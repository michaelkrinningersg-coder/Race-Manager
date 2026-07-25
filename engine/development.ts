/**
 * Bauteilentwicklung (Konzept 6.3).
 *
 * Die Formel des Konzepts arbeitet je Entwicklungswoche. Umgesetzt ist ein
 * Schritt **je Saison** - das ist die getroffene Entscheidung und hat zwei
 * Konsequenzen, die hier festgehalten gehoeren:
 *
 * 1. Upgrade-Pakete (Konzept 6.4) lassen sich nicht abbilden. Wer wann welches
 *    Teil bringt, ist bei einem Schritt pro Saison keine Frage mehr.
 * 2. Durchbruch und Sackgasse verschwinden als sichtbare Ereignisse. Ueber 39
 *    Wochen waeren beide mehrfach eingetreten; im Saisonmittel gehen sie in
 *    Erwartungswert und Streuung auf. Aus demselben Grund ist die Streuung
 *    schmal: 39 Wochenwuerfe mitteln sich aus, nicht auf.
 */

import type { Database } from './savegame.js';
import { createRng, gaussian, seedFrom } from './rng.js';

/**
 * Ein Team ganz ohne Fortschrittsbremse gewinnt hoechstens diesen Anteil des
 * Ligadeckels pro Saison. In der Praxis drueckt der Saettigungsterm das weit
 * herunter - nahe am Deckel bleibt fast nichts uebrig.
 */
const SEASON_GAIN = 0.2;

/** Aggregiertes Wochenrauschen: Mittel leicht ueber 1, Streuung schmal. */
const NOISE_MEAN = 1.025;
const NOISE_SD = 0.045;

const ARCHETYPE_FOCUS: Record<string, Partial<Record<string, number>>> = {
  works_team: { powertrain: 1.4, ers: 1.35, chassis: 1.1 },
  tech_startup: { front_wing: 1.4, rear_wing: 1.3, floor: 1.4 },
  traditional: { chassis: 1.3, suspension: 1.3, brakes: 1.15 },
  climber: { floor: 1.25, suspension: 1.2, front_wing: 1.15 },
  privateer: { brakes: 1.3, gearbox: 1.3, suspension: 1.15 },
  academy: { suspension: 1.3, brakes: 1.2, chassis: 1.1 },
};

export interface DevelopmentSummary {
  teams: number;
  parts: number;
  averageGain: number;
}

/**
 * ATR-Faktor (Konzept 5.4): Wer vorn steht, bekommt weniger Windkanalzeit.
 * Platz 1 erhaelt den niedrigsten Faktor.
 */
export function atrFactor(base: number, step: number, rank: number): number {
  return base + step * (rank - 1);
}

/**
 * Entwickelt alle Bauteile von `fromSeason` nach `toSeason`.
 *
 * Reihenfolge: Erst wird der Vorjahreswert uebernommen, dann entwickelt, dann
 * - bei Ligawechsel - homologiert. Der Reglementdeckel kappt hier bewusst
 * **nicht**: Konzept 6.2 speichert den echten Wert und kappt erst beim
 * Einsatz. Ein Absteiger behaelt damit sein Auto, auch wenn er es unten nicht
 * ausfahren darf.
 */
