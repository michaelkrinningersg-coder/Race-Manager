/**
 * Spaltendefinitionen der acht M0-Stammdatendateien.
 *
 * Diese Datei ist die maschinenlesbare Fassung von
 * docs/DATENMODELL_APEX_M0.md, Abschnitte 5 bis 12. Aendert sich dort eine
 * Spalte, muss sie hier mitgezogen werden - der Bootstrapper meldet
 * unbekannte und fehlende Spalten, damit das nicht stillschweigend auseinanderlaeuft.
 */

export type ColumnType = 'int' | 'real' | 'text';

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** Leeres Feld ist ein Fehler. Ohne Angabe ist die Spalte optional (NULL erlaubt). */
  required?: boolean;
  min?: number;
  max?: number;
  /** Erlaubte Werte fuer Enum-Spalten. */
  values?: readonly string[];
  /** Genaue Zeichenzahl, z. B. der dreistellige Team-Code. */
  length?: number;
  /** Wert muss ueber die gesamte Datei eindeutig sein. */
  unique?: boolean;
  /** Muster, dem der Wert entsprechen muss. */
  pattern?: RegExp;
}

export interface TableSpec {
  file: string;
  /** Zieltabelle in world_data.db. */
  table: string;
  primaryKey: string[];
  columns: ColumnSpec[];
  /** Erwartete Zeilenzahl. Abweichung ist ein Bestandsfehler (siehe --partial). */
  expectedRows?: number;
  /**
   * Spalten, nach denen die Datei sortiert sein soll. Ohne Angabe der
   * Primaerschluessel. Abweichend dort, wo eine fachliche Reihenfolge
   * existiert - car_part_types folgt der Bauteilreihenfolge aus Konzept 6.1,
   * nicht dem Alphabet der Schluessel.
   */
  sortBy?: string[];
}

const ARCHETYPES = [
  'works_team',
  'climber',
  'academy',
  'traditional',
  'privateer',
  'tech_startup',
] as const;

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

/** Die drei aerodynamischen Gruppen - sie tragen den gedrosselten Deckel. */
export const AERO_PART_KEYS = ['front_wing', 'rear_wing', 'floor'] as const;

/**
 * Die Wirkungsspalten von staff_roles.csv. Jede einzelne summiert sich ueber
 * alle acht Rollen auf 1.0 - der Validator prueft das hart. Damit ist jeder
 * Personalwert ein sauberer gewichteter Mittelwert auf der 0-100-Skala.
 */
export const STAFF_WEIGHT_COLUMNS = [
  ...PART_KEYS.map((key) => `w_${key}`),
  'w_reliability',
  'w_strategy',
  'w_pit',
  'w_feedback',
  'w_morale',
  'w_newgen',
];

/**
 * Die Wirkungsspalten von facility_types.csv. Dieselbe Normierung wie beim
 * Personal: jede Spalte summiert sich ueber alle acht Anlagen auf genau 1.0,
 * damit der Infrastrukturwert einer Wirkung auf der 0-100-Skala bleibt.
 */
export const FACILITY_WEIGHT_COLUMNS = [
  ...PART_KEYS.map((key) => `w_${key}`),
  'w_reliability',
  'w_feedback',
  'w_driver_dev',
  'w_newgen',
  'w_sponsor',
  'w_fitness',
];

/** Die 17 Fahrerattribute, je 0-100. */
export const DRIVER_ATTRIBUTES = [
  'pace',
  'qualifying',
  'braking',
  'cornering',
  'car_control',
  'overtaking',
  'defending',
  'starts',
  'racecraft_traffic',
  'consistency',
  'pressure',
  'aggression',
  'feedback',
  'tyre_management',
  'fuel_saving',
  'fitness',
  'wet_skill',
] as const;

/** Kernattribute, aus denen sich die Ligaeinordnung eines Fahrers ergibt. */
export const CORE_ATTRIBUTES = ['pace', 'qualifying', 'braking', 'cornering'] as const;

const HEX_COLOUR = /^#[0-9A-F]{6}$/;
const ISO3 = /^[A-Z]{3}$/;

/** Streckenarchetypen aus Konzept 10. */
export const TRACK_ARCHETYPES = [
  'highspeed',
  'downforce_street',
  'balanced',
  'stop_and_go',
  'bumpy_street',
  'altitude',
  'tyre_killer',
] as const;

