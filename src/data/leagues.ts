/**
 * Stammdaten der Ligenpyramide.
 *
 * Die Werte spiegeln Abschnitt 3 des Konzepts
 * (docs/KONZEPT_MEHRLIGA_RENNMANAGER.md) wider. Später kommen diese Daten
 * aus CSV-Dateien bzw. aus der Backend-Datenbank; für den Ligen-Explorer
 * liegen sie hier statisch im Frontend.
 */

export interface League {
  /** 1 = höchste Liga, 10 = unterste Liga */
  tier: number;
  name: string;
  shortName: string;
  teamCount: number;
  carsPerTeam: number;
  raceCount: number;
  /** Kostendeckel in Euro */
  costCap: number;
  /** Reglement-Deckel für Bauteilwerte auf der weltweiten 0-1000-Skala */
  partCap: number;
  minWeightKg: number;
  tyreSetsPerWeekend: number;
  /** Ausfallwahrscheinlichkeit pro Auto und Rennen (Richtwert für die Light-Sim) */
  dnfRate: number;
  weekendFormat: string;
  flavour: string;
}

export const LEAGUES: League[] = [
  {
    tier: 1,
    name: 'APEX World Championship',
    shortName: 'AWC',
    teamCount: 11,
    carsPerTeam: 2,
    raceCount: 22,
    costCap: 145_000_000,
    partCap: 1000,
    minWeightKg: 798,
    tyreSetsPerWeekend: 13,
    dnfRate: 0.07,
    weekendFormat: '3× Training · Q1/Q2/Q3 · Rennen (6× Sprintformat)',
    flavour:
      'Die Weltmeisterschaft. Werksprogramme, Kostendeckel, aerodynamische Testrestriktion – hier entscheidet Effizienz, nicht Budgethöhe.',
  },
  {
    tier: 2,
    name: 'World Series',
    shortName: 'WS',
    teamCount: 12,
    carsPerTeam: 2,
    raceCount: 18,
    costCap: 70_000_000,
    partCap: 870,
    minWeightKg: 810,
    tyreSetsPerWeekend: 11,
    dnfRate: 0.09,
    weekendFormat: '2× Training · Q1/Q2 · Rennen',
    flavour:
      'Das Wartezimmer der Weltmeisterschaft: Absteiger mit Fallschirmgeld treffen auf Aufsteiger, die alles auf eine Karte setzen.',
  },
  {
    tier: 3,
    name: 'Intercontinental Cup',
    shortName: 'ICC',
    teamCount: 14,
    carsPerTeam: 2,
    raceCount: 16,
    costCap: 34_000_000,
    partCap: 760,
    minWeightKg: 825,
    tyreSetsPerWeekend: 10,
    dnfRate: 0.11,
    weekendFormat: '2× Training · Q1/Q2 · Rennen',
    flavour:
      'Erste Liga mit weltweitem Kalender. Ab hier werden Logistikkosten zu einem echten Posten in der Bilanz.',
  },
  {
    tier: 4,
    name: 'Continental Prime',
    shortName: 'CP',
    teamCount: 16,
    carsPerTeam: 2,
    raceCount: 14,
    costCap: 17_000_000,
    partCap: 660,
    minWeightKg: 840,
    tyreSetsPerWeekend: 9,
    dnfRate: 0.13,
    weekendFormat: '1× Training · Qualifying · Rennen',
    flavour:
      'Die Schwelle zum Profibetrieb: erstmals Superlizenz-Anforderungen an die Fahrer und verpflichtende Infrastruktur.',
  },
  {
    tier: 5,
    name: 'Continental Series',
    shortName: 'CS',
    teamCount: 16,
    carsPerTeam: 2,
    raceCount: 12,
    costCap: 9_000_000,
    partCap: 570,
    minWeightKg: 860,
    tyreSetsPerWeekend: 8,
    dnfRate: 0.15,
    weekendFormat: '1× Training · Qualifying · Rennen',
    flavour:
      'Halbprofessionell. Pay Driver finanzieren hier ganze Saisons – und blockieren Cockpits für schnellere Talente.',
  },
  {
    tier: 6,
    name: 'Challenger Series',
    shortName: 'CHS',
    teamCount: 18,
    carsPerTeam: 2,
    raceCount: 12,
    costCap: 4_500_000,
    partCap: 490,
    minWeightKg: 880,
    tyreSetsPerWeekend: 7,
    dnfRate: 0.17,
    weekendFormat: '1× Training · Qualifying · Rennen',
    flavour:
      'Sprungbrett-Liga: wer hier zwei Saisons dominiert, wird von oben abgeworben – Fahrer wie Ingenieure.',
  },
  {
    tier: 7,
    name: 'National Elite',
    shortName: 'NE',
    teamCount: 18,
    carsPerTeam: 2,
    raceCount: 10,
    costCap: 2_200_000,
    partCap: 420,
    minWeightKg: 900,
    tyreSetsPerWeekend: 6,
    dnfRate: 0.19,
    weekendFormat: 'Training · Qualifying · 2 Sprintrennen',
    flavour:
      'Nationale Spitzenserie mit Doppelrennen. Startaufstellung des zweiten Laufs: Top 6 des ersten Laufs umgedreht.',
  },
  {
    tier: 8,
    name: 'National Series',
    shortName: 'NS',
    teamCount: 20,
    carsPerTeam: 2,
    raceCount: 10,
    costCap: 1_100_000,
    partCap: 360,
    minWeightKg: 920,
    tyreSetsPerWeekend: 6,
    dnfRate: 0.2,
    weekendFormat: 'Training · Qualifying · 2 Sprintrennen',
    flavour:
      'Werkstattbetrieb statt Fabrik: Zuverlässigkeit schlägt Leistung, weil Ersatzteile schlicht fehlen.',
  },
  {
    tier: 9,
    name: 'Regional Cup',
    shortName: 'RC',
    teamCount: 20,
    carsPerTeam: 2,
    raceCount: 8,
    costCap: 550_000,
    partCap: 300,
    minWeightKg: 940,
    tyreSetsPerWeekend: 5,
    dnfRate: 0.21,
    weekendFormat: 'Kurztraining · Qualifying · 2 kurze Rennen',
    flavour:
      'Zwei Autos, Mechaniker im Nebenberuf. Wer hier gut scoutet, verkauft in drei Jahren einen Weltmeister.',
  },
  {
    tier: 10,
    name: 'Rookie Cup',
    shortName: 'RK',
    teamCount: 22,
    carsPerTeam: 2,
    raceCount: 8,
    costCap: 260_000,
    partCap: 250,
    minWeightKg: 960,
    tyreSetsPerWeekend: 4,
    dnfRate: 0.22,
    weekendFormat: 'Kurztraining · Qualifying · 2 kurze Rennen',
    flavour:
      'Der Einstieg. Kein Fallschirm, kein Fangnetz: Die letzten zwei Teams verlieren ihre Lizenz an Neugründungen.',
  },
];

