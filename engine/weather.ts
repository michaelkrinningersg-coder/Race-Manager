/**
 * Wetter (Konzept 12.5).
 *
 * Wetter ist keine Eigenschaft eines Rennens, sondern eine Zeitreihe darueber.
 * Genau daraus entsteht der Reiz: Eine Strecke, die in Runde 12 abtrocknet,
 * verlangt eine andere Entscheidung als eine, auf der es ab Runde 40 schuettet.
 *
 * REICHWEITE. Das Wetter wirkt ausschliesslich in der Tick-Sim (getroffene
 * Entscheidung). Die Light-Sim, deren Ergebnisverteilung ueber fuenf
 * Meilensteine eingemessen ist, bleibt unangetastet. Der Preis ist bekannt: Von
 * 2.600 Rennwochenenden einer 20-Saisons-Welt laufen 22 rundenweise - in
 * Tabellen und Karrieren kommt Regen damit nicht vor.
 */

import type { Database } from './savegame.js';
import { createRng, seedFrom } from './rng.js';

export interface WeatherProfile {
  trackId: number;
  rainProbability: number;
  changeability: number;
  baseTempC: number;
  tempSwingC: number;
  southern: boolean;
}

export function loadWeatherProfiles(db: Database): Map<number, WeatherProfile> {
  return new Map(
    (db.prepare('SELECT * FROM weather_profiles').all() as Record<string, number>[]).map((row) => [
      row.track_id,
      {
        trackId: row.track_id,
        rainProbability: row.rain_probability,
        changeability: row.changeability,
        baseTempC: row.base_temp_c,
        tempSwingC: row.temp_swing_c,
        southern: row.southern === 1,
      },
    ]),
  );
}

/**
 * Nasse einer Runde: 0 = trocken, 1 = stehendes Wasser.
 *
 * Zwischenwerte sind der interessante Bereich - bei 0.3 ist die Ideallinie
 * abgetrocknet und der Rest nicht, und genau dann entscheidet die Reifenwahl.
 */
export type Wetness = number;

export interface RaceWeather {
  /** Nasse je Runde, Index 0 ist Runde 1. */
  perLap: Wetness[];
  /** Lufttemperatur - noch ohne Wirkung, aber Teil des Profils. */
  temperatureC: number;
  /** Kurzbeschreibung fuer die Anzeige. */
  label: string;
  /** Ob ueberhaupt Nasse auftrat - spart der Sim den Umweg bei Trockenheit. */
  wet: boolean;
}

/**
 * Jahreszeitfaktor aus der Kalenderwoche.
 *
 * Regen ist im Winterhalbjahr wahrscheinlicher, die Temperatur niedriger. Auf
 * der Suedhalbkugel dreht sich beides um - ohne diese Kennzeichnung waere der
 * australische Kalendersommer der kaelteste Termin des Jahres.
 */
function seasonalFactor(week: number, southern: boolean): number {
  const phase = ((week - 1) / 52) * 2 * Math.PI;
  // +1 im Hochsommer, -1 im Winter (Nordhalbkugel).
  const summer = Math.sin(phase - Math.PI / 2) * -1;
  return southern ? -summer : summer;
}

/**
 * Wuerfelt das Wetter eines Rennens.
 *
 * Der Ablauf ist bewusst grob: Entweder es bleibt trocken, oder es gibt eine
 * nasse Phase mit Anfang, Hoehepunkt und Ende. Eine feinere Zeitreihe waere
 * ohne Spielerentscheidung im Rennen nicht ablesbar - der Reiz entsteht erst
 * mit dem Live-Cockpit aus Konzept 11.3.
 */
export function drawWeather(
  profile: WeatherProfile | undefined,
  laps: number,
  week: number,
  worldSeed: number,
  season: number,
  tier: number,
  round: number,
  leg: number,
): RaceWeather {
  const dry: RaceWeather = {
    perLap: new Array(laps).fill(0),
    temperatureC: profile?.baseTempC ?? 20,
    label: 'trocken',
    wet: false,
  };
  if (!profile) return dry;

  const rng = createRng(seedFrom(worldSeed, season, tier, round, leg, 4711));
  const summer = seasonalFactor(week, profile.southern);

  // Im Sommer bis zu einem Drittel weniger Regen, im Winter entsprechend mehr.
  const chance = Math.max(0, Math.min(1, profile.rainProbability * (1 - 0.35 * summer)));
  const temperature = Math.round(profile.baseTempC + (profile.tempSwingC / 2) * summer);

  if (rng() >= chance) return { ...dry, temperatureC: temperature };

  // Eine nasse Phase: Start, Dauer und Staerke haengen an der Wechselhaftigkeit.
  const heavy = 0.35 + rng() * 0.65;
  const spanLaps = Math.max(
    3,
    Math.round(laps * (0.25 + (1 - profile.changeability) * 0.7 + rng() * 0.2)),
  );
  const start = Math.floor(rng() * Math.max(1, laps - Math.floor(spanLaps * 0.4)));

  const perLap = new Array<number>(laps).fill(0);
  for (let i = 0; i < laps; i += 1) {
    const offset = i - start;
    if (offset < 0 || offset > spanLaps) continue;
    // Dreiecksverlauf: aufziehen, Hoehepunkt, abtrocknen.
    const t = offset / spanLaps;
    perLap[i] = heavy * (t < 0.5 ? t * 2 : (1 - t) * 2);
  }

  const peak = Math.max(...perLap);
  const label =
    peak >= 0.7 ? 'Starkregen' : peak >= 0.35 ? 'Regen' : peak > 0 ? 'wechselhaft' : 'trocken';

  return { perLap, temperatureC: temperature, label, wet: peak > 0.05 };
}

/**
 * Zeitzuschlag durch Naesse (Konzept 12.5: +8 bis +25 %).
 *
 * `wet_skill` entscheidet, wie viel davon ein Fahrer zurueckholt - im Regen
 * trennt sich das Feld staerker als im Trockenen, und genau deshalb ist Regen
 * die Chance des Aussenseiters.
 */
export function wetLapPenalty(wetness: number, wetSkill: number): number {
  if (wetness <= 0) return 0;
  const base = 0.08 + 0.17 * wetness;
  // Ein 90er-Regenfahrer verliert ein Viertel weniger als ein 40er.
  const skill = 1.15 - (wetSkill / 100) * 0.35;
  return base * skill;
}

/** Passende Mischung zur Nasse: trocken, Intermediate, Regen. */
export function compoundForWetness(wetness: number): 'dry' | 'intermediate' | 'wet' {
  if (wetness >= 0.55) return 'wet';
  if (wetness >= 0.2) return 'intermediate';
  return 'dry';
}

/** Nasse erhoeht die Safety-Car-Wahrscheinlichkeit deutlich (Konzept 12.5). */
export function safetyCarMultiplier(wetness: number): number {
  return 1 + wetness * 2.5;
}
