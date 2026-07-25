/**
 * Erzeugt world_data.db aus den geprueften Stammdaten.
 *
 * Determinismus ist Pflicht (docs/DATENMODELL_APEX_M0.md, 14.4): Gleiche CSVs
 * muessen dieselbe Datenbank ergeben. Deshalb kein Zufall, keine Zeitstempel,
 * und Einfuegen in der Reihenfolge der Quelldateien.
 */

import DatabaseConstructor from 'better-sqlite3';
import { unlinkSync } from 'node:fs';
import type { LoadedTable, Row } from './load.js';
import { TABLES } from './schema.js';

export const DDL = `
CREATE TABLE leagues (
  tier                  INTEGER PRIMARY KEY CHECK (tier BETWEEN 1 AND 10),
  name                  TEXT    NOT NULL UNIQUE,
  short_name            TEXT    NOT NULL UNIQUE,
  team_count            INTEGER NOT NULL,
  cars_per_team         INTEGER NOT NULL,
  race_count            INTEGER NOT NULL,
  conference_count      INTEGER NOT NULL DEFAULT 1,
  points_system_id      INTEGER NOT NULL REFERENCES points_systems_meta(points_system_id),
  tyre_sets_per_weekend INTEGER NOT NULL,
  dnf_base_rate         REAL    NOT NULL,
  weekend_format_id     INTEGER,
  flavour               TEXT    NOT NULL
);

CREATE TABLE league_regulations (
  tier             INTEGER NOT NULL REFERENCES leagues(tier),
  season           INTEGER NOT NULL,
  regulation_label TEXT    NOT NULL,
  cap_chassis      INTEGER NOT NULL CHECK (cap_chassis    BETWEEN 0 AND 1000),
  cap_front_wing   INTEGER NOT NULL CHECK (cap_front_wing BETWEEN 0 AND 1000),
  cap_rear_wing    INTEGER NOT NULL,
  cap_floor        INTEGER NOT NULL,
  cap_powertrain   INTEGER NOT NULL,
  cap_ers          INTEGER NOT NULL,
  cap_gearbox      INTEGER NOT NULL,
  cap_suspension   INTEGER NOT NULL,
  cap_brakes       INTEGER NOT NULL,
  min_weight_kg    INTEGER NOT NULL,
  cost_cap         INTEGER NOT NULL,
  test_days        INTEGER,
  tyre_supplier    TEXT,
  atr_base         REAL    NOT NULL,
  atr_step         REAL    NOT NULL,
  PRIMARY KEY (tier, season)
);

CREATE TABLE promotion_rules (
  tier                     INTEGER NOT NULL REFERENCES leagues(tier),
  valid_from_season        INTEGER NOT NULL,
  direct_up                INTEGER NOT NULL,
  direct_down              INTEGER NOT NULL,
  promotion_barrage_slots  INTEGER NOT NULL,
  relegation_barrage_slots INTEGER NOT NULL,
  relegation_mode          TEXT    NOT NULL CHECK (relegation_mode IN ('tier','licence_loss')),
  barrage_track_id         INTEGER,
  barrage_leg_count        INTEGER NOT NULL,
  barrage_regulation_tier  INTEGER NOT NULL,
  tiebreak_rule            TEXT    NOT NULL,
  licence_fallback         TEXT    NOT NULL,
  PRIMARY KEY (tier, valid_from_season)
);

CREATE TABLE points_systems_meta (
  points_system_id         INTEGER PRIMARY KEY,
  system_name              TEXT    NOT NULL,
  bonus_pole               INTEGER NOT NULL,
  bonus_fastest_lap        INTEGER NOT NULL,
  fastest_lap_max_position INTEGER NOT NULL,
  min_distance_pct         REAL    NOT NULL
);

CREATE TABLE points_systems (
  points_system_id INTEGER NOT NULL REFERENCES points_systems_meta(points_system_id),
  position         INTEGER NOT NULL,
  points           INTEGER NOT NULL,
  PRIMARY KEY (points_system_id, position)
);

CREATE TABLE licence_requirements (
  tier                    INTEGER PRIMARY KEY REFERENCES leagues(tier),
  min_liquidity_pct       REAL    NOT NULL,
  min_windtunnel_level    INTEGER NOT NULL,
  min_dyno_level          INTEGER NOT NULL,
  min_simulator_level     INTEGER NOT NULL,
  min_factory_level       INTEGER NOT NULL,
  min_staff_count         INTEGER NOT NULL,
  required_roles          TEXT,
  needs_engine_contract   INTEGER NOT NULL,
  min_licence_points      INTEGER NOT NULL,
  min_superlicence_points INTEGER NOT NULL,
  grace_period_seasons    INTEGER NOT NULL
);

CREATE TABLE car_part_types (
  part_key            TEXT    PRIMARY KEY,
  name                TEXT    NOT NULL,
  sort_order          INTEGER NOT NULL UNIQUE,
  primary_effect      TEXT    NOT NULL,
  conflict            TEXT    NOT NULL,
  dev_constant_k      REAL,
  base_failure_rate   REAL,
  damage_prone        REAL,
  weight_reference_kg REAL,
  carry_over_default  REAL,
  supplied_by_engine  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE teams (
  team_id            INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL UNIQUE,
  short_name         TEXT    NOT NULL UNIQUE,
  code               TEXT    NOT NULL UNIQUE CHECK (length(code) = 3),
  country            TEXT    NOT NULL,
  city               TEXT    NOT NULL,
  founded_year       INTEGER NOT NULL,
  start_tier         INTEGER NOT NULL REFERENCES leagues(tier),
  colour_primary     TEXT    NOT NULL,
  colour_secondary   TEXT    NOT NULL,
  ai_archetype       TEXT    NOT NULL,
  prestige           INTEGER NOT NULL CHECK (prestige BETWEEN 0 AND 100),
  start_capital      INTEGER NOT NULL,
  engine_supplier_id INTEGER,
  is_works_team      INTEGER NOT NULL DEFAULT 0,
  history_titles     INTEGER NOT NULL DEFAULT 0,
  history_best_tier  INTEGER NOT NULL,
  flavour            TEXT
);

CREATE TABLE drivers (
  driver_id             INTEGER PRIMARY KEY,
  first_name            TEXT    NOT NULL,
  last_name             TEXT    NOT NULL,
  country               TEXT    NOT NULL,
  birth_year            INTEGER NOT NULL,
  pace                  INTEGER NOT NULL CHECK (pace BETWEEN 0 AND 100),
  qualifying            INTEGER NOT NULL,
  braking               INTEGER NOT NULL,
  cornering             INTEGER NOT NULL,
  car_control           INTEGER NOT NULL,
  overtaking            INTEGER NOT NULL,
  defending             INTEGER NOT NULL,
  starts                INTEGER NOT NULL,
  racecraft_traffic     INTEGER NOT NULL,
  consistency           INTEGER NOT NULL,
  pressure              INTEGER NOT NULL,
  aggression            INTEGER NOT NULL,
  feedback              INTEGER NOT NULL,
  tyre_management       INTEGER NOT NULL,
  fuel_saving           INTEGER NOT NULL,
  fitness               INTEGER NOT NULL,
  wet_skill             INTEGER NOT NULL,
  potential             INTEGER NOT NULL,
  ego                   INTEGER NOT NULL,
  adaptability          INTEGER NOT NULL,
  marketability         INTEGER NOT NULL,
  morale                INTEGER NOT NULL,
  superlicence_points   INTEGER NOT NULL DEFAULT 0,
  start_team_id         INTEGER REFERENCES teams(team_id),
  start_role            TEXT    NOT NULL CHECK (start_role IN ('race','reserve','junior','free_agent')),
  start_seat            INTEGER,
  contract_until_season INTEGER,
  salary                INTEGER NOT NULL DEFAULT 0,
  pay_driver_budget     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_teams_tier   ON teams(start_tier);
CREATE INDEX idx_drivers_team ON drivers(start_team_id);
CREATE UNIQUE INDEX idx_driver_seat ON drivers(start_team_id, start_seat)
  WHERE start_seat IS NOT NULL;
`;

