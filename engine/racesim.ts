/**
 * Rundenweise Rennsimulation (Konzept 12).
 *
 * Anders als die Light-Sim wird hier jede Runde jedes Autos gerechnet:
 * Rundenzeit aus Auto, Fahrer, Reifenzustand und Spritmasse, dazu Verkehr,
 * Boxenstopps und Ausfaelle. Jede Runde landet in lap_records - dieselbe
 * Tabelle speist spaeter Live-Ansicht, Post-Race-Analyse und Rekorde.
 *
 * Was hier bewusst NICHT drin ist: Safety Car und Wetter. Beide gehoeren
 * laut Roadmap zu M7. Ohne sie bleibt die Strategie eine Rechenaufgabe -
 * mit ihnen wird sie eine Entscheidung.
 */

import { createRng, gaussian, seedFrom } from './rng.js';
import { carScore, combinedScore, driverScore, type SectorProfile } from './scoring.js';

/** Rundenzeit eines Autos mit Score 100 bei einer Referenzstrecke. */
const REFERENCE_SPEED_MS = 55;

/** Jeder Score-Punkt unter 100 kostet diesen Anteil an Rundenzeit. */
const SCORE_TIME_FACTOR = 0.004;

/** Streuung der Rundenzeit in Sekunden bei einem sehr konstanten Fahrer. */
const LAP_NOISE_BASE = 0.12;

/** Spritverbrauch in kg je Runde und Zeitkosten je 10 kg. */
const FUEL_PER_LAP_KG = 1.8;
const FUEL_TIME_PER_10KG = 0.32;

export interface Compound {
  compoundId: number;
  shortName: string;
  grip: number;
  wearRate: number;
  cliffWearPct: number;
  minStintLaps: number;
}

export interface RaceEntry {
  driverId: number;
  teamId: number;
  parts: Record<string, number>;
  attributes: Record<string, number>;
  reliability: number;
  /** Qualitaet des Chefstrategen 0-100, bis M5 abgeleitet. */
  strategy: number;
  /** Boxencrew 0-100, bis M5 abgeleitet. */
  crew: number;
  grid: number;
}

export interface RaceContext {
  worldSeed: number;
  season: number;
  tier: number;
  round: number;
  leg: number;
  profile: SectorProfile[];
  trackLengthM: number;
  laps: number;
  abrasion: number;
  pitLossS: number;
  overtakingDifficulty: number;
  dnfBaseRate: number;
  compounds: Compound[];
}

export interface LapRecord {
  lap: number;
  driverId: number;
  position: number;
  lapTimeMs: number;
  gapToLeaderMs: number;
  compound: string;
  tyreWear: number;
  fuelKg: number;
  event: string | null;
}

export interface RaceOutcome {
  driverId: number;
  teamId: number;
  grid: number;
  position: number | null;
  status: 'classified' | 'dnf';
  totalMs: number;
  stops: number;
  bestLapMs: number;
  /** Zeitverlust in Sekunden, aufgeschluesselt nach Ursache. */
  lostToTyres: number;
  lostToFuel: number;
  lostToTraffic: number;
  lostToPits: number;
}

interface CarState {
  entry: RaceEntry;
  cleanPace: number;
  sigma: number;
  compound: Compound;
  wear: number;
  fuel: number;
  totalMs: number;
  bestLapMs: number;
  stops: number;
  stintLaps: number;
  plan: number[];
  retired: boolean;
  lostToTyres: number;
  lostToFuel: number;
  lostToTraffic: number;
  lostToPits: number;
}

/**
 * Zeitverlust durch Reifenverschleiss. Unterhalb der Klippe kostet Abbau
 * wenig, darueber sehr viel - das ist der Grund, warum ein Stopp zu spaet
 * ein Rennen kostet.
 */
function tyrePenalty(wear: number, compound: Compound): number {
  if (wear <= compound.cliffWearPct) return wear * 0.012;
  const beyond = wear - compound.cliffWearPct;
  return compound.cliffWearPct * 0.012 + beyond * 0.11;
}

/**
 * Plant die Stopprunden. Die rechnerisch beste Stintlaenge ergibt sich aus
 * Verschleiss und Boxengassenverlust; die Qualitaet des Chefstrategen
 * verschiebt sie. Ein schlechter Stratege stoppt zu frueh oder zu spaet.
 */
