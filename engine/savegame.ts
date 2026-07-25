/**
 * Savegame: Kopie der world_data.db plus Verlaufstabellen.
 *
 * Konzept 15: Die CSVs enthalten Startzustand, das Savegame den Verlauf.
 * world_data.db wird deshalb nie beschrieben - sie wird kopiert, und erst in
 * die Kopie schreibt die Simulation.
 */

import type { Database } from './db.js';

export type { Database, Statement } from './db.js';

/** Tabellen, die erst zur Laufzeit entstehen. */
export const RUNTIME_DDL = `
CREATE TABLE car_parts (
  team_id      INTEGER NOT NULL REFERENCES teams(team_id),
  season       INTEGER NOT NULL,
  part_key     TEXT    NOT NULL REFERENCES car_part_types(part_key),
  performance  INTEGER NOT NULL,
  reliability  INTEGER NOT NULL,
  weight_delta REAL    NOT NULL DEFAULT 0,
  maturity     INTEGER NOT NULL DEFAULT 100,
  spec_version INTEGER NOT NULL DEFAULT 1,
  source       TEXT    NOT NULL,
  PRIMARY KEY (team_id, season, part_key)
);

CREATE TABLE race_results (
  season      INTEGER NOT NULL,
  tier        INTEGER NOT NULL,
  round       INTEGER NOT NULL,
  leg         INTEGER NOT NULL,
  driver_id   INTEGER NOT NULL REFERENCES drivers(driver_id),
  team_id     INTEGER NOT NULL REFERENCES teams(team_id),
  grid        INTEGER NOT NULL,
  position    INTEGER,
  status      TEXT    NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  pole        INTEGER NOT NULL DEFAULT 0,
  fastest_lap INTEGER NOT NULL DEFAULT 0,
  -- Zeitstrafe in Sekunden (Konzept 12.4). Sie ist bereits in position und in
  -- race_analysis.total_ms verrechnet und steht hier nur, damit die Ansicht
  -- erklaeren kann, warum jemand hinter einem Auto steht, das er im Ziel
  -- geschlagen hat. Nur die Tick-Sim setzt sie; die Light-Sim kennt keine
  -- Zwischenfaelle und laesst die Spalte auf null.
  penalty_s   REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (season, tier, round, leg, driver_id)
);

CREATE TABLE team_seasons (
  team_id    INTEGER NOT NULL REFERENCES teams(team_id),
  season     INTEGER NOT NULL,
  tier       INTEGER NOT NULL,
  points     INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  podiums    INTEGER NOT NULL DEFAULT 0,
  dnfs       INTEGER NOT NULL DEFAULT 0,
  final_rank INTEGER,
  movement   TEXT,
  PRIMARY KEY (team_id, season)
);

CREATE TABLE driver_seasons (
  driver_id  INTEGER NOT NULL REFERENCES drivers(driver_id),
  season     INTEGER NOT NULL,
  tier       INTEGER NOT NULL,
  team_id    INTEGER NOT NULL REFERENCES teams(team_id),
  points     INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  podiums    INTEGER NOT NULL DEFAULT 0,
  poles      INTEGER NOT NULL DEFAULT 0,
  dnfs       INTEGER NOT NULL DEFAULT 0,
  final_rank INTEGER,
  PRIMARY KEY (driver_id, season)
);

CREATE TABLE game_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  current_season INTEGER NOT NULL,
  current_week   INTEGER NOT NULL,
  world_seed     INTEGER NOT NULL
);

CREATE TABLE lap_records (
  season      INTEGER NOT NULL,
  tier        INTEGER NOT NULL,
  round       INTEGER NOT NULL,
  leg         INTEGER NOT NULL,
  lap         INTEGER NOT NULL,
  driver_id   INTEGER NOT NULL REFERENCES drivers(driver_id),
  position    INTEGER NOT NULL,
  lap_time_ms INTEGER NOT NULL,
  gap_to_leader_ms INTEGER NOT NULL,
  compound    TEXT    NOT NULL,
  tyre_wear   REAL    NOT NULL,
  fuel_kg     REAL    NOT NULL,
  event       TEXT,
  -- Gegner des Zweikampfs bei event 'traffic' und 'overtake': der Fahrer, der
  -- in dieser Runde vorn lag. Ohne ihn laesst sich die Formel nicht pruefen -
  -- sie arbeitet mit der DIFFERENZ aus Angriff und Verteidigung, und wer der
  -- Verteidiger war, stand bis v0.16.2 nirgends.
  rival_id    INTEGER REFERENCES drivers(driver_id),
  PRIMARY KEY (season, tier, round, leg, lap, driver_id)
);

CREATE TABLE race_analysis (
  season         INTEGER NOT NULL,
  tier           INTEGER NOT NULL,
  round          INTEGER NOT NULL,
  leg            INTEGER NOT NULL,
  driver_id      INTEGER NOT NULL REFERENCES drivers(driver_id),
  stops          INTEGER NOT NULL,
  best_lap_ms    INTEGER NOT NULL,
  total_ms       INTEGER NOT NULL,
  lost_tyres_s   REAL    NOT NULL,
  lost_fuel_s    REAL    NOT NULL,
  lost_traffic_s REAL    NOT NULL,
  lost_pits_s    REAL    NOT NULL,
  -- Zeitverlust durch Fahrfehler, Dreher, Kollisionen und die Schaeden daraus
  -- (Konzept 12.4). Ohne eigene Spalte wuerde er in der Zerlegung aus 12.6
  -- verschwinden - und ausgerechnet der Posten, den der Fahrer selbst zu
  -- verantworten hat, waere der einzige unsichtbare.
  lost_incidents_s REAL  NOT NULL DEFAULT 0,
  PRIMARY KEY (season, tier, round, leg, driver_id)
);

-- facility_cost, investment und asset_sales stehen bewusst als eigene Posten
-- neben expenses: Nur so ist in der Bilanz ablesbar, woran ein Team zugrunde
-- geht. expenses deckt seit der Infrastruktur den Rest, expense_ratio wurde
-- dafuer je Liga gesenkt (league_payouts.csv).
CREATE TABLE team_finances (
  team_id       INTEGER NOT NULL REFERENCES teams(team_id),
  season        INTEGER NOT NULL,
  tier          INTEGER NOT NULL,
  opening       INTEGER NOT NULL,
  payout        INTEGER NOT NULL DEFAULT 0,
  parachute     INTEGER NOT NULL DEFAULT 0,
  prize_money   INTEGER NOT NULL DEFAULT 0,
  sponsors      INTEGER NOT NULL DEFAULT 0,
  pay_drivers   INTEGER NOT NULL DEFAULT 0,
  expenses      INTEGER NOT NULL DEFAULT 0,
  cost_basis    INTEGER NOT NULL DEFAULT 0,
  facility_cost INTEGER NOT NULL DEFAULT 0,
  driver_wages  INTEGER NOT NULL DEFAULT 0,
  staff_wages   INTEGER NOT NULL DEFAULT 0,
  engine_lease  INTEGER NOT NULL DEFAULT 0,
  logistics     INTEGER NOT NULL DEFAULT 0,
  investment    INTEGER NOT NULL DEFAULT 0,
  asset_sales   INTEGER NOT NULL DEFAULT 0,
  closing       INTEGER NOT NULL,
  PRIMARY KEY (team_id, season)
);

CREATE TABLE barrage_results (
  season        INTEGER NOT NULL,
  boundary_tier INTEGER NOT NULL,
  track_id      INTEGER NOT NULL REFERENCES tracks(track_id),
  team_id       INTEGER NOT NULL REFERENCES teams(team_id),
  from_tier     INTEGER NOT NULL,
  points        INTEGER NOT NULL,
  won           INTEGER NOT NULL,
  PRIMARY KEY (season, boundary_tier, team_id)
);

-- Fahrerzustand je Saison. drivers haelt nur noch die Identitaet und den
-- Startzustand; alles, was sich ueber die Karriere aendert, steht hier
-- (Konzept 7). Ohne diese Trennung koennte ein Fahrer nie das Team wechseln.
CREATE TABLE driver_state (
  driver_id           INTEGER NOT NULL REFERENCES drivers(driver_id),
  season              INTEGER NOT NULL,
  team_id             INTEGER REFERENCES teams(team_id),
  role                TEXT    NOT NULL CHECK (role IN ('race','reserve','junior','free_agent','retired')),
  seat                INTEGER,
  contract_until      INTEGER,
  salary              INTEGER NOT NULL DEFAULT 0,
  pay_driver_budget   INTEGER NOT NULL DEFAULT 0,
  morale              INTEGER NOT NULL,
  superlicence_points INTEGER NOT NULL DEFAULT 0,
  retired             INTEGER NOT NULL DEFAULT 0,
  pace                INTEGER NOT NULL,
  qualifying          INTEGER NOT NULL,
  braking             INTEGER NOT NULL,
  cornering           INTEGER NOT NULL,
  car_control         INTEGER NOT NULL,
  overtaking          INTEGER NOT NULL,
  defending           INTEGER NOT NULL,
  starts              INTEGER NOT NULL,
  racecraft_traffic   INTEGER NOT NULL,
  consistency         INTEGER NOT NULL,
  pressure            INTEGER NOT NULL,
  aggression          INTEGER NOT NULL,
  feedback            INTEGER NOT NULL,
  tyre_management     INTEGER NOT NULL,
  fuel_saving         INTEGER NOT NULL,
  fitness             INTEGER NOT NULL,
  wet_skill           INTEGER NOT NULL,
  potential           INTEGER NOT NULL,
  ego                 INTEGER NOT NULL,
  adaptability        INTEGER NOT NULL,
  marketability       INTEGER NOT NULL,
  PRIMARY KEY (driver_id, season)
);

-- Personal. Anders als bei den Fahrern gibt es keine handgepflegte Vorlage:
-- 167 Teams mal neun Stellen waeren rund 1.500 Zeilen Handarbeit. Der Bestand
-- entsteht deshalb vollstaendig deterministisch aus dem Seed (getroffene
-- Entscheidung), die Wirkung der Rollen steht in staff_roles.csv.
CREATE TABLE staff (
  staff_id   INTEGER PRIMARY KEY,
  first_name TEXT    NOT NULL,
  last_name  TEXT    NOT NULL,
  country    TEXT    NOT NULL,
  birth_year INTEGER NOT NULL,
  role_key   TEXT    NOT NULL REFERENCES staff_roles(role_key),
  potential  INTEGER NOT NULL
);

CREATE TABLE staff_state (
  staff_id       INTEGER NOT NULL REFERENCES staff(staff_id),
  season         INTEGER NOT NULL,
  team_id        INTEGER REFERENCES teams(team_id),
  rating         INTEGER NOT NULL,
  loyalty        INTEGER NOT NULL,
  contract_until INTEGER,
  salary         INTEGER NOT NULL DEFAULT 0,
  retired        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (staff_id, season)
);

CREATE TABLE staff_history (
  staff_id INTEGER NOT NULL REFERENCES staff(staff_id),
  season   INTEGER NOT NULL,
  event    TEXT    NOT NULL,
  tier     INTEGER,
  team_id  INTEGER REFERENCES teams(team_id),
  detail   TEXT,
  PRIMARY KEY (staff_id, season, event)
);

CREATE TABLE driver_history (
  driver_id   INTEGER NOT NULL REFERENCES drivers(driver_id),
  season      INTEGER NOT NULL,
  event       TEXT    NOT NULL,
  tier        INTEGER,
  team_id     INTEGER REFERENCES teams(team_id),
  detail      TEXT,
  PRIMARY KEY (driver_id, season, event)
);

-- Sponsorenvertraege je Team und Saison (Konzept 9.1). slot ist 'title' fuer den
-- Hauptvertrag und 'side1'..'side6' fuer die Nebenvertraege. achieved ist NULL,
-- solange die Saison laeuft - erst settleSponsors wertet die Zielvorgabe aus.
CREATE TABLE team_sponsors (
  team_id         INTEGER NOT NULL REFERENCES teams(team_id),
  season          INTEGER NOT NULL,
  slot            TEXT    NOT NULL,
  sponsor_key     TEXT    NOT NULL REFERENCES sponsors(sponsor_key),
  contract_until  INTEGER NOT NULL,
  base_value      INTEGER NOT NULL,
  objective_type  TEXT    NOT NULL,
  objective_value INTEGER NOT NULL,
  bonus           INTEGER NOT NULL DEFAULT 0,
  malus           INTEGER NOT NULL DEFAULT 0,
  achieved        INTEGER,
  payout          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, season, slot)
);

-- Ueberschreitungen des Kostendeckels (Konzept 9.3). Die Strafe wirkt in der
-- FOLGESAISON: Lizenzpunkte weg, Windkanalzeit gekuerzt.
CREATE TABLE cap_breaches (
  team_id       INTEGER NOT NULL REFERENCES teams(team_id),
  season        INTEGER NOT NULL,
  tier          INTEGER NOT NULL,
  capped_spend  INTEGER NOT NULL,
  cost_cap      INTEGER NOT NULL,
  overspend_pct REAL    NOT NULL,
  penalty_points INTEGER NOT NULL,
  atr_cut        REAL    NOT NULL,
  PRIMARY KEY (team_id, season)
);

-- Anlagenbestand je Team und Saison (Konzept 8.2). Der Bestand wandert beim
-- Auf- und Abstieg unveraendert mit - die Fixkosten damit auch.
CREATE TABLE team_facilities (
  team_id      INTEGER NOT NULL REFERENCES teams(team_id),
  season       INTEGER NOT NULL,
  facility_key TEXT    NOT NULL REFERENCES facility_types(facility_key),
  level        INTEGER NOT NULL CHECK (level BETWEEN 0 AND 5),
  PRIMARY KEY (team_id, season, facility_key)
);

-- Chronik der Ausbauten und Zwangsverkaeufe. Aus den Bestandszeilen allein
-- waere spaeter nicht mehr rekonstruierbar, ob ein Team eine Stufe freiwillig
-- gebaut oder unter Zwang abgegeben hat.
CREATE TABLE team_facility_moves (
  team_id      INTEGER NOT NULL REFERENCES teams(team_id),
  season       INTEGER NOT NULL,
  facility_key TEXT    NOT NULL REFERENCES facility_types(facility_key),
  from_level   INTEGER NOT NULL,
  to_level     INTEGER NOT NULL,
  amount       INTEGER NOT NULL,
  reason       TEXT    NOT NULL CHECK (reason IN ('built','forced_sale')),
  PRIMARY KEY (team_id, season, facility_key, from_level, to_level)
);

CREATE TABLE licence_denials (
  season    INTEGER NOT NULL,
  team_id   INTEGER NOT NULL REFERENCES teams(team_id),
  from_tier INTEGER NOT NULL,
  to_tier   INTEGER NOT NULL,
  reasons   TEXT    NOT NULL,
  PRIMARY KEY (season, team_id, to_tier)
);

CREATE INDEX idx_results_league ON race_results(season, tier);
CREATE INDEX idx_results_driver ON race_results(driver_id, season);
CREATE INDEX idx_team_seasons_tier ON team_seasons(season, tier);
CREATE INDEX idx_driver_state_season ON driver_state(season, team_id);
CREATE INDEX idx_staff_state_season ON staff_state(season, team_id);

-- Newgens wachsen in dieselbe Tabelle hinein wie die handgepflegten Fahrer.
-- Die Marke trennt beide: Die Potenzialverteilung der Startfahrer bleibt so
-- dauerhaft als Referenz erhalten, aus der neue Jahrgaenge gezogen werden.
ALTER TABLE drivers ADD COLUMN is_newgen INTEGER NOT NULL DEFAULT 0;
`;

/**
 * Macht aus einer geoeffneten Kopie der world_data.db ein Savegame.
 *
 * Bewusst ohne Dateizugriff: Wie die Kopie zustande kommt, unterscheidet sich
 * zwischen Node (Datei kopieren) und Browser (Bytes laden). Was danach
 * passiert, ist in beiden Faellen dasselbe - und stand vorher nur im
 * Node-Pfad.
 */
export function initSavegame(db: Database, worldSeed: number): Database {
  db.pragma('foreign_keys = ON');
  db.exec(RUNTIME_DDL);
  db.prepare(
    'INSERT INTO game_state (id, current_season, current_week, world_seed) VALUES (1, 1, 1, ?)',
  ).run(worldSeed);
  return db;
}
