/**
 * Markt aus Spielersicht (Konzept 14.2).
 *
 * Die KI-Routinen in staff.ts, careers.ts und sponsors.ts entscheiden und
 * buchen in einem Zug - fuer 166 Teams ist das richtig, fuer den Spieler
 * nicht. Er braucht zwei getrennte Schritte: sehen, was zu haben ist, und
 * dann einen davon nehmen.
 *
 * BEWUSST OHNE EIGENE BEWERTUNGSLOGIK. Dieses Modul waehlt nichts aus und
 * gewichtet nichts; es listet und bucht. Jede Zahl, die hier auftaucht - Wert,
 * Gehalt, Laufzeit -, steht bereits in der Datenbank. Sonst waere neben der
 * KI-Bewertung eine zweite entstanden, und die beiden waeren auseinander
 * gelaufen.
 */

import type { Database } from './db.js';

export interface StaffCandidate {
  staff_id: number;
  name: string;
  role_key: string;
  rating: number;
  salary: number;
  contract_until: number;
  /** Aktuelles Team - null heisst frei. */
  team_id: number | null;
}

/** Eigener Personalbestand der laufenden Saison. */
export function ownStaff(db: Database, season: number, teamId: number): StaffCandidate[] {
  return db
    .prepare(
      `SELECT s.staff_id, s.first_name || ' ' || s.last_name AS name, s.role_key,
              ss.rating, ss.salary, ss.contract_until, ss.team_id
         FROM staff_state ss JOIN staff s ON s.staff_id = ss.staff_id
        WHERE ss.season = ? AND ss.team_id = ? AND ss.retired = 0
        ORDER BY s.role_key`,
    )
    .all(season, teamId) as StaffCandidate[];
}

/**
 * Freie Kraefte einer Rolle, beste zuerst.
 *
 * Nur Vertragslose. Abwerbung unter Vertrag stehender Leute kann die KI
 * (runStaffMarket), der Spieler bewusst nicht: Sie braucht eine
 * Abloesesumme, und die ist in Konzept 9.1 beschrieben, aber nicht gebaut.
 */
export function freeStaff(db: Database, season: number, roleKey: string): StaffCandidate[] {
  return db
    .prepare(
      `SELECT s.staff_id, s.first_name || ' ' || s.last_name AS name, s.role_key,
              ss.rating, ss.salary, ss.contract_until, ss.team_id
         FROM staff_state ss JOIN staff s ON s.staff_id = ss.staff_id
        WHERE ss.season = ? AND ss.team_id IS NULL AND ss.retired = 0 AND s.role_key = ?
        ORDER BY ss.rating DESC LIMIT 12`,
    )
    .all(season, roleKey) as StaffCandidate[];
}

export interface HireResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verpflichtet eine freie Kraft. Wer die Rolle bisher hielt, wird frei.
 *
 * Eine Rolle ist einfach besetzt (Konzept 8.1) - deshalb der Tausch statt
 * eines zweiten Eintrags.
 */
