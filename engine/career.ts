/**
 * Karrieremodus (Konzept 13.1, 14.2).
 *
 * Die Saison der KI laeuft in einem Zug durch (loop.ts). Die des Spielers hat
 * eine Naht: Nach der Vorbereitung - Entwicklung, Ausbau, Personal, Fahrer,
 * Sponsoren fuer alle anderen 166 Teams - haelt sie an. Erst wenn der Spieler
 * fuer sein Team entschieden hat, laufen die Rennen.
 *
 * DIE VOREINSTELLUNG IST DIE KI. Wer nichts entscheidet, bekommt exakt das,
 * was die KI fuer ihn getan haette - dieselben Funktionen, auf sein Team
 * eingegrenzt (scopeTeams in player.ts). Der Grund ist nicht Bequemlichkeit,
 * sondern Notwendigkeit: Ohne Voreinstellung staende sein Auto in Saison 1
 * ohne Entwicklung da, waehrend 166 andere sich weiterentwickeln - die
 * Karriere waere nach zwei Jahren vorbei, bevor der Spieler ueberhaupt eine
 * Maske gesehen hat.
 */

import type { Database } from './db.js';
import { playerTeam } from './player.js';
import { developParts } from './development.js';
import { planInvestments } from './facilities.js';
import { runStaffMarket } from './staff.js';
import { runMarket } from './careers.js';
import { assignSponsors } from './sponsors.js';
import {
  emptyReport,
  finishSeason,
  prepareSeasonStart,
  type SeasonReport,
} from './loop.js';

/** Die fuenf Bereiche, in denen der Spieler die KI ersetzt (Konzept 14.2). */
export const DECISION_AREAS = [
  'development',
  'facilities',
  'staff',
  'drivers',
  'sponsors',
] as const;

export type DecisionArea = (typeof DECISION_AREAS)[number];

export const AREA_LABEL: Record<DecisionArea, string> = {
  development: 'Entwicklung',
  facilities: 'Anlagen',
  staff: 'Personal',
  drivers: 'Fahrer',
  sponsors: 'Sponsoren',
};

/**
 * Welche Bereiche der Spieler in dieser Saison selbst entschieden hat.
 *
 * Was hier fehlt, uebernimmt die KI fuer ihn. Der Zustand gehoert in den
 * Spielstand und nicht in den Browser: Ein exportierter Spielstand muss
 * dieselbe Saison an derselben Stelle fortsetzen.
 */
export const CAREER_DDL = `
CREATE TABLE IF NOT EXISTS player_decisions (
  season INTEGER NOT NULL,
  area   TEXT    NOT NULL,
  PRIMARY KEY (season, area)
);
`;

/**
 * Schwerpunkt des Spielers je Bauteilgruppe.
 *
 * Im Spielstand und nicht im Browser: Er gilt fuer eine Saison und gehoert
 * damit zur Karriere, nicht zur Sitzung.
 */
export function developmentFocus(
  db: Database,
  season: number,
): Record<string, number> | undefined {
  const rows = db
    .prepare('SELECT part_key, weight FROM player_focus WHERE season = ?')
    .all(season) as { part_key: string; weight: number }[];
  if (!rows.length) return undefined;
  return Object.fromEntries(rows.map((row) => [row.part_key, row.weight]));
}

export function setDevelopmentFocus(
  db: Database,
  season: number,
  focus: Record<string, number>,
): void {
  db.prepare('DELETE FROM player_focus WHERE season = ?').run(season);
  const insert = db.prepare(
    'INSERT INTO player_focus (season, part_key, weight) VALUES (?, ?, ?)',
  );
  for (const [key, weight] of Object.entries(focus)) insert.run(season, key, weight);
  markDecided(db, season, 'development');
}

export function decidedAreas(db: Database, season: number): Set<DecisionArea> {
  const rows = db
    .prepare('SELECT area FROM player_decisions WHERE season = ?')
    .all(season) as { area: DecisionArea }[];
  return new Set(rows.map((row) => row.area));
}

export function markDecided(db: Database, season: number, area: DecisionArea): void {
  db.prepare('INSERT OR IGNORE INTO player_decisions (season, area) VALUES (?, ?)').run(
    season,
    area,
  );
}

/**
 * Bereitet die Saison vor - fuer alle ausser dem Spieler.
 *
 * Danach steht sein Team unangetastet da: kein entwickeltes Auto, keine neue
 * Halle, keine Vertraege. Genau das ist der Zeitpunkt, an dem er dran ist.
 */
export function beginSeason(db: Database, season: number): SeasonReport {
  const report = emptyReport(season);
  prepareSeasonStart(db, season, report);
  return report;
}

