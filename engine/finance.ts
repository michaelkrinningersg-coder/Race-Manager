/**
 * Ausschuettung, Ausgaben und Fallschirmzahlungen (Konzept 9.1 und 4.3).
 *
 * Bewusst schlank: M2 braucht Liquiditaet nur als Lizenzkriterium und den
 * Fallschirm als Abfederung. Sponsoren, Gehaelter und Insolvenz gehoeren
 * nach M6 - hier entsteht nur die Bilanzlinie, an der sie spaeter andocken.
 */

import type { Database } from './savegame.js';

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