const attributeColumns: ColumnSpec[] = DRIVER_ATTRIBUTES.map((name) => ({
  name,
  type: 'int' as const,
  required: true,
  min: 0,
  max: 100,
}));

const capColumns: ColumnSpec[] = PART_KEYS.map((key) => ({
  name: `cap_${key}`,
  type: 'int' as const,
  required: true,
  min: 0,
  max: 1000,
}));

/**
 * Rundenzeitrelevante Fahrerwerte. qualifying, overtaking und defending
 * fehlen bewusst - sie wirken auf Session- und Zweikampflogik, nicht auf
 * die Sektorzeit.
 */
export const SECTOR_DRIVER_KEYS = [
  'pace',
  'braking',
  'cornering',
  'car_control',
  'tyre_management',
  'consistency',
] as const;

/** Gewichtsspalten eines Sektorprofils: 9 Bauteilgruppen, 6 Fahrerwerte. */
export const PART_WEIGHT_KEYS = PART_KEYS.map((key) => `w_${key}`);
export const DRIVER_WEIGHT_KEYS = SECTOR_DRIVER_KEYS.map((key) => `w_${key}`);

const weightColumns: ColumnSpec[] = [...PART_WEIGHT_KEYS, ...DRIVER_WEIGHT_KEYS].map((name) => ({
  name,
  type: 'real' as const,
  required: true,
  min: 0,
  max: 1,
}));

