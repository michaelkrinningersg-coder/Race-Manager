/**
 * Saisonlauf ueber alle zehn Ligen.
 *
 * M1 aus der Roadmap: eine Saison laeuft komplett durch, die Tabellen stimmen.
 * Auf- und Abstieg (M2) bleibt bewusst aussen vor - team_seasons.movement
 * existiert schon als Spalte, wird hier aber noch nicht gefuellt.
 */

import type { Database } from './savegame.js';
import { loadTrackProfiles } from './scoring.js';
import { simulateWeekend, type Entry, type ResultRow, type WeekendContext } from './lightsim.js';

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
  const drivers = db
    .prepare(
      `SELECT d.driver_id, d.start_team_id AS team_id, t.start_tier AS tier,
              ${DRIVER_KEYS.map((key) => `d.${key}`).join(', ')}
       FROM drivers d JOIN teams t ON t.team_id = d.start_team_id
       WHERE d.start_role = 'race'
       ORDER BY t.start_tier, d.start_team_id, d.start_seat`,
    )
    .all() as Record<string, number>[];

  const parts = new Map<number, Record<string, number>>();
  const reliability = new Map<number, number>();
  for (const row of db
    .prepare('SELECT team_id, part_key, performance, reliability FROM car_parts WHERE season = ?')
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

export function runSeason(db: Database, season: number): SeasonSummary {
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
      const calendar = db
        .prepare('SELECT * FROM calendar WHERE season = ? AND tier = ? ORDER BY round')
        .all(season, tier) as Record<string, number>[];

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

        const rows: ResultRow[] = simulateWeekend(roster.entries, context);
        weekends += 1;

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
    db.prepare('DELETE FROM team_seasons WHERE season = ?').run(season);
    db.prepare('DELETE FROM driver_seasons WHERE season = ?').run(season);

    db.prepare(
      `INSERT INTO team_seasons (team_id, season, tier, points, wins, podiums, dnfs)
       SELECT team_id, season, tier,
              SUM(points),
              SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END),
              SUM(CASE WHEN position <= 3 THEN 1 ELSE 0 END),
              SUM(CASE WHEN status = 'dnf' THEN 1 ELSE 0 END)
       FROM race_results WHERE season = ? GROUP BY team_id, season, tier`,
    ).run(season);

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
