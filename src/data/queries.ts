/**
 * Alle Abfragen der Webansicht an einem Ort.
 *
 * Die Ansichten formulieren kein SQL selbst - sie rufen hier eine benannte
 * Funktion. Damit bleibt an einer Stelle sichtbar, welche Tabellen die Seite
 * ueberhaupt anfasst, und Schemaaenderungen der Engine schlagen an einer Stelle
 * durch statt in acht Ansichten.
 *
 * Der Kalender existiert nur fuer Saison 1 und wird von der Engine in jeder
 * Folgesaison wiederverwendet (Konzept 17: eine 20-Saisons-Karriere von Hand
 * vorzuhalten waere nicht tragbar). Jeder Join auf `calendar` steht deshalb
 * fest auf `season = 1`.
 */

import { rows, row, scalar, type Row } from './db';
import type { Database } from 'sql.js';

export const PART_KEYS = [
  'chassis',
  'front_wing',
  'rear_wing',
  'floor',
  'powertrain',
  'ers',
  'gearbox',
  'suspension',
  'brakes',
] as const;

export const PART_LABEL: Record<string, string> = {
  chassis: 'Chassis',
  front_wing: 'Frontflügel',
  rear_wing: 'Heckflügel',
  floor: 'Unterboden',
  powertrain: 'Antrieb',
  ers: 'ERS',
  gearbox: 'Getriebe',
  suspension: 'Fahrwerk',
  brakes: 'Bremsen',
};

export const ARCHETYPE_LABEL: Record<string, string> = {
  works_team: 'Werksteam',
  tech_startup: 'Technik-Startup',
  traditional: 'Traditionsteam',
  climber: 'Aufsteiger',
  privateer: 'Privatteam',
  academy: 'Akademieteam',
};

export const MOVEMENT_LABEL: Record<string, string> = {
  promoted: 'Aufstieg',
  promoted_barrage: 'Barrage (Aufstieg)',
  relegated: 'Abstieg',
  relegated_barrage: 'Barrage (Abstieg)',
  licence_denied: 'Lizenz verweigert',
  licence_loss: 'Lizenzverlust',
};

export const MOVEMENT_CLASS: Record<string, string> = {
  promoted: 'row--promotion',
  promoted_barrage: 'row--barrage',
  relegated: 'row--relegation',
  relegated_barrage: 'row--barrage',
  licence_denied: 'row--denied',
  licence_loss: 'row--denied',
};

/* ------------------------------------------------------------------ */
/* Welt & Ligen                                                        */
/* ------------------------------------------------------------------ */

export interface WorldInfo {
  seasons: number;
  /** Saison mit Rundenverlauf - nur fuer sie liefen die Rennen rundenweise. */
  tickSeason: number | null;
  tickTier: number | null;
  teams: number;
  drivers: number;
}

export function worldInfo(db: Database): WorldInfo {
  const tick = row<{ season: number; tier: number }>(
    db,
    'SELECT season, tier FROM lap_records LIMIT 1',
  );
  return {
    seasons: Number(scalar(db, 'SELECT MAX(season) FROM team_seasons') ?? 1),
    tickSeason: tick ? tick.season : null,
    tickTier: tick ? tick.tier : null,
    teams: Number(scalar(db, 'SELECT COUNT(*) FROM teams') ?? 0),
    drivers: Number(scalar(db, 'SELECT COUNT(*) FROM drivers') ?? 0),
  };
}

export interface League {
  tier: number;
  name: string;
  short_name: string;
  team_count: number;
  cars_per_team: number;
  race_count: number;
  dnf_base_rate: number;
  flavour: string;
}

export function leagues(db: Database): League[] {
  return rows<League>(db, 'SELECT * FROM leagues ORDER BY tier');
}

export interface Regulation {
  cost_cap: number;
  min_weight_kg: number;
  test_days: number;
  atr_base: number;
  atr_step: number;
  cap_chassis: number;
  cap_front_wing: number;
  [key: string]: number | string;
}

export function regulation(db: Database, tier: number): Regulation | undefined {
  return row<Regulation>(
    db,
    'SELECT * FROM league_regulations WHERE tier = ? AND season = 1',
    [tier],
  );
}

