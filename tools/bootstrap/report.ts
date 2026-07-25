/**
 * Befunde und ihre Ausgabe.
 *
 * Grundsatz aus docs/DATENMODELL_APEX_M0.md, Abschnitt 14.1: Alle Pruefungen
 * laufen vollstaendig durch, bevor abgebrochen wird. Bei mehreren hundert
 * handgepflegten Zeilen ist ein Validator, der beim ersten Fehler stehen
 * bleibt, praktisch unbenutzbar.
 */

export type Severity = 'error' | 'warning';

export interface Finding {
  severity: Severity;
  /** Dateiname oder 'welt' fuer dateiuebergreifende Befunde. */
  file: string;
  line?: number;
  message: string;
}

export function error(file: string, message: string, line?: number): Finding {
  return { severity: 'error', file, message, line };
}

export function warning(file: string, message: string, line?: number): Finding {
  return { severity: 'warning', file, message, line };
}

export function countBySeverity(findings: Finding[], severity: Severity): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

/** Gruppiert die Befunde nach Datei und gibt sie lesbar aus. */
export function printReport(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('  Keine Befunde.');
    return;
  }

  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }

  for (const [file, list] of byFile) {
    const errors = countBySeverity(list, 'error');
    const warnings = countBySeverity(list, 'warning');
    console.log(`\n  ${file}  (${errors} Fehler, ${warnings} Warnungen)`);

    for (const finding of list) {
      const marker = finding.severity === 'error' ? 'FEHLER ' : 'WARNUNG';
      const position = finding.line === undefined ? '' : ` Zeile ${finding.line}:`;
      console.log(`    ${marker}${position} ${finding.message}`);
    }
  }
}