/**
 * Holt nach, was der Spieler nicht selbst entschieden hat, und faehrt die
 * Saison zu Ende.
 *
 * Die Reihenfolge der Nachholschritte entspricht der aus loop.ts. Sie ist dort
 * an mehreren Stellen zwingend, und ein Karrieremodus, der sie anders sortiert,
 * rechnet ein anderes Spiel.
 */
export function endSeason(
  db: Database,
  season: number,
  tickTier: number,
  report: SeasonReport,
): SeasonReport {
  const player = playerTeam(db);
  if (player !== null) {
    const decided = decidedAreas(db, season);

    // Sponsoren zuerst: Der Vertrag gilt fuer die kommende Saison und steht in
    // loop.ts ebenfalls vor allem anderen.
    if (!decided.has('sponsors')) {
      report.sponsorsSigned += assignSponsors(db, season, player).signed;
    }
    if (season > 1) {
      // Entwicklung laeuft IMMER - der Schwerpunkt entscheidet nur, wohin.
      // Ohne diesen Aufruf staende das Auto des Spielers still, waehrend 166
      // andere zulegen.
      developParts(db, season - 1, season, player, developmentFocus(db, season));
      if (!decided.has('facilities')) {
        const built = planInvestments(db, season, player);
        report.upgrades += built.upgrades;
        report.invested += built.invested;
      }
      if (!decided.has('staff')) {
        const market = runStaffMarket(db, season, player);
        report.poached += market.poached;
        report.hired += market.hired;
      }
      if (!decided.has('drivers')) {
        const market = runMarket(db, season, player);
        report.signings += market.signings;
        report.unfilled += market.unfilled;
        report.overBudget += market.overBudget;
      }
    }
  }

  finishSeason(db, season, tickTier, report);
  return report;
}

export interface BoardVerdict {
  /** Ligaplatz, den der Vorstand erwartet hat. */
  target: number;
  achieved: number | null;
  met: boolean;
  /** Vertrauen 0-100. */
  confidence: number;
  fired: boolean;
  message: string;
}

/**
 * Zielvorgabe des Vorstands (Konzept 14.2).
 *
 * Erwartet wird der Platz des Vorjahres, gemildert um eine Position - ein
 * Vorstand, der jedes Jahr eine Verbesserung verlangt, feuert zwangslaeufig
 * jeden. Im ersten Jahr gilt die Mitte des Feldes.
 */
export function boardTarget(db: Database, season: number, teamId: number): number {
  const previous = db
    .prepare('SELECT final_rank FROM team_seasons WHERE team_id = ? AND season = ?')
    .get(teamId, season - 1) as { final_rank: number | null } | undefined;
  const field = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM team_seasons
        WHERE season = ? AND tier = (SELECT tier FROM team_seasons WHERE team_id = ? AND season = ?)`,
    )
    .get(season, teamId, season) as { n: number }).n;

  if (!previous?.final_rank) return Math.max(1, Math.ceil(field / 2));
  return Math.min(field, previous.final_rank + 1);
}

/**
 * Bewertet die abgelaufene Saison.
 *
 * Vertrauen steigt und faellt mit dem Abstand zur Vorgabe. Unter 20 ist
 * Schluss - aber nie im ersten Jahr, sonst endet eine Karriere, bevor eine
 * einzige Entscheidung wirken konnte.
 */
export function judgeSeason(
  db: Database,
  season: number,
  teamId: number,
  confidence: number,
): BoardVerdict {
  const target = boardTarget(db, season, teamId);
  const row = db
    .prepare('SELECT final_rank FROM team_seasons WHERE team_id = ? AND season = ?')
    .get(teamId, season) as { final_rank: number | null } | undefined;
  const achieved = row?.final_rank ?? null;

  if (achieved === null) {
    return {
      target,
      achieved,
      met: false,
      confidence,
      fired: false,
      message: 'Keine Wertung - die Saison ist nicht abgeschlossen.',
    };
  }

  // Jede Position ueber der Vorgabe bringt vier Punkte Vertrauen, jede darunter
  // kostet sechs. Die Schieflage ist gewollt: Ein Vorstand vergisst einen guten
  // Platz schneller als einen schlechten.
  const delta = target - achieved;
  const next = Math.max(0, Math.min(100, confidence + (delta >= 0 ? delta * 4 + 4 : delta * 6)));
  const met = achieved <= target;
  const fired = next < 20 && season > 1;

  return {
    target,
    achieved,
    met,
    confidence: next,
    fired,
    message: fired
      ? `Platz ${achieved} bei Vorgabe ${target}. Der Vorstand beendet die Zusammenarbeit.`
      : met
        ? `Platz ${achieved} bei Vorgabe ${target}. Der Vorstand ist zufrieden.`
        : `Platz ${achieved} bei Vorgabe ${target}. Der Vorstand erwartet Besserung.`,
  };
}
