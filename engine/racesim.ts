/**
 * Rundenweise Rennsimulation (Konzept 12).
 *
 * Anders als die Light-Sim wird hier jede Runde jedes Autos gerechnet:
 * Rundenzeit aus Auto, Fahrer, Reifenzustand und Spritmasse, dazu Verkehr,
 * Boxenstopps und Ausfaelle. Jede Runde landet in lap_records - dieselbe
 * Tabelle speist spaeter Live-Ansicht, Post-Race-Analyse und Rekorde.
 *
 * Seit M7 sind Wetter und Safety Car dabei - beide ausschliesslich hier und
 * nicht in der Light-Sim (getroffene Entscheidung). Erst mit ihnen ist die
 * Strategie eine Entscheidung und keine Rechenaufgabe mehr: Ein Schauer macht
 * den Reifenplan wertlos, ein Safety Car verschenkt den Boxenstopp an alle, die
 * ihn noch vor sich haben.
 */

import { createRng, gaussian, seedFrom } from './rng.js';
import { carScore, combinedScore, driverScore, type SectorProfile } from './scoring.js';
import {
  compoundForWetness,
  safetyCarMultiplier,
  wetLapPenalty,
  type RaceWeather,
} from './weather.js';

/** Rundenzeit eines Autos mit Score 100 bei einer Referenzstrecke. */
const REFERENCE_SPEED_MS = 55;

/** Jeder Score-Punkt unter 100 kostet diesen Anteil an Rundenzeit. */
const SCORE_TIME_FACTOR = 0.004;

/** Streuung der Rundenzeit in Sekunden bei einem sehr konstanten Fahrer. */
const LAP_NOISE_BASE = 0.12;

/**
 * Gewicht des Fahrers im Zweikampf (Konzept 12.3).
 *
 * `skill` ist die Differenz aus `overtaking` des Angreifers und `defending` des
 * Vordermanns, geteilt durch 100 - zwischen Tier-1-Fahrern liegt sie zwischen
 * -0.18 und +0.14. Der Streckenterm spannt dagegen von 0.62 bis 0.06.
 *
 * Bei 0.3 war der Fahreranteil gemessen +0,97 Prozentpunkte je rund acht Punkte
 * Differenz - vorhanden, aber vom Streckenterm zwanzigfach ueberdeckt.
 * Angehoben auf einen Wert, der den Fahrer spuerbar macht, ohne die Strecke zu
 * entwerten: Ein Stadtkurs soll auch fuer einen Weltmeister ein Stadtkurs
 * bleiben.
 */
const DUEL_DRIVER_WEIGHT = 0.9;

/**
 * Untergrenze der Ueberholchance. Von 0.05 auf 0.02 gesenkt: Bei 0.05 schnitt
 * sie auf den schwersten Strecken genau den Fahreranteil ab, den sie sichtbar
 * machen soll - bei Ueberholbarkeit 0.92 lag der Basiswert schon bei 0.064.
 */
const DUEL_MIN_CHANCE = 0.02;

/** Obergrenze, damit ein Zweikampf nie zur Formsache wird. */
const DUEL_MAX_CHANCE = 0.92;

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
  /** Regenmischung. Bis M7 aus der Sim ausgeschlossen, weil es kein Wetter gab. */
  wetOnly: boolean;
}

export interface RaceEntry {
  driverId: number;
  teamId: number;
  parts: Record<string, number>;
  attributes: Record<string, number>;
  reliability: number;
  /** Qualitaet des Chefstrategen 0-100, aus dem Personalbestand (Konzept 8.1). */
  strategy: number;
  /** Boxencrew 0-100, aus dem Personalbestand (Konzept 8.1). */
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
  /** Grundwahrscheinlichkeit einer Safety-Car-Phase je Rennen (tracks.csv). */
  safetyCarRate: number;
  /** Wetterverlauf des Rennens. Ohne Angabe wird trocken gefahren. */
  weather?: RaceWeather;
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
  /** Gegner des Zweikampfs - nur bei 'traffic' und 'overtake' gesetzt. */
  rivalId: number | null;
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
  const dry = context.compounds.filter((c) => !c.wetOnly);
  const intermediate = context.compounds.find((c) => c.wetOnly && c.grip >= 0.86);
  const wetTyre = context.compounds.find((c) => c.wetOnly && c.grip < 0.86);
  const weather = context.weather;
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

  // Safety Car (Konzept 12.4). Die Streckenrate gilt fuer das ganze Rennen und
  // wird auf die Runden verteilt; Naesse hebt sie deutlich an.
  const perLapSafetyCar = 1 - Math.pow(1 - Math.min(0.95, context.safetyCarRate), 1 / context.laps);
  let safetyCarLapsLeft = 0;

