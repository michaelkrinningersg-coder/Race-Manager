/**
 * Startaufstellung der Autos.
 *
 * Bis M3 (Entwicklung) gibt es keine gewachsenen Bauteilwerte. Sie werden
 * deshalb aus dem abgeleitet, was in den Stammdaten steht: dem Ligadeckel,
 * dem Prestige des Teams innerhalb seiner Liga und - fuer Antrieb und ERS -
 * dem Motorenhersteller.
 *
 * Der Ansatz ist bewusst durchsichtig: Kein Zufall, keine versteckten Boni.
 * Dieselben Stammdaten ergeben dieselben Autos.
 */

import type { Database } from './savegame.js';

/** Das staerkste Team einer Liga liegt knapp unter dem Reglementdeckel. */
const TOP_FACTOR = 0.995;

/**
 * Feldbreite je Liga, in Score-Punkten (ein Score-Punkt = 10 Bauteilpunkte).
 *
 * Entscheidend ist, dass die Breite **nicht** am Ligadeckel haengt. Waere sie
 * ein Prozentsatz davon, waere das Spitzenfeld absolut am weitesten
 * auseinander - und genau das Gegenteil ist gewollt: Kostendeckel und ATR
 * ziehen die oberen Ligen zusammen (Konzept 5.4), waehrend unten weder das
 * eine noch das andere greift.
 *
 * Die Werte sind so gewaehlt, dass die Spanne zwischen Erstem und Letztem in
 * jeder Liga rund drei Sigma betraegt - genug fuer eine wechselnde Rangfolge,
 * zu wenig fuer Zufallssiege.
 */
function fieldSpread(tier: number): number {
  return 2.0 + (tier - 1) * 0.67;
}

/**
 * Archetyp-Signatur: wo ein Team seine Ressourcen hinlegt.
 *
 * Angegeben als **Anteil der Feldbreite**, nicht als Prozentsatz des
 * Bauteilwerts - sonst wuerde die Signatur in Tier 1 die gesamte Feldbreite
 * ueberdecken. Je Archetyp summieren sich die Anteile auf null: Der Archetyp
 * verschiebt Schwerpunkte, er macht ein Team nicht pauschal besser. Die
 * Gesamtstaerke kommt allein aus dem Prestige.
 */
const ARCHETYPE_BIAS: Record<string, Partial<Record<string, number>>> = {
  works_team: { powertrain: 0.3, ers: 0.3, chassis: 0.05, front_wing: -0.3, floor: -0.35 },
  tech_startup: {
    front_wing: 0.35,
    rear_wing: 0.25,
    floor: 0.35,
    powertrain: -0.45,
    gearbox: -0.25,
    suspension: -0.25,
  },
  traditional: { chassis: 0.25, suspension: 0.25, brakes: 0.15, floor: -0.3, front_wing: -0.35 },
  climber: { floor: 0.25, suspension: 0.15, chassis: -0.15, rear_wing: -0.25 },
  privateer: { brakes: 0.25, gearbox: 0.25, suspension: 0.15, front_wing: -0.3, floor: -0.35 },
  academy: { suspension: 0.25, brakes: 0.15, chassis: 0.1, powertrain: -0.25, floor: -0.25 },
};

interface TeamRow {
  team_id: number;
  start_tier: number;
  prestige: number;
  ai_archetype: string;
  engine_supplier_id: number | null;
  is_works_team: number;
}

/**
 * Setzt fuer jedes Team die Bauteilwerte der Saison.
 *
 * `source` haelt fest, woher ein Wert stammt - `derived` aus Deckel und
 * Prestige, `engine_works` bzw. `engine_customer` vom Hersteller. Das macht
 * spaeter nachvollziehbar, warum zwei Teams denselben Antrieb haben.
 */
export function seedCarParts(db: Database, season: number): number {
  const teams = db.prepare('SELECT * FROM teams').all() as TeamRow[];
  const partKeys = db
    .prepare('SELECT part_key, supplied_by_engine FROM car_part_types ORDER BY sort_order')
    .all() as { part_key: string; supplied_by_engine: number }[];

  const capsByTier = new Map<number, Record<string, number>>();
  for (const row of db
    .prepare('SELECT * FROM league_regulations WHERE season = ?')
    .all(season) as Record<string, number>[]) {
    capsByTier.set(row.tier, row);
  }

  const suppliers = new Map<number, Record<string, number>>();
  for (const row of db.prepare('SELECT * FROM engine_suppliers').all() as Record<string, number>[]) {
    suppliers.set(row.supplier_id, row);
  }

  // Prestigespanne je Liga - ein Team wird immer relativ zu seiner eigenen
  // Liga eingeordnet, nie gegen die ganze Pyramide.
  const span = new Map<number, { min: number; max: number }>();
  for (const team of teams) {
    const current = span.get(team.start_tier);
    span.set(team.start_tier, {
      min: Math.min(current?.min ?? team.prestige, team.prestige),
      max: Math.max(current?.max ?? team.prestige, team.prestige),
    });
  }

  const insert = db.prepare(
    `INSERT INTO car_parts (team_id, season, part_key, performance, reliability, weight_delta, maturity, spec_version, source)
     VALUES (@team_id, @season, @part_key, @performance, @reliability, 0, 100, 1, @source)`,
  );

  let written = 0;
  const run = db.transaction(() => {
    for (const team of teams) {
      const caps = capsByTier.get(team.start_tier);
      if (!caps) continue;
      const range = span.get(team.start_tier);
      if (!range) continue;

      const prestigeSpan = range.max - range.min;
      const rel = prestigeSpan === 0 ? 1 : (team.prestige - range.min) / prestigeSpan;
      // Feldbreite in Bauteilpunkten: Score-Punkte mal zehn.
      const spreadPoints = fieldSpread(team.start_tier) * 10;
      const bias = ARCHETYPE_BIAS[team.ai_archetype] ?? {};
      const supplier =
        team.engine_supplier_id === null ? undefined : suppliers.get(team.engine_supplier_id);

      for (const { part_key, supplied_by_engine } of partKeys) {
        const cap = caps[`cap_${part_key}`];
        let performance: number;
        let reliability: number;
        let source: string;

        if (supplied_by_engine === 1 && supplier) {
          const isWorks = team.is_works_team === 1;
          const base =
            part_key === 'powertrain'
              ? supplier.powertrain_performance
              : supplier.ers_performance;
          const rel2 =
            part_key === 'powertrain' ? supplier.powertrain_reliability : supplier.ers_reliability;
          // Kundenteams bekommen eine gedrosselte Spezifikation (Konzept 6.6).
          performance = isWorks ? base : base - supplier.customer_spec_offset;
          reliability = rel2;
          source = isWorks ? 'engine_works' : 'engine_customer';
        } else {
          const top = cap * TOP_FACTOR;
          const bottom = top - spreadPoints;
          performance = bottom + rel * (top - bottom) + (bias[part_key] ?? 0) * spreadPoints;
          // Zuverlaessigkeit folgt dem Prestige, aber flacher als die Leistung.
          reliability = 62 + 30 * rel;
          source = 'derived';
        }

        // Der Reglementdeckel kappt am Ende alles - auch einen Werksmotor,
        // der in einer niedrigeren Liga eingesetzt wird.
        performance = Math.min(Math.round(performance), cap);
        insert.run({
          team_id: team.team_id,
          season,
          part_key,
          performance,
          reliability: Math.round(Math.max(0, Math.min(100, reliability))),
          source,
        });
        written += 1;
      }
    }
  });

  run();
  return written;
}
