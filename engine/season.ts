/**
 * Saisonlauf ueber alle zehn Ligen.
 *
 * Die Ligazugehoerigkeit eines Teams steht in team_seasons, nicht in
 * teams.start_tier - letzteres ist ab Saison 2 falsch. prepareSeason legt die
 * Zeilen an, bevor das erste Rennen laeuft.
 */

import type { Database } from './savegame.js';
import { loadTrackProfiles } from './scoring.js';
import { simulateWeekend, type Entry, type ResultRow, type WeekendContext } from './lightsim.js';
import { nextTier, type Movement } from './promotion.js';
import { loadPayoutRules, parachuteFor, payoutFor } from './finance.js';
import { simulateRace, type Compound, type RaceContext, type RaceEntry } from './racesim.js';
import { loadStaffValues } from './staff.js';

const PART_KEYS = [
  'chassis',
  'front_wing',
  'rear_wing',
  'floor',
  'powertrain',
  'ers',
  'gearbox',
  'suspension',
  'brakes',
];

const DRIVER_KEYS = [
  'pace',
  'qualifying',
  'braking',
  'cornering',
  'car_control',
  'starts',
  'tyre_management',
  'consistency',
];

export interface SeasonSummary {
  weekends: number;
  results: number;
  dnfs: number;
}

interface Roster {
  entries: Entry[];
}

function loadRosters(db: Database, season: number): Map<number, Roster> {
  // Ab M5 kommen die Fahrer aus driver_state, nicht mehr aus drivers: Nur dort
  // steht, wer in *dieser* Saison fuer wen faehrt.
  const drivers = db
    .prepare(
      `SELECT ds.driver_id, ds.team_id AS team_id, ts.tier AS tier,
              ${DRIVER_KEYS.map((key) => `ds.${key}`).join(', ')}
       FROM driver_state ds
       JOIN team_seasons ts ON ts.team_id = ds.team_id AND ts.season = ds.season
       WHERE ds.season = ? AND ds.role = 'race' AND ds.retired = 0
       ORDER BY ts.tier, ds.team_id, ds.seat`,
    )
    .all(season) as Record<string, number>[];

  const parts = new Map<number, Record<string, number>>();
  const reliability = new Map<number, number>();
  // Der Reglementdeckel wirkt hier, nicht beim Speichern: gefahren wird
  // min(performance, Deckel), gespeichert bleibt der echte Wert (Konzept 6.2).
  for (const row of db
    .prepare(
      `SELECT c.team_id, c.part_key, c.reliability,
              MIN(c.performance, r.cap) AS performance
       FROM car_parts c
       JOIN team_seasons ts ON ts.team_id = c.team_id AND ts.season = c.season
       JOIN (SELECT tier, 'chassis' k, cap_chassis cap FROM league_regulations WHERE season = 1
             UNION ALL SELECT tier,'front_wing',cap_front_wing FROM league_regulations WHERE season=1
             UNION ALL SELECT tier,'rear_wing',cap_rear_wing FROM league_regulations WHERE season=1
             UNION ALL SELECT tier,'floor',cap_floor FROM league_regulations WHERE season=1
             UNION ALL SELECT tier,'powertrain',cap_powertrain FROM league_regulations WHERE season=1
             UNION ALL SELECT tier,'ers',cap_ers FROM league_regulations WHERE season=1
             UNION ALL SELECT tier,'gearbox',cap_gearbox FROM league_regulations WHERE season=1
             UNION ALL SELECT tier,'suspension',cap_suspension FROM league_regulations WHERE season=1
             UNION ALL SELECT tier,'brakes',cap_brakes FROM league_regulations WHERE season=1) r
         ON r.tier = ts.tier AND r.k = c.part_key
       WHERE c.season = ?`,
    )
    .all(season) as Record<string, number>[]) {
    const key = row.team_id as number;
    const current = parts.get(key) ?? {};
    current[row.part_key as unknown as string] = row.performance;
    parts.set(key, current);
    // Das schwaechste Bauteil bestimmt, wie oft das Auto stehen bleibt.
    reliability.set(key, Math.min(reliability.get(key) ?? 100, row.reliability));
  }

  const byTier = new Map<number, Roster>();
  for (const row of drivers) {
    const tier = row.tier;
    const roster = byTier.get(tier) ?? { entries: [] };
    roster.entries.push({
      driverId: row.driver_id,
      teamId: row.team_id,
      parts: parts.get(row.team_id) ?? Object.fromEntries(PART_KEYS.map((key) => [key, 0])),
      attributes: Object.fromEntries(DRIVER_KEYS.map((key) => [key, row[key]])),
      reliability: reliability.get(row.team_id) ?? 70,
    });
    byTier.set(tier, roster);
  }
  return byTier;
}