function planStops(
  entry: RaceEntry,
  compound: Compound,
  context: RaceContext,
  rng: () => number,
): number[] {
  const wearPerLap =
    compound.wearRate * context.abrasion * (1.15 - (entry.attributes.tyre_management ?? 60) / 100 * 0.3);
  const lapsToCliff = Math.max(compound.minStintLaps, Math.floor(compound.cliffWearPct / wearPerLap));

  // Wie viele Stopps minimieren Boxenzeit plus Reifenverlust?
  let bestStops = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let stops = 0; stops <= 3; stops += 1) {
    const stintLength = context.laps / (stops + 1);
    if (stints(stintLength, lapsToCliff) === false) continue;
    const wearCost = context.laps * tyrePenalty((stintLength * wearPerLap) / 2, compound);
    const cost = stops * context.pitLossS + wearCost;
    if (cost < bestCost) {
      bestCost = cost;
      bestStops = stops;
    }
  }

  // Strategenqualitaet: Je schlechter, desto weiter weicht der geplante
  // Stopp vom rechnerischen Optimum ab.
  const error = (1 - entry.strategy / 100) * 6;
  const plan: number[] = [];
  for (let i = 1; i <= bestStops; i += 1) {
    const ideal = (context.laps * i) / (bestStops + 1);
    plan.push(Math.max(2, Math.min(context.laps - 2, Math.round(ideal + gaussian(rng) * error))));
  }
  return plan.sort((a, b) => a - b);
}

/** Ein Stint darf die Klippe nicht deutlich ueberschreiten. */
function stints(stintLength: number, lapsToCliff: number): boolean {
  return stintLength <= lapsToCliff * 1.35;
}