export interface PromotionRule {
  direct_up: number;
  direct_down: number;
  promotion_barrage_slots: number;
  relegation_barrage_slots: number;
}

export function promotionRule(db: Database, tier: number): PromotionRule | undefined {
  return row<PromotionRule>(
    db,
    `SELECT direct_up, direct_down, promotion_barrage_slots, relegation_barrage_slots
     FROM promotion_rules WHERE tier = ?`,
    [tier],
  );
}

/* ------------------------------------------------------------------ */
/* Pyramide                                                            */
/* ------------------------------------------------------------------ */

export interface PyramidRow {
  tier: number;
  name: string;
  short_name: string;
  team_count: number;
  race_count: number;
  cost_cap: number;
  champion_id: number | null;
  champion: string | null;
  champion_colour: string | null;
  driver_champion: string | null;
}

export function pyramid(db: Database, season: number): PyramidRow[] {
  return rows<PyramidRow>(
    db,
    `SELECT l.tier, l.name, l.short_name, l.team_count, l.race_count, r.cost_cap,
            t.team_id AS champion_id, t.name AS champion, t.colour_primary AS champion_colour,
            (SELECT d.first_name || ' ' || d.last_name
               FROM driver_seasons ds JOIN drivers d ON d.driver_id = ds.driver_id
              WHERE ds.season = ? AND ds.tier = l.tier AND ds.final_rank = 1
              LIMIT 1) AS driver_champion
       FROM leagues l
       LEFT JOIN league_regulations r ON r.tier = l.tier AND r.season = 1
       LEFT JOIN team_seasons ts ON ts.tier = l.tier AND ts.season = ? AND ts.final_rank = 1
       LEFT JOIN teams t ON t.team_id = ts.team_id
      ORDER BY l.tier`,
    [season, season],
  );
}

