/**
 * Personal: Bestand, Karrieren und Personalmarkt (Konzept 8.1).
 *
 * Drei getroffene Entscheidungen praegen dieses Modul:
 *
 * 1. **Rollen von Hand, Personen generiert.** `staff_roles.csv` legt fest, WAS
 *    eine Rolle bewirkt - acht Zeilen, die das Balancing tragen. WER sie
 *    ausfuellt, entsteht deterministisch aus dem Seed. 167 Teams mal neun
 *    Stellen waeren sonst rund 1.500 Zeilen Handarbeit.
 * 2. **Sieben Rollen wirken, der Nachwuchsleiter noch nicht.** Seine Wirkung
 *    ist Sichtbarkeit und Schaetzgenauigkeit - das braucht erst einen Spieler,
 *    der etwas nicht weiss. Er wird trotzdem besetzt und bezahlt, damit spaeter
 *    kein Bestand nachgezogen werden muss.
 * 3. **Abwerbung nur ueber zwei Ligen hinweg.** Ein Tier-6-Team verliert seinen
 *    Chefkonstrukteur an Tier 4 und hoeher, nie an den direkten Ligarivalen.
 *    Konzept 8.1 will die Dramatik, dass ein erfolgreiches kleines Team seine
 *    Leute nach oben verliert; der Abstand von zwei Stufen nimmt ihr die Spitze
 *    gegen genau den Konkurrenten, gegen den der Aufstieg entschieden wird.
 *
 * Der Personalwert einer Wirkung ist immer ein gewichteter Mittelwert: je Rolle
 * das Mittel ihrer Stelleninhaber, gewichtet mit der Spalte aus
 * `staff_roles.csv`. Da jede Spalte auf 1.0 normiert ist, liegt das Ergebnis
 * auf derselben 0-100-Skala wie die Einzelwerte.
 */

import type { Database } from './savegame.js';
import { createRng, gaussian, seedFrom } from './rng.js';

/** Wirkungen, die das Personal traegt. Namensgleich mit den Spalten der CSV. */
export type StaffEffect =
  | 'chassis'
  | 'front_wing'
  | 'rear_wing'
  | 'floor'
  | 'powertrain'
  | 'ers'
  | 'gearbox'
  | 'suspension'
  | 'brakes'
  | 'reliability'
  | 'strategy'
  | 'pit'
  | 'feedback'
  | 'morale'
  | 'newgen';

interface RoleSpec {
  roleKey: string;
  countPerTeam: number;
  salaryShare: number;
  weights: Record<string, number>;
}

/**
 * Anteil des Kostendeckels, den ein Team fuer sein gesamtes Personal ausgibt.
 *
 * Von 0.22 auf 0.18 gesenkt, als die Gehaelter mit M6 erstmals wirklich gebucht
 * wurden. Vorher war der Wert nie gegen eine Bilanz geprueft - er konnte es
 * nicht sein, weil er nirgends abgezogen wurde. Gemessen kostete das
 * neunkoepfige Personal damit das Drei- bis Fuenffache der beiden Fahrer.
 */
const STAFF_BUDGET_SHARE = 0.18;

/** Ab wie vielen Saisons im Amt die Loyalitaet einen Wechsel spuerbar bremst. */
const LOYALTY_FULL = 6;

export interface StaffSummary {
  hired: number;
  poached: number;
  retired: number;
  newcomers: number;
}

export function loadRoles(db: Database): RoleSpec[] {
  return (db.prepare('SELECT * FROM staff_roles ORDER BY sort_order').all() as Record<
    string,
    number | string
  >[]).map((row) => {
    const weights: Record<string, number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('w_')) weights[key.slice(2)] = value as number;
    }
    return {
      roleKey: String(row.role_key),
      countPerTeam: row.count_per_team as number,
      salaryShare: row.salary_share as number,
      weights,
    };
  });
}

/**
 * Personalwerte aller Teams einer Saison, je Wirkung ein Wert auf 0-100.
 *
 * Ein Team ohne besetzte Stelle faellt auf den Ligaschnitt zurueck, damit eine
 * Luecke im Bestand nicht als Nullwert durchschlaegt.
 */