export function simulateRace(
  entries: RaceEntry[],
  context: RaceContext,
): { records: LapRecord[]; outcomes: RaceOutcome[] } {
  const rng = createRng(
    seedFrom(context.worldSeed, context.season, context.tier, context.round, context.leg, 7),
  );
  const dry = context.compounds.filter((c) => c.grip > 0 && c.minStintLaps > 0);
  const baseLapS = context.trackLengthM / REFERENCE_SPEED_MS;

  const cars: CarState[] = entries.map((entry) => {
    const car = carScore(entry.parts, context.profile);
    const driver = driverScore(entry.attributes, context.profile);
    const score = combinedScore(car, driver);
    // Die Mischungswahl folgt der Strategie: Wer lange Stints plant, nimmt
    // die haertere Mischung.
    const preferred =
      dry.find((c) => c.compoundId === (entry.strategy > 55 ? 2 : 1)) ?? dry[0];
    const state: CarState = {
      entry,
      cleanPace: baseLapS * (1 + (100 - score) * SCORE_TIME_FACTOR),
      sigma: LAP_NOISE_BASE + 0.45 * (1 - (entry.attributes.consistency ?? 60) / 100),
      compound: preferred,
      wear: 0,
      fuel: context.laps * FUEL_PER_LAP_KG,
      totalMs: 0,
      bestLapMs: Number.POSITIVE_INFINITY,
      stops: 0,
      stintLaps: 0,
      plan: [],
      retired: false,
      lostToTyres: 0,
      lostToFuel: 0,
      lostToTraffic: 0,
      lostToPits: 0,
    };
    state.plan = planStops(entry, preferred, context, rng);
    return state;
  });

  // Startaufstellung als Anfangsabstand: Platz zwei startet 0,2 s hinter
  // Platz eins und muss die Luecke erst fahren.
  for (const car of cars) car.totalMs = (car.entry.grid - 1) * 200;

  const records: LapRecord[] = [];
  const perLapDnf = 1 - Math.pow(1 - context.dnfBaseRate, 1 / context.laps);

  for (let lap = 1; lap <= context.laps; lap += 1) {
    const running = cars.filter((car) => !car.retired);
    const order = [...running].sort((a, b) => a.totalMs - b.totalMs);

    for (const car of running) {
      const reliabilityFactor = 1 + (0.75 - car.entry.reliability / 100);
      if (rng() < perLapDnf * Math.max(0.7, Math.min(1.3, reliabilityFactor))) {
        car.retired = true;
        records.push({
          lap,
          driverId: car.entry.driverId,
          position: order.indexOf(car) + 1,
          lapTimeMs: 0,
          gapToLeaderMs: 0,
          compound: car.compound.shortName,
          tyreWear: Math.round(car.wear * 10) / 10,
          fuelKg: Math.round(car.fuel * 10) / 10,
          event: 'dnf',
        });
        continue;
      }

      const wearPerLap =
        car.compound.wearRate *
        context.abrasion *
        (1.15 - (car.entry.attributes.tyre_management ?? 60) / 100 * 0.3);
      car.wear += wearPerLap;
      car.stintLaps += 1;
      car.fuel = Math.max(0, car.fuel - FUEL_PER_LAP_KG);

      const tyreLoss = tyrePenalty(car.wear, car.compound);
      const fuelLoss = (car.fuel / 10) * FUEL_TIME_PER_10KG;
      const gripGain = (car.compound.grip - 1) * -baseLapS * 0.012;

      let lapS =
        car.cleanPace + tyreLoss + fuelLoss + gripGain + gaussian(rng) * car.sigma;

      car.lostToTyres += tyreLoss;
      car.lostToFuel += fuelLoss;

      let event: string | null = null;

      // Verkehr: Wer dicht hinter einem Vordermann liegt, kommt nur vorbei,
      // wenn Tempo und Streckencharakter es hergeben.
      const index = order.indexOf(car);
      const ahead = index > 0 ? order[index - 1] : undefined;
      if (ahead && !ahead.retired) {
        const gapS = (car.totalMs - ahead.totalMs) / 1000;
        if (gapS > 0 && gapS < 1.2 && car.cleanPace < ahead.cleanPace) {
          const skill =
            ((car.entry.attributes.overtaking ?? 60) - (ahead.entry.attributes.defending ?? 60)) /
            100;
          const chance = Math.max(0.05, (1 - context.overtakingDifficulty) * 0.8 + skill * 0.3);
          if (rng() > chance) {
            const stuck = Math.min(0.9, 0.25 + context.overtakingDifficulty * 0.7);
            lapS += stuck;
            car.lostToTraffic += stuck;
            event = 'traffic';
          } else {
            event = 'overtake';
          }
        }
      }

      // Boxenstopp
      if (car.plan.includes(lap) && car.stintLaps >= 2) {
        const crewNoise = (1 - car.entry.crew / 100) * 1.6;
        const stopS = context.pitLossS + 2.2 + Math.abs(gaussian(rng)) * crewNoise;
        lapS += stopS;
        car.lostToPits += stopS;
        car.stops += 1;
        car.wear = 0;
        car.stintLaps = 0;
        // Zweiter Stint auf der haerteren Mischung, wenn vorhanden.
        car.compound = dry.find((c) => c.compoundId === 3) ?? car.compound;
        event = 'pit';
      }

      const lapMs = Math.round(lapS * 1000);
      car.totalMs += lapMs;
      car.bestLapMs = Math.min(car.bestLapMs, lapMs);

      records.push({
        lap,
        driverId: car.entry.driverId,
        position: 0,
        lapTimeMs: lapMs,
        gapToLeaderMs: 0,
        compound: car.compound.shortName,
        tyreWear: Math.round(car.wear * 10) / 10,
        fuelKg: Math.round(car.fuel * 10) / 10,
        event,
      });
    }

    // Positionen und Rueckstand nach dieser Runde nachtragen.
    const afterLap = cars.filter((car) => !car.retired).sort((a, b) => a.totalMs - b.totalMs);
    const leaderMs = afterLap[0]?.totalMs ?? 0;
    for (const record of records) {
      if (record.lap !== lap || record.event === 'dnf') continue;
      const position = afterLap.findIndex((car) => car.entry.driverId === record.driverId);
      if (position >= 0) {
        record.position = position + 1;
        record.gapToLeaderMs = afterLap[position].totalMs - leaderMs;
      }
    }
  }

  const finishers = cars.filter((car) => !car.retired).sort((a, b) => a.totalMs - b.totalMs);
  const outcomes: RaceOutcome[] = [
    ...finishers.map((car, index) => ({
      driverId: car.entry.driverId,
      teamId: car.entry.teamId,
      grid: car.entry.grid,
      position: index + 1,
      status: 'classified' as const,
      totalMs: car.totalMs,
      stops: car.stops,
      bestLapMs: car.bestLapMs === Number.POSITIVE_INFINITY ? 0 : car.bestLapMs,
      lostToTyres: car.lostToTyres,
      lostToFuel: car.lostToFuel,
      lostToTraffic: car.lostToTraffic,
      lostToPits: car.lostToPits,
    })),
    ...cars
      .filter((car) => car.retired)
      .map((car) => ({
        driverId: car.entry.driverId,
        teamId: car.entry.teamId,
        grid: car.entry.grid,
        position: null,
        status: 'dnf' as const,
        totalMs: car.totalMs,
        stops: car.stops,
        bestLapMs: car.bestLapMs === Number.POSITIVE_INFINITY ? 0 : car.bestLapMs,
        lostToTyres: car.lostToTyres,
        lostToFuel: car.lostToFuel,
        lostToTraffic: car.lostToTraffic,
        lostToPits: car.lostToPits,
      })),
  ];

  return { records, outcomes };
}
