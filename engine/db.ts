/**
 * Datenbankschnittstelle der Engine.
 *
 * Bis v0.20.0 war der Typ `Database` ein Alias auf den von better-sqlite3 -
 * und damit hing die gesamte Engine an einer Node-Bibliothek, obwohl sie sie
 * nirgends direkt benutzt. Sie reicht `db` durch und ruft daran sechs Methoden.
 *
 * Gemessen vor dem Umbau: 6.353 Zeilen Engine, davon zwei Dateien mit
 * Node-Bezug; 177 `prepare`, 165 `get`, 97 `all`, 62 `run`, 23 `transaction`,
 * ein `pragma` - und keine einzige Stelle mit `pluck`, `raw`, `iterate`,
 * `lastInsertRowid` oder `changes`. Die Engine benutzt ausschliesslich den
 * gemeinsamen Nenner, den auch sql.js im Browser bedienen kann.
 *
 * Diese Datei beschreibt genau diesen Nenner. better-sqlite3 erfuellt ihn von
 * sich aus, der Adapter in src/data/sqljs.ts bildet ihn nach.
 */

export interface Statement {
  /** Alle Treffer. Parameter positionsweise oder als benanntes Objekt. */
  all(...params: unknown[]): unknown[];
  /** Erster Treffer oder undefined. */
  get(...params: unknown[]): unknown;
  /**
   * Schreibt. Der Rueckgabewert von better-sqlite3 wird nirgends benutzt -
   * geprueft, bevor diese Schnittstelle geschnitten wurde -, deshalb void.
   */
  run(...params: unknown[]): void;
}

export interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  /**
   * Verpackt eine Funktion in eine Transaktion. Verschachtelte Aufrufe muessen
   * zulaessig sein: Die Engine ruft transaktionale Funktionen aus anderen
   * transaktionalen Funktionen heraus auf.
   */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  pragma(source: string): unknown;
  close(): void;
}