export function loadStaffValues(
  db: Database,
  season: number,
): Map<number, Record<StaffEffect, number>> {
  const roles = loadRoles(db);
  const rows = db
    .prepare(
      `SELECT ss.team_id, s.role_key, AVG(ss.rating) AS rating
       FROM staff_state ss JOIN staff s ON s.staff_id = ss.staff_id
       WHERE ss.season = ? AND ss.retired = 0 AND ss.team_id IS NOT NULL
       GROUP BY ss.team_id, s.role_key`,
    )
    .all(season) as { team_id: number; role_key: string; rating: number }[];

  const byTeam = new Map<number, Map<string, number>>();
  for (const row of rows) {
    const current = byTeam.get(row.team_id) ?? new Map<string, number>();
    current.set(row.role_key, row.rating);
    byTeam.set(row.team_id, current);
  }

  const result = new Map<number, Record<StaffEffect, number>>();
  for (const [teamId, ratings] of byTeam) {
    const values = {} as Record<StaffEffect, number>;
    for (const effect of Object.keys(roles[0]?.weights ?? {}) as StaffEffect[]) {
      let total = 0;
      let covered = 0;
      for (const role of roles) {
        const weight = role.weights[effect] ?? 0;
        if (weight <= 0) continue;
        const rating = ratings.get(role.roleKey);
        if (rating === undefined) continue;
        total += weight * rating;
        covered += weight;
      }
      // Auf den abgedeckten Anteil hochrechnen: Eine unbesetzte Stelle senkt
      // den Wert nicht kuenstlich, sie faellt einfach aus der Gewichtung.
      values[effect] = covered > 0 ? total / covered : 50;
    }
    result.set(teamId, values);
  }
  return result;
}

/** Wertband einer Liga - dieselbe Staffelung wie bei den Fahrern. */
function ratingBand(tier: number): { min: number; max: number } {
  const min = 87 - 6 * (tier - 1) - 4;
  return { min: Math.max(15, min), max: Math.max(22, min + 8) };
}

/**
 * Legt den Personalbestand der ersten Saison an: neun Stellen je Team, besetzt
 * im Wertband der jeweiligen Liga.
 */
