/**
 * Sponsoren (Konzept 9.1).
 *
 * Ein Hauptvertrag je Team, dazu vier bis sechs Nebenvertraege. Was ein Sponsor
 * verlangt und wert ist, steht handgepflegt in `sponsors.csv`; wer welchen
 * bekommt, entsteht hier zur Laufzeit in `team_sponsors` - dasselbe Muster wie
 * bei Personal und Anlagen.
 *
 * Der Reiz liegt in den Zielvorgaben. Ein Vertrag zahlt nicht einfach, sondern
 * misst am Saisonende, ob das Team geliefert hat, und schlaegt einen Bonus auf
 * oder zieht einen Malus ab. Ein Team, das sich einen fordernden Sponsor holt,
 * wettet damit auf die eigene Saison.
 */

import type { Database } from './savegame.js';
import { createRng, seedFrom } from './rng.js';
import { playerTeam, withoutPlayer } from './player.js';

/** Bezugslaenge fuer Podest- und Siegvorgaben (siehe sponsors.csv). */
const REFERENCE_RACES = 16;

/** Wie viele Nebenvertraege ein Team haelt - Konzept 9.1 nennt vier bis sechs. */
const SIDE_SLOTS_MIN = 4;
const SIDE_SLOTS_MAX = 6;

export interface SponsorType {
  key: string;
  name: string;
  slot: 'title' | 'side';
  tierMin: number;
  tierMax: number;
  valuePct: number;
  termMin: number;
  termMax: number;
  objectiveType: string;
  objectiveValue: number;
  bonusPct: number;
  malusPct: number;
}

export function loadSponsorTypes(db: Database): SponsorType[] {
  return (db.prepare('SELECT * FROM sponsors ORDER BY sort_order').all() as Record<
    string,
    number | string
  >[]).map((row) => ({
    key: String(row.sponsor_key),
    name: String(row.name),
    slot: row.slot as 'title' | 'side',
    tierMin: row.tier_min as number,
    tierMax: row.tier_max as number,
    valuePct: row.value_pct as number,
    termMin: row.term_min as number,
    termMax: row.term_max as number,
    objectiveType: String(row.objective_type),
    objectiveValue: row.objective_value as number,
    bonusPct: row.bonus_pct as number,
    malusPct: row.malus_pct as number,
  }));
}

export interface SponsorSummary {
  signed: number;
  renewed: number;
  unfilled: number;
}

/**
 * Vergibt die Vertraege einer Saison.
 *
 * Laufende Vertraege werden fortgeschrieben, ausgelaufene neu besetzt. Wer
 * besser platziert war, greift zuerst zu - die Sponsorenschlange ist damit
 * dieselbe Rangfolge wie die Tabelle, was den Vorjahreserfolg ein zweites Mal
 * belohnt (Konzept 9.1: der Wert haengt am Vorjahresplatz).
 */
