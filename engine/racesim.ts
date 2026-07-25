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
 *
 * Mit M7 Teil 2 kommt der Rest von Konzept 12.4 dazu: Fahrfehler, Dreher,
 * Kollisionen, Schaeden und Strafen. Die rote Flagge bleibt bewusst aussen vor
 * (getroffene Entscheidung) - sie unterbricht die Rundenschleife, statt ein
 * Ereignis darin zu sein, und haette die eingemessene Renndistanz verschoben.
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

/**
 * Temperatur (Konzept 12.4/12.5).
 *
 * Bezugspunkt ist die Temperatur, auf die Reifen und Kuehlung ausgelegt sind.
 * Der Hitzefaktor laeuft von -1 (kalt) ueber 0 (Auslegungspunkt) bis +1 (heiss);
 * beide Richtungen kosten, aber unterschiedlich: Hitze frisst Reifen und
 * Technik, Kaelte kostet Zeit, bis der Reifen ueberhaupt arbeitet.
 */
const REFERENCE_TEMP_C = 22;
const TEMP_SPAN_C = 18;

/** Zusaetzlicher Verschleiss bei voller Hitze. */
const TEMP_WEAR_FACTOR = 0.28;

/** Zusaetzliche Ausfallrate bei voller Hitze - der Hitzefaktor aus Konzept 12.4. */
const TEMP_DNF_FACTOR = 0.4;

/** Zeitverlust in der ersten Runde eines Stints bei voller Kaelte. */
const COLD_WARMUP_S = 0.8;

/**
 * Grundwahrscheinlichkeit eines Fahrfehlers je Runde und Auto (Konzept 12.4).
 *
 * Der weit ueberwiegende Teil davon ist ein Verbremser, der Zehntel kostet und
 * niemandem auffaellt. Erst die Eskalationsstufen darunter - Dreher, Ausritt -
 * sind das, was ein Rennen dreht.
 */
const MISTAKE_BASE = 0.01;

/** Anteil der Fahrfehler, die zum Dreher werden. `car_control` daempft ihn. */
const SPIN_SHARE = 0.12;

/** Anteil der Dreher, die im Reifenstapel enden. Die Streckentuecke hebt ihn. */
const CRASH_SHARE = 0.1;

/** Anteil der Dreher, die eine Flatstelle im Reifen hinterlassen. */
const FLATSPOT_SHARE = 0.45;

/**
 * Grundwahrscheinlichkeit, dass ein Zweikampf Kontakt gibt (Konzept 12.4).
 *
 * Der Wert wirkt klein, weil er sich auf den einzelnen Zweikampf bezieht - und
 * davon gibt es rund 150 je Rennen. Bei 0.045 gemessen waren es neun
 * Kollisionen je Rennen, also fast eine je Fahrer: ein Feld, das sich selbst
 * zerlegt. Eingestellt auf gut zwei je Rennen.
 */
const CONTACT_BASE = 0.012;

/** Anteil der Kollisionen, die mindestens ein Auto aus dem Rennen nehmen. */
const CONTACT_HEAVY_SHARE = 0.22;

/** Anteil der Kollisionen, die als Rennunfall ohne Schuldigen gewertet werden. */
const RACING_INCIDENT_SHARE = 0.25;

/** Zeitverlust je Runde durch einen beschaedigten Frontfluegel. */
const WING_DAMAGE_S = 1.1;

/** Zeitverlust je Runde durch einen beschaedigten Reifen. */
const TYRE_DAMAGE_S = 1.4;

/** Zusaetzliche Standzeit, wenn bei einem Stopp der Fluegel getauscht wird. */
const WING_REPAIR_S = 4.2;

/** Zeitstrafen in Sekunden (Konzept 12.4). */
const PENALTY_COLLISION_S = 5;
const PENALTY_COLLISION_HEAVY_S = 10;
const PENALTY_TRACK_LIMITS_S = 5;
const PENALTY_PIT_SPEEDING_S = 5;

