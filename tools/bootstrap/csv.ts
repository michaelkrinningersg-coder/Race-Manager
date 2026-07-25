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

// ---------------------------------------------------------------------------
// Dokumentmodell fuer den Editor
//
// parseCsv wirft weg, was der Bootstrapper nicht braucht: Kommentare, Leer-
// zeilen und die Information, welche Felder zitiert waren. Fuer den Editor ist
// genau das die Substanz. teams.csv enthaelt zwanzig Gliederungskommentare
// ("# ---- Tier 1: APEX World Championship (11) ----"), drivers.csv sechs-
// undzwanzig; und mehrere Dateien zitieren Freitext, der kein Komma enthaelt.
//
// Gemessen: Ohne dieses Modell haetten 8 von 21 Dateien beim Speichern anders
// ausgesehen als vorher - ein Editor, der Dateien veraendert, die niemand
// angefasst hat, ist schlimmer als keiner.
// ---------------------------------------------------------------------------

export interface Field {
  value: string;
  /** War das Feld in der Quelle zitiert? Steuert das Zitat beim Schreiben. */
  quoted: boolean;
}

export type CsvLine =
  | { kind: 'comment'; text: string }
  | { kind: 'blank' }
  | { kind: 'header'; fields: Field[] }
  | { kind: 'row'; fields: Field[]; line: number };

export interface CsvDocument {
  lines: CsvLine[];
  header: string[];
}

/** Wie splitLine, behaelt aber fest, welche Felder zitiert waren. */
function splitFields(line: string): Field[] {
  const fields: Field[] = [];
  let current = '';
  let quoted = false;
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
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
      quoted = true;
    } else if (char === ',') {
      fields.push({ value: current, quoted });
      current = '';
      quoted = false;
    } else {
      current += char;
    }
  }

  fields.push({ value: current, quoted });
  return fields;
}

/** Liest CSV-Text so ein, dass er unveraendert zurueckgeschrieben werden kann. */
export function parseDocument(text: string): CsvDocument {
  const raw = text.replace(/^\ufeff/, '').split(/\r?\n/);
  // Ein abschliessender Zeilenumbruch erzeugt ein leeres letztes Element. Es
  // ist keine Leerzeile, sondern das Dateiende - serializeDocument haengt den
  // Umbruch von sich aus wieder an.
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();

  const lines: CsvLine[] = [];
  let header: string[] = [];
  let seenHeader = false;

  raw.forEach((line, index) => {
    if (line.startsWith('#')) {
      lines.push({ kind: 'comment', text: line });
    } else if (line.trim() === '') {
      lines.push({ kind: 'blank' });
    } else if (!seenHeader) {
      const fields = splitFields(line);
      header = fields.map((field) => field.value.trim());
      lines.push({ kind: 'header', fields });
      seenHeader = true;
    } else {
      lines.push({ kind: 'row', fields: splitFields(line), line: index + 1 });
    }
  });

  if (!seenHeader) throw new Error('Datei enthaelt keine Kopfzeile');
  return { lines, header };
}

/**
 * Zitiert nur, wo es sein muss - oder wo es in der Quelle schon stand. Der
 * zweite Teil ist der wichtige: Er haelt Dateien im Diff ruhig, in denen
 * Freitext aus Gewohnheit zitiert ist, obwohl kein Komma darin vorkommt.
 */
function quote(field: Field): string {
  const needed = /[",\r\n]/.test(field.value) || field.value !== field.value.trim();
  if (needed || field.quoted) return `"${field.value.replace(/"/g, '""')}"`;
  return field.value;
}

export function serializeDocument(document: CsvDocument): string {
  const lines = document.lines.map((line) => {
    if (line.kind === 'comment') return line.text;
    if (line.kind === 'blank') return '';
    return line.fields.map(quote).join(',');
  });
  return lines.join('\n') + '\n';
}

/** Nur die Datenzeilen, in Dateireihenfolge. */
export function documentRows(document: CsvDocument): Extract<CsvLine, { kind: 'row' }>[] {
  return document.lines.filter((line): line is Extract<CsvLine, { kind: 'row' }> => line.kind === 'row');
}