export const TABLES: TableSpec[] = [
  {
    file: 'points_systems.csv',
    table: 'points_systems',
    primaryKey: ['points_system_id', 'position'],
    columns: [
      { name: 'points_system_id', type: 'int', required: true, min: 1 },
      { name: 'system_name', type: 'text', required: true },
      { name: 'position', type: 'int', required: true, min: 1 },
      { name: 'points', type: 'int', required: true, min: 0 },
      { name: 'bonus_pole', type: 'int', required: true, min: 0 },
      { name: 'bonus_fastest_lap', type: 'int', required: true, min: 0 },
      { name: 'fastest_lap_max_position', type: 'int', required: true, min: 1 },
      { name: 'min_distance_pct', type: 'real', required: true, min: 0, max: 1 },
    ],
  },
  {
    file: 'car_part_types.csv',
    table: 'car_part_types',
    primaryKey: ['part_key'],
    expectedRows: 9,
    sortBy: ['sort_order'],
    columns: [
      { name: 'part_key', type: 'text', required: true, values: PART_KEYS, unique: true },
      { name: 'name', type: 'text', required: true },
      { name: 'sort_order', type: 'int', required: true, min: 1, max: 9, unique: true },
      { name: 'primary_effect', type: 'text', required: true },
      { name: 'conflict', type: 'text', required: true },
      { name: 'dev_constant_k', type: 'real', required: true, min: 0 },
      { name: 'base_failure_rate', type: 'real', required: true, min: 0, max: 1 },
      { name: 'damage_prone', type: 'real', required: true, min: 0, max: 1 },
      { name: 'weight_reference_kg', type: 'real', required: true, min: 0 },
      { name: 'carry_over_default', type: 'real', required: true, min: 0, max: 1 },
      { name: 'supplied_by_engine', type: 'int', required: true, min: 0, max: 1 },
    ],
  },
  {
    file: 'staff_roles.csv',
    table: 'staff_roles',
    primaryKey: ['role_key'],
    expectedRows: 8,
    sortBy: ['sort_order'],
    columns: [
      { name: 'role_key', type: 'text', required: true, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'sort_order', type: 'int', required: true, min: 1, max: 8, unique: true },
      { name: 'count_per_team', type: 'int', required: true, min: 1, max: 4 },
      ...STAFF_WEIGHT_COLUMNS.map((name) => ({
        name,
        type: 'real' as const,
        required: true,
        min: 0,
        max: 1,
      })),
      { name: 'salary_share', type: 'real', required: true, min: 0, max: 1 },
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'facility_types.csv',
    table: 'facility_types',
    primaryKey: ['facility_key'],
    expectedRows: 8,
    sortBy: ['sort_order'],
    columns: [
      { name: 'facility_key', type: 'text', required: true, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'sort_order', type: 'int', required: true, min: 1, max: 8, unique: true },
      { name: 'licence_checked', type: 'int', required: true, min: 0, max: 1 },
      { name: 'upkeep_base', type: 'int', required: true, min: 0 },
      { name: 'build_factor', type: 'real', required: true, min: 1, max: 10 },
      ...FACILITY_WEIGHT_COLUMNS.map((name) => ({
        name,
        type: 'real' as const,
        required: true,
        min: 0,
        max: 1,
      })),
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'race_weekend_formats.csv',
    table: 'race_weekend_formats',
    primaryKey: ['format_id'],
    columns: [
      { name: 'format_id', type: 'int', required: true, min: 1, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'practice_sessions', type: 'int', required: true, min: 0, max: 4 },
      { name: 'practice_minutes', type: 'int', required: true, min: 0, max: 300 },
      {
        name: 'qualifying_mode',
        type: 'text',
        required: true,
        values: ['segments', 'single', 'result'],
      },
      { name: 'qualifying_segments', type: 'int', required: true, min: 1, max: 3 },
      { name: 'race_count', type: 'int', required: true, min: 1, max: 3 },
      { name: 'race_distance_pct', type: 'real', required: true, min: 0.2, max: 1 },
      { name: 'reverse_grid_top_n', type: 'int', required: true, min: 0, max: 12 },
      { name: 'sprint_weekends_per_season', type: 'int', required: true, min: 0, max: 12 },
      { name: 'sprint_points_system_id', type: 'int', min: 1 },
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'tyre_compounds.csv',
    table: 'tyre_compounds',
    primaryKey: ['compound_id'],
    columns: [
      { name: 'compound_id', type: 'int', required: true, min: 1, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'short_name', type: 'text', required: true, unique: true },
      { name: 'grip', type: 'real', required: true, min: 0.5, max: 1.2 },
      { name: 'wear_rate', type: 'real', required: true, min: 0.1, max: 10 },
      { name: 'cliff_wear_pct', type: 'real', required: true, min: 10, max: 100 },
      { name: 'min_stint_laps', type: 'int', required: true, min: 1, max: 60 },
      { name: 'wet_only', type: 'int', required: true, min: 0, max: 1 },
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'tracks.csv',
    table: 'tracks',
    primaryKey: ['track_id'],
    columns: [
      { name: 'track_id', type: 'int', required: true, min: 300001, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'short_name', type: 'text', required: true, unique: true },
      { name: 'country', type: 'text', required: true, pattern: ISO3 },
      { name: 'city', type: 'text', required: true },
      { name: 'length_m', type: 'int', required: true, min: 2000, max: 12000 },
      { name: 'laps', type: 'int', required: true, min: 20, max: 120 },
      { name: 'archetype', type: 'text', required: true, values: TRACK_ARCHETYPES },
      { name: 'overtaking_difficulty', type: 'real', required: true, min: 0, max: 1 },
      { name: 'pit_loss_s', type: 'real', required: true, min: 10, max: 40 },
      { name: 'safety_car_rate', type: 'real', required: true, min: 0, max: 1 },
      { name: 'elevation_change_m', type: 'int', required: true, min: 0, max: 300 },
      { name: 'abrasion', type: 'real', required: true, min: 0, max: 1 },
      { name: 'downforce_level', type: 'real', required: true, min: 0, max: 1 },
      { name: 'first_used_year', type: 'int', required: true, min: 1900, max: 2100 },
      { name: 'logistics_factor', type: 'real', required: true, min: 0.5, max: 3 },
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'track_archetype_weights.csv',
    table: 'track_archetype_weights',
    primaryKey: ['archetype', 'sector'],
    expectedRows: 21,
    columns: [
      { name: 'archetype', type: 'text', required: true, values: TRACK_ARCHETYPES },
      { name: 'sector', type: 'int', required: true, min: 1, max: 3 },
      { name: 'sector_share', type: 'real', required: true, min: 0, max: 1 },
      ...weightColumns,
    ],
  },
  {
    file: 'track_sector_weights.csv',
    table: 'track_sector_weights',
    primaryKey: ['track_id', 'sector'],
    columns: [
      { name: 'track_id', type: 'int', required: true, min: 300001 },
      { name: 'sector', type: 'int', required: true, min: 1, max: 3 },
      { name: 'sector_share', type: 'real', required: true, min: 0, max: 1 },
      ...weightColumns,
      { name: 'note', type: 'text' },
    ],
  },
  {
    file: 'engine_suppliers.csv',
    table: 'engine_suppliers',
    primaryKey: ['supplier_id'],
    columns: [
      { name: 'supplier_id', type: 'int', required: true, min: 200001, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'short_name', type: 'text', required: true, unique: true },
      { name: 'country', type: 'text', required: true, pattern: ISO3 },
      { name: 'founded_year', type: 'int', required: true, min: 1900, max: 2100 },
      { name: 'works_team_id', type: 'int', required: true, unique: true },
      { name: 'powertrain_performance', type: 'int', required: true, min: 0, max: 1000 },
      { name: 'powertrain_reliability', type: 'int', required: true, min: 0, max: 100 },
      { name: 'ers_performance', type: 'int', required: true, min: 0, max: 1000 },
      { name: 'ers_reliability', type: 'int', required: true, min: 0, max: 100 },
      { name: 'weight_kg', type: 'real', required: true, min: 0 },
      { name: 'fuel_efficiency', type: 'real', required: true, min: 0, max: 1 },
      { name: 'customer_slots', type: 'int', required: true, min: 0, max: 8 },
      { name: 'customer_spec_offset', type: 'int', required: true, min: 0, max: 200 },
      { name: 'works_tuning_pct', type: 'real', required: true, min: 0, max: 0.2 },
      { name: 'customer_tuning_pct', type: 'real', required: true, min: 0, max: 0.2 },
      { name: 'lease_cost_customer', type: 'int', required: true, min: 0 },
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'league_payouts.csv',
    table: 'league_payouts',
    primaryKey: ['tier'],
    expectedRows: 10,
    columns: [
      { name: 'tier', type: 'int', required: true, min: 1, max: 10, unique: true },
      { name: 'tv_fixed', type: 'int', required: true, min: 0 },
      { name: 'tv_variable_top', type: 'int', required: true, min: 0 },
      { name: 'expense_ratio', type: 'real', required: true, min: 0, max: 2 },
      { name: 'parachute_pct_1', type: 'real', required: true, min: 0, max: 1 },
      { name: 'parachute_pct_2', type: 'real', required: true, min: 0, max: 1 },
      { name: 'prize_pool_per_race', type: 'int', required: true, min: 0 },
      { name: 'logistics_base', type: 'int', required: true, min: 0 },
    ],
  },
  {
    file: 'weather_profiles.csv',
    table: 'weather_profiles',
    primaryKey: ['track_id'],
    expectedRows: 30,
    columns: [
      { name: 'track_id', type: 'int', required: true, min: 300001, unique: true },
      { name: 'rain_probability', type: 'real', required: true, min: 0, max: 1 },
      { name: 'changeability', type: 'real', required: true, min: 0, max: 1 },
      { name: 'base_temp_c', type: 'int', required: true, min: -20, max: 55 },
      { name: 'temp_swing_c', type: 'int', required: true, min: 0, max: 40 },
      { name: 'southern', type: 'int', min: 0, max: 1 },
    ],
  },
  {
    file: 'sponsors.csv',
    table: 'sponsors',
    primaryKey: ['sponsor_key'],
    expectedRows: 16,
    sortBy: ['sort_order'],
    columns: [
      { name: 'sponsor_key', type: 'text', required: true, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'sort_order', type: 'int', required: true, min: 1, unique: true },
      { name: 'industry', type: 'text', required: true },
      { name: 'slot', type: 'text', required: true, values: ['title', 'side'] },
      { name: 'tier_min', type: 'int', required: true, min: 1, max: 10 },
      { name: 'tier_max', type: 'int', required: true, min: 1, max: 10 },
      { name: 'value_pct', type: 'real', required: true, min: 0, max: 1 },
      { name: 'term_min', type: 'int', required: true, min: 1, max: 5 },
      { name: 'term_max', type: 'int', required: true, min: 1, max: 5 },
      {
        name: 'objective_type',
        type: 'text',
        required: true,
        values: ['rank', 'podiums', 'wins', 'finishes', 'improve'],
      },
      { name: 'objective_value', type: 'int', required: true, min: 1, max: 100 },
      { name: 'bonus_pct', type: 'real', required: true, min: 0, max: 1 },
      { name: 'malus_pct', type: 'real', required: true, min: 0, max: 1 },
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'leagues.csv',
    table: 'leagues',
    primaryKey: ['tier'],
    expectedRows: 10,
    columns: [
      { name: 'tier', type: 'int', required: true, min: 1, max: 10, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'short_name', type: 'text', required: true, unique: true },
      { name: 'team_count', type: 'int', required: true, min: 8, max: 30 },
      { name: 'cars_per_team', type: 'int', required: true, min: 1, max: 3 },
      { name: 'race_count', type: 'int', required: true, min: 4, max: 24 },
      { name: 'conference_count', type: 'int', required: true, min: 1, max: 4 },
      { name: 'points_system_id', type: 'int', required: true, min: 1 },
      { name: 'tyre_sets_per_weekend', type: 'int', required: true, min: 2, max: 16 },
      { name: 'dnf_base_rate', type: 'real', required: true, min: 0, max: 0.5 },
      { name: 'weekend_format_id', type: 'int' },
      { name: 'flavour', type: 'text', required: true },
    ],
  },
  {
    file: 'league_regulations.csv',
    table: 'league_regulations',
    primaryKey: ['tier', 'season'],
    columns: [
      { name: 'tier', type: 'int', required: true, min: 1, max: 10 },
      { name: 'season', type: 'int', required: true, min: 1 },
      { name: 'regulation_label', type: 'text', required: true },
      ...capColumns,
      { name: 'min_weight_kg', type: 'int', required: true, min: 700, max: 1100 },
      { name: 'cost_cap', type: 'int', required: true, min: 1 },
      { name: 'test_days', type: 'int', min: 0, max: 30 },
      { name: 'tyre_supplier', type: 'text' },
      { name: 'atr_base', type: 'real', required: true, min: 1, max: 2 },
      { name: 'atr_step', type: 'real', required: true, min: 0, max: 0.2 },
    ],
  },
  {
    file: 'promotion_rules.csv',
    table: 'promotion_rules',
    primaryKey: ['tier', 'valid_from_season'],
    columns: [
      { name: 'tier', type: 'int', required: true, min: 1, max: 10 },
      { name: 'valid_from_season', type: 'int', required: true, min: 1 },
      { name: 'direct_up', type: 'int', required: true, min: 0, max: 4 },
      { name: 'direct_down', type: 'int', required: true, min: 0, max: 4 },
      { name: 'promotion_barrage_slots', type: 'int', required: true, min: 0, max: 2 },
      { name: 'relegation_barrage_slots', type: 'int', required: true, min: 0, max: 2 },
      {
        name: 'relegation_mode',
        type: 'text',
        required: true,
        values: ['tier', 'licence_loss'],
      },
      { name: 'barrage_track_id', type: 'int' },
      { name: 'barrage_leg_count', type: 'int', required: true, min: 1, max: 3 },
      { name: 'barrage_regulation_tier', type: 'int', required: true, min: 1, max: 10 },
      {
        name: 'tiebreak_rule',
        type: 'text',
        required: true,
        values: ['quali_average', 'best_finish', 'head_to_head'],
      },
      {
        name: 'licence_fallback',
        type: 'text',
        required: true,
        values: ['next_eligible', 'slot_stays_empty'],
      },
    ],
  },
  {
    file: 'licence_requirements.csv',
    table: 'licence_requirements',
    primaryKey: ['tier'],
    expectedRows: 10,
    columns: [
      { name: 'tier', type: 'int', required: true, min: 1, max: 10, unique: true },
      { name: 'min_liquidity_pct', type: 'real', required: true, min: 0, max: 1 },
      { name: 'min_windtunnel_level', type: 'int', required: true, min: 0, max: 5 },
      { name: 'min_dyno_level', type: 'int', required: true, min: 0, max: 5 },
      { name: 'min_simulator_level', type: 'int', required: true, min: 0, max: 5 },
      { name: 'min_factory_level', type: 'int', required: true, min: 0, max: 5 },
      { name: 'min_staff_count', type: 'int', required: true, min: 0 },
      { name: 'required_roles', type: 'text' },
      { name: 'needs_engine_contract', type: 'int', required: true, min: 0, max: 1 },
      { name: 'min_licence_points', type: 'int', required: true },
      { name: 'min_superlicence_points', type: 'int', required: true, min: 0 },
      { name: 'grace_period_seasons', type: 'int', required: true, min: 0, max: 3 },
    ],
  },
  {
    file: 'teams.csv',
    table: 'teams',
    primaryKey: ['team_id'],
    expectedRows: 167,
    columns: [
      { name: 'team_id', type: 'int', required: true, min: 1001, max: 10999, unique: true },
      { name: 'name', type: 'text', required: true, unique: true },
      { name: 'short_name', type: 'text', required: true, unique: true },
      { name: 'code', type: 'text', required: true, unique: true, length: 3, pattern: /^[A-Z]{3}$/ },
      { name: 'country', type: 'text', required: true, pattern: ISO3 },
      { name: 'city', type: 'text', required: true },
      { name: 'founded_year', type: 'int', required: true, min: 1900, max: 2100 },
      { name: 'start_tier', type: 'int', required: true, min: 1, max: 10 },
      { name: 'colour_primary', type: 'text', required: true, pattern: HEX_COLOUR },
      { name: 'colour_secondary', type: 'text', required: true, pattern: HEX_COLOUR },
      { name: 'ai_archetype', type: 'text', required: true, values: ARCHETYPES },
      { name: 'prestige', type: 'int', required: true, min: 0, max: 100 },
      { name: 'start_capital', type: 'int', required: true, min: 0 },
      { name: 'engine_supplier_id', type: 'int' },
      { name: 'is_works_team', type: 'int', required: true, min: 0, max: 1 },
      { name: 'history_titles', type: 'int', required: true, min: 0 },
      { name: 'history_best_tier', type: 'int', required: true, min: 1, max: 10 },
      { name: 'flavour', type: 'text' },
    ],
  },
  {
    file: 'driver_names.csv',
    table: 'driver_names',
    primaryKey: ['country'],
    columns: [
      { name: 'country', type: 'text', required: true, pattern: ISO3, unique: true },
      { name: 'weight', type: 'int', required: true, min: 1, max: 20 },
      { name: 'first_names', type: 'text', required: true },
      { name: 'last_names', type: 'text', required: true },
    ],
  },
  {
    file: 'calendar.csv',
    table: 'calendar',
    primaryKey: ['season', 'tier', 'round'],
    expectedRows: 130,
    columns: [
      { name: 'season', type: 'int', required: true, min: 1 },
      { name: 'tier', type: 'int', required: true, min: 1, max: 10 },
      { name: 'round', type: 'int', required: true, min: 1, max: 24 },
      { name: 'week', type: 'int', required: true, min: 1, max: 52 },
      { name: 'track_id', type: 'int', required: true, min: 300001 },
      { name: 'format_id', type: 'int', required: true, min: 1 },
    ],
  },
  {
    file: 'drivers.csv',
    table: 'drivers',
    primaryKey: ['driver_id'],
    columns: [
      { name: 'driver_id', type: 'int', required: true, min: 100001, unique: true },
      { name: 'first_name', type: 'text', required: true },
      { name: 'last_name', type: 'text', required: true },
      { name: 'country', type: 'text', required: true, pattern: ISO3 },
      { name: 'birth_year', type: 'int', required: true, min: 1900, max: 2100 },
      ...attributeColumns,
      { name: 'potential', type: 'int', required: true, min: 0, max: 100 },
      { name: 'ego', type: 'int', required: true, min: 0, max: 100 },
      { name: 'adaptability', type: 'int', required: true, min: 0, max: 100 },
      { name: 'marketability', type: 'int', required: true, min: 0, max: 100 },
      { name: 'morale', type: 'int', required: true, min: 0, max: 100 },
      { name: 'superlicence_points', type: 'int', required: true, min: 0 },
      { name: 'start_team_id', type: 'int' },
      {
        name: 'start_role',
        type: 'text',
        required: true,
        values: ['race', 'reserve', 'junior', 'free_agent'],
      },
      { name: 'start_seat', type: 'int', min: 1, max: 2 },
      { name: 'contract_until_season', type: 'int', min: 1 },
      { name: 'salary', type: 'int', required: true, min: 0 },
      { name: 'pay_driver_budget', type: 'int', required: true, min: 0 },
    ],
  },
];

export function tableByFile(file: string): TableSpec {
  const spec = TABLES.find((entry) => entry.file === file);
  if (!spec) throw new Error(`Unbekannte Datei: ${file}`);
  return spec;
}
