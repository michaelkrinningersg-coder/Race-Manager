/**
 * Einlesen der Stammdatendateien vom Datentraeger.
 *
 * Die eigentliche Pruefung steht in table.ts - sie kommt ohne Dateizugriff aus,
 * damit der Editor im Browser dieselben Regeln anwenden kann. Hier bleibt nur,
 * was ohne Betriebssystem nicht geht.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TableSpec } from './schema.js';
import { error, type Finding } from './report.js';
import { buildTable, type LoadedTable } from './table.js';

export type { LoadedTable, Row, Value } from './table.js';

export function loadTable(dataDir: string, spec: TableSpec, findings: Finding[]): LoadedTable {
  const path = join(dataDir, spec.file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    findings.push(error(spec.file, `Datei nicht gefunden: ${path}`));
    return { spec, rows: [] };
  }
  return buildTable(text, spec, findings);
}
