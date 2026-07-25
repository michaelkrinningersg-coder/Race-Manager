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
  prizePoolPerRace: number;
  logisticsBase: number;
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
        prizePoolPerRace: row.prize_pool_per_race,
        logisticsBase: row.logistics_base,
      },
    ]),
  );
}

/**
 * Preisgeldverteilung je Rennen (Konzept 9.1).
 *
 * Geometrisch fallend: Der Sieger bekommt gut ein Viertel des Topfes, ab Platz
 * zehn bleibt kaum noch etwas. Ein flacherer Schluessel haette die Ausschuettung
 * nur verdoppelt, statt das einzelne Rennergebnis spuerbar zu machen.
 */
const PRIZE_DECAY = 0.78;

export function prizeShares(field: number): number[] {
  const raw = Array.from({ length: field }, (_, index) => Math.pow(PRIZE_DECAY, index));
  const sum = raw.reduce((total, value) => total + value, 0);
  return raw.map((value) => value / sum);
}

/**
 * Logistik je Rennen (Konzept 9.2, dort ausdruecklich entfernungsabhaengig).
 *
 * Die Entfernung haengt an der Strecke, nicht am einzelnen Team: Das Feld ist
 * ueberwiegend europaeisch, ein Uebersee-Rennen kostet also alle mehr. Eine
 * Matrix Team x Strecke waere genauer und fuer 167 Teams nicht zu pflegen.
 */
export function logisticsCost(rule: PayoutRule, factors: number[]): number {
  return Math.round(rule.logisticsBase * factors.reduce((sum, factor) => sum + factor, 0));
}

/**
 * Motorenleasing eines Kundenteams.
 *
 * `lease_cost_customer` ist auf Tier 1 bemessen - die acht Hersteller beliefern
 * aber bis Tier 3 hinunter. Der Betrag skaliert deshalb mit dem Deckel der
 * eigenen Liga; ein Tier-3-Team koennte den Tier-1-Preis nie tragen.
 */
export function leaseCost(base: number, ownCap: number, topCap: number): number {
  if (topCap <= 0) return 0;
  return Math.round(base * (ownCap / topCap));
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
