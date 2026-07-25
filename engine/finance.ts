/**
 * Ausschuettung, Ausgaben und Fallschirmzahlungen (Konzept 9.1 und 4.3).
 *
 * Bewusst schlank: M2 braucht Liquiditaet nur als Lizenzkriterium und den
 * Fallschirm als Abfederung. Sponsoren, Gehaelter und Insolvenz gehoeren
 * nach M6 - hier entsteht nur die Bilanzlinie, an der sie spaeter andocken.
 */

import type { Database } from './savegame.js';

/**
 * Wie schnell sich das Betriebsniveau eines Teams an eine neue Liga anpasst.
 *
 * `expenses` hing bis hierher unmittelbar am Deckel der aktuellen Liga und fiel
 * beim Abstieg sofort mit. Die Basis folgt der neuen Liga jetzt verzoegert: Sie
 * faellt je Saison auf diesen Anteil, bis sie den neuen Deckel erreicht. Nach
 * OBEN wirkt die Bremse nicht - wer aufsteigt, arbeitet sofort auf dem neuen
 * Niveau.
 *
 * ACHTUNG, damit ist die Fixkostenfalle NICHT geschaerft. Der Wert 0.50 ist
 * bewusst so gewaehlt, dass die Mechanik heute praktisch folgenlos bleibt: Beim
 * Abstieg von Tier 1 nach Tier 2 liegt die Basis im ersten Jahr bei 72,5 statt
 * 70 Mio und ist im zweiten schon am neuen Deckel.
 *
 * Warum nicht schaerfer? Gemessen ueber vier Abklingraten kehrt sich die
 * Wirkung um. Bei 0.65 SINKT der Anteil der Abstiege mit Zwangsverkauf von 10
 * auf 7 %, waehrend die Teams mit Ligaspannweite >= 2 von 25 auf 15 fallen -
 * hoehere Betriebskosten verhindern, dass ueberhaupt gebaut wird, und was nie
 * gebaut wurde, kann auch nicht zwangsverkauft werden. Erst 1.00 (nie
 * abruesten) laesst die Falle zuschnappen (20 %), kostet aber ein Drittel der
 * Aufstiege: 198 statt 285.
 *
 * Der eigentliche Grund liegt tiefer und ist mit diesem Regler nicht
 * erreichbar: Konzept 8.2 setzt einen Mehrliga-Absturz voraus, und den gibt es
 * nicht. Von 232 Abstiegen folgte KEIN EINZIGER auf einen zweiten.
 *
 * Die Groesse bleibt trotzdem stehen - als Bilanzposten, an dem M6 mit
 * Gehaeltern und Sponsoren andockt, ohne die Bilanz dann erneut umzubauen
 * (getroffene Entscheidung).
 */
export const COST_BASIS_DECAY = 0.5;

/**
 * Betriebsniveau einer Saison: der Deckel der aktuellen Liga, aber hoechstens
 * so schnell fallend, wie COST_BASIS_DECAY es zulaesst.
 */
export function costBasisFor(currentCap: number, previousBasis: number | undefined): number {
  if (previousBasis === undefined) return currentCap;
  return Math.max(currentCap, Math.round(COST_BASIS_DECAY * previousBasis));
}

export interface PayoutRule {
  tier: number;
  tvFixed: number;
  tvVariableTop: number;
  expenseRatio: number;
  parachutePct1: number;
  parachutePct2: number;
}

export function loadPayoutRules(db: Database): Map<number, PayoutRule> {
  const rows = db.prepare('SELECT * FROM league_payouts').all() as Record<string, number>[];
  return new Map(
    rows.map((row) => [
      row.tier,
      {
        tier: row.tier,
        tvFixed: row.tv_fixed,
        tvVariableTop: row.tv_variable_top,
        expenseRatio: row.expense_ratio,
        parachutePct1: row.parachute_pct_1,
        parachutePct2: row.parachute_pct_2,
      },
    ]),
  );
}

/** Fixanteil plus variabler Anteil nach Platzierung. Letzter bekommt nur den Fix. */
export function payoutFor(rule: PayoutRule, rank: number, teamCount: number): number {
  if (teamCount <= 1) return rule.tvFixed + rule.tvVariableTop;
  const share = (teamCount - rank) / (teamCount - 1);
  return Math.round(rule.tvFixed + rule.tvVariableTop * share);
}

/** Durchschnittliche Ausschuettung einer Liga - Bezugsgroesse fuer den Fallschirm. */
export function averagePayout(rule: PayoutRule): number {
  return Math.round(rule.tvFixed + rule.tvVariableTop / 2);
}

/**
 * Fallschirm: Anteil der Ausschuettungsdifferenz zwischen alter und neuer Liga.
 * `seasonsSince` ist 1 in der ersten Saison nach dem Abstieg, 2 in der zweiten.
 */
export function parachuteFor(
  fromRule: PayoutRule | undefined,
  toRule: PayoutRule | undefined,
  seasonsSince: number,
): number {
  if (!fromRule || !toRule || seasonsSince < 1 || seasonsSince > 2) return 0;
  const difference = averagePayout(fromRule) - averagePayout(toRule);
  if (difference <= 0) return 0;
  const pct = seasonsSince === 1 ? toRule.parachutePct1 : toRule.parachutePct2;
  return Math.round(difference * pct);
}