export function developParts(
  db: Database,
  fromSeason: number,
  toSeason: number,
): DevelopmentSummary {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;

  const partTypes = db
    .prepare('SELECT part_key, dev_constant_k, supplied_by_engine FROM car_part_types')
    .all() as { part_key: string; dev_constant_k: number; supplied_by_engine: number }[];

  const regulations = new Map(
    (db.prepare('SELECT * FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row]),
  );
  const payouts = new Map(
    (db.prepare('SELECT * FROM league_payouts').all() as Record<string, number>[]).map((row) => [
      row.tier,
      row,
    ]),
  );

  // Zustand der Vorsaison: Liga, Platz, Ertrag - daraus entstehen ATR-Faktor
  // und Ressourcenterm.
  const previous = db
    .prepare(
      `SELECT ts.team_id, ts.tier, ts.final_rank, t.ai_archetype,
              COALESCE(f.payout, 0) AS payout
       FROM team_seasons ts
       JOIN teams t ON t.team_id = ts.team_id
       LEFT JOIN team_finances f ON f.team_id = ts.team_id AND f.season = ts.season
       WHERE ts.season = ?`,
    )
    .all(fromSeason) as Record<string, number | string>[];

  const target = new Map(
    (db.prepare('SELECT team_id, tier FROM team_seasons WHERE season = ?').all(toSeason) as {
      team_id: number;
      tier: number;
    }[]).map((row) => [row.team_id, row.tier]),
  );

  // Fahrer-Feedback des Teams: Mittel der beiden Stammfahrer der Vorsaison -
  // entwickelt wird mit den Rueckmeldungen der Fahrer, die das Auto kannten.
  const feedback = new Map(
    (db
      .prepare(
        `SELECT team_id, AVG(feedback) AS f FROM driver_state
         WHERE season = ? AND role = 'race' AND retired = 0 AND team_id IS NOT NULL
         GROUP BY team_id`,
      )
      .all(fromSeason) as { team_id: number; f: number }[]).map((row) => [row.team_id, row.f]),
  );

  const insert = db.prepare(
    `INSERT INTO car_parts (team_id, season, part_key, performance, reliability, weight_delta, maturity, spec_version, source)
     VALUES (@team_id, @season, @part_key, @performance, @reliability, 0, 100, @spec_version, @source)`,
  );
  const readPart = db.prepare(
    'SELECT performance, reliability, spec_version, source FROM car_parts WHERE team_id = ? AND season = ? AND part_key = ?',
  );

  let teams = 0;
  let parts = 0;
  let gainSum = 0;

  const run = db.transaction(() => {
    db.prepare('DELETE FROM car_parts WHERE season = ?').run(toSeason);

    for (const row of previous) {
      const teamId = row.team_id as number;
      const oldTier = row.tier as number;
      const newTier = target.get(teamId);
      if (newTier === undefined) continue;

      const oldRegulation = regulations.get(oldTier);
      const newRegulation = regulations.get(newTier);
      const payoutRule = payouts.get(oldTier);
      if (!oldRegulation || !newRegulation || !payoutRule) continue;

      const rank = (row.final_rank as number) ?? 10;
      const atr = atrFactor(oldRegulation.atr_base, oldRegulation.atr_step, rank);

      // Ressourcen: Was das Team letzte Saison eingenommen hat, gemessen am
      // Kostendeckel seiner Liga. Der Deckel ist die Obergrenze - wer ihn
      // erreicht, kann nicht weiter zulegen (Konzept 9.3).
      const budget = Math.min(row.payout as number, oldRegulation.cost_cap);
      const resourceTerm = Math.pow(Math.max(0, budget) / oldRegulation.cost_cap, 0.7);

      // Personalwert bis M5 abgeleitet - allein aus der Ligastufe.
      //
      // Bewusst OHNE Prestige: Das ist nur ein Startwert fuer Saison 1. Waere
      // es hier drin, bliebe die Rangfolge einer Liga fuer immer eingefroren -
      // gemessen wuchs ein Aufsteiger dann um 24 Punkte, waehrend seine neue
      // Liga um 50 zulegte, und rutschte von Platz 2 auf Platz 13 durch.
      // Unterschiede innerhalb einer Liga entstehen jetzt aus Geld (Platz der
      // Vorsaison) und ATR (ebenfalls Platz, aber gegenlaeufig).
      const staff = 68 - (oldTier - 1) * 4.5;
      const staffTerm = 0.4 + 0.6 * (staff / 100);

      const feedbackTerm = 0.9 + 0.25 * ((feedback.get(teamId) ?? 60) / 100);
      const focus = ARCHETYPE_FOCUS[row.ai_archetype as string] ?? {};

      // Homologationshilfe fuer den Aufsteiger (Konzept 6.5). Absteiger
      // behalten ihre Werte unveraendert, wie dort beschrieben.
      //
      // OFFENER PUNKT, gemessen und nicht geloest: Ueber viele Wechsel wirkt
      // das als Sperrklinke - wer fuenfmal pendelt, sammelt 1.08^5, also 47 %
      // geschenkte Leistung, und hat dann ein staerkeres Auto als der Schnitt
      // seiner neuen Liga. Die naheliegende Gegenmassnahme, die Hilfe beim
      // Abstieg wieder abzuziehen, wurde ausprobiert und verworfen: Sie liess
      // den Anteil der Sofortabsteiger von 33 auf 70 Prozent springen. Beide
      // Fassungen verfehlen das Ziel aus Konzept 18, also braucht es hier eine
      // Designentscheidung, keine weitere Justierung.
      const homologation = newTier < oldTier ? 1.08 : 1;

      const rng = createRng(seedFrom(worldSeed, toSeason, teamId));
      teams += 1;

      for (const type of partTypes) {
        const existing = readPart.get(teamId, fromSeason, type.part_key) as
          | { performance: number; reliability: number; spec_version: number; source: string }
          | undefined;
        if (!existing) continue;

        // Antrieb und ERS entwickelt der Hersteller, nicht das Team. Sie
        // werden hier unveraendert uebernommen (Konzept 6.6).
        if (type.supplied_by_engine === 1) {
          insert.run({
            team_id: teamId,
            season: toSeason,
            part_key: type.part_key,
            performance: existing.performance,
            reliability: existing.reliability,
            spec_version: existing.spec_version,
            source: existing.source,
          });
          parts += 1;
          continue;
        }

        const cap = oldRegulation[`cap_${type.part_key}`];
        const headroom = Math.max(0, 1 - existing.performance / cap);
        const saturation = Math.pow(headroom, 1.3);

        // Lueckengetrieben: Wo am meisten zum Deckel fehlt, fließt am meisten
        // hin - gewichtet mit der Handschrift des Archetyps.
        const allocation = (0.5 + headroom) * (focus[type.part_key] ?? 1);
        const noise = Math.max(0.85, NOISE_MEAN + gaussian(rng) * NOISE_SD);

        const delta =
          cap *
          SEASON_GAIN *
          type.dev_constant_k *
          allocation *
          resourceTerm *
          staffTerm *
          atr *
          feedbackTerm *
          saturation *
          noise;

        const performance = Math.round((existing.performance + delta) * homologation);
        gainSum += performance - existing.performance;

        insert.run({
          team_id: teamId,
          season: toSeason,
          part_key: type.part_key,
          performance,
          // Reife steigt mit den gefahrenen Kilometern: die Zuverlaessigkeit
          // naehert sich langsam 95 an.
          reliability: Math.round(existing.reliability + (95 - existing.reliability) * 0.12),
          spec_version: existing.spec_version + 1,
          source: 'developed',
        });
        parts += 1;
      }
    }
  });

  run();
  return { teams, parts, averageGain: parts === 0 ? 0 : gainSum / parts };
}
