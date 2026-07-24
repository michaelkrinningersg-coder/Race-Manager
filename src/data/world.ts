/**
 * Weltgenerator + Light-Sim.
 *
 * Erzeugt deterministisch (fester Seed) alle 167 Teams der zehn Ligen samt
 * Fahrern und Bauteilwerten und simuliert eine komplette Saison je Liga nach
 * dem in Abschnitt 12.7 des Konzepts beschriebenen Light-Sim-Verfahren.
 * Gleicher Seed => gleiche Welt, damit die Seite reproduzierbar bleibt.
 */

import {
  LEAGUES,
  PART_GROUPS,
  getLeague,
  movementRules,
  pointsSystem,
  type League,
  type PartKey,
} from './leagues';

/* ------------------------------------------------------------------ */
/* Zufall                                                              */
/* ------------------------------------------------------------------ */

/** Kleiner, schneller PRNG mit reproduzierbarem Zustand (mulberry32). */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)];
}

function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/* ------------------------------------------------------------------ */
/* Namenspools                                                         */
/* ------------------------------------------------------------------ */

const TEAM_PREFIXES = [
  'Aurora', 'Bramante', 'Calder', 'Delacroix', 'Eisberg', 'Falkenrath', 'Granite',
  'Halden', 'Iberia', 'Jarvik', 'Kestrel', 'Lindqvist', 'Meridian', 'Nordvent',
  'Orion', 'Pallas', 'Quartara', 'Rovere', 'Saltire', 'Tessera', 'Umbra',
  'Valenta', 'Wexford', 'Xander', 'Yamazaki', 'Zenith', 'Argent', 'Bellator',
  'Corvus', 'Draken', 'Ember', 'Fjord', 'Gallardo', 'Hyperion', 'Ignis',
  'Juniper', 'Krieger', 'Lumen', 'Mistral', 'Nimbus', 'Obsidian', 'Peregrin',
  'Rakete', 'Sirocco', 'Talon', 'Ursa', 'Vortex', 'Wolfsbach', 'Zephyr', 'Basalt',
];

const TEAM_SUFFIXES_TOP = ['Racing', 'Grand Prix', 'Motorsport', 'Works', 'Autosport'];
const TEAM_SUFFIXES_MID = ['Racing', 'Motorsport', 'Engineering', 'Competition', 'Team'];
const TEAM_SUFFIXES_LOW = ['Racing', 'Motorsport', 'Garage', 'Rennsport', 'Squadra'];

const COUNTRIES = [
  { code: 'DEU', name: 'Deutschland' },
  { code: 'ITA', name: 'Italien' },
  { code: 'GBR', name: 'Großbritannien' },
  { code: 'FRA', name: 'Frankreich' },
  { code: 'ESP', name: 'Spanien' },
  { code: 'JPN', name: 'Japan' },
  { code: 'USA', name: 'USA' },
  { code: 'BRA', name: 'Brasilien' },
  { code: 'AUT', name: 'Österreich' },
  { code: 'NLD', name: 'Niederlande' },
  { code: 'SWE', name: 'Schweden' },
  { code: 'AUS', name: 'Australien' },
  { code: 'CAN', name: 'Kanada' },
  { code: 'BEL', name: 'Belgien' },
  { code: 'CHE', name: 'Schweiz' },
  { code: 'FIN', name: 'Finnland' },
];

const FIRST_NAMES = [
  'Aaron', 'Adrian', 'Alessio', 'Andres', 'Anton', 'Bastian', 'Bruno', 'Callum',
  'Cesare', 'Damien', 'Diego', 'Dmitri', 'Eduard', 'Elias', 'Emil', 'Enzo',
  'Fabian', 'Felipe', 'Finn', 'Gustav', 'Hakan', 'Henri', 'Hugo', 'Ivar',
  'Jasper', 'Joel', 'Julius', 'Kaito', 'Karim', 'Kenji', 'Lars', 'Leon',
  'Lorenzo', 'Lucas', 'Malte', 'Marco', 'Mattia', 'Milan', 'Nico', 'Noah',
  'Oliver', 'Oskar', 'Pablo', 'Pierre', 'Rafael', 'Rasmus', 'Ruben', 'Samuel',
  'Sebastian', 'Silas', 'Theo', 'Tobias', 'Valentin', 'Viktor', 'Yannick', 'Zane',
];

