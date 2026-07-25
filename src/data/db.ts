/**
 * Zugriff auf die echte Welt.
 *
 * Bis v0.13 erzeugte die Seite ihre eigene Welt in `world.ts` - 466 Zeilen
 * Generator und Light-Sim, die mit der Engine nichts zu tun hatten. Es liefen
 * damit zwei Simulationen nebeneinander, und die sichtbare war die falsche.
 *
 * Jetzt laedt die Seite das Erzeugnis der echten Engine: `public/apex.db`,
 * gebaut von `npm run world` (bootstrap -> 20 Saisons -> publish). GitHub Pages
 * hat kein Backend, also wandert die ganze Datenbank in den Browser und wird
 * dort per sql.js abgefragt - rund 4,5 MB uebertragen, einmalig beim ersten
 * Aufruf.
 *
 * Der Rundenverlauf existiert nur fuer die Schlusssaison. Zwanzig Saisons
 * Tick-Sim waeren rund 570.000 Zeilen und ueber 60 MB gewesen.
 */

import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export type Row = Record<string, SqlValue>;

let database: Database | null = null;

/** Fortschritt beim Laden - die Datei ist gross genug, dass Stille stoert. */
export interface LoadProgress {
  loaded: number;
  total: number;
}

export async function openWorld(onProgress?: (progress: LoadProgress) => void): Promise<Database> {
  if (database) return database;

  const [SQL, bytes] = await Promise.all([
    initSqlJs({ locateFile: () => wasmUrl }),
    fetchDatabase(onProgress),
  ]);

  database = new SQL.Database(bytes);
  return database;
}

/**
 * Laedt die Datei und meldet den Fortschritt, solange der Server eine Laenge
 * mitschickt. Bei gzip-Auslieferung fehlt `Content-Length` haeufig - dann
 * bleibt nur die gelesene Menge, und die Anzeige laeuft ohne Ziel.
 */
async function fetchDatabase(onProgress?: (progress: LoadProgress) => void): Promise<Uint8Array> {
  const url = `${import.meta.env.BASE_URL}apex.db`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`apex.db konnte nicht geladen werden (HTTP ${response.status})`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  if (!response.body || !onProgress) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ loaded, total });
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Fragt ab und liefert Objektzeilen. sql.js gibt von sich aus Spaltenlisten
 * plus Wertetupel zurueck; alles Weitere in dieser Anwendung rechnet mit
 * benannten Feldern.
 */
export function rows<T = Row>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const result: T[] = [];
    while (statement.step()) result.push(statement.getAsObject() as T);
    return result;
  } finally {
    statement.free();
  }
}

/** Erste Zeile oder `undefined` - fuer Abfragen, die hoechstens eine liefern. */
export function row<T = Row>(db: Database, sql: string, params: SqlValue[] = []): T | undefined {
  return rows<T>(db, sql, params)[0];
}

/** Einzelwert der ersten Zeile. */
export function scalar(db: Database, sql: string, params: SqlValue[] = []): SqlValue | undefined {
  const first = row(db, sql, params);
  return first ? Object.values(first)[0] : undefined;
}