export function assignSponsors(db: Database, season: number): SponsorSummary {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;

  const types = loadSponsorTypes(db);
  const byKey = new Map(types.map((type) => [type.key, type]));

  const costCaps = new Map(
    (db.prepare('SELECT tier, cost_cap FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.cost_cap]),
  );

  // Teams in der Reihenfolge des Vorjahresergebnisses. Wer neu in der Liga ist,
  // reiht sich hinten ein.
  const teams = db
    .prepare(
      `SELECT ts.team_id, ts.tier, prev.final_rank AS previous_rank,
              (SELECT COUNT(*) FROM team_seasons x WHERE x.season = ts.season AND x.tier = ts.tier) AS field
         FROM team_seasons ts
         LEFT JOIN team_seasons prev ON prev.team_id = ts.team_id AND prev.season = ts.season - 1
        WHERE ts.season = ?
        ORDER BY ts.tier, COALESCE(prev.final_rank, 99), ts.team_id`,
    )
    .all(season) as {
    team_id: number;
    tier: number;
    previous_rank: number | null;
    field: number;
  }[];

  // Seine Sponsoren sucht sich der Spieler selbst (Konzept 14.2). Wichtig fuer
  // die Ausschliesslichkeit: Sein Titelsponsor blockiert den Platz in der Liga
  // trotzdem - deshalb faellt er erst aus der Vergabeschleife, nicht aus den
  // laufenden Vertraegen.
  const negotiating = withoutPlayer(teams, playerTeam(db));

  // Laufende Vertraege aus der Vorsaison.
  const running = new Map<string, Record<string, number | string>>();
  for (const row of db
    .prepare('SELECT * FROM team_sponsors WHERE season = ? AND contract_until >= ?')
    .all(season - 1, season) as Record<string, number | string>[]) {
    running.set(`${row.team_id}|${row.slot}`, row);
  }

  const insert = db.prepare(
    `INSERT INTO team_sponsors
       (team_id, season, slot, sponsor_key, contract_until, base_value,
        objective_type, objective_value, bonus, malus, achieved, payout)
     VALUES (@team_id, @season, @slot, @sponsor_key, @contract_until, @base_value,
             @objective_type, @objective_value, @bonus, @malus, NULL, 0)`,
  );

  const summary: SponsorSummary = { signed: 0, renewed: 0, unfilled: 0 };

  const run = db.transaction(() => {
    db.prepare('DELETE FROM team_sponsors WHERE season = ?').run(season);

    // Exklusiv ist nur der HAUPTVERTRAG, und nur innerhalb einer Liga: Derselbe
    // Titelsponsor auf elf Tier-1-Autos waere keiner.
    //
    // Nebenvertraege sind es ausdruecklich nicht. Acht Definitionen gegen vier
    // bis sechs Slots je Team - jede Sperre laesst die Mehrheit der Slots leer.
    // Gemessen: weltweit exklusiv 26 Vertraege, je Liga exklusiv 147, ohne
    // Sperre auf der Nebenseite gut zwei Groessenordnungen mehr. Fachlich ist
    // das auch richtig - ein Schmierstoffhersteller klebt auf vielen Autos.
    const takenByTier = new Map<number, Set<string>>();
    const tierOf = new Map(teams.map((team) => [team.team_id, team.tier]));
    for (const [, contract] of running) {
      const tier = tierOf.get(contract.team_id as number);
      if (tier === undefined) continue;
      const set = takenByTier.get(tier) ?? new Set<string>();
      set.add(String(contract.sponsor_key));
      takenByTier.set(tier, set);
    }

    for (const team of negotiating) {
      const cap = costCaps.get(team.tier) ?? 0;
      const taken = takenByTier.get(team.tier) ?? new Set<string>();
      takenByTier.set(team.tier, taken);
      // Innerhalb EINES Teams ist jeder Sponsor einmalig - vier Slots mit
      // demselben Namen waeren vier Logos derselben Marke auf einem Auto.
      const onTeam = new Set<string>();
      for (const slot of ['title', ...Array.from({ length: SIDE_SLOTS_MAX }, (_, i) => `side${i + 1}`)]) {
        const contract = running.get(`${team.team_id}|${slot}`);
        if (contract) onTeam.add(String(contract.sponsor_key));
      }
      const rng = createRng(seedFrom(worldSeed, season, team.team_id, 31));
      const sideCount = SIDE_SLOTS_MIN + Math.floor(rng() * (SIDE_SLOTS_MAX - SIDE_SLOTS_MIN + 1));
      const slots = ['title', ...Array.from({ length: sideCount }, (_, i) => `side${i + 1}`)];

      for (const slot of slots) {
        const existing = running.get(`${team.team_id}|${slot}`);
        if (existing) {
          const type = byKey.get(String(existing.sponsor_key));
          // Ein laufender Vertrag wird zum Wert der AKTUELLEN Liga fortgeschrieben.
          // Sonst zahlte ein Absteiger weiter Tier-1-Konditionen, und der
          // Fallschirm bekaeme einen zweiten, unbeabsichtigten Zwilling.
          const value = type ? Math.round(cap * type.valuePct) : (existing.base_value as number);
          insert.run({
            team_id: team.team_id,
            season,
            slot,
            sponsor_key: existing.sponsor_key,
            contract_until: existing.contract_until,
            base_value: value,
            objective_type: existing.objective_type,
            objective_value: existing.objective_value,
            bonus: Math.round(value * (type?.bonusPct ?? 0)),
            malus: Math.round(value * (type?.malusPct ?? 0)),
          });
          summary.renewed += 1;
          continue;
        }

        const wanted = slot === 'title' ? 'title' : 'side';
        const candidates = types.filter(
          (type) =>
            type.slot === wanted &&
            team.tier >= type.tierMin &&
            team.tier <= type.tierMax &&
            !onTeam.has(type.key) &&
            !(wanted === 'title' && taken.has(type.key)),
        );
        if (!candidates.length) {
          summary.unfilled += 1;
          continue;
        }

        // Der bestplatzierte Interessent bekommt den wertvollsten Vertrag, der
        // noch frei ist - deshalb nach Wert absteigend und nicht zufaellig.
        const sorted = [...candidates].sort((a, b) => b.valuePct - a.valuePct);
        const reach = Math.max(1, Math.round(sorted.length * standing(team.previous_rank, team.field)));
        const type = sorted[Math.min(sorted.length - 1, Math.floor(rng() * reach))];

        const years = type.termMin + Math.floor(rng() * (type.termMax - type.termMin + 1));
        const value = Math.round(cap * type.valuePct);
        const target = scaleObjective(db, type, team.tier);

        insert.run({
          team_id: team.team_id,
          season,
          slot,
          sponsor_key: type.key,
          contract_until: season + years - 1,
          base_value: value,
          objective_type: type.objectiveType,
          objective_value: target,
          bonus: Math.round(value * type.bonusPct),
          malus: Math.round(value * type.malusPct),
        });
        if (wanted === 'title') taken.add(type.key);
        onTeam.add(type.key);
        summary.signed += 1;
      }
    }
  });

  run();
  return summary;
}

/** 0 = Tabellenfuehrer des Vorjahres, 1 = Schlusslicht oder Neuling. */
function standing(previousRank: number | null, field: number): number {
  if (previousRank === null || field <= 1) return 1;
  return Math.min(1, Math.max(0, (previousRank - 1) / (field - 1)));
}

/**
 * Podest- und Siegvorgaben haengen an der Kalenderlaenge: Drei Podien sind in
 * einer 22-Rennen-Saison eine andere Forderung als in einer mit acht.
 */
function scaleObjective(db: Database, type: SponsorType, tier: number): number {
  if (type.objectiveType !== 'podiums' && type.objectiveType !== 'wins') {
    return type.objectiveValue;
  }
  const races = (db.prepare('SELECT race_count FROM leagues WHERE tier = ?').get(tier) as {
    race_count: number;
  }).race_count;
  return Math.max(1, Math.round((type.objectiveValue * races) / REFERENCE_RACES));
}

export interface SponsorPayout {
  total: number;
  achieved: number;
  missed: number;
}

/**
 * Wertet die Zielvorgaben aus und bucht die Sponsorengelder.
 *
 * Muss nach buildStandings laufen - alle Vorgaben ausser `finishes` haengen am
 * Saisonergebnis.
 */
export function settleSponsors(db: Database, season: number): SponsorPayout {
  const contracts = db
    .prepare('SELECT * FROM team_sponsors WHERE season = ?')
    .all(season) as Record<string, number | string | null>[];

  const teamRows = new Map(
    (db
      .prepare(
        `SELECT ts.team_id, ts.final_rank, ts.wins, ts.podiums, ts.dnfs, prev.final_rank AS previous_rank,
                (SELECT COUNT(*) FROM race_results r
                  WHERE r.season = ts.season AND r.team_id = ts.team_id) AS starts,
                (SELECT COUNT(*) FROM race_results r
                  WHERE r.season = ts.season AND r.team_id = ts.team_id AND r.status = 'classified') AS finishes
           FROM team_seasons ts
           LEFT JOIN team_seasons prev ON prev.team_id = ts.team_id AND prev.season = ts.season - 1
          WHERE ts.season = ?`,
      )
      .all(season) as Record<string, number | null>[]).map((row) => [row.team_id as number, row]),
  );

  const update = db.prepare(
    'UPDATE team_sponsors SET achieved = ?, payout = ? WHERE team_id = ? AND season = ? AND slot = ?',
  );

  const result: SponsorPayout = { total: 0, achieved: 0, missed: 0 };

  const run = db.transaction(() => {
    for (const contract of contracts) {
      const team = teamRows.get(contract.team_id as number);
      if (!team) continue;

      const met = objectiveMet(
        String(contract.objective_type),
        contract.objective_value as number,
        team,
      );
      const base = contract.base_value as number;
      const payout = met ? base + (contract.bonus as number) : base - (contract.malus as number);

      update.run(met ? 1 : 0, payout, contract.team_id, season, contract.slot);
      result.total += payout;
      if (met) result.achieved += 1;
      else result.missed += 1;
    }
  });

  run();
  return result;
}

function objectiveMet(
  type: string,
  value: number,
  team: Record<string, number | null>,
): boolean {
  switch (type) {
    case 'rank':
      return (team.final_rank ?? 99) <= value;
    case 'podiums':
      return (team.podiums ?? 0) >= value;
    case 'wins':
      return (team.wins ?? 0) >= value;
    case 'finishes': {
      const starts = team.starts ?? 0;
      if (starts === 0) return false;
      return (100 * (team.finishes ?? 0)) / starts >= value;
    }
    case 'improve': {
      const previous = team.previous_rank;
      // Ohne Vorjahr gibt es nichts zu verbessern - der Aufsteiger bekommt den
      // Bonus geschenkt, statt fuer eine Vorgabe bestraft zu werden, die er
      // nicht erfuellen kann.
      if (previous === null || previous === undefined) return true;
      return previous - (team.final_rank ?? 99) >= value;
    }
    default:
      return false;
  }
}

/** Summe der Sponsorengelder je Team - Eingang fuer die Bilanz. */
export function sponsorIncome(db: Database, season: number): Map<number, number> {
  return new Map(
    (db
      .prepare('SELECT team_id, COALESCE(SUM(payout), 0) total FROM team_sponsors WHERE season = ? GROUP BY team_id')
      .all(season) as { team_id: number; total: number }[]).map((row) => [row.team_id, row.total]),
  );
}