const LAST_NAMES = [
  'Aaltonen', 'Baumgartner', 'Beaumont', 'Bernasconi', 'Brandt', 'Cavalli',
  'Cortez', 'Dahlberg', 'Delacroix', 'Dietrich', 'Doyle', 'Eriksen', 'Farkas',
  'Ferreira', 'Gallardo', 'Grimaldi', 'Hartmann', 'Hayashi', 'Holmberg',
  'Ivanov', 'Jansen', 'Keller', 'Kowalski', 'Lambert', 'Lindqvist', 'Lombardi',
  'Marchetti', 'Meister', 'Moreau', 'Nakamura', 'Novak', 'Okonkwo', 'Olsen',
  'Pettersson', 'Prieto', 'Rasmussen', 'Reyes', 'Ricci', 'Sandoval', 'Schneider',
  'Silva', 'Sorensen', 'Steiner', 'Takahashi', 'Vandenberg', 'Vasquez',
  'Vogel', 'Weber', 'Wallace', 'Zielinski',
];

const ARCHETYPES = [
  'Werksteam',
  'Aufsteiger',
  'Nachwuchsschmiede',
  'Traditionsteam',
  'Privatier',
  'Tech-Startup',
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

const COLORS = [
  ['#e10600', '#1a1a1a'], ['#00d2be', '#0b1a1a'], ['#0090ff', '#0a1730'],
  ['#ff8700', '#231303'], ['#005aff', '#0a0f2a'], ['#2b6e3f', '#0c1a10'],
  ['#b6babd', '#101215'], ['#900000', '#1c0505'], ['#37bedd', '#08222b'],
  ['#f062a6', '#2a0b1c'], ['#ffd300', '#2a2200'], ['#7a3cff', '#160a2a'],
];

/* ------------------------------------------------------------------ */
/* Entitäten                                                          */
/* ------------------------------------------------------------------ */

export interface Driver {
  id: string;
  name: string;
  country: string;
  age: number;
  /** Grundtempo 0-100 */
  pace: number;
  /** Zweikampf/Verkehr 0-100 */
  racecraft: number;
  /** Streuung der Rundenzeiten 0-100 (hoch = konstant) */
  consistency: number;
  /** Erwartetes Endniveau 0-100 */
  potential: number;
  points: number;
  wins: number;
  podiums: number;
  dnf: number;
}

export interface Team {
  id: string;
  tier: number;
  name: string;
  shortName: string;
  country: string;
  colorPrimary: string;
  colorSecondary: string;
  archetype: Archetype;
  /** Ruf des Teams 0-100 */
  prestige: number;
  /** Jahresbudget in Euro */
  budget: number;
  /** Bauteilwerte auf der weltweiten 0-1000-Skala */
  parts: Record<PartKey, number>;
  /** Zuverlässigkeit 0-100 */
  reliability: number;
  drivers: Driver[];
}

export type Movement =
  | 'promotion'
  | 'promotion_barrage'
  | 'relegation_barrage'
  | 'relegation'
  | 'stay';

export interface StandingRow {
  rank: number;
  team: Team;
  points: number;
  wins: number;
  podiums: number;
  dnf: number;
  movement: Movement;
}

export interface LeagueSeason {
  league: League;
  table: StandingRow[];
  driverTable: Driver[];
}

export interface World {
  seed: number;
  season: number;
  seasons: Map<number, LeagueSeason>;
}

/* ------------------------------------------------------------------ */
/* Generierung                                                         */
/* ------------------------------------------------------------------ */

/**
 * Zieht einen Namenszusatz und bevorzugt dabei den in dieser Liga bisher
 * seltensten, damit eine Tabelle nicht aus sieben "Works"-Teams besteht.
 */
function teamSuffix(rng: () => number, tier: number, used: Map<string, number>): string {
  const pool = tier <= 3 ? TEAM_SUFFIXES_TOP : tier <= 7 ? TEAM_SUFFIXES_MID : TEAM_SUFFIXES_LOW;
  const minUsage = Math.min(...pool.map((suffix) => used.get(suffix) ?? 0));
  const candidates = pool.filter((suffix) => (used.get(suffix) ?? 0) === minUsage);
  const chosen = pick(rng, candidates);
  used.set(chosen, minUsage + 1);
  return chosen;
}

function createDriver(rng: () => number, tier: number, index: number, teamStrength: number): Driver {
  // Fahrerniveau hängt an der Liga: Tier 1 ~ 88, Tier 10 ~ 48.
  const tierBase = 92 - (tier - 1) * 4.6;
  // Der zweite Fahrer eines Teams ist im Schnitt etwas schwächer.
  const seatPenalty = index === 0 ? 0 : between(rng, 1, 6);
  const teamPull = (teamStrength - 0.5) * 6;
  const pace = clamp(tierBase + teamPull - seatPenalty + between(rng, -5, 5), 25, 99);
  // Altersverteilung mit Schwerpunkt Mitte 20: rng^1.5 zieht die Werte nach unten,
  // damit Routiniers jenseits der 33 die Ausnahme bleiben.
  const minAge = tier >= 8 ? 17 : 20;
  const maxAge = tier >= 8 ? 30 : 37;
  const age = Math.round(minAge + Math.pow(rng(), 1.5) * (maxAge - minAge));
  const growth = age <= 23 ? between(rng, 6, 16) : age <= 27 ? between(rng, 1, 6) : 0;
  const country = pick(rng, COUNTRIES).code;

  return {
    id: `d${tier}-${index}-${Math.floor(rng() * 1e6)}`,
    name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    country,
    age,
    pace: Math.round(pace),
    racecraft: Math.round(clamp(pace + between(rng, -9, 9), 20, 99)),
    consistency: Math.round(clamp(pace + between(rng, -12, 8) + (age - 24) * 0.4, 20, 99)),
    potential: Math.round(clamp(pace + growth, 30, 99)),
    points: 0,
    wins: 0,
    podiums: 0,
    dnf: 0,
  };
}

/**
 * Zieht einen Teamnamen, der in dieser Liga noch nicht vergeben ist. Der Präfix
 * muss innerhalb einer Liga eindeutig sein (sonst gäbe es "Obsidian Racing" und
 * "Obsidian Motorsport" in derselben Tabelle), der volle Name weltweit.
 */
interface LeagueNames {
  /** In dieser Liga bereits vergebene Präfixe */
  prefixes: Set<string>;
  /** Wie oft ein Namenszusatz in dieser Liga schon verwendet wurde */
  suffixes: Map<string, number>;
}

function drawTeamName(
  rng: () => number,
  tier: number,
  leagueNames: LeagueNames,
  usedNames: Set<string>,
): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const prefix = pick(rng, TEAM_PREFIXES);
    if (leagueNames.prefixes.has(prefix)) continue;
    const name = `${prefix} ${teamSuffix(rng, tier, leagueNames.suffixes)}`;
    if (usedNames.has(name)) continue;
    leagueNames.prefixes.add(prefix);
    usedNames.add(name);
    return name;
  }
  // Notausgang: durchnummerieren, damit die Generierung nie hängen bleibt.
  let counter = 2;
  let fallback = `${pick(rng, TEAM_PREFIXES)} ${teamSuffix(rng, tier, leagueNames.suffixes)}`;
  while (usedNames.has(fallback)) {
    fallback = `${fallback.split(' ')[0]} ${teamSuffix(rng, tier, leagueNames.suffixes)} ${counter}`;
    counter += 1;
  }
  usedNames.add(fallback);
  return fallback;
}