export function seedStaff(db: Database): number {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;
  const roles = loadRoles(db);
  const teams = db.prepare('SELECT team_id, tier FROM team_seasons WHERE season = 1').all() as {
    team_id: number;
    tier: number;
  }[];
  const costCaps = new Map(
    (db.prepare('SELECT tier, cost_cap FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.cost_cap]),
  );
  const pools = namePools(db);

  const insertStaff = db.prepare(
    `INSERT INTO staff (staff_id, first_name, last_name, country, birth_year, role_key, potential)
     VALUES (@staff_id, @first_name, @last_name, @country, @birth_year, @role_key, @potential)`,
  );
  const insertState = db.prepare(
    `INSERT INTO staff_state (staff_id, season, team_id, rating, loyalty, contract_until, salary, retired)
     VALUES (@staff_id, 1, @team_id, @rating, @loyalty, @contract_until, @salary, 0)`,
  );

  let nextId = 400001;
  let created = 0;

  const run = db.transaction(() => {
    for (const team of teams) {
      const band = ratingBand(team.tier);
      const budget = (costCaps.get(team.tier) ?? 0) * STAFF_BUDGET_SHARE;
      for (const role of roles) {
        for (let seat = 0; seat < role.countPerTeam; seat += 1) {
          const rng = createRng(seedFrom(worldSeed, team.team_id, nextId, seat, 21));
          const rating = Math.max(
            10,
            Math.min(99, Math.round(band.min + rng() * (band.max - band.min))),
          );
          const age = 32 + Math.floor(rng() * 26);
          const person = drawName(pools, rng);
          insertStaff.run({
            staff_id: nextId,
            first_name: person.first,
            last_name: person.last,
            country: person.country,
            birth_year: 2026 - age,
            role_key: role.roleKey,
            potential: Math.max(rating, Math.min(99, Math.round(rating + rng() * 12))),
          });
          insertState.run({
            staff_id: nextId,
            team_id: team.team_id,
            rating,
            loyalty: Math.round(30 + rng() * 50),
            contract_until: 1 + Math.floor(rng() * 4),
            salary: Math.round(budget * role.salaryShare),
          });
          nextId += 1;
          created += 1;
        }
      }
    }
  });

  run();
  return created;
}

interface NamePool {
  country: string;
  weight: number;
  first: string[];
  last: string[];
}

function namePools(db: Database): NamePool[] {
  return (db.prepare('SELECT * FROM driver_names ORDER BY country').all() as {
    country: string;
    weight: number;
    first_names: string;
    last_names: string;
  }[]).map((row) => ({
    country: row.country,
    weight: row.weight,
    first: row.first_names.split('|'),
    last: row.last_names.split('|'),
  }));
}

function drawName(
  pools: NamePool[],
  rng: () => number,
): { first: string; last: string; country: string } {
  const total = pools.reduce((sum, pool) => sum + pool.weight, 0);
  let pick = rng() * total;
  let chosen = pools[0];
  for (const pool of pools) {
    pick -= pool.weight;
    if (pick <= 0) {
      chosen = pool;
      break;
    }
  }
  return {
    first: chosen.first[Math.floor(rng() * chosen.first.length)],
    last: chosen.last[Math.floor(rng() * chosen.last.length)],
    country: chosen.country,
  };
}

/**
 * Traegt den Personalbestand in die Folgesaison fort.
 *
 * Personal altert langsamer als Fahrer und laenger produktiv: Ein
 * Chefkonstrukteur ist mit 55 auf der Hoehe, nicht im Abbau. Der Abbau setzt
 * erst nach 62 ein.
 */
export function ageStaff(db: Database, fromSeason: number, toSeason: number): void {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;

  const rows = db
    .prepare(
      `SELECT ss.*, s.birth_year, s.potential, ts.tier
       FROM staff_state ss
       JOIN staff s ON s.staff_id = ss.staff_id
       LEFT JOIN team_seasons ts ON ts.team_id = ss.team_id AND ts.season = ss.season
       WHERE ss.season = ? AND ss.retired = 0`,
    )
    .all(fromSeason) as Record<string, number | null>[];

  const insert = db.prepare(
    `INSERT INTO staff_state (staff_id, season, team_id, rating, loyalty, contract_until, salary, retired)
     VALUES (@staff_id, @season, @team_id, @rating, @loyalty, @contract_until, @salary, 0)`,
  );

  const run = db.transaction(() => {
    db.prepare('DELETE FROM staff_state WHERE season = ?').run(toSeason);

    for (const row of rows) {
      const age = 2026 + toSeason - (row.birth_year as number);
      const rating = row.rating as number;
      const potential = row.potential as number;
      const rng = createRng(seedFrom(worldSeed, toSeason, row.staff_id as number, 23));

      // Eine haertere Liga entwickelt schneller - wie bei den Fahrern.
      const tier = (row.tier as number | null) ?? 10;
      const leagueFactor = row.team_id === null ? 0.3 : 1.16 - (tier - 1) * 0.04;

      let delta: number;
      if (age <= 45) delta = 0.16 * leagueFactor * Math.max(0, potential - rating);
      else if (age <= 61) delta = 0.08 * leagueFactor * Math.max(0, potential - rating);
      else delta = -1.4;

      insert.run({
        staff_id: row.staff_id,
        season: toSeason,
        team_id: row.team_id,
        rating: Math.max(10, Math.min(99, Math.round(rating + delta + gaussian(rng) * 0.7))),
        // Wer bleibt, bindet sich staerker; wer wechselt, faengt bei null an.
        loyalty: Math.min(100, (row.loyalty as number) + 8),
        contract_until: row.contract_until,
        salary: row.salary,
        retired: 0,
      });
    }
  });

  run();
}

/** Ruhestand. Spaeter als bei Fahrern und ohne Leistungsknick davor. */
export function retireStaff(db: Database, season: number): number {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;

  const rows = db
    .prepare(
      `SELECT ss.staff_id, s.birth_year FROM staff_state ss
       JOIN staff s ON s.staff_id = ss.staff_id
       WHERE ss.season = ? AND ss.retired = 0`,
    )
    .all(season) as { staff_id: number; birth_year: number }[];

  const update = db.prepare(
    'UPDATE staff_state SET retired = 1, team_id = NULL WHERE staff_id = ? AND season = ?',
  );
  const note = db.prepare(
    `INSERT OR REPLACE INTO staff_history (staff_id, season, event, tier, team_id, detail)
     VALUES (?, ?, 'retired', NULL, (SELECT team_id FROM staff_state WHERE staff_id = ? AND season = ?), ?)`,
  );

  let count = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      const age = 2026 + season - row.birth_year;
      let chance: number;
      if (age < 60) chance = 0;
      else if (age <= 64) chance = 0.12;
      else if (age <= 68) chance = 0.35;
      else chance = 1;
      const rng = createRng(seedFrom(worldSeed, season, row.staff_id, 27));
      if (rng() < chance) {
        note.run(row.staff_id, season, row.staff_id, season, `Alter ${age}`);
        update.run(row.staff_id, season);
        count += 1;
      }
    }
  });
  run();
  return count;
}