/** Vierte Verwarnung wegen Streckenbegrenzung ergibt die Strafe. */
const TRACK_LIMITS_ALLOWANCE = 3;

/**
 * Grundwahrscheinlichkeit je Runde, die Streckenbegrenzung zu ueberfahren.
 *
 * Bewusst ein eigener Wurf und keine Folge des Fahrfehlers. Als Folge gebaut
 * feuerte die Regel in 420 gemessenen Rennen genau einmal: Es gibt rund sieben
 * Fahrfehler je Rennen im ganzen Feld, und vier davon beim selben Fahrer kommen
 * nie zusammen. Einen Randstein zu weit mitzunehmen ist aber kein Fehler,
 * sondern der Normalfall - er kostet nichts, bis er das vierte Mal passiert.
 */
const TRACK_LIMITS_BASE = 0.035;

/** Grundwahrscheinlichkeit, in der Boxengasse zu schnell zu sein. */
const PIT_SPEEDING_BASE = 0.008;

/** Hitzefaktor: -1 kalt, 0 Auslegungspunkt, +1 heiss. */
function heatFactor(temperatureC: number): number {
  return Math.max(-1, Math.min(1, (temperatureC - REFERENCE_TEMP_C) / TEMP_SPAN_C));
}

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
  /**
   * Streckentuecke 0-1 (tracks.csv). Sie entscheidet nicht, wie oft ein Fehler
   * passiert, sondern was er kostet: Wo Auslauf ist, verliert man Zehntel und
   * eine Verwarnung, wo eine Mauer steht, das Rennen.
   */
  risk: number;
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
  /** Gegner - bei 'traffic', 'overtake' und 'collision' gesetzt. */
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
  /** Zeitverlust durch Fahrfehler, Kollisionen und deren Schaeden. */
  lostToIncidents: number;
  /** Verhaengte Zeitstrafen in Sekunden, erst in der Endwertung verrechnet. */
  penaltyS: number;
}

/**
 * Was eine Kollision beim Gegner anrichtet.
 *
 * Der Gegner wird nicht sofort angefasst: Ob er in dieser Runde schon gefahren
 * ist, haengt an der Reihenfolge der Schleife, und ein Auto zweimal in dieselbe
 * Runde zu schreiben verletzt den Primaerschluessel von lap_records. Die Folgen
 * werden deshalb hinterlegt und zu Beginn seiner naechsten Runde eingeloest.
 */
