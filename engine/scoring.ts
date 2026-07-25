/**
 * Staerkewerte fuer ein Rennwochenende.
 *
 * Konzept 12.7 verlangt fuer die Light-Sim je Auto einen Staerkewert aus Auto,
 * Fahrer und Zufall. Was "Auto" und "Fahrer" auf einer bestimmten Strecke
 * heisst, steht in track_sector_profile: je Sektor ein Gewicht pro
 * Bauteilgruppe und pro rundenzeitrelevantem Fahrerwert.
 *
 * Damit ist jede Zahl herleitbar - die Forderung aus Design-Saeule 3.
 */

import type { Database } from './savegame.js';

/** Gewichtung Auto gegen Fahrer im Gesamtscore. */
export const CAR_WEIGHT = 0.6;
export const DRIVER_WEIGHT = 0.4;

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
] as const;

const DRIVER_KEYS = [
  'pace',
  'braking',
  'cornering',
  'car_control',
  'tyre_management',
  'consistency',
] as const;

export interface SectorProfile {
  sector: number;
  sector_share: number;
  part: Record<string, number>;
  driver: Record<string, number>;
}

export function loadTrackProfiles(db: Database): Map<number, SectorProfile[]> {
  const rows = db
    .prepare('SELECT * FROM track_sector_profile ORDER BY track_id, sector')
    .all() as Record<string, number>[];

  const byTrack = new Map<number, SectorProfile[]>();
  for (const row of rows) {
    const profile: SectorProfile = {
      sector: row.sector,
      sector_share: row.sector_share,
      part: Object.fromEntries(PART_KEYS.map((key) => [key, row[`w_${key}`]])),
      driver: Object.fromEntries(DRIVER_KEYS.map((key) => [key, row[`w_${key}`]])),
    };
    byTrack.set(row.track_id, [...(byTrack.get(row.track_id) ?? []), profile]);
  }
  return byTrack;
}

/**
 * Auto-Score auf einer Strecke: 0-100.
 *
 * Die Bauteilwerte laufen auf der weltweiten 0-1000-Skala, deshalb wird durch
 * 10 geteilt - ein Tier-1-Auto am Deckel landet bei etwa 100, ein Tier-10-Auto
 * bei etwa 25. Genau diese Spreizung soll die Pyramide haben.
 */
export function carScore(parts: Record<string, number>, profile: SectorProfile[]): number {
  let total = 0;
  for (const sector of profile) {
    let sectorScore = 0;
    for (const key of PART_KEYS) {
      sectorScore += (sector.part[key] ?? 0) * (parts[key] ?? 0);
    }
    total += sector.sector_share * sectorScore;
  }
  return total / 10;
}

/** Fahrer-Score auf einer Strecke: 0-100, die Attribute liegen bereits dort. */
export function driverScore(
  attributes: Record<string, number>,
  profile: SectorProfile[],
): number {
  let total = 0;
  for (const sector of profile) {
    let sectorScore = 0;
    for (const key of DRIVER_KEYS) {
      sectorScore += (sector.driver[key] ?? 0) * (attributes[key] ?? 0);
    }
    total += sector.sector_share * sectorScore;
  }
  return total;
}

export function combinedScore(car: number, driver: number): number {
  return CAR_WEIGHT * car + DRIVER_WEIGHT * driver;
}

/**
 * Streuung der Leistung eines Fahrers. Ein sehr konstanter Fahrer schwankt um
 * gut ein Zehntel dessen, was ein unsteter Fahrer schwankt.
 */
export function noiseSigma(consistency: number): number {
  return 0.8 + 3.0 * (1 - consistency / 100);
}

/**
 * Referenzzuverlaessigkeit, bei der ein Auto exakt die Ligaquote trifft.
 * Entspricht dem Mittel der abgeleiteten Werte (62 bis 92).
 */
const RELIABILITY_PIVOT = 0.75;

/**
 * Ausfallwahrscheinlichkeit pro Auto und Rennen.
 *
 * `dnf_base_rate` aus leagues.csv ist der **Mittelwert** der Liga, keine
 * Obergrenze - der Modifikator muss deshalb um 1.0 pendeln, nicht darunter
 * liegen. Ein Auto an der Referenzzuverlaessigkeit trifft die Ligaquote genau,
 * darueber faellt es seltener aus, darunter oefter.
 */
export function dnfProbability(baseRate: number, reliability: number): number {
  const modifier = 1 + (RELIABILITY_PIVOT - reliability / 100);
  return baseRate * Math.max(0.7, Math.min(1.3, modifier));
}
