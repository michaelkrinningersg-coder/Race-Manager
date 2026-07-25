/**
 * CSV-Leser nach den Konventionen aus docs/DATENMODELL_APEX_M0.md, Abschnitt 2.
 *
 * Bewusst kein Fremdpaket: Das Format ist eng definiert (UTF-8, Komma,
 * doppelte Anfuehrungszeichen zum Maskieren, `#` als Kommentarzeile), und der
 * Bootstrapper soll ohne Laufzeitabhaengigkeiten ausser SQLite auskommen.
 */

export interface RawRow {
  /** Zeilennummer in der Datei, 1-basiert - fuer verwertbare Fehlermeldungen. */
  line: number;
  values: string[];
}

export interface RawTable {
  header: string[];
  headerLine: number;
  rows: RawRow[];
}

/** Zerlegt eine einzelne CSV-Zeile unter Beachtung maskierter Felder. */
function splitLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Verdoppeltes Anfuehrungszeichen steht fuer ein literales Zeichen.
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

/**
 * Liest CSV-Text ein. Kommentar- und Leerzeilen entfallen, die erste
 * verbleibende Zeile ist die Kopfzeile.
 */
export function parseCsv(text: string): RawTable {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let header: string[] | null = null;
  let headerLine = 0;
  const rows: RawRow[] = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === '' || line.startsWith('#')) return;

    const values = splitLine(line);
    if (header === null) {
      header = values.map((value) => value.trim());
      headerLine = lineNumber;
      return;
    }
    rows.push({ line: lineNumber, values });
  });

  if (header === null) {
    throw new Error('Datei enthaelt keine Kopfzeile');
  }

  return { header, headerLine, rows };
}