function createTeam(
  rng: () => number,
  league: League,
  index: number,
  leagueNames: LeagueNames,
  usedNames: Set<string>,
): Team {
  // Relative Stärke des Teams innerhalb seiner Liga (0 = Schlusslicht, 1 = Spitze).
  const strength = rng();
  const cap = league.partCap;
  // Selbst das beste Team schöpft den Reglementdeckel nicht ganz aus.
  const level = cap * (0.68 + strength * 0.3);
  const parts = {} as Record<PartKey, number>;
  for (const group of PART_GROUPS) {
    parts[group.key] = Math.round(clamp(level * between(rng, 0.88, 1.1), 40, cap));
  }
  const [colorPrimary, colorSecondary] = COLORS[(index + league.tier * 3) % COLORS.length];
  const archetype = pick(rng, ARCHETYPES);

  const team: Team = {
    id: `t${league.tier}-${index}`,
    tier: league.tier,
    name: drawTeamName(rng, league.tier, leagueNames, usedNames),
    shortName: '',
    country: pick(rng, COUNTRIES).code,
    colorPrimary,
    colorSecondary,
    archetype,
    prestige: Math.round(clamp(100 - (league.tier - 1) * 8 + (strength - 0.5) * 18, 5, 100)),
    budget: Math.round(league.costCap * between(rng, 0.55, 0.98)),
    parts,
    reliability: Math.round(clamp(96 - league.tier * 2.2 + (strength - 0.5) * 12, 45, 99)),
    drivers: [],
  };
  team.shortName = team.name
    .split(' ')[0]
    .slice(0, 3)
    .toUpperCase();

  for (let seat = 0; seat < league.carsPerTeam; seat += 1) {
    team.drivers.push(createDriver(rng, league.tier, seat, strength));
  }
  return team;
}

/* ------------------------------------------------------------------ */
/* Light-Sim einer Saison                                              */
/* ------------------------------------------------------------------ */

/** Auto-Score 0-100: Mittel der Bauteile, gemessen am Reglementdeckel der Liga. */
export function carScore(team: Team, league: League): number {
  const values = PART_GROUPS.map((group) => team.parts[group.key]);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (mean / league.partCap) * 100;
}