export function getLeague(tier: number): League {
  const league = LEAGUES.find((entry) => entry.tier === tier);
  if (!league) throw new Error(`Unbekannte Liga: Tier ${tier}`);
  return league;
}

/** Punktesystem: Tier 1–3 fahren die volle Skala, darunter wird flacher gewertet. */
export function pointsSystem(tier: number): number[] {
  return tier <= 3
    ? [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    : [20, 16, 13, 11, 9, 7, 5, 3, 2, 1];
}

/** Bewegungsregeln je Liga (Abschnitt 4.1 des Konzepts). */
export interface MovementRules {
  promotionSlots: number;
  promotionBarrageSlots: number;
  relegationBarrageSlots: number;
  relegationSlots: number;
}

export function movementRules(tier: number): MovementRules {
  return {
    promotionSlots: tier === 1 ? 0 : 2,
    promotionBarrageSlots: tier === 1 ? 0 : 1,
    relegationBarrageSlots: tier === 10 ? 0 : 1,
    relegationSlots: tier === 10 ? 2 : 2,
  };
}

export const PART_GROUPS = [
  { key: 'chassis', label: 'Monocoque / Chassis' },
  { key: 'front_wing', label: 'Frontflügel & Nase' },
  { key: 'rear_wing', label: 'Heckflügel' },
  { key: 'floor', label: 'Unterboden / Diffusor' },
  { key: 'powertrain', label: 'Antriebseinheit' },
  { key: 'ers', label: 'Energierückgewinnung' },
  { key: 'gearbox', label: 'Getriebe' },
  { key: 'suspension', label: 'Fahrwerk & Aufhängung' },
  { key: 'brakes', label: 'Bremsen & Kühlung' },
] as const;

export type PartKey = (typeof PART_GROUPS)[number]['key'];