export function hireStaff(
  db: Database,
  season: number,
  teamId: number,
  staffId: number,
): HireResult {
  const candidate = db
    .prepare(
      `SELECT ss.team_id, ss.salary, s.role_key FROM staff_state ss
         JOIN staff s ON s.staff_id = ss.staff_id
        WHERE ss.staff_id = ? AND ss.season = ?`,
    )
    .get(staffId, season) as { team_id: number | null; salary: number; role_key: string } | undefined;

  if (!candidate) return { ok: false, reason: 'Diese Kraft gibt es in dieser Saison nicht.' };
  if (candidate.team_id !== null) return { ok: false, reason: 'Steht bereits unter Vertrag.' };

  const balance = (db
    .prepare('SELECT closing FROM team_finances WHERE team_id = ? AND season = ?')
    .get(teamId, season - 1) as { closing: number } | undefined)?.closing ?? 0;
  if (candidate.salary > balance) {
    return { ok: false, reason: 'Das Gehalt uebersteigt die Kasse.' };
  }

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE staff_state SET team_id = NULL WHERE season = ? AND team_id = ?
         AND staff_id IN (SELECT staff_id FROM staff WHERE role_key = ?)`,
    ).run(season, teamId, candidate.role_key);
    db.prepare('UPDATE staff_state SET team_id = ? WHERE staff_id = ? AND season = ?').run(
      teamId,
      staffId,
      season,
    );
  });
  run();
  return { ok: true };
}

export interface DriverCandidate {
  driver_id: number;
  name: string;
  pace: number;
  qualifying: number;
  consistency: number;
  potential: number;
  salary: number;
  pay_driver_budget: number;
  seat: number | null;
}

/** Die eigenen Renncockpits. */
export function ownDrivers(db: Database, season: number, teamId: number): DriverCandidate[] {
  return db
    .prepare(
      `SELECT ds.driver_id, d.first_name || ' ' || d.last_name AS name,
              ds.pace, ds.qualifying, ds.consistency, ds.potential,
              ds.salary, ds.pay_driver_budget, ds.seat
         FROM driver_state ds JOIN drivers d ON d.driver_id = ds.driver_id
        WHERE ds.season = ? AND ds.team_id = ? AND ds.role = 'race'
        ORDER BY ds.seat`,
    )
    .all(season, teamId) as DriverCandidate[];
}

/** Vertragslose Fahrer, schnellste zuerst. */
export function freeDrivers(db: Database, season: number): DriverCandidate[] {
  return db
    .prepare(
      `SELECT ds.driver_id, d.first_name || ' ' || d.last_name AS name,
              ds.pace, ds.qualifying, ds.consistency, ds.potential,
              ds.salary, ds.pay_driver_budget, ds.seat
         FROM driver_state ds JOIN drivers d ON d.driver_id = ds.driver_id
        WHERE ds.season = ? AND ds.role = 'free_agent' AND ds.retired = 0
        ORDER BY ds.pace DESC LIMIT 20`,
    )
    .all(season) as DriverCandidate[];
}

/** Besetzt ein Cockpit neu. Der bisherige Fahrer wird vertragslos. */
export function signDriver(
  db: Database,
  season: number,
  teamId: number,
  driverId: number,
  seat: number,
): HireResult {
  const candidate = db
    .prepare('SELECT role, salary FROM driver_state WHERE driver_id = ? AND season = ?')
    .get(driverId, season) as { role: string; salary: number } | undefined;
  if (!candidate) return { ok: false, reason: 'Diesen Fahrer gibt es in dieser Saison nicht.' };
  if (candidate.role !== 'free_agent') return { ok: false, reason: 'Steht bereits unter Vertrag.' };

  const balance = (db
    .prepare('SELECT closing FROM team_finances WHERE team_id = ? AND season = ?')
    .get(teamId, season - 1) as { closing: number } | undefined)?.closing ?? 0;
  if (candidate.salary > balance) return { ok: false, reason: 'Das Gehalt uebersteigt die Kasse.' };

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE driver_state SET role = 'free_agent', team_id = NULL, seat = NULL
        WHERE season = ? AND team_id = ? AND seat = ?`,
    ).run(season, teamId, seat);
    db.prepare(
      `UPDATE driver_state SET role = 'race', team_id = ?, seat = ? WHERE driver_id = ? AND season = ?`,
    ).run(teamId, seat, driverId, season);
  });
  run();
  return { ok: true };
}

export interface SponsorOffer {
  sponsor_key: string;
  name: string;
  slot: string;
  industry: string;
  value_pct: number;
  objective_type: string;
  objective_value: number;
  bonus_pct: number;
  malus_pct: number;
}

/**
 * Sponsoren, die fuer die Liga in Frage kommen und beim Team noch nicht unter
 * Vertrag stehen.
 *
 * Die Ausschliesslichkeit des Titelsponsors innerhalb einer Liga prueft die
 * Buchung, nicht diese Liste - sie haengt am Bestand aller Teams.
 */
