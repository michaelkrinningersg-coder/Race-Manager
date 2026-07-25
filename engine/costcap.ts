/**
 * Kostendeckel als echte Schranke (Konzept 9.3).
 *
 * Bis M6 war `cost_cap` nur eine Bezugsgroesse: Er skalierte Ausgaben und
 * Entwicklung, aber niemand konnte ihn ueberschreiten, weil niemand frei
 * entschied, wie viel er ausgibt. Mit echten Gehaeltern, Anlagen, Leasing und
 * Logistik entsteht erstmals eine Summe, die daran vorbeilaufen kann.
 *
 * Konzept 9.3 nennt zwei Strafen und eine Ausnahme:
 *   - Ueberschreitung kostet Lizenzpunkte und Windkanalzeit.
 *   - Fahrergehaelter sind bis zu einem Freibetrag nicht deckelrelevant, damit
 *     ein Team nicht zwischen Weltmeister und Entwicklung waehlen muss.
 *
 * Die Strafe wirkt in der FOLGESAISON. Das ist kein technisches Detail: Wer im
 * Dezember merkt, dass er zu viel ausgegeben hat, kann die Saison nicht mehr
 * aendern - er zahlt im naechsten Jahr.
 */

import type { Database } from './savegame.js';

/**
 * Anteil des Deckels, bis zu dem Fahrergehaelter nicht mitzaehlen.
 *
 * Konzept 9.3 nennt einen Freibetrag, ohne ihn zu beziffern. 8 Prozent decken
 * gemessen das uebliche Fahrergehalt einer Liga ab - der Freibetrag greift also
 * im Normalfall vollstaendig und wird erst dort zur Schranke, wo ein Team sich
 * zwei aussergewoehnlich teure Fahrer leistet.
 */
export const DRIVER_WAGE_ALLOWANCE = 0.08;

/** Ab welcher Ueberschreitung ueberhaupt bestraft wird - unter 2 % ist Rauschen. */
const TOLERANCE = 0.02;

/** Lizenzpunkte je angefangene 5 Prozent Ueberschreitung, gedeckelt. */
const POINTS_PER_STEP = 3;
const MAX_PENALTY_POINTS = 12;

/** Kuerzung der Windkanalzeit je angefangene 5 Prozent, gedeckelt. */
const ATR_CUT_PER_STEP = 0.05;
const MAX_ATR_CUT = 0.25;

export interface CapSummary {
  breaches: number;
  worstPct: number;
}

/**
 * Prueft die Bilanz einer Saison gegen den Deckel und schreibt Verstoesse fort.
 *
 * Deckelrelevant sind Betrieb, Anlagen, Personal, Leasing, Logistik und der
 * Ausbau. Nicht deckelrelevant sind Fahrergehaelter bis zum Freibetrag und -
 * mangels Marketingposten - bislang nichts weiter.
 */
export function checkCostCaps(db: Database, season: number): CapSummary {
  const costCaps = new Map(
    (db.prepare('SELECT tier, cost_cap FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.cost_cap]),
  );

  const rows = db
    .prepare(
      `SELECT team_id, tier, expenses, facility_cost, staff_wages, driver_wages,
              engine_lease, logistics, investment
         FROM team_finances WHERE season = ?`,
    )
    .all(season) as Record<string, number>[];

  const insert = db.prepare(
    `INSERT OR REPLACE INTO cap_breaches
       (team_id, season, tier, capped_spend, cost_cap, overspend_pct, penalty_points, atr_cut)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const summary: CapSummary = { breaches: 0, worstPct: 0 };

  const run = db.transaction(() => {
    db.prepare('DELETE FROM cap_breaches WHERE season = ?').run(season);

    for (const row of rows) {
      const cap = costCaps.get(row.tier) ?? 0;
      if (cap <= 0) continue;

      const allowance = cap * DRIVER_WAGE_ALLOWANCE;
      const countedDriverWages = Math.max(0, row.driver_wages - allowance);
      const spend =
        row.expenses +
        row.facility_cost +
        row.staff_wages +
        row.engine_lease +
        row.logistics +
        row.investment +
        countedDriverWages;

      const overspend = (spend - cap) / cap;
      if (overspend <= TOLERANCE) continue;

      const steps = Math.ceil((overspend - TOLERANCE) / 0.05);
      const points = Math.min(MAX_PENALTY_POINTS, steps * POINTS_PER_STEP);
      const atrCut = Math.min(MAX_ATR_CUT, steps * ATR_CUT_PER_STEP);

      insert.run(row.team_id, season, row.tier, spend, cap, overspend, points, atrCut);
      summary.breaches += 1;
      summary.worstPct = Math.max(summary.worstPct, overspend);
    }
  });

  run();
  return summary;
}

/**
 * Windkanalkuerzung, die ein Team aus dem Vorjahr mitschleppt.
 *
 * Wird in der Entwicklungsformel auf den ATR-Faktor gerechnet: Wer den Deckel
 * gerissen hat, darf im Folgejahr weniger testen - genau der Regler, mit dem
 * Konzept 5.4 ohnehin arbeitet.
 */
export function atrPenalties(db: Database, season: number): Map<number, number> {
  return new Map(
    (db
      .prepare('SELECT team_id, atr_cut FROM cap_breaches WHERE season = ?')
      .all(season) as { team_id: number; atr_cut: number }[]).map((row) => [row.team_id, row.atr_cut]),
  );
}

/** Lizenzpunktabzug aus dem Vorjahr - fliesst in die Lizenzpruefung ein. */
export function licencePenalties(db: Database, season: number): Map<number, number> {
  return new Map(
    (db
      .prepare('SELECT team_id, penalty_points FROM cap_breaches WHERE season = ?')
      .all(season) as { team_id: number; penalty_points: number }[]).map((row) => [
      row.team_id,
      row.penalty_points,
    ]),
  );
}