interface PendingIncident {
  lossS: number;
  wing: boolean;
  tyre: boolean;
  retire: boolean;
  rivalId: number;
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
  lostToIncidents: number;
  /** Frontfluegelschaden: kostet jede Runde Zeit, bis er getauscht wird. */
  wingDamage: boolean;
  /** Reifenschaden: dasselbe, aber der Reifen wird ohnehin gewechselt. */
  tyreDamage: boolean;
  /** Runde, ab der die Box den Schaden reparieren will. */
  repairAt: number | null;
  /** Offene Verwarnungen wegen Streckenbegrenzung. */
  trackLimits: number;
  penaltyS: number;
  pending: PendingIncident | null;
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
      lostToIncidents: 0,
      wingDamage: false,
      tyreDamage: false,
      repairAt: null,
      trackLimits: 0,
      penaltyS: 0,
      pending: null,
    };
    state.plan = planStops(entry, preferred, context, rng);
    return state;
  });

  // Startaufstellung als Anfangsabstand: Platz zwei startet 0,2 s hinter
  // Platz eins und muss die Luecke erst fahren.
  for (const car of cars) car.totalMs = (car.entry.grid - 1) * 200;

  const records: LapRecord[] = [];
  const perLapDnf = 1 - Math.pow(1 - context.dnfBaseRate, 1 / context.laps);

  // Hitzefaktor des Renntags. Er steht fest, weil das Wetter nur die Naesse
  // ueber die Runden verteilt und die Temperatur als Tageswert liefert.
  const heat = heatFactor(weather?.temperatureC ?? REFERENCE_TEMP_C);
  const tempWear = 1 + TEMP_WEAR_FACTOR * heat;
  const tempDnf = 1 + TEMP_DNF_FACTOR * heat;
  const coldWarmup = Math.max(0, -heat) * COLD_WARMUP_S;

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

    // Rennstand zu Rundenbeginn. Ohne diese Momentaufnahme haengt der Abstand
    // zum Vordermann davon ab, ob der in dieser Schleife schon gefahren ist:
    // War er frueher an der Reihe, enthielt sein totalMs bereits die laufende
    // Runde, der Abstand wurde negativ und der Zweikampf fiel aus. Rund die
    // Haelfte aller Zweikaempfe ist so bis v0.17.0 nie zustande gekommen.
    const startMs = new Map(running.map((car) => [car, car.totalMs]));

    for (const car of running) {
      // Folgen einer Kollision aus der Vorrunde einloesen.
      const pending = car.pending;
      car.pending = null;
      if (pending?.retire) {
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
          event: 'crash',
          rivalId: pending.rivalId,
        });
        continue;
      }

      const reliabilityFactor = 1 + (0.75 - car.entry.reliability / 100);
      if (rng() < perLapDnf * tempDnf * Math.max(0.7, Math.min(1.3, reliabilityFactor))) {
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

      // Hitze frisst Reifen: Bei vierzig Grad Luft laeuft derselbe Satz ueber
      // ein Viertel schneller ab als am Auslegungspunkt.
      const wearPerLap =
        car.compound.wearRate *
        context.abrasion *
        tempWear *
        (1.15 - (car.entry.attributes.tyre_management ?? 60) / 100 * 0.3);
      car.wear += wearPerLap;
      car.stintLaps += 1;
      car.fuel = Math.max(0, car.fuel - FUEL_PER_LAP_KG);

      const tyreLoss = tyrePenalty(car.wear, car.compound);
      const fuelLoss = (car.fuel / 10) * FUEL_TIME_PER_10KG;
      const gripGain = (car.compound.grip - 1) * -baseLapS * 0.012;

      // Kaelte kostet am Anfang eines Stints: Der Reifen arbeitet erst nach
      // zwei Runden. Das ist die Gegenrichtung zum Verschleiss - und der Grund,
      // warum ein zusaetzlicher Stopp an einem kalten Tag teurer ist.
      const warmupLoss =
        car.stintLaps === 1 ? coldWarmup : car.stintLaps === 2 ? coldWarmup * 0.5 : 0;

      // Schaeden aus Kollision oder Dreher kosten jede Runde, bis die Box sie
      // repariert. Genau darin liegt die Entscheidung: sofort rein und die
      // Position aufgeben, oder weiterfahren und Zeit verlieren.
      const damageLoss =
        (car.wingDamage ? WING_DAMAGE_S : 0) + (car.tyreDamage ? TYRE_DAMAGE_S : 0);

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
        car.cleanPace +
        tyreLoss +
        fuelLoss +
        gripGain +
        wetLoss +
        warmupLoss +
        damageLoss +
        gaussian(rng) * car.sigma;

      car.lostToTyres += tyreLoss + wrongTyre + warmupLoss;
      car.lostToFuel += fuelLoss;
      car.lostToIncidents += damageLoss;

      let event: string | null = null;
      let rivalId: number | null = null;

      // Kollisionsfolgen der Vorrunde, die nicht zum Ausfall gefuehrt haben.
      if (pending) {
        lapS += pending.lossS;
        car.lostToIncidents += pending.lossS;
        if (pending.wing) car.wingDamage = true;
        if (pending.tyre) car.tyreDamage = true;
        if ((pending.wing || pending.tyre) && car.repairAt === null) {
          car.repairAt = lap + 1 + Math.round((1 - car.entry.strategy / 100) * 3);
        }
        // Eigenes Ereignis fuer den Getroffenen. Beide Rollen gleich zu
        // beschriften machte die Formel unpruefbar: Auf den Angreifer wirkt
        // seine Aggressivitaet mit dem vollen Gewicht, auf den Vordermann nur
        // mit einem Drittel - in einer gemeinsamen Zahl heben sich beide auf,
        // und gemessen kam ausgerechnet das falsche Vorzeichen heraus.
        event = 'collision_hit';
        rivalId = pending.rivalId;
      }

      // Fahrfehler (Konzept 12.4). Wie oft einer passiert, entscheiden Konstanz
      // und Druckfestigkeit des Fahrers und die Naesse; was er kostet, die
      // Streckentuecke. Unter Safety Car faehrt niemand am Limit.
      if (!underSafetyCar && event === null) {
        const attributes = car.entry.attributes;
        const mistakeChance =
          MISTAKE_BASE *
          (1.7 - (attributes.consistency ?? 60) / 100) *
          (1.3 - ((attributes.pressure ?? 60) / 100) * 0.6) *
          (1 + wetness * 1.8);

        if (rng() < mistakeChance) {
          const control = (attributes.car_control ?? 60) / 100;
          if (rng() < SPIN_SHARE * (1.4 - control * 0.8)) {
            // Dreher. Auf einer Strecke mit Mauer endet er im Reifenstapel,
            // auf einer mit Auslauf im Kies und kostet nur Sekunden.
            if (rng() < CRASH_SHARE * (0.4 + context.risk)) {
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
                event: 'crash',
                rivalId: null,
              });
              continue;
            }
            const spinS = 4 + rng() * 5;
            lapS += spinS;
            car.lostToIncidents += spinS;
            event = 'spin';
            // Eine Flatstelle zwingt an die Box, egal was der Plan sagt.
            if (rng() < FLATSPOT_SHARE) {
              car.tyreDamage = true;
              if (car.repairAt === null) {
                car.repairAt = lap + 1 + Math.round((1 - car.entry.strategy / 100) * 3);
              }
            }
          } else {
            const mistakeS = 0.35 + rng() * 0.85;
            lapS += mistakeS;
            car.lostToIncidents += mistakeS;
            event = 'mistake';
          }
        }

        // Streckenbegrenzung (Konzept 12.4). Nur dort ein Thema, wo ueberhaupt
        // Platz zum Ueberfahren ist: Auf einem Mauerkurs steht hinter dem
        // Randstein kein Asphalt, sondern Beton. Die Verwarnung selbst kostet
        // nichts - erst die vierte wird zur Strafe.
        if (rng() < TRACK_LIMITS_BASE * (1 - context.risk) *
            (0.6 + ((car.entry.attributes.aggression ?? 60) / 100) * 0.8)) {
          car.trackLimits += 1;
          if (car.trackLimits > TRACK_LIMITS_ALLOWANCE) {
            car.trackLimits = 0;
            car.penaltyS += PENALTY_TRACK_LIMITS_S;
            event = 'track_limits';
          }
        }
      }

      // Verkehr: Wer dicht hinter einem Vordermann liegt, kommt nur vorbei,
      // wenn Tempo und Streckencharakter es hergeben.
      const index = order.indexOf(car);
      const ahead = index > 0 ? order[index - 1] : undefined;
      if (ahead && !ahead.retired && !underSafetyCar && event === null) {
        const gapS = ((startMs.get(car) ?? car.totalMs) - (startMs.get(ahead) ?? ahead.totalMs)) / 1000;
        if (gapS > 0 && gapS < 1.2 && car.cleanPace < ahead.cleanPace) {
          const attacker = car.entry.attributes;
          const defender = ahead.entry.attributes;
          rivalId = ahead.entry.driverId;

          // Kollision (Konzept 12.4). Der Zweikampf hat jetzt einen dritten
          // Ausgang neben vorbei und haengengeblieben: Kontakt. Aggressivitaet
          // beider Beteiligter treibt ihn, die Streckentuecke entscheidet ueber
          // die Folgen - eine Beruehrung mit Auslauf kostet Zeit, eine an der
          // Mauer beide Autos.
          const contactChance =
            CONTACT_BASE *
            (0.5 + context.risk) *
            (0.55 + ((attacker.aggression ?? 60) / 100) * 0.9) *
            (0.75 + ((defender.aggression ?? 60) / 100) * 0.5) *
            (1 + wetness * 1.5);

          if (rng() < contactChance) {
            const heavy = rng() < CONTACT_HEAVY_SHARE * (0.5 + context.risk);
            const ownS = heavy ? 8 + rng() * 6 : 1.5 + rng() * 2.5;
            lapS += ownS;
            car.lostToIncidents += ownS;
            event = 'collision';

            // Schuldfrage. Ein Viertel bleibt Rennunfall ohne Schuldigen; sonst
            // traegt in der Regel der Angreifer die Verantwortung, und je
            // aggressiver er gegenueber dem Verteidiger faehrt, desto eher.
            const blameRoll = rng();
            const attackerOdds = Math.max(
              0.2,
              Math.min(
                0.85,
                0.55 + ((attacker.aggression ?? 60) - (defender.aggression ?? 60)) / 300,
              ),
            );
            const guilty =
              blameRoll < RACING_INCIDENT_SHARE
                ? null
                : rng() < attackerOdds
                  ? car
                  : ahead;

            if (guilty) {
              guilty.penaltyS += heavy ? PENALTY_COLLISION_HEAVY_S : PENALTY_COLLISION_S;
            }

            // Der Angreifer trifft mit dem Frontfluegel, der Verteidigte
            // faengt sich den Reifenschaden ein.
            const attackerRetires = heavy && rng() < 0.55;
            const defenderRetires = heavy && rng() < 0.45;

            if (attackerRetires) {
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
                event: 'crash',
                rivalId,
              });
            } else if (rng() < 0.6) {
              car.wingDamage = true;
              if (car.repairAt === null) {
                car.repairAt = lap + 1 + Math.round((1 - car.entry.strategy / 100) * 3);
              }
            }

            ahead.pending = {
              lossS: heavy ? 8 + rng() * 6 : 1.2 + rng() * 2.2,
              wing: !defenderRetires && rng() < 0.3,
              tyre: !defenderRetires && rng() < 0.35,
              retire: defenderRetires,
              rivalId: car.entry.driverId,
            };

            if (attackerRetires) continue;
          } else {
            const skill = ((attacker.overtaking ?? 60) - (defender.defending ?? 60)) / 100;
            const chance = Math.min(
              DUEL_MAX_CHANCE,
              Math.max(
                DUEL_MIN_CHANCE,
                (1 - context.overtakingDifficulty) * 0.8 + skill * DUEL_DRIVER_WEIGHT,
              ),
            );
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

      // Ein Schaden ist der dritte Anlass fuer einen Stopp - neben Wetter und
      // Plan. Er hat Vorrang vor dem Plan, aber nicht vor dem Wetter: Wer
      // ohnehin auf Regenreifen muss, repariert im selben Stopp.
      const wantsRepair =
        (car.wingDamage || car.tyreDamage) && car.repairAt !== null && lap >= car.repairAt;

      const weatherTarget = needsChange
        ? compoundForWetness(seenWetness) === 'wet'
          ? wetTyre
          : compoundForWetness(seenWetness) === 'intermediate'
            ? intermediate
            : dry.find((c) => c.compoundId === 3) ?? dry[0]
        : undefined;

      let reason: 'weather' | 'damage' | 'plan' | null = null;
      if (needsChange && weatherTarget) reason = 'weather';
      else if (wantsRepair) reason = 'damage';
      else if (car.plan.includes(lap)) reason = 'plan';

      if (reason && car.stintLaps >= 2) {
        // Die Crew wirkt auf Mittelwert UND Fehlerrate (Konzept 8.1). Nur die
        // Streuung zu staffeln reichte nicht: Zwischen der besten und der
        // schlechtesten Crew in Tier 1 lagen dann neun Hundertstel, weniger
        // als das Rauschen einer einzelnen Saison.
        const standS = 2.9 - 1.2 * (car.entry.crew / 100);
        // Unter Safety Car ist der Stopp fast geschenkt - der beruechtigte
        // Gratis-Boxenstopp aus Konzept 12.4.
        const pitLoss = underSafetyCar ? context.pitLossS * 0.35 : context.pitLossS;
        // Ein neuer Frontfluegel haelt das Auto laenger an der Box.
        const repairS = car.wingDamage ? WING_REPAIR_S : 0;
        const crewNoise = reason === 'weather' ? 0 : (1 - car.entry.crew / 100) * 1.6;
        const stopS = pitLoss + standS + repairS + Math.abs(gaussian(rng)) * crewNoise;
        lapS += stopS;
        car.lostToPits += stopS - repairS;
        car.lostToIncidents += repairS;
        car.stops += 1;
        car.wear = 0;
        car.stintLaps = 0;
        car.wingDamage = false;
        car.tyreDamage = false;
        car.repairAt = null;
        // Wetterstopp nimmt die passende Mischung, sonst geht es auf der
        // haerteren weiter.
        car.compound =
          reason === 'weather' && weatherTarget
            ? weatherTarget
            : dry.find((c) => c.compoundId === 3) ?? car.compound;

        // Boxengassentempo (Konzept 12.4). Selten, aber teuer - und der
        // einzige Fehler, den ein Fahrer im Schritttempo macht.
        if (rng() < PIT_SPEEDING_BASE * (1.3 - (car.entry.attributes.consistency ?? 60) / 100)) {
          car.penaltyS += PENALTY_PIT_SPEEDING_S;
        }

        event = underSafetyCar
          ? 'pit_sc'
          : reason === 'weather'
            ? 'pit_weather'
            : reason === 'damage'
              ? 'pit_damage'
              : 'pit';
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

  // Strafen wirken erst in der Endwertung (Konzept 12.4). Genau das macht sie
  // im Rennen so unangenehm: Der Fahrer weiss, dass er fuenf Sekunden Vorsprung
  // braucht, und faehrt den Rest des Rennens gegen eine unsichtbare Uhr. Die
  // Rundenzeiten bleiben unberuehrt - eine Strafe ist keine verlorene Zeit auf
  // der Strecke, sondern eine Zeile im Ergebnisprotokoll.
  const finishers = cars
    .filter((car) => !car.retired)
    .sort((a, b) => a.totalMs + a.penaltyS * 1000 - (b.totalMs + b.penaltyS * 1000));
  const outcomes: RaceOutcome[] = [
    ...finishers.map((car, index) => ({
      driverId: car.entry.driverId,
      teamId: car.entry.teamId,
      grid: car.entry.grid,
      position: index + 1,
      status: 'classified' as const,
      totalMs: car.totalMs + Math.round(car.penaltyS * 1000),
      stops: car.stops,
      bestLapMs: car.bestLapMs === Number.POSITIVE_INFINITY ? 0 : car.bestLapMs,
      lostToTyres: car.lostToTyres,
      lostToFuel: car.lostToFuel,
      lostToTraffic: car.lostToTraffic,
      lostToPits: car.lostToPits,
      lostToIncidents: car.lostToIncidents,
      penaltyS: car.penaltyS,
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
        lostToIncidents: car.lostToIncidents,
        // Wer ausfaellt, nimmt seine Strafe mit ins Nichts. Sie zu uebertragen
        // waere ein eigenes Regelwerk (Startplatzstrafe im naechsten Rennen)
        // und gehoert nicht in die Rennsimulation.
        penaltyS: 0,
      })),
  ];

  return { records, outcomes };
}
