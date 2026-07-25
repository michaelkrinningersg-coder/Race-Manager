/**
 * Bereitet ein Savegame zur Auslieferdatei fuer die Webansicht auf.
 *
 * Die Seite liegt auf GitHub Pages und hat kein Backend - sie laedt die
 * Datenbank vollstaendig in den Browser und fragt sie dort per sql.js ab. Das
 * geht nur, wenn die Datei klein genug ist. Zwei Eingriffe bringen den
 * Unterschied:
 *
 *   1. Die Laufzeitindizes fliegen raus. Sie beschleunigen die Simulation ueber
 *      Hunderttausende Schreibvorgaenge; im Browser wird nur gelesen, und zwar
 *      aus einer Datenbank, die ohnehin komplett im Speicher liegt.
 *   2. VACUUM schreibt die Datei ohne Luecken neu.
 *
 * Zusammen: 17 MB werden zu 13 MB, gzip-uebertragen rund 3,9 MB.
 *
 * Der Rundenverlauf entsteht bewusst nur in der Schlusssaison (--tick-from).
 * Zwanzig Saisons Tick-Sim waeren rund 570.000 Zeilen und ueber 60 MB.
 *
 * Aufruf:
 *   npm run publish                       # build/savegame.db -> public/apex.db
 *   npm run publish -- --in <pfad> --out <pfad>
 */

import DatabaseConstructor from 'better-sqlite3';
import { copyFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Indizes, die nur der Simulation dienen. Namen aus RUNTIME_DDL in
 * engine/savegame.ts - kommt dort einer hinzu, gehoert er auch hierher.
 */
const RUNTIME_INDEXES = [
  'idx_results_league',
  'idx_results_driver',
  'idx_team_seasons_tier',
  'idx_driver_state_season',
  'idx_staff_state_season',
];

interface Options {
  inPath: string;
  outPath: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    inPath: resolve(repoRoot, 'build', 'savegame.db'),
    outPath: resolve(repoRoot, 'public', 'apex.db'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') options.inPath = resolve(argv[++i]);
    else if (arg === '--out') options.outPath = resolve(argv[++i]);
    else {
      console.error(`Unbekannte Option: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

function megabytes(path: string): string {
  return (statSync(path).size / 1024 / 1024).toFixed(1);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  console.log('APEX-Auslieferdatei');
  console.log(`  Quelle: ${options.inPath}`);
  console.log(`  Ziel:   ${options.outPath}`);

  const before = megabytes(options.inPath);

  mkdirSync(dirname(options.outPath), { recursive: true });
  try {
    unlinkSync(options.outPath);
  } catch {
    // Existierte nicht - Normalfall beim ersten Lauf.
  }
  copyFileSync(options.inPath, options.outPath);

  const db = new DatabaseConstructor(options.outPath);
  try {
    for (const index of RUNTIME_INDEXES) db.exec(`DROP INDEX IF EXISTS ${index}`);
    // VACUUM darf nicht in einer Transaktion laufen.
    db.exec('VACUUM');

    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM race_results) results,
                (SELECT COUNT(*) FROM lap_records)  laps,
                (SELECT MAX(season) FROM team_seasons) seasons`,
      )
      .get() as { results: number; laps: number; seasons: number };

    console.log(`  Saisons:        ${counts.seasons}`);
    console.log(`  Ergebniszeilen: ${counts.results}`);
    console.log(`  Rundenzeilen:   ${counts.laps}`);
  } finally {
    db.close();
  }

  console.log(`  Groesse:        ${before} MB -> ${megabytes(options.outPath)} MB`);
  console.log(`\nFertig: ${options.outPath}`);
}

main();
