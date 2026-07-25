import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { adapt, type EngineDatabase } from './sqljs';
import { initSavegame } from '../../engine/savegame';
import { setPlayerTeam } from '../../engine/player';

/**
 * Spielstand im Browser (Konzept 14.2).
 *
 * IndexedDB und nicht localStorage: Ein Spielstand ist eine SQLite-Datei von
 * mehreren Megabyte, localStorage haelt Zeichenketten im einstelligen
 * Megabytebereich. Ausserdem speichert IndexedDB Binaerdaten direkt, ohne den
 * Umweg ueber Base64, der ein Drittel Aufschlag kostet.
 *
 * Zusaetzlich Export und Import als Datei. Der Grund ist nicht Bequemlichkeit:
 * IndexedDB gehoert dem Browser und ist mit einem geleerten Verlauf weg. Eine
 * Karriere ueber zwanzig Saisons darf nicht an einer Browsereinstellung
 * haengen.
 */

const DB_NAME = 'apex-career';
const STORE = 'savegames';
const SLOT = 'current';

interface StoredSave {
  bytes: Uint8Array;
  savedAt: number;
  season: number;
  teamName: string;
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB nicht verfügbar'));
  });
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openStore().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Zugriff fehlgeschlagen'));
      }),
  );
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

function sql(): ReturnType<typeof initSqlJs> {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl });
  return sqlPromise;
}

/** Startwelt: die gebootstrappte Saison 1, nicht die fertig gerechnete Welt. */
async function fetchWorld(): Promise<Uint8Array> {
  const response = await fetch(`${import.meta.env.BASE_URL}world_data.db`);
  if (!response.ok) {
    throw new Error(
      `Startwelt nicht gefunden (HTTP ${response.status}). Sie entsteht mit 'npm run publish'.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function startCareer(teamId: number, seed: number): Promise<EngineDatabase> {
  const [SQL, world] = await Promise.all([sql(), fetchWorld()]);
  const db = adapt(new SQL.Database(world));
  initSavegame(db, seed);
  setPlayerTeam(db, teamId);
  return db;
}

export async function openBytes(bytes: Uint8Array): Promise<EngineDatabase> {
  const SQL = await sql();
  return adapt(new SQL.Database(bytes));
}

export async function saveCareer(db: EngineDatabase, season: number, teamName: string): Promise<void> {
  const record: StoredSave = { bytes: db.export(), savedAt: Date.now(), season, teamName };
  await transact('readwrite', (store) => store.put(record, SLOT) as IDBRequest<unknown>);
}

export async function storedCareer(): Promise<StoredSave | undefined> {
  try {
    return await transact('readonly', (store) => store.get(SLOT) as IDBRequest<StoredSave>);
  } catch {
    // Privater Modus oder gesperrter Speicher - dann gibt es eben keinen Stand.
    return undefined;
  }
}

export async function loadCareer(): Promise<EngineDatabase | undefined> {
  const stored = await storedCareer();
  return stored ? openBytes(stored.bytes) : undefined;
}

export async function deleteCareer(): Promise<void> {
  await transact('readwrite', (store) => store.delete(SLOT) as IDBRequest<undefined>);
}

/** Spielstand als Datei sichern - unabhaengig vom Browserspeicher. */
export function downloadCareer(db: EngineDatabase, season: number): void {
  const blob = new Blob([db.export() as BlobPart], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `apex-karriere-saison-${season}.db`;
  link.click();
  URL.revokeObjectURL(url);
}