/** Reihenfolge der Einfuegungen - Fremdschluessel muessen vorher stehen. */
const INSERT_ORDER = [
  'points_systems.csv',
  'car_part_types.csv',
  'leagues.csv',
  'league_regulations.csv',
  'promotion_rules.csv',
  'licence_requirements.csv',
  'teams.csv',
  'drivers.csv',
];

function insertGeneric(
  db: DatabaseConstructor.Database,
  table: string,
  columns: string[],
  rows: Row[],
): void {
  const placeholders = columns.map((name) => `@${name}`).join(', ');
  const statement = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
  );
  for (const row of rows) {
    const parameters: Record<string, unknown> = {};
    for (const name of columns) {
      parameters[name] = row.values[name] ?? null;
    }
    statement.run(parameters);
  }
}

/**
 * points_systems liegt als Langformat vor und wird beim Import in Metadaten
 * und Positionen aufgeteilt (siehe DDL).
 */
function insertPointsSystems(db: DatabaseConstructor.Database, rows: Row[]): void {
  const meta = db.prepare(
    `INSERT INTO points_systems_meta
       (points_system_id, system_name, bonus_pole, bonus_fastest_lap, fastest_lap_max_position, min_distance_pct)
     VALUES (@points_system_id, @system_name, @bonus_pole, @bonus_fastest_lap, @fastest_lap_max_position, @min_distance_pct)`,
  );
  const entry = db.prepare(
    `INSERT INTO points_systems (points_system_id, position, points)
     VALUES (@points_system_id, @position, @points)`,
  );

  const seen = new Set<unknown>();
  for (const row of rows) {
    const id = row.values.points_system_id;
    if (!seen.has(id)) {
      seen.add(id);
      meta.run({
        points_system_id: id,
        system_name: row.values.system_name,
        bonus_pole: row.values.bonus_pole,
        bonus_fastest_lap: row.values.bonus_fastest_lap,
        fastest_lap_max_position: row.values.fastest_lap_max_position,
        min_distance_pct: row.values.min_distance_pct,
      });
    }
    entry.run({
      points_system_id: id,
      position: row.values.position,
      points: row.values.points,
    });
  }
}

export interface WriteResult {
  table: string;
  rows: number;
}

export function writeDatabase(
  path: string,
  tables: Map<string, LoadedTable>,
): WriteResult[] {
  try {
    unlinkSync(path);
  } catch {
    // Datei existierte nicht - das ist der Normalfall beim ersten Lauf.
  }

  const db = new DatabaseConstructor(path);
  const results: WriteResult[] = [];

  try {
    db.pragma('foreign_keys = ON');
    db.exec(DDL);

    const run = db.transaction(() => {
      for (const file of INSERT_ORDER) {
        const loaded = tables.get(file);
        if (!loaded) continue;

        if (file === 'points_systems.csv') {
          insertPointsSystems(db, loaded.rows);
          results.push({ table: 'points_systems_meta + points_systems', rows: loaded.rows.length });
          continue;
        }

        const spec = TABLES.find((entry) => entry.file === file);
        if (!spec) continue;
        insertGeneric(db, spec.table, spec.columns.map((column) => column.name), loaded.rows);
        results.push({ table: spec.table, rows: loaded.rows.length });
      }
    });

    run();
  } finally {
    db.close();
  }

  return results;
}
