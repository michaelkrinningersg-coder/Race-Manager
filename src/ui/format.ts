/** Kleine Formatierungs-Helfer für die Anzeige. */

const NUMBER = new Intl.NumberFormat('de-DE');

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}${NUMBER.format(Math.round((abs / 1_000_000) * 10) / 10)} Mio. €`;
  }
  return `${sign}${NUMBER.format(Math.round(abs / 1000))} Tsd. €`;
}

/** Bilanzposten: mit Vorzeichen, damit Einnahme und Ausgabe unterscheidbar sind. */
export function formatSigned(value: number): string {
  return value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Prozentanteil eines Wertes am Reglementdeckel, auf 0-100 begrenzt. */
export function capPercent(value: number, cap: number): number {
  return Math.max(0, Math.min(100, (value / cap) * 100));
}

/** Rundenzeit als m:ss.mmm. */
export function formatLapTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

/** Rueckstand in Sekunden, fuer den Fuehrenden ein Strich. */
export function formatGap(ms: number): string {
  if (ms <= 0) return '—';
  return `+${(ms / 1000).toFixed(3)} s`;
}

export function formatSeconds(value: number): string {
  return `${value.toFixed(1)} s`;
}

/**
 * Alter aus dem Jahrgang. Saison 1 ist 2026 - dieselbe Verankerung wie in
 * engine/careers.ts, wo `startYear` fest auf 2026 steht.
 */
export function ageIn(season: number, birthYear: number): number {
  return 2026 + season - 1 - birthYear;
}

/**
 * Haengt die Saison an einen Link. Ohne das faellt jede Navigation auf die
 * Schlusssaison zurueck, und man verliert beim Klick auf ein Team genau die
 * Saison, die man gerade betrachtet hat.
 */
export function withSeason(href: string, season: number): string {
  return `${href}?s=${season}`;
}
