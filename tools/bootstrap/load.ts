/**
 * Einlesen und dateiinterne Pruefung: Kopfzeile, Typen, Wertebereiche,
 * Eindeutigkeit, Primaerschluessel, Sortierung.
 *
 * Dateiuebergreifende Regeln stehen in validate.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.js';
import type { ColumnSpec, TableSpec } from './schema.js';
import { error, warning, type Finding } from './report.js';

export type Value = string | number | null;

export interface Row {
  line: number;
  values: Record<string, Value>;
}

export interface LoadedTable {
  spec: TableSpec;
  rows: Row[];
}

/** Wandelt ein Rohfeld in den deklarierten Typ um. Gibt bei Fehlern undefined zurueck. */
function convert(
  raw: string,
  column: ColumnSpec,
  file: string,
  line: number,
  findings: Finding[],
): Value | undefined {
  const text = raw.trim();

  if (text === '') {
    if (column.required) {
      findings.push(error(file, `Pflichtfeld '${column.name}' ist leer`, line));
      return undefined;
    }
    return null;
  }

  // Ausdruecklich verbotene Ersatzschreibweisen fuer NULL (Konvention 2).
  if (['NULL', 'null', 'n/a', '-'].includes(text)) {
    findings.push(
      error(file, `'${column.name}': '${text}' ist kein Leerwert - Feld leer lassen`, line),
    );
    return undefined;
  }

  if (column.type === 'text') {
    if (column.values && !column.values.includes(text)) {
      findings.push(
        error(
          file,
          `'${column.name}': '${text}' ist kein erlaubter Wert (${column.values.join(', ')})`,
          line,
        ),
      );
      return undefined;
    }
    if (column.length !== undefined && text.length !== column.length) {
      findings.push(
        error(file, `'${column.name}': '${text}' muss genau ${column.length} Zeichen haben`, line),
      );
      return undefined;
    }
    if (column.pattern && !column.pattern.test(text)) {
      findings.push(
        error(file, `'${column.name}': '${text}' entspricht nicht dem erwarteten Format`, line),
      );
      return undefined;
    }
    return text;
  }

  // Dezimaltrennzeichen ist der Punkt - ein Komma waere im CSV ohnehin ein Feldtrenner,
  // taucht aber in maskierten Feldern auf und wird hier eindeutig abgewiesen.
  if (text.includes(',')) {
    findings.push(
      error(file, `'${column.name}': '${text}' - Dezimaltrennzeichen ist der Punkt`, line),
    );
    return undefined;
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    findings.push(error(file, `'${column.name}': '${text}' ist keine Zahl`, line));
    return undefined;
  }
  if (column.type === 'int' && !Number.isInteger(numeric)) {
    findings.push(error(file, `'${column.name}': '${text}' muss ganzzahlig sein`, line));
    return undefined;
  }
  if (column.min !== undefined && numeric < column.min) {
    findings.push(error(file, `'${column.name}': ${numeric} liegt unter ${column.min}`, line));
    return undefined;
  }
  if (column.max !== undefined && numeric > column.max) {
    findings.push(error(file, `'${column.name}': ${numeric} liegt ueber ${column.max}`, line));
    return undefined;
  }
  return numeric;
}

function checkHeader(header: string[], spec: TableSpec, findings: Finding[]): boolean {
  const expected = spec.columns.map((column) => column.name);
  const missing = expected.filter((name) => !header.includes(name));
  const unknown = header.filter((name) => !expected.includes(name));

  for (const name of missing) {
    findings.push(error(spec.file, `Spalte '${name}' fehlt in der Kopfzeile`));
  }
  for (const name of unknown) {
    findings.push(error(spec.file, `Unbekannte Spalte '${name}' in der Kopfzeile`));
  }

  if (missing.length === 0 && unknown.length === 0) {
    const wrongOrder = expected.some((name, index) => header[index] !== name);
    if (wrongOrder) {
      findings.push(
        warning(spec.file, 'Spaltenreihenfolge weicht vom Schema ab - erschwert Diffs'),
      );
    }
  }

  return missing.length === 0;
}

function checkUniqueness(rows: Row[], spec: TableSpec, findings: Finding[]): void {
  for (const column of spec.columns) {
    if (!column.unique) continue;
    const seen = new Map<Value, number>();
    for (const row of rows) {
      const value = row.values[column.name];
      if (value === null || value === undefined) continue;
      const first = seen.get(value);
      if (first !== undefined) {
        findings.push(
          error(
            spec.file,
            `'${column.name}': '${value}' kommt doppelt vor (bereits in Zeile ${first})`,
            row.line,
          ),
        );
      } else {
        seen.set(value, row.line);
      }
    }
  }
}

function keyOf(row: Row, key: string[]): string {
  return key.map((name) => String(row.values[name])).join('|');
}

function checkPrimaryKey(rows: Row[], spec: TableSpec, findings: Finding[]): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row, spec.primaryKey);
    const first = seen.get(key);
    if (first !== undefined) {
      findings.push(
        error(
          spec.file,
          `Primaerschluessel (${spec.primaryKey.join(', ')}) = (${key}) kommt doppelt vor (bereits in Zeile ${first})`,
          row.line,
        ),
      );
    } else {
      seen.set(key, row.line);
    }
  }
}

/**
 * Die Sortierung nach Primaerschluessel ist Konvention, kein Datenfehler -
 * sie haelt Diffs in den handgepflegten Dateien lesbar. Deshalb Warnung.
 */
function checkSortOrder(rows: Row[], spec: TableSpec, findings: Finding[]): void {
  const sortBy = spec.sortBy ?? spec.primaryKey;
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    for (const name of sortBy) {
      const a = previous.values[name];
      const b = current.values[name];
      if (a === b) continue;
      if (a !== null && b !== null && a !== undefined && b !== undefined && a > b) {
        findings.push(
          warning(
            spec.file,
            `Sortierung: '${name}' = ${b} steht nach ${a} - Datei nach (${sortBy.join(', ')}) sortieren`,
            current.line,
          ),
        );
      }
      break;
    }
  }
}

export function loadTable(dataDir: string, spec: TableSpec, findings: Finding[]): LoadedTable {
  const path = join(dataDir, spec.file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    findings.push(error(spec.file, `Datei nicht gefunden: ${path}`));
    return { spec, rows: [] };
  }

  const table = parseCsv(text);
  if (!checkHeader(table.header, spec, findings)) {
    return { spec, rows: [] };
  }

  const index = new Map(table.header.map((name, position) => [name, position]));
  const rows: Row[] = [];

  for (const raw of table.rows) {
    if (raw.values.length !== table.header.length) {
      findings.push(
        error(
          spec.file,
          `Zeile hat ${raw.values.length} Felder, erwartet sind ${table.header.length}`,
          raw.line,
        ),
      );
      continue;
    }

    const values: Record<string, Value> = {};
    let ok = true;
    for (const column of spec.columns) {
      const position = index.get(column.name);
      const converted = convert(
        raw.values[position as number],
        column,
        spec.file,
        raw.line,
        findings,
      );
      if (converted === undefined) {
        ok = false;
        continue;
      }
      values[column.name] = converted;
    }
    if (ok) rows.push({ line: raw.line, values });
  }

  checkPrimaryKey(rows, spec, findings);
  checkUniqueness(rows, spec, findings);
  checkSortOrder(rows, spec, findings);

  return { spec, rows };
}
