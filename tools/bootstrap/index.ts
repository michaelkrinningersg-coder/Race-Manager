/**
 * Bootstrapper: CSV-Stammdaten einlesen, pruefen, world_data.db erzeugen.
 *
 * Aufruf:
 *   npm run bootstrap                    # prueft und schreibt build/world_data.db
 *   npm run bootstrap -- --partial       # Bestandsluecken nur als Warnung
 *   npm run bootstrap -- --check         # nur pruefen, nichts schreiben
 *   npm run bootstrap -- --data <pfad> --out <pfad>
 *
 * Ablauf und Schweregrade: docs/DATENMODELL_APEX_M0.md, Abschnitt 14.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTable, type LoadedTable } from './load.js';
import { TABLES } from './schema.js';
import { countBySeverity, printReport, type Finding } from './report.js';
import { validateWorld } from './validate.js';
import { writeDatabase } from './db.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Options {
  dataDir: string;
  outFile: string;
  partial: boolean;
  checkOnly: boolean;
  startYear: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dataDir: resolve(repoRoot, 'data'),
    outFile: resolve(repoRoot, 'build', 'world_data.db'),
    partial: false,
    checkOnly: false,
    startYear: 2027,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--partial') options.partial = true;
    else if (arg === '--check') options.checkOnly = true;
    else if (arg === '--data') options.dataDir = resolve(argv[++i]);
    else if (arg === '--out') options.outFile = resolve(argv[++i]);
    else if (arg === '--start-year') options.startYear = Number(argv[++i]);
    else {
      console.error(`Unbekannte Option: ${arg}`);
      process.exit(2);
    }
  }

  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  console.log('APEX-Bootstrapper');
  console.log(`  Stammdaten: ${options.dataDir}`);
  console.log(`  Ziel:       ${options.checkOnly ? '(nur pruefen)' : options.outFile}`);
  if (options.partial) console.log('  Modus:      Teilbestand - Vollstaendigkeitsluecken sind Warnungen');

  // Schritt 1-3: Einlesen, Typen, Wertebereiche, dateiinterne Regeln.
  const findings: Finding[] = [];
  const tables = new Map<string, LoadedTable>();
  for (const spec of TABLES) {
    const loaded = loadTable(options.dataDir, spec, findings);
    tables.set(spec.file, loaded);
  }

  console.log('\nEingelesen:');
  for (const spec of TABLES) {
    const rows = tables.get(spec.file)?.rows.length ?? 0;
    console.log(`  ${spec.file.padEnd(26)} ${String(rows).padStart(4)} Zeilen`);
  }

  // Schritt 4-5: Referenzen und dateiuebergreifende Konsistenz.
  findings.push(
    ...validateWorld({ tables, partial: options.partial, startYear: options.startYear }),
  );

  console.log('\nBefunde:');
  printReport(findings);

  const errors = countBySeverity(findings, 'error');
  const warnings = countBySeverity(findings, 'warning');
  console.log(`\n  Gesamt: ${errors} Fehler, ${warnings} Warnungen`);

  if (errors > 0) {
    console.log('\nAbbruch: Bei Fehlern wird keine Datenbank geschrieben.');
    process.exit(1);
  }

  if (options.checkOnly) {
    console.log('\nPruefung bestanden. (--check: nichts geschrieben)');
    return;
  }

  mkdirSync(dirname(options.outFile), { recursive: true });
  const written = writeDatabase(options.outFile, tables);

  console.log('\nGeschrieben:');
  for (const result of written) {
    console.log(`  ${result.table.padEnd(38)} ${String(result.rows).padStart(4)} Zeilen`);
  }
  console.log(`\nFertig: ${options.outFile}`);
}

main();