export function sponsorOffers(db: Database, season: number, teamId: number): SponsorOffer[] {
  const tier = (db
    .prepare('SELECT tier FROM team_seasons WHERE team_id = ? AND season = ?')
    .get(teamId, season) as { tier: number } | undefined)?.tier;
  if (tier === undefined) return [];

  return db
    .prepare(
      `SELECT sponsor_key, name, slot, industry, value_pct, objective_type,
              objective_value, bonus_pct, malus_pct
         FROM sponsors
        WHERE tier_min <= ? AND tier_max >= ?
          AND sponsor_key NOT IN (
            SELECT sponsor_key FROM team_sponsors WHERE team_id = ? AND season = ?)
        ORDER BY slot, sort_order`,
    )
    .all(tier, tier, teamId, season) as SponsorOffer[];
}

/** Laufende Vertraege des Teams. */
export function ownSponsors(db: Database, season: number, teamId: number): Record<string, unknown>[] {
  return db
    .prepare(
      `SELECT ts.slot, ts.sponsor_key, s.name, ts.base_value, ts.contract_until,
              ts.objective_type, ts.objective_value
         FROM team_sponsors ts JOIN sponsors s ON s.sponsor_key = ts.sponsor_key
        WHERE ts.team_id = ? AND ts.season = ? ORDER BY ts.slot`,
    )
    .all(teamId, season) as Record<string, unknown>[];
}

/**
 * Schliesst einen Sponsorenvertrag.
 *
 * Prueft die eine Regel, die der Bestand kennt und eine Liste nicht: Der
 * Titelsponsor ist innerhalb einer Liga ausschliesslich, Nebensponsoren sind es
 * nicht - duerfen aber nie zweimal am selben Auto stehen (Abschnitt 21.2).
 * Wert und Laufzeit kommen aus sponsors.csv und dem Ligadeckel, nicht aus einer
 * zweiten Bewertung.
 */
export function signSponsor(
  db: Database,
  season: number,
  teamId: number,
  sponsorKey: string,
): HireResult {
  const type = db
    .prepare('SELECT * FROM sponsors WHERE sponsor_key = ?')
    .get(sponsorKey) as Record<string, number | string> | undefined;
  if (!type) return { ok: false, reason: 'Unbekannter Sponsor.' };

  const tier = (db
    .prepare('SELECT tier FROM team_seasons WHERE team_id = ? AND season = ?')
    .get(teamId, season) as { tier: number } | undefined)?.tier;
  if (tier === undefined) return { ok: false, reason: 'Kein Ligaplatz in dieser Saison.' };
  if (tier < (type.tier_min as number) || tier > (type.tier_max as number)) {
    return { ok: false, reason: 'Dieser Sponsor tritt in deiner Liga nicht auf.' };
  }

  const slot = type.slot as string;
  if (slot === 'title') {
    const taken = db
      .prepare(
        `SELECT 1 FROM team_sponsors ts JOIN team_seasons t
                ON t.team_id = ts.team_id AND t.season = ts.season
          WHERE ts.season = ? AND ts.sponsor_key = ? AND t.tier = ? AND ts.team_id <> ?`,
      )
      .get(season, sponsorKey, tier, teamId);
    if (taken) return { ok: false, reason: 'Der Titelsponsor ist in dieser Liga vergeben.' };
  }

  const cap = (db
    .prepare('SELECT cost_cap FROM league_regulations WHERE tier = ? AND season = 1')
    .get(tier) as { cost_cap: number } | undefined)?.cost_cap ?? 0;
  const value = Math.round(cap * (type.value_pct as number));
  const years = type.term_min as number;

  db.prepare(
    `INSERT OR REPLACE INTO team_sponsors
       (team_id, season, slot, sponsor_key, contract_until, base_value,
        objective_type, objective_value, bonus, malus, achieved, payout)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
  ).run(
    teamId,
    season,
    slot,
    sponsorKey,
    season + years - 1,
    value,
    type.objective_type,
    type.objective_value,
    Math.round(value * (type.bonus_pct as number)),
    Math.round(value * (type.malus_pct as number)),
  );
  return { ok: true };
}
