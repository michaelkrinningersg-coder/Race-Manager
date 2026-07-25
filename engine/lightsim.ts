/**
 * Light-Sim eines Rennwochenendes (Konzept 12.7).
 *
 * Kein Tick, keine Runden - ein Staerkewert je Auto, Rauschen darauf,
 * Ausfaelle per Monte Carlo, fertig. Was sie trotzdem abbildet: Startaufstellung
 * aus einem eigenen Qualifying-Score, Ueberholschwierigkeit der Strecke,
 * Doppelrennen mit Umkehrgitter, Pole- und Rundenbonus.
 */

import { createRng, gaussian, seedFrom } from './rng.js';
import {
  carScore,
  combinedScore,
  dnfProbability,
  driverScore,
  noiseSigma,
  type SectorProfile,
} from './scoring.js';

export interface Entry {
  driverId: number;
  teamId: number;
  parts: Record<string, number>;
  attributes: Record<string, number>;
  /** Schwaechste Zuverlaessigkeit im Auto - sie bestimmt den Ausfall. */
  reliability: number;
}

export interface WeekendContext {
  /** Weltseed des Savegames - macht ganze Saisons gegeneinander variierbar. */
  worldSeed: number;
  season: number;
  tier: number;
  round: number;
  profile: SectorProfile[];
  overtakingDifficulty: number;
  dnfBaseRate: number;
  legCount: number;
  reverseGridTopN: number;
  points: Map<number, number>;
  /**
   * Welcher Lauf der Sprint ist (Konzept 11.1). Ohne Angabe kein Sprint.
   * Der Sprint zaehlt nach einer eigenen, flacheren Skala und vergibt weder
   * Pole- noch Rundenbonus - beides gehoert dem Hauptrennen.
   */
  sprintLeg?: number;
  sprintPoints?: Map<number, number>;
  bonusPole: number;
  bonusFastestLap: number;
  fastestLapMaxPosition: number;
}

export interface ResultRow {
  leg: number;
  driverId: number;
  teamId: number;
  grid: number;
  position: number | null;
  status: 'classified' | 'dnf';
  points: number;
  pole: boolean;
  fastestLap: boolean;
}

interface Rated extends Entry {
  base: number;
  sigma: number;
  dnfChance: number;
}

function rate(entries: Entry[], context: WeekendContext): Rated[] {
  return entries.map((entry) => {
    const car = carScore(entry.parts, context.profile);
    const driver = driverScore(entry.attributes, context.profile);
    return {
      ...entry,
      base: combinedScore(car, driver),
      sigma: noiseSigma(entry.attributes.consistency ?? 60),
      dnfChance: dnfProbability(context.dnfBaseRate, entry.reliability),
    };
  });
}

/** Startaufstellung des ersten Laufs: eigener Score mit Qualifying-Gewicht. */
function qualify(rated: Rated[], context: WeekendContext): number[] {
  const rng = createRng(seedFrom(context.worldSeed, context.season, context.tier, context.round, 0));
  return rated
    .map((entry) => ({
      driverId: entry.driverId,
      // Ein Qualifying ist eine einzelne Runde: das Qualifying-Attribut zaehlt
      // hier, Reifenmanagement dagegen nicht.
      score:
        entry.base +
        ((entry.attributes.qualifying ?? 60) - (entry.attributes.pace ?? 60)) * 0.25 +
        gaussian(rng) * entry.sigma * 0.7,
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.driverId);
}

function runLeg(
  rated: Rated[],
  grid: number[],
  leg: number,
  context: WeekendContext,
  poleDriver: number | null,
): ResultRow[] {
  const rng = createRng(seedFrom(context.worldSeed, context.season, context.tier, context.round, leg));
  const gridIndex = new Map(grid.map((driverId, index) => [driverId, index + 1]));

  const running: { entry: Rated; score: number; grid: number }[] = [];
  const retired: ResultRow[] = [];

  for (const entry of rated) {
    const start = gridIndex.get(entry.driverId) ?? rated.length;
    if (rng() < entry.dnfChance) {
      retired.push({
        leg,
        driverId: entry.driverId,
        teamId: entry.teamId,
        grid: start,
        position: null,
        status: 'dnf',
        points: 0,
        pole: entry.driverId === poleDriver,
        fastestLap: false,
      });
      continue;
    }

    // Startplatz wirkt umso staerker, je schlechter die Strecke zu ueberholen
    // ist. Auf einem Stadtkurs kostet Platz zehn spuerbar mehr als in Monza.
    const gridPenalty = context.overtakingDifficulty * (start - 1) * 0.35;
    const startBonus = ((entry.attributes.starts ?? 60) - 60) * 0.02;
    running.push({
      entry,
      grid: start,
      score: entry.base - gridPenalty + startBonus + gaussian(rng) * entry.sigma,
    });
  }

  running.sort((a, b) => b.score - a.score);

  // Schnellste Runde: unter den Klassifizierten in Bonusreichweite der mit dem
  // hoechsten Grundtempo - nicht zwingend der Sieger.
  let fastestDriver: number | null = null;
  const eligible = running.slice(0, context.fastestLapMaxPosition);
  if (eligible.length > 0) {
    fastestDriver = eligible.reduce((best, current) =>
      (current.entry.attributes.pace ?? 0) > (best.entry.attributes.pace ?? 0) ? current : best,
    ).entry.driverId;
  }

  const rows: ResultRow[] = running.map((item, index) => {
    const position = index + 1;
    const isSprint = context.sprintLeg === leg;
    const table = isSprint ? (context.sprintPoints ?? context.points) : context.points;
    let points = table.get(position) ?? 0;
    const isPole = item.entry.driverId === poleDriver;
    const isFastest = !isSprint && item.entry.driverId === fastestDriver;
    if (isPole) points += context.bonusPole;
    if (isFastest) points += context.bonusFastestLap;
    return {
      leg,
      driverId: item.entry.driverId,
      teamId: item.entry.teamId,
      grid: item.grid,
      position,
      status: 'classified',
      points,
      pole: isPole,
      fastestLap: isFastest,
    };
  });

  return [...rows, ...retired];
}

/** Simuliert ein komplettes Wochenende inklusive aller Laeufe. */
export function simulateWeekend(entries: Entry[], context: WeekendContext): ResultRow[] {
  const rated = rate(entries, context);
  const grid = qualify(rated, context);
  // Der Pole-Bonus wird einmal je Wochenende vergeben, auch bei Doppelrennen -
  // der zweite Lauf hat kein eigenes Qualifying (Datenmodell 8).
  const poleDriver = grid[0] ?? null;

  const results: ResultRow[] = [];
  let currentGrid = grid;

  for (let leg = 1; leg <= context.legCount; leg += 1) {
    const legRows = runLeg(rated, currentGrid, leg, context, leg === 1 ? poleDriver : null);
    results.push(...legRows);

    if (leg < context.legCount) {
      const finishers = legRows
        .filter((row) => row.status === 'classified')
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((row) => row.driverId);
      const retiredIds = legRows.filter((row) => row.status === 'dnf').map((row) => row.driverId);

      const top = finishers.slice(0, context.reverseGridTopN).reverse();
      const rest = finishers.slice(context.reverseGridTopN);
      // Ausgefallene starten den naechsten Lauf von hinten.
      currentGrid = [...top, ...rest, ...retiredIds];
    }
  }

  return results;
}