/** Wie viele Teams sich in dieser Saison bewegt haben - Kopfzahl der Startseite. */
export function movementTotals(db: Database, season: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of rows<{ movement: string; n: number }>(
    db,
    `SELECT movement, COUNT(*) n FROM team_seasons
      WHERE season = ? AND movement IS NOT NULL AND movement <> 'stay' GROUP BY movement`,
    [season],
  )) {
    result[entry.movement] = entry.n;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Ligatabelle                                                         */
/* ------------------------------------------------------------------ */

export interface StandingRow {
  team_id: number;
  name: string;
  short_name: string;
  colour_primary: string;
  ai_archetype: string;
  final_rank: number;
  points: number;
  wins: number;
  podiums: number;
  dnfs: number;
  movement: string | null;
}

export function standings(db: Database, season: number, tier: number): StandingRow[] {
  return rows<StandingRow>(
    db,
    `SELECT ts.team_id, t.name, t.short_name, t.colour_primary, t.ai_archetype,
            ts.final_rank, ts.points, ts.wins, ts.podiums, ts.dnfs, ts.movement
       FROM team_seasons ts JOIN teams t ON t.team_id = ts.team_id
      WHERE ts.season = ? AND ts.tier = ?
      ORDER BY ts.final_rank`,
    [season, tier],
  );
}

export interface DriverStandingRow {
  driver_id: number;
  name: string;
  country: string;
  team_id: number;
  team: string;
  colour_primary: string;
  points: number;
  wins: number;
  poles: number;
  final_rank: number;
}

export function driverStandings(
  db: Database,
  season: number,
  tier: number,
  limit = 12,
): DriverStandingRow[] {
  return rows<DriverStandingRow>(
    db,
    `SELECT ds.driver_id, d.first_name || ' ' || d.last_name AS name, d.country,
            ds.team_id, t.short_name AS team, t.colour_primary,
            ds.points, ds.wins, ds.poles, ds.final_rank
       FROM driver_seasons ds
       JOIN drivers d ON d.driver_id = ds.driver_id
       JOIN teams t ON t.team_id = ds.team_id
      WHERE ds.season = ? AND ds.tier = ?
      ORDER BY ds.final_rank LIMIT ?`,
    [season, tier, limit],
  );
}

/** Verweigerte Lizenzen einer Saison - der sichtbare Teil des Reglements. */
export function licenceDenials(
  db: Database,
  season: number,
  tier: number,
): { name: string; to_tier: number; reasons: string }[] {
  return rows(
    db,
    `SELECT t.name, ld.to_tier, ld.reasons
       FROM licence_denials ld JOIN teams t ON t.team_id = ld.team_id
      WHERE ld.season = ? AND ld.from_tier = ?
      ORDER BY t.name`,
    [season, tier],
  );
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

export interface TeamDetail extends Row {
  team_id: number;
  name: string;
  short_name: string;
  code: string;
  country: string;
  city: string;
  founded_year: number;
  colour_primary: string;
  colour_secondary: string;
  ai_archetype: string;
  prestige: number;
  is_works_team: number;
  history_titles: number;
  flavour: string;
  tier: number;
  final_rank: number | null;
  points: number;
  wins: number;
  podiums: number;
  dnfs: number;
  movement: string | null;
  engine_name: string | null;
}

export function teamDetail(db: Database, season: number, teamId: number): TeamDetail | undefined {
  return row<TeamDetail>(
    db,
    `SELECT t.*, ts.tier, ts.final_rank, ts.points, ts.wins, ts.podiums, ts.dnfs, ts.movement,
            e.name AS engine_name
       FROM teams t
       JOIN team_seasons ts ON ts.team_id = t.team_id AND ts.season = ?
       LEFT JOIN engine_suppliers e ON e.supplier_id = t.engine_supplier_id
      WHERE t.team_id = ?`,
    [season, teamId],
  );
}

export interface PartRow {
  part_key: string;
  performance: number;
  reliability: number;
  spec_version: number;
  cap: number;
}

export function teamParts(db: Database, season: number, teamId: number, tier: number): PartRow[] {
  const caps = regulation(db, tier);
  const parts = rows<Omit<PartRow, 'cap'>>(
    db,
    `SELECT p.part_key, p.performance, p.reliability, p.spec_version
       FROM car_parts p JOIN car_part_types ct ON ct.part_key = p.part_key
      WHERE p.team_id = ? AND p.season = ?
      ORDER BY ct.sort_order`,
    [teamId, season],
  );
  return parts.map((part) => ({
    ...part,
    cap: Number(caps?.[`cap_${part.part_key}`] ?? 1000),
  }));
}

export interface RosterRow {
  driver_id: number;
  name: string;
  country: string;
  birth_year: number;
  role: string;
  seat: number | null;
  contract_until: number | null;
  salary: number;
  morale: number;
  potential: number;
  pace: number;
  qualifying: number;
  consistency: number;
  racecraft_traffic: number;
  is_newgen: number;
  points: number | null;
  wins: number | null;
}

export function teamRoster(db: Database, season: number, teamId: number): RosterRow[] {
  return rows<RosterRow>(
    db,
    `SELECT ds.driver_id, d.first_name || ' ' || d.last_name AS name, d.country, d.birth_year,
            ds.role, ds.seat, ds.contract_until, ds.salary, ds.morale, ds.potential,
            ds.pace, ds.qualifying, ds.consistency, ds.racecraft_traffic, d.is_newgen,
            dsn.points, dsn.wins
       FROM driver_state ds
       JOIN drivers d ON d.driver_id = ds.driver_id
       LEFT JOIN driver_seasons dsn ON dsn.driver_id = ds.driver_id AND dsn.season = ds.season
      WHERE ds.season = ? AND ds.team_id = ? AND ds.retired = 0
      ORDER BY CASE ds.role WHEN 'race' THEN 0 WHEN 'reserve' THEN 1 ELSE 2 END, ds.seat`,
    [season, teamId],
  );
}

export interface StaffRow {
  staff_id: number;
  name: string;
  country: string;
  birth_year: number;
  role_key: string;
  role: string;
  sort_order: number;
  rating: number;
  potential: number;
  loyalty: number;
  contract_until: number | null;
  salary: number;
}

export function teamStaff(db: Database, season: number, teamId: number): StaffRow[] {
  return rows<StaffRow>(
    db,
    `SELECT s.staff_id, s.first_name || ' ' || s.last_name AS name, s.country, s.birth_year,
            s.role_key, sr.name AS role, sr.sort_order, ss.rating, s.potential,
            ss.loyalty, ss.contract_until, ss.salary
       FROM staff_state ss
       JOIN staff s ON s.staff_id = ss.staff_id
       JOIN staff_roles sr ON sr.role_key = s.role_key
      WHERE ss.season = ? AND ss.team_id = ? AND ss.retired = 0
      ORDER BY sr.sort_order`,
    [season, teamId],
  );
}

export interface FacilityRow {
  facility_key: string;
  name: string;
  level: number;
  licence_checked: number;
  upkeep_base: number;
  flavour: string;
}

export function teamFacilities(db: Database, season: number, teamId: number): FacilityRow[] {
  return rows<FacilityRow>(
    db,
    `SELECT tf.facility_key, ft.name, tf.level, ft.licence_checked, ft.upkeep_base, ft.flavour
       FROM team_facilities tf JOIN facility_types ft ON ft.facility_key = tf.facility_key
      WHERE tf.season = ? AND tf.team_id = ?
      ORDER BY ft.sort_order`,
    [season, teamId],
  );
}

export interface FacilityMove {
  season: number;
  facility_key: string;
  name: string;
  from_level: number;
  to_level: number;
  amount: number;
  reason: string;
}

export function teamFacilityMoves(db: Database, teamId: number): FacilityMove[] {
  return rows<FacilityMove>(
    db,
    `SELECT m.season, m.facility_key, ft.name, m.from_level, m.to_level, m.amount, m.reason
       FROM team_facility_moves m JOIN facility_types ft ON ft.facility_key = m.facility_key
      WHERE m.team_id = ?
      ORDER BY m.season DESC, ft.sort_order`,
    [teamId],
  );
}

export interface FinanceRow {
  season: number;
  tier: number;
  opening: number;
  payout: number;
  parachute: number;
  prize_money: number;
  sponsors: number;
  pay_drivers: number;
  expenses: number;
  cost_basis: number;
  facility_cost: number;
  driver_wages: number;
  staff_wages: number;
  engine_lease: number;
  logistics: number;
  investment: number;
  asset_sales: number;
  closing: number;
}

export interface SponsorRow {
  slot: string;
  sponsor_key: string;
  name: string;
  industry: string;
  contract_until: number;
  base_value: number;
  objective_type: string;
  objective_value: number;
  bonus: number;
  malus: number;
  achieved: number | null;
  payout: number;
  flavour: string;
}

export function teamSponsors(db: Database, season: number, teamId: number): SponsorRow[] {
  return rows<SponsorRow>(
    db,
    `SELECT ts.slot, ts.sponsor_key, s.name, s.industry, ts.contract_until, ts.base_value,
            ts.objective_type, ts.objective_value, ts.bonus, ts.malus, ts.achieved, ts.payout,
            s.flavour
       FROM team_sponsors ts JOIN sponsors s ON s.sponsor_key = ts.sponsor_key
      WHERE ts.season = ? AND ts.team_id = ?
      ORDER BY CASE WHEN ts.slot = 'title' THEN 0 ELSE 1 END, ts.slot`,
    [season, teamId],
  );
}

export interface CapBreach {
  season: number;
  capped_spend: number;
  cost_cap: number;
  overspend_pct: number;
  penalty_points: number;
  atr_cut: number;
}

export function teamCapBreaches(db: Database, teamId: number): CapBreach[] {
  return rows<CapBreach>(
    db,
    `SELECT season, capped_spend, cost_cap, overspend_pct, penalty_points, atr_cut
       FROM cap_breaches WHERE team_id = ? ORDER BY season DESC`,
    [teamId],
  );
}

export const OBJECTIVE_LABEL: Record<string, (value: number) => string> = {
  rank: (v) => `Platz ${v} oder besser`,
  podiums: (v) => `mindestens ${v} Podien`,
  wins: (v) => `mindestens ${v} Siege`,
  finishes: (v) => `mindestens ${v} % Zielankünfte`,
  improve: (v) => `${v} Plätze besser als im Vorjahr`,
};

export function teamFinances(db: Database, teamId: number): FinanceRow[] {
  return rows<FinanceRow>(
    db,
    'SELECT * FROM team_finances WHERE team_id = ? ORDER BY season',
    [teamId],
  );
}

/** Ligaverlauf eines Teams ueber alle Saisons - die Zeile fuer den Sparkline. */
export function teamHistory(
  db: Database,
  teamId: number,
): { season: number; tier: number; final_rank: number | null; movement: string | null }[] {
  return rows(
    db,
    'SELECT season, tier, final_rank, movement FROM team_seasons WHERE team_id = ? ORDER BY season',
    [teamId],
  );
}

/* ------------------------------------------------------------------ */
/* Fahrerakte                                                          */
/* ------------------------------------------------------------------ */

export interface DriverIdentity extends Row {
  driver_id: number;
  first_name: string;
  last_name: string;
  country: string;
  birth_year: number;
  is_newgen: number;
}

export function driverIdentity(db: Database, driverId: number): DriverIdentity | undefined {
  return row<DriverIdentity>(db, 'SELECT * FROM drivers WHERE driver_id = ?', [driverId]);
}

export interface DriverSeasonRow extends Row {
  season: number;
  team_id: number | null;
  team: string | null;
  colour_primary: string | null;
  tier: number | null;
  role: string;
  contract_until: number | null;
  salary: number;
  morale: number;
  potential: number;
  retired: number;
  pace: number;
  points: number | null;
  wins: number | null;
  final_rank: number | null;
}

export function driverSeasons(db: Database, driverId: number): DriverSeasonRow[] {
  return rows<DriverSeasonRow>(
    db,
    `SELECT ds.*, t.name AS team, t.colour_primary, ts.tier,
            dsn.points, dsn.wins, dsn.final_rank
       FROM driver_state ds
       LEFT JOIN teams t ON t.team_id = ds.team_id
       LEFT JOIN team_seasons ts ON ts.team_id = ds.team_id AND ts.season = ds.season
       LEFT JOIN driver_seasons dsn ON dsn.driver_id = ds.driver_id AND dsn.season = ds.season
      WHERE ds.driver_id = ?
      ORDER BY ds.season`,
    [driverId],
  );
}

export function driverHistory(
  db: Database,
  driverId: number,
): { season: number; event: string; tier: number | null; team: string | null; detail: string }[] {
  return rows(
    db,
    `SELECT h.season, h.event, h.tier, t.name AS team, h.detail
       FROM driver_history h LEFT JOIN teams t ON t.team_id = h.team_id
      WHERE h.driver_id = ? ORDER BY h.season`,
    [driverId],
  );
}

/* ------------------------------------------------------------------ */
/* Rennen                                                              */
/* ------------------------------------------------------------------ */

export interface CalendarEntry {
  round: number;
  week: number;
  track_id: number;
  track: string;
  short_name: string;
  country: string;
  archetype: string;
  laps: number;
  legs: number;
}

export function calendar(db: Database, season: number, tier: number): CalendarEntry[] {
  return rows<CalendarEntry>(
    db,
    `SELECT c.round, c.week, c.track_id, tr.name AS track, tr.short_name, tr.country,
            tr.archetype, tr.laps,
            (SELECT COUNT(DISTINCT leg) FROM race_results rr
              WHERE rr.season = ? AND rr.tier = c.tier AND rr.round = c.round) AS legs
       FROM calendar c JOIN tracks tr ON tr.track_id = c.track_id
      WHERE c.season = 1 AND c.tier = ?
      ORDER BY c.round`,
    [season, tier],
  );
}

export interface ResultRow {
  driver_id: number;
  name: string;
  team_id: number;
  team: string;
  colour_primary: string;
  grid: number;
  position: number | null;
  status: string;
  points: number;
  pole: number;
  fastest_lap: number;
  /** Zeitstrafe in Sekunden, bereits in position verrechnet (Konzept 12.4). */
  penalty_s: number;
}

export function raceResults(
  db: Database,
  season: number,
  tier: number,
  round: number,
  leg: number,
): ResultRow[] {
  return rows<ResultRow>(
    db,
    `SELECT rr.driver_id, d.first_name || ' ' || d.last_name AS name,
            rr.team_id, t.short_name AS team, t.colour_primary,
            rr.grid, rr.position, rr.status, rr.points, rr.pole, rr.fastest_lap,
            rr.penalty_s
       FROM race_results rr
       JOIN drivers d ON d.driver_id = rr.driver_id
       JOIN teams t ON t.team_id = rr.team_id
      WHERE rr.season = ? AND rr.tier = ? AND rr.round = ? AND rr.leg = ?
      ORDER BY CASE WHEN rr.position IS NULL THEN 1 ELSE 0 END, rr.position`,
    [season, tier, round, leg],
  );
}

export interface LapRow {
  lap: number;
  driver_id: number;
  name: string;
  short_name: string;
  colour_primary: string;
  position: number;
  lap_time_ms: number;
  gap_to_leader_ms: number;
  compound: string;
  tyre_wear: number;
  fuel_kg: number;
  event: string | null;
}

export function lapRecords(
  db: Database,
  season: number,
  tier: number,
  round: number,
  leg: number,
): LapRow[] {
  return rows<LapRow>(
    db,
    `SELECT lr.lap, lr.driver_id, d.first_name || ' ' || d.last_name AS name,
            d.last_name AS short_name, t.colour_primary, lr.position, lr.lap_time_ms,
            lr.gap_to_leader_ms, lr.compound, lr.tyre_wear, lr.fuel_kg, lr.event
       FROM lap_records lr
       JOIN drivers d ON d.driver_id = lr.driver_id
       LEFT JOIN driver_state ds ON ds.driver_id = lr.driver_id AND ds.season = lr.season
       LEFT JOIN teams t ON t.team_id = ds.team_id
      WHERE lr.season = ? AND lr.tier = ? AND lr.round = ? AND lr.leg = ?
      ORDER BY lr.lap, lr.position`,
    [season, tier, round, leg],
  );
}

export interface AnalysisRow {
  driver_id: number;
  name: string;
  stops: number;
  best_lap_ms: number;
  total_ms: number;
  lost_tyres_s: number;
  lost_fuel_s: number;
  lost_traffic_s: number;
  lost_pits_s: number;
  lost_incidents_s: number;
  position: number | null;
  status: string;
}

/**
 * Sortiert nach Zielplatzierung, nicht nach Gesamtzeit.
 *
 * `total_ms` misst nur die tatsaechlich gefahrene Zeit - wer in Runde 6
 * ausfaellt, steht damit ganz oben. Nach Platzierung geordnet steht der Sieger
 * vorn und die Ausfaelle hinten, und der Rueckstand bekommt einen sinnvollen
 * Bezugspunkt.
 */
export function raceAnalysis(
  db: Database,
  season: number,
  tier: number,
  round: number,
  leg: number,
): AnalysisRow[] {
  return rows<AnalysisRow>(
    db,
    `SELECT ra.driver_id, d.first_name || ' ' || d.last_name AS name, ra.stops,
            ra.best_lap_ms, ra.total_ms, ra.lost_tyres_s, ra.lost_fuel_s,
            ra.lost_traffic_s, ra.lost_pits_s, ra.lost_incidents_s,
            rr.position, rr.status
       FROM race_analysis ra
       JOIN drivers d ON d.driver_id = ra.driver_id
       LEFT JOIN race_results rr ON rr.season = ra.season AND rr.tier = ra.tier
            AND rr.round = ra.round AND rr.leg = ra.leg AND rr.driver_id = ra.driver_id
      WHERE ra.season = ? AND ra.tier = ? AND ra.round = ? AND ra.leg = ?
      ORDER BY CASE WHEN rr.position IS NULL THEN 1 ELSE 0 END, rr.position, ra.total_ms`,
    [season, tier, round, leg],
  );
}