/** Fahrer-Score 0-100 nach der Gewichtung aus Abschnitt 12.1. */
export function driverScore(driver: Driver): number {
  return driver.pace * 0.6 + driver.racecraft * 0.25 + driver.consistency * 0.15;
}

interface Entry {
  team: Team;
  driver: Driver;
}

function simulateSeason(rng: () => number, league: League, teams: Team[]): LeagueSeason {
  const points = pointsSystem(league.tier);
  const entries: Entry[] = [];
  for (const team of teams) {
    for (const driver of team.drivers) entries.push({ team, driver });
  }

  const teamPoints = new Map<string, { points: number; wins: number; podiums: number; dnf: number }>();
  for (const team of teams) teamPoints.set(team.id, { points: 0, wins: 0, podiums: 0, dnf: 0 });

  for (let race = 0; race < league.raceCount; race += 1) {
    const results: { entry: Entry; score: number; dnf: boolean }[] = entries.map((entry) => {
      const base = carScore(entry.team, league) * 0.6 + driverScore(entry.driver) * 0.4;
      // Streuung: unkonstante Fahrer schwanken stärker. Die Größe ist so gewählt,
      // dass Spitzenteams klar dominieren, das Mittelfeld aber regelmäßig punktet.
      const spread = 5 + (100 - entry.driver.consistency) * 0.18;
      const noise = (rng() + rng() + rng() - 1.5) * spread;
      const failureChance = league.dnfRate * (2 - entry.team.reliability / 100);
      return { entry, score: base + noise, dnf: rng() < failureChance };
    });

    const finishers = results.filter((result) => !result.dnf).sort((a, b) => b.score - a.score);
    for (const result of results) {
      if (!result.dnf) continue;
      result.entry.driver.dnf += 1;
      teamPoints.get(result.entry.team.id)!.dnf += 1;
    }

    finishers.forEach((result, position) => {
      const scored = points[position] ?? 0;
      const bucket = teamPoints.get(result.entry.team.id)!;
      result.entry.driver.points += scored;
      bucket.points += scored;
      if (position === 0) {
        result.entry.driver.wins += 1;
        bucket.wins += 1;
      }
      if (position < 3) {
        result.entry.driver.podiums += 1;
        bucket.podiums += 1;
      }
    });
  }

  const rules = movementRules(league.tier);
  const table: StandingRow[] = teams
    .map((team) => {
      const bucket = teamPoints.get(team.id)!;
      return {
        rank: 0,
        team,
        points: bucket.points,
        wins: bucket.wins,
        podiums: bucket.podiums,
        dnf: bucket.dnf,
        movement: 'stay' as Movement,
      };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums);

  const last = table.length;
  table.forEach((row, index) => {
    const rank = index + 1;
    row.rank = rank;
    if (rank <= rules.promotionSlots) row.movement = 'promotion';
    else if (rank <= rules.promotionSlots + rules.promotionBarrageSlots) row.movement = 'promotion_barrage';
    else if (rank > last - rules.relegationSlots) row.movement = 'relegation';
    else if (rank > last - rules.relegationSlots - rules.relegationBarrageSlots)
      row.movement = 'relegation_barrage';
    else row.movement = 'stay';
  });

  const driverTable = entries
    .map((entry) => entry.driver)
    .sort((a, b) => b.points - a.points || b.wins - a.wins);

  return { league, table, driverTable };
}

/* ------------------------------------------------------------------ */
/* Welt bauen                                                          */
/* ------------------------------------------------------------------ */

export function buildWorld(seed = 20260724, season = 1): World {
  const rng = createRng(seed);
  const seasons = new Map<number, LeagueSeason>();
  const usedNames = new Set<string>();

  for (const league of LEAGUES) {
    const teams: Team[] = [];
    const leagueNames: LeagueNames = { prefixes: new Set(), suffixes: new Map() };
    for (let index = 0; index < league.teamCount; index += 1) {
      teams.push(createTeam(rng, league, index, leagueNames, usedNames));
    }
    seasons.set(league.tier, simulateSeason(rng, league, teams));
  }

  return { seed, season, seasons };
}

export function getSeason(world: World, tier: number): LeagueSeason {
  const season = world.seasons.get(tier);
  if (!season) throw new Error(`Keine Saisondaten für Tier ${tier}`);
  return season;
}

/** Gesamtzahlen für die Kopfzeile der Pyramide. */
export function worldTotals(world: World): { teams: number; drivers: number; races: number } {
  let teams = 0;
  let drivers = 0;
  let races = 0;
  for (const league of LEAGUES) {
    const season = getSeason(world, league.tier);
    teams += season.table.length;
    drivers += season.driverTable.length;
    races += getLeague(league.tier).raceCount;
  }
  return { teams, drivers, races };
}