  for (let lap = 1; lap <= context.laps; lap += 1) {
    const wetness = weather?.perLap[lap - 1] ?? 0;

    // Eine Safety-Car-Phase dauert drei bis fuenf Runden.
    if (safetyCarLapsLeft > 0) {
      safetyCarLapsLeft -= 1;
    } else if (rng() < perLapSafetyCar * safetyCarMultiplier(wetness)) {
      safetyCarLapsLeft = 3 + Math.floor(rng() * 3);
    }
    const underSafetyCar = safetyCarLapsLeft > 0;
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
          rivalId: null,
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

      // Naesse: Grundzuschlag auf die Rundenzeit, gedaempft durch wet_skill.
      // Wer auf der falschen Mischung unterwegs ist, zahlt zusaetzlich - das
      // ist die eigentliche Strafe fuer einen verpassten Wechsel.
      const wanted = compoundForWetness(wetness);
      const onWet = car.compound.wetOnly;
      const wrongTyre =
        (wanted === 'dry' && onWet) || (wanted !== 'dry' && !onWet)
          ? 0.6 + wetness * 2.2
          : 0;
      const wetLoss =
        baseLapS * wetLapPenalty(wetness, car.entry.attributes.wet_skill ?? 50) + wrongTyre;

      let lapS =
        car.cleanPace + tyreLoss + fuelLoss + gripGain + wetLoss + gaussian(rng) * car.sigma;

      car.lostToTyres += tyreLoss + wrongTyre;
      car.lostToFuel += fuelLoss;

      let event: string | null = null;
      let rivalId: number | null = null;

      // Verkehr: Wer dicht hinter einem Vordermann liegt, kommt nur vorbei,
      // wenn Tempo und Streckencharakter es hergeben.
      const index = order.indexOf(car);
      const ahead = index > 0 ? order[index - 1] : undefined;
      if (ahead && !ahead.retired && !underSafetyCar) {
        const gapS = (car.totalMs - ahead.totalMs) / 1000;
        if (gapS > 0 && gapS < 1.2 && car.cleanPace < ahead.cleanPace) {
          const skill =
            ((car.entry.attributes.overtaking ?? 60) - (ahead.entry.attributes.defending ?? 60)) /
            100;
          const chance = Math.min(
            DUEL_MAX_CHANCE,
            Math.max(
              DUEL_MIN_CHANCE,
              (1 - context.overtakingDifficulty) * 0.8 + skill * DUEL_DRIVER_WEIGHT,
            ),
          );
          rivalId = ahead.entry.driverId;
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

      // Reifenwechsel bei Wetterwechsel. Der Stratege reagiert nicht sofort -
      // je schlechter er ist, desto laenger bleibt das Auto auf der falschen
      // Mischung. Das ersetzt die geplante Strategie, sobald Regen einsetzt.
      const reactionLag = Math.round((1 - car.entry.strategy / 100) * 4);
      const seenWetness = weather?.perLap[Math.max(0, lap - 1 - reactionLag)] ?? 0;
      const needsChange =
        compoundForWetness(seenWetness) !== (car.compound.wetOnly
          ? car.compound.grip >= 0.86
            ? 'intermediate'
            : 'wet'
          : 'dry');

      if (needsChange && car.stintLaps >= 2) {
        const target =
          compoundForWetness(seenWetness) === 'wet'
            ? wetTyre
            : compoundForWetness(seenWetness) === 'intermediate'
              ? intermediate
              : dry.find((c) => c.compoundId === 3) ?? dry[0];
        if (target) {
          const standS = 2.9 - 1.2 * (car.entry.crew / 100);
          // Unter Safety Car ist der Stopp fast geschenkt - der beruechtigte
          // Gratis-Boxenstopp aus Konzept 12.4.
          const loss = underSafetyCar ? context.pitLossS * 0.35 : context.pitLossS;
          const stopS = loss + standS;
          lapS += stopS;
          car.lostToPits += stopS;
          car.stops += 1;
          car.wear = 0;
          car.stintLaps = 0;
          car.compound = target;
          event = underSafetyCar ? 'pit_sc' : 'pit_weather';
        }
      } else if (car.plan.includes(lap) && car.stintLaps >= 2) {
        // Die Crew wirkt auf Mittelwert UND Fehlerrate (Konzept 8.1). Nur die
        // Streuung zu staffeln reichte nicht: Zwischen der besten und der
        // schlechtesten Crew in Tier 1 lagen dann neun Hundertstel, weniger
        // als das Rauschen einer einzelnen Saison.
        const standS = 2.9 - 1.2 * (car.entry.crew / 100);
        const crewNoise = (1 - car.entry.crew / 100) * 1.6;
        const pitLoss = underSafetyCar ? context.pitLossS * 0.35 : context.pitLossS;
        const stopS = pitLoss + standS + Math.abs(gaussian(rng)) * crewNoise;
        lapS += stopS;
        car.lostToPits += stopS;
        car.stops += 1;
        car.wear = 0;
        car.stintLaps = 0;
        // Zweiter Stint auf der haerteren Mischung, wenn vorhanden.
        car.compound = dry.find((c) => c.compoundId === 3) ?? car.compound;
        event = underSafetyCar ? 'pit_sc' : 'pit';
      }

      // Unter Safety Car faehrt das ganze Feld neutralisiert: langsamer, aber
      // ohne Streuung. Ueberholen gibt es nicht, Zeit gewinnt niemand.
      if (underSafetyCar) lapS = car.cleanPace * 1.4 + (event === 'pit_sc' ? lapS - car.cleanPace : 0);

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
        rivalId,
      });
    }

    // Positionen und Rueckstand nach dieser Runde nachtragen.
    const afterLap = cars.filter((car) => !car.retired).sort((a, b) => a.totalMs - b.totalMs);
    const leaderMs = afterLap[0]?.totalMs ?? 0;

    // Das Feld schliesst hinter dem Safety Car auf. Genau das macht die Phase
    // so teuer fuer den Fuehrenden: Sein herausgefahrener Vorsprung ist weg.
    if (underSafetyCar) {
      for (let i = 1; i < afterLap.length; i += 1) {
        const gap = afterLap[i].totalMs - leaderMs;
        afterLap[i].totalMs = leaderMs + Math.min(gap, i * 700);
      }
    }
    for (const record of records) {
      if (record.lap !== lap || record.event === 'dnf') continue;
      const position = afterLap.findIndex((car) => car.entry.driverId === record.driverId);
      if (position >= 0) {
        record.position = position + 1;
        record.gapToLeaderMs = afterLap[position].totalMs - leaderMs;
      }
      if (underSafetyCar && record.event === null) record.event = 'safety_car';
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
