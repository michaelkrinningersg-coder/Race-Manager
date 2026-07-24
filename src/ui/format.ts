/** Kleine Formatierungs-Helfer fuer die Anzeige. */

const NUMBER = new Intl.NumberFormat('de-DE');

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatMoney(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${NUMBER.format(Math.round(millions * 10) / 10)} Mio. €`;
  }
  return `${NUMBER.format(Math.round(value / 1000))} Tsd. €`;
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