/**
 * Laedt die Reifenmischungen. Regenmischungen bleiben aussen vor, solange es
 * kein Wetter gibt (M7).
 */
function loadCompounds(db: Database): Compound[] {
  return (db
    .prepare('SELECT * FROM tyre_compounds WHERE wet_only = 0 ORDER BY compound_id')
    .all() as Record<string, number | string>[]).map((row) => ({
    compoundId: row.compound_id as number,
    shortName: String(row.short_name),
    grip: row.grip as number,
    wearRate: row.wear_rate as number,
    cliffWearPct: row.cliff_wear_pct as number,
    minStintLaps: row.min_stint_laps as number,
  }));
}

export function runSeason(db: Database, season: number, tickTier = 0): SeasonSummary {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as { world_seed: number }).world_seed;
  const rosters = loadRosters(db, season);
  const profiles = loadTrackProfiles(db);

  const leagues = db.prepare('SELECT * FROM leagues ORDER BY tier').all() as Record<string, number>[];
  const formats = new Map(
    (db.prepare('SELECT * FROM race_weekend_formats').all() as Record<string, number>[]).map(
      (row) => [row.format_id, row],
    ),
  );
  const tracks = new Map(
    (db.prepare('SELECT track_id, overtaking_difficulty FROM tracks').all() as Record<
      string,
      number
    >[]).map((row) => [row.track_id, row.overtaking_difficulty]),
  );

  const pointsBySystem = new Map<number, Map<number, number>>();
  for (const row of db.prepare('SELECT * FROM points_systems').all() as Record<string, number>[]) {
    const table = pointsBySystem.get(row.points_system_id) ?? new Map<number, number>();
    table.set(row.position, row.points);
    pointsBySystem.set(row.points_system_id, table);
  }
  const meta = new Map(
    (db.prepare('SELECT * FROM points_systems_meta').all() as Record<string, number>[]).map(
      (row) => [row.points_system_id, row],
    ),
  );

  const trackData = new Map(
    (db.prepare('SELECT * FROM tracks').all() as Record<string, number>[]).map((row) => [
      row.track_id,
      row,
    ]),
  );
  const compounds = loadCompounds(db);
  // Strategen- und Crewqualitaet kommen jetzt aus dem Personalbestand.
  const staffValues = loadStaffValues(db, season);

  const insertLap = db.prepare(
    `INSERT INTO lap_records (season, tier, round, leg, lap, driver_id, position, lap_time_ms, gap_to_leader_ms, compound, tyre_wear, fuel_kg, event)
     VALUES (@season, @tier, @round, @leg, @lap, @driver_id, @position, @lap_time_ms, @gap_to_leader_ms, @compound, @tyre_wear, @fuel_kg, @event)`,
  );
  const insertAnalysis = db.prepare(
    `INSERT INTO race_analysis (season, tier, round, leg, driver_id, stops, best_lap_ms, total_ms, lost_tyres_s, lost_fuel_s, lost_traffic_s, lost_pits_s)
     VALUES (@season, @tier, @round, @leg, @driver_id, @stops, @best_lap_ms, @total_ms, @lost_tyres_s, @lost_fuel_s, @lost_traffic_s, @lost_pits_s)`,
  );

  const insert = db.prepare(
    `INSERT INTO race_results (season, tier, round, leg, driver_id, team_id, grid, position, status, points, pole, fastest_lap)
     VALUES (@season, @tier, @round, @leg, @driver_id, @team_id, @grid, @position, @status, @points, @pole, @fastest_lap)`,
  );

  let weekends = 0;
  let results = 0;
  let dnfs = 0;

  const run = db.transaction(() => {
    for (const league of leagues) {
      const tier = league.tier;
      const roster = rosters.get(tier);
      if (!roster) continue;

      const system = pointsBySystem.get(league.points_system_id) ?? new Map<number, number>();
      const systemMeta = meta.get(league.points_system_id);
      // Folgesaisons nutzen bis zum CalendarService den Startkalender.
      const calendar = db
        .prepare('SELECT * FROM calendar WHERE season = 1 AND tier = ? ORDER BY round')
        .all(tier) as Record<string, number>[];

      for (const round of calendar) {
        const format = formats.get(round.format_id);
        const profile = profiles.get(round.track_id);
        if (!format || !profile) continue;

        const context: WeekendContext = {
          worldSeed,
          season,
          tier,
          round: round.round,
          profile,
          overtakingDifficulty: tracks.get(round.track_id) ?? 0.5,
          dnfBaseRate: league.dnf_base_rate,
          legCount: format.race_count,
          reverseGridTopN: format.reverse_grid_top_n,
          points: system,
          bonusPole: systemMeta?.bonus_pole ?? 0,
          bonusFastestLap: systemMeta?.bonus_fastest_lap ?? 0,
          fastestLapMaxPosition: systemMeta?.fastest_lap_max_position ?? 10,
        };

        let rows: ResultRow[] = simulateWeekend(roster.entries, context);
        weekends += 1;

        // Die gewaehlte Liga wird rundenweise nachgerechnet. Die Light-Sim
        // liefert dabei die Startaufstellung - das Qualifying bleibt ihr
        // Zustaendigkeitsbereich, gefahren wird das Rennen dann echt.
        if (tier === tickTier) {
          const track = trackData.get(round.track_id);
          // Die bereits gerechnete Light-Sim liefert nur noch die
          // Startaufstellung; ihre Rennergebnisse werden verworfen.
          const light = rows;
          const gridOf = new Map(
            light.filter((r) => r.leg === 1).map((r) => [r.driverId, r.grid]),
          );
          rows = [];

          for (let leg = 1; leg <= format.race_count; leg += 1) {
            const raceEntries: RaceEntry[] = roster.entries.map((entry) => {
              const staff = staffValues.get(entry.teamId);
              return {
                ...entry,
                strategy: staff?.strategy ?? 55,
                crew: staff?.pit ?? 55,
                grid: gridOf.get(entry.driverId) ?? roster.entries.length,
              };
            });

            const raceContext: RaceContext = {
              worldSeed,
              season,
              tier,
              round: round.round,
              leg,
              profile,
              trackLengthM: track?.length_m ?? 4500,
              laps: Math.max(8, Math.round((track?.laps ?? 55) * format.race_distance_pct)),
              abrasion: track?.abrasion ?? 0.6,
              pitLossS: track?.pit_loss_s ?? 20,
              overtakingDifficulty: tracks.get(round.track_id) ?? 0.5,
              dnfBaseRate: league.dnf_base_rate,
              compounds,
            };

            const race = simulateRace(raceEntries, raceContext);
            for (const record of race.records) {
              insertLap.run({
                season,
                tier,
                round: round.round,
                leg,
                lap: record.lap,
                driver_id: record.driverId,
                position: record.position,
                lap_time_ms: record.lapTimeMs,
                gap_to_leader_ms: record.gapToLeaderMs,
                compound: record.compound,
                tyre_wear: record.tyreWear,
                fuel_kg: record.fuelKg,
                event: record.event,
              });
            }

            let fastest: number | null = null;
            let fastestMs = Number.POSITIVE_INFINITY;
            for (const outcome of race.outcomes) {
              if (
                outcome.status === 'classified' &&
                outcome.bestLapMs > 0 &&
                outcome.bestLapMs < fastestMs &&
                (outcome.position ?? 99) <= (systemMeta?.fastest_lap_max_position ?? 10)
              ) {
                fastestMs = outcome.bestLapMs;
                fastest = outcome.driverId;
              }
              insertAnalysis.run({
                season,
                tier,
                round: round.round,
                leg,
                driver_id: outcome.driverId,
                stops: outcome.stops,
                best_lap_ms: outcome.bestLapMs,
                total_ms: outcome.totalMs,
                lost_tyres_s: outcome.lostToTyres,
                lost_fuel_s: outcome.lostToFuel,
                lost_traffic_s: outcome.lostToTraffic,
                lost_pits_s: outcome.lostToPits,
              });
            }

            const poleDriver = leg === 1 ? (light[0]?.driverId ?? null) : null;
            rows.push(
              ...race.outcomes.map((outcome) => {
                let points = outcome.position ? system.get(outcome.position) ?? 0 : 0;
                const isPole = outcome.driverId === poleDriver;
                const isFastest = outcome.driverId === fastest;
                if (isPole) points += systemMeta?.bonus_pole ?? 0;
                if (isFastest) points += systemMeta?.bonus_fastest_lap ?? 0;
                return {
                  leg,
                  driverId: outcome.driverId,
                  teamId: outcome.teamId,
                  grid: outcome.grid,
                  position: outcome.position,
                  status: outcome.status,
                  points,
                  pole: isPole,
                  fastestLap: isFastest,
                };
              }),
            );
          }
        }

        for (const row of rows) {
          insert.run({
            season,
            tier,
            round: round.round,
            leg: row.leg,
            driver_id: row.driverId,
            team_id: row.teamId,
            grid: row.grid,
            position: row.position,
            status: row.status,
            points: row.points,
            pole: row.pole ? 1 : 0,
            fastest_lap: row.fastestLap ? 1 : 0,
          });
          results += 1;
          if (row.status === 'dnf') dnfs += 1;
        }
      }
    }
  });

  run();
  return { weekends, results, dnfs };
}

