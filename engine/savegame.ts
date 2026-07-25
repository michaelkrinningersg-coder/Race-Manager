/**
 * Savegame: Kopie der world_data.db plus Verlaufstabellen.
 *
 * Konzept 15: Die CSVs enthalten Startzustand, das Savegame den Verlauf.
 * world_data.db wird deshalb nie beschrieben - sie wird kopiert, und erst in
 * die Kopie schreibt die Simulation.
 */

import DatabaseConstructor from 'better-sqlite3';
import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export type Database = DatabaseConstructor.Database;

/** Tabellen, die erst zur Laufzeit entstehen. */
const RUNTIME_DDL = `
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
  PRIMARY KEY (season, tier, round, leg, driver_id)
);

CREATE TABLE team_finances (
  team_id   INTEGER NOT NULL REFERENCES teams(team_id),
  season    INTEGER NOT NULL,
  tier      INTEGER NOT NULL,
  opening   INTEGER NOT NULL,
  payout    INTEGER NOT NULL DEFAULT 0,
  parachute INTEGER NOT NULL DEFAULT 0,
  expenses  INTEGER NOT NULL DEFAULT 0,
  closing   INTEGER NOT NULL,
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
`;

export function createSavegame(worldPath: string, savePath: string, worldSeed: number): Database {
  mkdirSync(dirname(savePath), { recursive: true });
  try {
    unlinkSync(savePath);
  } catch {
    // Existierte nicht - Normalfall beim ersten Lauf.
  }
  copyFileSync(worldPath, savePath);

  const db = new DatabaseConstructor(savePath);
  db.pragma('foreign_keys = ON');
  db.exec(RUNTIME_DDL);
  db.prepare(
    'INSERT INTO game_state (id, current_season, current_week, world_seed) VALUES (1, 1, 1, ?)',
  ).run(worldSeed);
  return db;
}
