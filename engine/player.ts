/**
 * Das Team des Spielers (Konzept 14.2).
 *
 * Bis v0.20.0 gab es keinen Spieler: Alle 167 Teams wurden von der KI gefuehrt,
 * und die Oberflaeche war ein Betrachter einer fertig gerechneten Welt.
 *
 * Der Eintrag hier ist die eine Marke, an der die gesamte Karriere haengt. Jede
 * KI-Routine, die je Team entscheidet - Entwicklung, Ausbau, Personal,
 * Fahrermarkt, Sponsoren -, laesst dieses Team aus. Was dort geschieht,
 * entscheidet der Spieler.
 *
 * BEWUSST IM SAVEGAME und nicht im Browser gespeichert: Wer der Spieler ist,
 * gehoert zum Spielstand. Ein Spielstand, den man exportiert und woanders
 * fortsetzt, muss dieselbe Karriere sein.
 */

import type { Database } from './db.js';

export function playerTeam(db: Database): number | null {
  const row = db.prepare('SELECT player_team_id FROM game_state WHERE id = 1').get() as
    | { player_team_id: number | null }
    | undefined;
  return row?.player_team_id ?? null;
}

export function setPlayerTeam(db: Database, teamId: number | null): void {
  db.prepare('UPDATE game_state SET player_team_id = ? WHERE id = 1').run(teamId);
}

/**
 * Filtert das Spielerteam aus einer Teamliste.
 *
 * Absichtlich eine Funktion und keine WHERE-Bedingung in fuenf Abfragen: So
 * steht an einer Stelle, was ausgelassen wird, und eine neue KI-Routine faellt
 * auf, wenn sie diesen Aufruf nicht hat.
 */
export function withoutPlayer<T extends { team_id: number }>(rows: T[], player: number | null): T[] {
  return player === null ? rows : rows.filter((row) => row.team_id !== player);
}