/**
 * Tabellen aus den Ergebnissen. Bewusst als Aggregation ueber race_results
 * statt als mitgefuehrter Zaehler - so kann eine Tabelle nie von den
 * Ergebnissen abweichen, aus denen sie entsteht.
 */
export function buildStandings(db: Database, season: number): void {
  const run = db.transaction(() => {
    // team_seasons existiert bereits (prepareSeason) - hier werden nur die
    // Kennzahlen nachgetragen, die Ligazugehoerigkeit bleibt unangetastet.
    db.prepare(
      `UPDATE team_seasons SET
         points  = COALESCE((SELECT SUM(points) FROM race_results r WHERE r.season = team_seasons.season AND r.team_id = team_seasons.team_id), 0),
         wins    = COALESCE((SELECT COUNT(*) FROM race_results r WHERE r.season = team_seasons.season AND r.team_id = team_seasons.team_id AND r.position = 1), 0),
         podiums = COALESCE((SELECT COUNT(*) FROM race_results r WHERE r.season = team_seasons.season AND r.team_id = team_seasons.team_id AND r.position <= 3), 0),
         dnfs    = COALESCE((SELECT COUNT(*) FROM race_results r WHERE r.season = team_seasons.season AND r.team_id = team_seasons.team_id AND r.status = 'dnf'), 0)
       WHERE season = ?`,
    ).run(season);

    db.prepare('DELETE FROM driver_seasons WHERE season = ?').run(season);

    db.prepare(
      `INSERT INTO driver_seasons (driver_id, season, tier, team_id, points, wins, podiums, poles, dnfs)
       SELECT driver_id, season, tier, team_id,
              SUM(points),
              SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END),
              SUM(CASE WHEN position <= 3 THEN 1 ELSE 0 END),
              SUM(pole),
              SUM(CASE WHEN status = 'dnf' THEN 1 ELSE 0 END)
       FROM race_results WHERE season = ? GROUP BY driver_id, season, tier, team_id`,
    ).run(season);

    // Platzierung je Liga. Bei Punktgleichheit entscheidet die Zahl der Siege,
    // danach die der Podien - dieselbe Reihenfolge wie im Motorsport ueblich.
    for (const table of ['team_seasons', 'driver_seasons'] as const) {
      const idColumn = table === 'team_seasons' ? 'team_id' : 'driver_id';
      db.prepare(
        `UPDATE ${table} SET final_rank = (
           SELECT COUNT(*) + 1 FROM ${table} other
           WHERE other.season = ${table}.season AND other.tier = ${table}.tier
             AND (other.points > ${table}.points
               OR (other.points = ${table}.points AND other.wins > ${table}.wins)
               OR (other.points = ${table}.points AND other.wins = ${table}.wins
                   AND other.podiums > ${table}.podiums)
               OR (other.points = ${table}.points AND other.wins = ${table}.wins
                   AND other.podiums = ${table}.podiums AND other.${idColumn} < ${table}.${idColumn}))
         ) WHERE season = ?`,
      ).run(season);
    }
  });

  run();
}