/**
 * Personalmarkt einer Saison.
 *
 * Reihenfolge: erst Abwerbung, dann auslaufende Vertraege, dann Nachbesetzung.
 * Die Abwerbung laeuft von oben nach unten, damit die reichste Liga zuerst
 * zugreift - und sie springt mindestens zwei Ligastufen (getroffene
 * Entscheidung).
 */
export function runStaffMarket(db: Database, season: number): StaffSummary {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;
  const roles = loadRoles(db);
  const pools = namePools(db);
  const summary: StaffSummary = { hired: 0, poached: 0, retired: 0, newcomers: 0 };

  const teams = db.prepare('SELECT team_id, tier FROM team_seasons WHERE season = ?').all(season) as {
    team_id: number;
    tier: number;
  }[];
  const tierOf = new Map(teams.map((row) => [row.team_id, row.tier]));
  const costCaps = new Map(
    (db.prepare('SELECT tier, cost_cap FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.cost_cap]),
  );

  const budgetOf = (teamId: number): number =>
    (costCaps.get(tierOf.get(teamId) ?? 10) ?? 0) * STAFF_BUDGET_SHARE;

  const maxId = (db.prepare('SELECT COALESCE(MAX(staff_id), 400000) m FROM staff').get() as {
    m: number;
  }).m;
  let nextId = maxId + 1;

  const insertStaff = db.prepare(
    `INSERT INTO staff (staff_id, first_name, last_name, country, birth_year, role_key, potential)
     VALUES (@staff_id, @first_name, @last_name, @country, @birth_year, @role_key, @potential)`,
  );
  const insertState = db.prepare(
    `INSERT INTO staff_state (staff_id, season, team_id, rating, loyalty, contract_until, salary, retired)
     VALUES (@staff_id, @season, @team_id, @rating, @loyalty, @contract_until, @salary, 0)`,
  );
  const move = db.prepare(
    `UPDATE staff_state SET team_id = ?, contract_until = ?, salary = ?, loyalty = 0
     WHERE staff_id = ? AND season = ?`,
  );
  const release = db.prepare(
    'UPDATE staff_state SET team_id = NULL, contract_until = NULL WHERE staff_id = ? AND season = ?',
  );
  const note = db.prepare(
    `INSERT OR REPLACE INTO staff_history (staff_id, season, event, tier, team_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const run = db.transaction(() => {
    // --- Abwerbung ---------------------------------------------------------
    // Ein Team sucht je Rolle den besten Kandidaten, der mindestens zwei Ligen
    // tiefer sitzt und besser ist als der eigene Mann. Loyalitaet und ein
    // laufender Vertrag schuetzen; ganz verhindern koennen sie es nicht -
    // dafuer steht die Ausstiegsklausel aus Konzept 8.1.
    const occupants = db
      .prepare(
        `SELECT ss.staff_id, ss.team_id, ss.rating, ss.loyalty, ss.contract_until, s.role_key
         FROM staff_state ss JOIN staff s ON s.staff_id = ss.staff_id
         WHERE ss.season = ? AND ss.retired = 0 AND ss.team_id IS NOT NULL`,
      )
      .all(season) as {
      staff_id: number;
      team_id: number;
      rating: number;
      loyalty: number;
      contract_until: number | null;
      role_key: string;
    }[];

    const byRole = new Map<string, typeof occupants>();
    for (const row of occupants) {
      const list = byRole.get(row.role_key) ?? [];
      list.push(row);
      byRole.set(row.role_key, list);
    }

    const poached = new Set<number>();
    const sortedTeams = [...teams].sort((a, b) => a.tier - b.tier || a.team_id - b.team_id);

    for (const team of sortedTeams) {
      for (const role of roles) {
        const mine = (byRole.get(role.roleKey) ?? []).filter(
          (row) => row.team_id === team.team_id && !poached.has(row.staff_id),
        );
        if (mine.length === 0) continue;
        const weakest = mine.reduce((worst, row) => (row.rating < worst.rating ? row : worst));

        const target = (byRole.get(role.roleKey) ?? [])
          .filter(
            (row) =>
              !poached.has(row.staff_id) &&
              row.rating > weakest.rating + 4 &&
              (tierOf.get(row.team_id) ?? 10) >= team.tier + 2,
          )
          .sort((a, b) => b.rating - a.rating)[0];
        if (!target) continue;

        const rng = createRng(seedFrom(worldSeed, season, team.team_id, target.staff_id, 29));
        // Je laenger jemand im Amt ist und je laenger sein Vertrag laeuft,
        // desto teurer wird der Ausstieg - und desto seltener klappt er.
        const bound = Math.min(1, target.loyalty / 100) * (LOYALTY_FULL / LOYALTY_FULL);
        const yearsLeft = Math.max(0, (target.contract_until ?? season) - season);
        const chance = Math.max(0.05, 0.75 - 0.45 * bound - 0.12 * yearsLeft);
        if (rng() > chance) continue;

        const years = 2 + Math.floor(rng() * 3);
        const salary = Math.round(budgetOf(team.team_id) * role.salaryShare);
        move.run(team.team_id, season + years, salary, target.staff_id, season);
        note.run(
          target.staff_id,
          season,
          'poached',
          team.tier,
          team.team_id,
          `aus Tier ${tierOf.get(target.team_id)}, Wert ${target.rating}`,
        );
        poached.add(target.staff_id);
        // Der abgegebene Platz wird gleich unten als Vakanz nachbesetzt.
        summary.poached += 1;
      }
    }

    // --- Auslaufende Vertraege --------------------------------------------
    for (const row of occupants) {
      if (poached.has(row.staff_id)) continue;
      if (row.contract_until === null || row.contract_until < season) {
        release.run(row.staff_id, season);
      }
    }

    // --- Vakanzen nachbesetzen --------------------------------------------
    const filled = db.prepare(
      `SELECT s.role_key, COUNT(*) n FROM staff_state ss JOIN staff s ON s.staff_id = ss.staff_id
       WHERE ss.season = ? AND ss.retired = 0 AND ss.team_id = ? GROUP BY s.role_key`,
    );
    // Ein Team nimmt einen freien Kandidaten nur, wenn er sein Ligaband nicht
    // unterschreitet - sonst waere ein Neuzugang besser. Ohne diese Schranke
    // griffen die Teams nach jedem Abgestiegenen aus tieferen Ligen, und der
    // Personalwert der Mittelfeldligen sackte ueber zwanzig Saisons um bis zu
    // vierzehn Punkte ab.
    const freeAgents = db.prepare(
      `SELECT ss.staff_id, ss.rating FROM staff_state ss JOIN staff s ON s.staff_id = ss.staff_id
       WHERE ss.season = ? AND ss.retired = 0 AND ss.team_id IS NULL AND s.role_key = ?
         AND ss.rating >= ?
       ORDER BY ss.rating DESC LIMIT 1`,
    );

    for (const team of sortedTeams) {
      const have = new Map(
        (filled.all(season, team.team_id) as { role_key: string; n: number }[]).map((row) => [
          row.role_key,
          row.n,
        ]),
      );
      const band = ratingBand(team.tier);
      for (const role of roles) {
        const missing = role.countPerTeam - (have.get(role.roleKey) ?? 0);
        for (let i = 0; i < missing; i += 1) {
          const rng = createRng(seedFrom(worldSeed, season, team.team_id, nextId + i, 31));
          const salary = Math.round(budgetOf(team.team_id) * role.salaryShare);
          const years = 2 + Math.floor(rng() * 3);

          const candidate = freeAgents.get(season, role.roleKey, band.min - 4) as
            | { staff_id: number; rating: number }
            | undefined;
          if (candidate) {
            move.run(team.team_id, season + years, salary, candidate.staff_id, season);
            note.run(candidate.staff_id, season, 'hired', team.tier, team.team_id, `Wert ${candidate.rating}`);
            summary.hired += 1;
            continue;
          }

          // Niemand frei - ein Neuzugang aus dem Nachwuchs. Er startet am
          // unteren Rand des Ligabandes.
          const rating = Math.max(10, Math.min(99, Math.round(band.min - 4 + rng() * 8)));
          const age = 30 + Math.floor(rng() * 14);
          const person = drawName(pools, rng);
          insertStaff.run({
            staff_id: nextId,
            first_name: person.first,
            last_name: person.last,
            country: person.country,
            birth_year: 2026 + season - age,
            role_key: role.roleKey,
            potential: Math.min(99, Math.round(rating + 6 + rng() * 16)),
          });
          insertState.run({
            staff_id: nextId,
            season,
            team_id: team.team_id,
            rating,
            loyalty: 0,
            contract_until: season + years,
            salary,
          });
          note.run(nextId, season, 'hired', team.tier, team.team_id, `Neuzugang, Wert ${rating}`);
          nextId += 1;
          summary.newcomers += 1;
          summary.hired += 1;
        }
      }
    }
  });

  run();
  return summary;
}
