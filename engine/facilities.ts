/**
 * Abgeleitete Infrastruktur und Belegschaft.
 *
 * `licence_requirements.csv` prueft Windkanal, Pruefstand, Simulator, Fabrik
 * und Mitarbeiterzahl - all das entsteht als echter Bestand erst mit M5/M6.
 * Bis dahin wird es nach demselben Muster wie die Autostaerke abgeleitet:
 * aus der aktuellen Liga und dem Prestige des Teams darin.
 *
 * Der Ansatz hat einen praktischen Vorteil: Die Pruefroutine in licence.ts
 * arbeitet schon jetzt gegen dieselbe Schnittstelle, die spaeter echte Werte
 * liefert. Getauscht wird dann nur diese Datei, nicht die Logik.
 */

import type { Database } from './savegame.js';

export interface Facilities {
  windtunnel: number;
  dyno: number;
  simulator: number;
  factory: number;
  staff: number;
}

/**
 * Ein Team liegt auf dem Mindestniveau seiner aktuellen Liga, das obere
 * Drittel zwei Stufen darueber. Damit scheitert ein Aufstieg genau dort, wo
 * die Lizenzleiter einen Sprung macht - an den Grenzen 2/1, 5/4 und 8/7.
 */
export function deriveFacilities(
  tierMinimum: {
    windtunnel: number;
    dyno: number;
    simulator: number;
    factory: number;
    staff: number;
  },
  relativePrestige: number,
): Facilities {
  const step = Math.floor(relativePrestige * 3);
  const capped = Math.min(step, 2);
  return {
    windtunnel: Math.min(5, tierMinimum.windtunnel + capped),
    dyno: Math.min(5, tierMinimum.dyno + capped),
    simulator: Math.min(5, tierMinimum.simulator + capped),
    factory: Math.min(5, tierMinimum.factory + capped),
    // Personal waechst anteilig, nicht in Stufen.
    staff: Math.round(tierMinimum.staff * (1 + 0.35 * relativePrestige)),
  };
}

export interface TeamStanding {
  teamId: number;
  tier: number;
  prestige: number;
}

/** Prestigespanne je Liga - ein Team wird stets gegen seine eigene Liga gemessen. */
export function prestigeSpans(teams: TeamStanding[]): Map<number, { min: number; max: number }> {
  const span = new Map<number, { min: number; max: number }>();
  for (const team of teams) {
    const current = span.get(team.tier);
    span.set(team.tier, {
      min: Math.min(current?.min ?? team.prestige, team.prestige),
      max: Math.max(current?.max ?? team.prestige, team.prestige),
    });
  }
  return span;
}

export function relativePrestige(
  prestige: number,
  span: { min: number; max: number } | undefined,
): number {
  if (!span) return 0.5;
  const width = span.max - span.min;
  return width === 0 ? 1 : (prestige - span.min) / width;
}

export function loadFacilityMinimums(
  db: Database,
): Map<number, { windtunnel: number; dyno: number; simulator: number; factory: number; staff: number }> {
  const rows = db.prepare('SELECT * FROM licence_requirements').all() as Record<string, number>[];
  return new Map(
    rows.map((row) => [
      row.tier,
      {
        windtunnel: row.min_windtunnel_level,
        dyno: row.min_dyno_level,
        simulator: row.min_simulator_level,
        factory: row.min_factory_level,
        staff: row.min_staff_count,
      },
    ]),
  );
}