/**
 * Legt die team_seasons-Zeilen einer Saison an und bestimmt damit, wer wo
 * faehrt. Saison 1 kommt aus teams.start_tier, jede weitere aus Liga und
 * Bewegung der Vorsaison.
 */
export function prepareSeason(db: Database, season: number): void {
  const run = db.transaction(() => {
    db.prepare('DELETE FROM team_seasons WHERE season = ?').run(season);

    if (season === 1) {
      db.prepare(
        'INSERT INTO team_seasons (team_id, season, tier) SELECT team_id, 1, start_tier FROM teams',
      ).run();
      return;
    }

    const previous = db
      .prepare('SELECT team_id, tier, movement FROM team_seasons WHERE season = ?')
      .all(season - 1) as { team_id: number; tier: number; movement: Movement | null }[];

    const insert = db.prepare('INSERT INTO team_seasons (team_id, season, tier) VALUES (?, ?, ?)');
    for (const row of previous) {
      insert.run(row.team_id, season, nextTier(row.tier, row.movement));
    }
  });

  run();
}

/**
 * Bucht Ausschuettung, Fallschirm und Ausgaben einer Saison.
 *
 * Muss nach buildStandings laufen: Der variable Anteil haengt am Tabellenplatz.
 */
export function applyFinances(db: Database, season: number): void {
  const rules = loadPayoutRules(db);
  const costCaps = new Map(
    (db.prepare('SELECT tier, cost_cap FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.cost_cap]),
  );
  const teamCounts = new Map(
    (db.prepare('SELECT tier, COUNT(*) n FROM team_seasons WHERE season = ? GROUP BY tier')
      .all(season) as Record<string, number>[]).map((row) => [row.tier, row.n]),
  );

  const standings = db
    .prepare('SELECT team_id, tier, final_rank FROM team_seasons WHERE season = ?')
    .all(season) as { team_id: number; tier: number; final_rank: number | null }[];

  // Eroeffnungsbestand: Startkapital in Saison 1, sonst der Schlussbestand
  // der Vorsaison.
  const opening = new Map<number, number>();
  if (season === 1) {
    for (const row of db.prepare('SELECT team_id, start_capital FROM teams').all() as Record<
      string,
      number
    >[]) {
      opening.set(row.team_id, row.start_capital);
    }
  } else {
    for (const row of db
      .prepare('SELECT team_id, closing FROM team_finances WHERE season = ?')
      .all(season - 1) as Record<string, number>[]) {
      opening.set(row.team_id, row.closing);
    }
  }

  // Fallschirm: Wer in einer der beiden Vorsaisons abgestiegen ist, bekommt
  // einen Anteil der Ausschuettungsdifferenz zur damaligen Liga.
  const historyRows = db
    .prepare('SELECT team_id, season, tier FROM team_seasons WHERE season IN (?, ?)')
    .all(season - 1, season - 2) as { team_id: number; season: number; tier: number }[];
  const history = new Map<string, number>();
  for (const row of historyRows) history.set(`${row.team_id}|${row.season}`, row.tier);

  const insert = db.prepare(
    `INSERT INTO team_finances (team_id, season, tier, opening, payout, parachute, expenses, closing)
     VALUES (@team_id, @season, @tier, @opening, @payout, @parachute, @expenses, @closing)`,
  );

  const run = db.transaction(() => {
    db.prepare('DELETE FROM team_finances WHERE season = ?').run(season);

    for (const team of standings) {
      const rule = rules.get(team.tier);
      if (!rule) continue;
      const count = teamCounts.get(team.tier) ?? 1;
      const payout = payoutFor(rule, team.final_rank ?? count, count);

      let parachute = 0;
      for (const back of [1, 2] as const) {
        const previousTier = history.get(`${team.team_id}|${season - back}`);
        if (previousTier !== undefined && previousTier < team.tier) {
          parachute += parachuteFor(rules.get(previousTier), rule, back);
        }
      }

      const expenses = Math.round(rule.expenseRatio * (costCaps.get(team.tier) ?? 0));
      const start = opening.get(team.team_id) ?? 0;
      insert.run({
        team_id: team.team_id,
        season,
        tier: team.tier,
        opening: start,
        payout,
        parachute,
        expenses,
        closing: start + payout + parachute - expenses,
      });
    }
  });

  run();
}
