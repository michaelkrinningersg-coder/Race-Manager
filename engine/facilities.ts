/**
 * Infrastruktur (Konzept 8.2): acht Anlagen, Level 0-5, als echter Bestand.
 *
 * Bis M5 war das hier eine reine Ableitung aus Liga und Prestige, die nur im
 * Moment der Lizenzpruefung gebraucht wurde - es gab keinen Bestand, keine
 * Kosten und keine Wirkung. Die Ableitung ist geblieben, aber nur noch als
 * ERZEUGER DES STARTBESTANDS in Saison 1 (getroffene Entscheidung). Ab dem
 * ersten Saisonwechsel traegt jedes Team seine Anlagen selbst weiter, baut aus
 * und zahlt dafuer - auch nach einem Abstieg. Genau das ist die Fixkostenfalle.
 *
 * `team_facilities` haelt eine Zeile je Team, Saison und Anlage,
 * `team_facility_moves` jeden Ausbau und jeden Zwangsverkauf. Dieselbe
 * Trennung wie bei den Fahrern: Zustand je Saison, Chronik daneben.
 */

import type { Database } from './savegame.js';
import { playerTeam, withoutPlayer } from './player.js';

export interface Facilities {
  windtunnel: number;
  dyno: number;
  simulator: number;
  factory: number;
  staff: number;
}

/**
 * Kostenleiter der Level 0-5.
 *
 * Steil, und zwar aus einem Zwang heraus: Die Level sind flach (0-5), das Geld
 * spannt ueber die Pyramide um den Faktor 558 (145 Mio gegen 260 Tsd Deckel).
 * Eine lineare Leiter kann beides nicht bedienen - ein Level-1-Windkanal muss
 * in Tier 7 bezahlbar sein, waehrend ein Level-5-Windkanal auch fuer Tier 1
 * ausser Reichweite bleiben soll. Level 3 ist das Niveau der Weltmeisterschaft,
 * alles darueber ist Luxus, den sich auch dort kaum jemand leistet.
 */
export const UPKEEP_LADDER = [0, 1, 4, 16, 60, 200];
export const MAX_FACILITY_LEVEL = 5;

/** Anteil der Bausumme, der beim Verkauf zurueckfliesst (Konzept 8.2: 40 % Verlust). */
export const SALE_RECOVERY = 0.6;

export interface FacilityType {
  key: string;
  name: string;
  sortOrder: number;
  licenceChecked: boolean;
  upkeepBase: number;
  buildFactor: number;
  weights: Record<string, number>;
}

/** Die Wirkungsbereiche - Spaltennamen ohne das `w_`-Praefix. */
export const FACILITY_AREAS = [
  'chassis',
  'front_wing',
  'rear_wing',
  'floor',
  'powertrain',
  'ers',
  'gearbox',
  'suspension',
  'brakes',
  'reliability',
  'feedback',
  'driver_dev',
  'newgen',
  'sponsor',
  'fitness',
] as const;

/** Die vier Anlagen, fuer die licence_requirements.csv ein Minimum kennt. */
export const LICENCE_FACILITIES = ['windtunnel', 'dyno', 'simulator', 'factory'] as const;

export function loadFacilityTypes(db: Database): FacilityType[] {
  const rows = db.prepare('SELECT * FROM facility_types ORDER BY sort_order').all() as Record<
    string,
    number | string
  >[];
  return rows.map((row) => ({
    key: String(row.facility_key),
    name: String(row.name),
    sortOrder: row.sort_order as number,
    licenceChecked: row.licence_checked === 1,
    upkeepBase: row.upkeep_base as number,
    buildFactor: row.build_factor as number,
    weights: Object.fromEntries(
      FACILITY_AREAS.map((area) => [area, (row[`w_${area}`] as number) ?? 0]),
    ),
  }));
}

/** Jaehrliche Fixkosten eines Levels - absolut, nicht am Deckel der Liga bemessen. */
export function upkeepFor(type: FacilityType, level: number): number {
  const step = UPKEEP_LADDER[Math.max(0, Math.min(MAX_FACILITY_LEVEL, level))] ?? 0;
  return Math.round(type.upkeepBase * step);
}

/** Einmalige Bausumme fuer den Sprung AUF dieses Level. */
export function buildCostFor(type: FacilityType, level: number): number {
  return Math.round(upkeepFor(type, level) * type.buildFactor);
}

/** Erloes beim Rueckbau VON diesem Level auf das darunter. */
export function saleValueFor(type: FacilityType, level: number): number {
  return Math.round(buildCostFor(type, level) * SALE_RECOVERY);
}

/**
 * Infrastrukturwert je Wirkungsbereich, 0-100.
 *
 * Weil sich die Gewichte einer Spalte ueber alle acht Anlagen auf 1.0
 * summieren, ist das ein sauberer gewichteter Mittelwert auf derselben Skala
 * wie der Personalwert - und laesst sich genauso in die Formeln haengen.
 */
export function facilityValues(
  types: FacilityType[],
  levels: Map<string, number>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const area of FACILITY_AREAS) {
    let sum = 0;
    for (const type of types) {
      const level = levels.get(type.key) ?? 0;
      sum += type.weights[area] * (level / MAX_FACILITY_LEVEL);
    }
    values[area] = sum * 100;
  }
  return values;
}

export function upkeepTotal(types: FacilityType[], levels: Map<string, number>): number {
  return types.reduce((sum, type) => sum + upkeepFor(type, levels.get(type.key) ?? 0), 0);
}

export interface TeamStanding {
  teamId: number;
  tier: number;
  prestige: number;
}

/** Prestigespanne je Liga - ein Team wird stets gegen seine eigene Liga gemessen. */
export function prestigeSpans(teams: TeamStanding[]): Map<number, { min: number; max: number }> {
  const span = new Map<number, { min: number; max: number }>();
  for (const team of teams) {
    const current = span.get(team.tier);
    span.set(team.tier, {
      min: Math.min(current?.min ?? team.prestige, team.prestige),
      max: Math.max(current?.max ?? team.prestige, team.prestige),
    });
  }
  return span;
}

export function relativePrestige(
  prestige: number,
  span: { min: number; max: number } | undefined,
): number {
  if (!span) return 0.5;
  const width = span.max - span.min;
  return width === 0 ? 1 : (prestige - span.min) / width;
}

export interface FacilityMinimum {
  windtunnel: number;
  dyno: number;
  simulator: number;
  factory: number;
  staff: number;
}

export function loadFacilityMinimums(db: Database): Map<number, FacilityMinimum> {
  const rows = db.prepare('SELECT * FROM licence_requirements').all() as Record<string, number>[];
  return new Map(
    rows.map((row) => [
      row.tier,
      {
        windtunnel: row.min_windtunnel_level,
        dyno: row.min_dyno_level,
        simulator: row.min_simulator_level,
        factory: row.min_factory_level,
        staff: row.min_staff_count,
      },
    ]),
  );
}

/**
 * Ein Team liegt auf dem Mindestniveau seiner Liga, das obere Drittel zwei
 * Stufen darueber. Damit scheitert ein Aufstieg genau dort, wo die Lizenzleiter
 * einen Sprung macht - an den Grenzen 2/1, 5/4 und 8/7.
 *
 * Nur noch Startwert fuer Saison 1: Ab Saison 2 steht der Bestand in
 * `team_facilities` und wird nicht mehr abgeleitet.
 */
export function deriveFacilities(
  tierMinimum: FacilityMinimum,
  relative: number,
  ceiling?: FacilityMinimum,
): Facilities {
  const step = Math.min(Math.floor(relative * 3), 2);
  const lift = (own: number, cap: number | undefined): number =>
    Math.min(MAX_FACILITY_LEVEL, own + step, cap ?? MAX_FACILITY_LEVEL);
  return {
    windtunnel: lift(tierMinimum.windtunnel, ceiling?.windtunnel),
    dyno: lift(tierMinimum.dyno, ceiling?.dyno),
    simulator: lift(tierMinimum.simulator, ceiling?.simulator),
    factory: lift(tierMinimum.factory, ceiling?.factory),
    // Belegschaft waechst anteilig, nicht in Stufen. Sie ist keine Anlage und
    // steht deshalb weiter ausserhalb von `team_facilities`.
    staff: Math.round(tierMinimum.staff * (1 + 0.35 * relative)),
  };
}

/**
 * Belegschaftsstaerke eines Teams - die einzige Groesse der Lizenzpruefung,
 * die weiterhin abgeleitet wird. Sie beschreibt die gesamte Mannschaft, nicht
 * die neun namentlich gefuehrten Fuehrungskraefte aus `staff`.
 */
export function derivedStaffCount(tierMinimum: FacilityMinimum, relative: number): number {
  return Math.round(tierMinimum.staff * (1 + 0.35 * relative));
}

/**
 * Startbestand Saison 1.
 *
 * Die vier gepruefften Anlagen bekommen exakt die Werte, die `deriveFacilities`
 * bisher zur Laufzeit geliefert hat - dadurch verhaelt sich die Lizenzpruefung
 * in Saison 1 unveraendert, und jede spaetere Veraenderung der Mobilitaet ist
 * der neuen Mechanik zuzurechnen und nicht einer neuen Startverteilung.
 *
 * Die vier uebrigen starten bei null. Die Lizenzleiter ist der einzige Anker
 * dafuer, wie die Infrastruktur einer Liga aussieht, und sie sagt zu CFD,
 * Akademie, Marketing und Medizin nichts. Ein erfundener Startwert waere hier
 * keine Ableitung, sondern eine Setzung - und zwar eine teure: Jede Stufe kostet
 * ab sofort jede Saison Geld. Wer diese Anlagen will, baut sie selbst.
 *
 * DECKELUNG. Der Prestige-Schritt reicht hoechstens bis zum Mindestniveau der
 * naechsthoeheren Liga, in Tier 1 bis zum eigenen. Solange Anlagen nichts
 * kosteten, war der ungedeckelte Schritt harmlos; mit echten Fixkosten ist er
 * toedlich: Ein Tier-10-Team mit Prestige bekam so einen Windkanal auf Stufe 2
 * und damit 1,35 Mio Fixkosten gegen einen Deckel von 0,26 Mio - gemessen 518 %
 * des Deckels allein fuer die Hallen.
 *
 * Auf die Lizenzurteile der Saison 1 wirkt die Deckelung nachweislich nicht:
 * Geprueft wird gegen genau das Minimum, an dem gedeckelt wird, also kappt sie
 * ausschliesslich Stufen, die ohnehin ueber der Anforderung lagen.
 */
export function seedFacilities(db: Database, season: number): void {
  const types = loadFacilityTypes(db);
  const minimums = loadFacilityMinimums(db);

  const teams = db
    .prepare(
      `SELECT ts.team_id, ts.tier, t.prestige
       FROM team_seasons ts JOIN teams t ON t.team_id = ts.team_id
       WHERE ts.season = ?`,
    )
    .all(season) as { team_id: number; tier: number; prestige: number }[];

  const spans = prestigeSpans(
    teams.map((row) => ({ teamId: row.team_id, tier: row.tier, prestige: row.prestige })),
  );

  const insert = db.prepare(
    'INSERT INTO team_facilities (team_id, season, facility_key, level) VALUES (?, ?, ?, ?)',
  );

  const run = db.transaction(() => {
    db.prepare('DELETE FROM team_facilities WHERE season = ?').run(season);
    for (const team of teams) {
      const minimum = minimums.get(team.tier);
      if (!minimum) continue;
      const relative = relativePrestige(team.prestige, spans.get(team.tier));
      const ceiling = minimums.get(Math.max(1, team.tier - 1)) ?? minimum;
      const derived = deriveFacilities(minimum, relative, ceiling);

      for (const type of types) {
        const level = type.licenceChecked
          ? (derived[type.key as keyof Facilities] as number)
          : 0;
        insert.run(team.team_id, season, type.key, level);
      }
    }
  });

  run();
}

/**
 * Bestand in die naechste Saison tragen - unveraendert, auch bei Auf- und
 * Abstieg. Ein Absteiger nimmt seinen Windkanal mit, und die Rechnung dafuer
 * gleich mit.
 */
export function carryFacilities(db: Database, fromSeason: number, toSeason: number): void {
  const run = db.transaction(() => {
    db.prepare('DELETE FROM team_facilities WHERE season = ?').run(toSeason);
    db.prepare(
      `INSERT INTO team_facilities (team_id, season, facility_key, level)
       SELECT team_id, ?, facility_key, level FROM team_facilities WHERE season = ?`,
    ).run(toSeason, fromSeason);
  });
  run();
}

export function loadLevels(db: Database, season: number): Map<number, Map<string, number>> {
  const rows = db
    .prepare('SELECT team_id, facility_key, level FROM team_facilities WHERE season = ?')
    .all(season) as { team_id: number; facility_key: string; level: number }[];
  const levels = new Map<number, Map<string, number>>();
  for (const row of rows) {
    let team = levels.get(row.team_id);
    if (!team) {
      team = new Map<string, number>();
      levels.set(row.team_id, team);
    }
    team.set(row.facility_key, row.level);
  }
  return levels;
}

/**
 * Ausbauwuensche je KI-Archetyp. Was ein Team baut, wenn die Lizenz nichts
 * mehr fordert - dieselbe Handschrift wie bei ARCHETYPE_FOCUS in der
 * Entwicklungsformel.
 */
const ARCHETYPE_PREFERENCE: Record<string, string[]> = {
  works_team: ['dyno', 'windtunnel', 'factory', 'cfd', 'simulator'],
  tech_startup: ['cfd', 'windtunnel', 'simulator', 'factory', 'dyno'],
  traditional: ['factory', 'windtunnel', 'dyno', 'simulator', 'cfd'],
  climber: ['windtunnel', 'cfd', 'factory', 'simulator', 'academy'],
  privateer: ['factory', 'dyno', 'simulator', 'cfd', 'windtunnel'],
  academy: ['academy', 'simulator', 'factory', 'windtunnel', 'cfd'],
};

export interface FacilitySummary {
  upgrades: number;
  invested: number;
  sales: number;
  recovered: number;
}

/**
 * Ausbauentscheidung der KI, einmal je Team und Saison.
 *
 * Zwei Stufen, und die Reihenfolge ist die eigentliche Aussage: Zuerst wird
 * gebaut, was die Lizenz der naechsthoeheren Liga fordert - Infrastruktur ist
 * damit erstmals ein Aufstiegshebel und nicht nur eine Huerde. Erst wenn dort
 * nichts fehlt, folgt die Handschrift des Archetyps.
 *
 * Hoechstens ein Ausbau je Saison. Das ist keine Sparsamkeit, sondern eine
 * Bremse: Die Kostenleiter ist so steil, dass zwei Stufen in einem Jahr ein
 * Team ueber Nacht in die Fixkostenfalle stellen wuerden, aus der es nie
 * wieder herausfindet.
 */
export function planInvestments(db: Database, season: number): FacilitySummary {
  const types = loadFacilityTypes(db);
  const byKey = new Map(types.map((type) => [type.key, type]));
  const minimums = loadFacilityMinimums(db);
  const levels = loadLevels(db, season);

  const costCaps = new Map(
    (db.prepare('SELECT tier, cost_cap FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.cost_cap]),
  );
  const liquidityPct = new Map(
    (db.prepare('SELECT tier, min_liquidity_pct FROM licence_requirements').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.min_liquidity_pct]),
  );

  const balances = new Map(
    (db.prepare('SELECT team_id, closing FROM team_finances WHERE season = ?').all(
      season - 1,
    ) as Record<string, number>[]).map((row) => [row.team_id, row.closing]),
  );

  // Deckelrelevante Ausgaben der Vorsaison (Konzept 9.3). Ohne diese Schranke
  // baut ein Team weiter, bis es den Deckel dauerhaft um zwanzig Prozent
  // reisst - gemessen 870 Verstoesse in zwanzig Saisons, mit einer
  // Windkanalkuerzung, die dann nie mehr endet. Der Deckel ist der zweite
  // Anti-Dominanz-Regler des Konzepts; er wirkt nur, wenn die KI ihn einplant.
  const cappedSpend = new Map(
    (db.prepare(
      `SELECT team_id, expenses + facility_cost + staff_wages + engine_lease + logistics AS spent
         FROM team_finances WHERE season = ?`,
    ).all(season - 1) as Record<string, number>[]).map((row) => [row.team_id, row.spent]),
  );

  // Jahresueberschuss der Vorsaison ohne den einmaligen Ausbau: Was ein Team
  // dauerhaft uebrig hat. Die Kasse allein reicht als Pruefung nicht - eine
  // Bausumme faellt einmal an, die Fixkosten jedes Jahr danach.
  const surplus = new Map(
    (db.prepare(
      `SELECT team_id, payout + parachute - expenses - facility_cost AS s
       FROM team_finances WHERE season = ?`,
    ).all(season - 1) as Record<string, number>[]).map((row) => [row.team_id, row.s]),
  );

  const teams = db
    .prepare(
      `SELECT ts.team_id, ts.tier, t.ai_archetype
       FROM team_seasons ts JOIN teams t ON t.team_id = ts.team_id
       WHERE ts.season = ? ORDER BY ts.team_id`,
    )
    .all(season) as { team_id: number; tier: number; ai_archetype: string }[];

  // Ueber den Ausbau des Spielerteams entscheidet der Spieler (Konzept 14.2).
  // forceSales weiter unten gilt weiterhin fuer alle: Ein Zwangsverkauf ist
  // keine Entscheidung, sondern die Folge einer leeren Kasse.
  const building = withoutPlayer(teams, playerTeam(db));

  const setLevel = db.prepare(
    'UPDATE team_facilities SET level = ? WHERE team_id = ? AND season = ? AND facility_key = ?',
  );
  const logMove = db.prepare(
    `INSERT INTO team_facility_moves (team_id, season, facility_key, from_level, to_level, amount, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const summary: FacilitySummary = { upgrades: 0, invested: 0, sales: 0, recovered: 0 };

  const run = db.transaction(() => {
    for (const team of building) {
      const owned = levels.get(team.team_id);
      if (!owned) continue;

      const balance = balances.get(team.team_id) ?? 0;
      const targetTier = Math.max(1, team.tier - 1);
      // Ruecklage gegen die ZIELLIGA, nicht gegen die eigene: Die Lizenz misst
      // die Liquiditaet am Deckel der Liga, in die es hinaufgehen soll. Wer
      // gegen den eigenen, kleineren Deckel zurueckstellt, baut sich eine Halle
      // und faellt im selben Winter durch die Liquiditaetspruefung - gemessen
      // 188 von 494 Verweigerungen.
      const reserve = (liquidityPct.get(targetTier) ?? 0) * (costCaps.get(targetTier) ?? 0);

      const wishlist: string[] = [];
      const targetMinimum = minimums.get(targetTier);
      if (targetMinimum && targetTier !== team.tier) {
        for (const key of LICENCE_FACILITIES) {
          if ((owned.get(key) ?? 0) < targetMinimum[key]) wishlist.push(key);
        }
      }
      for (const key of ARCHETYPE_PREFERENCE[team.ai_archetype] ?? []) wishlist.push(key);

      for (const key of wishlist) {
        const type = byKey.get(key);
        if (!type) continue;
        const current = owned.get(key) ?? 0;
        if (current >= MAX_FACILITY_LEVEL) continue;

        const next = current + 1;
        const cost = buildCostFor(type, next);
        const extraUpkeep = upkeepFor(type, next) - upkeepFor(type, current);
        // Zwei Huerden, und die zweite ist die wichtigere. Die Kasse muss den
        // Bau tragen und danach noch die Ruecklage halten - aber vor allem muss
        // der laufende Ueberschuss die neue Fixkostenstufe DAUERHAFT tragen.
        //
        // Ohne die zweite Bedingung baut ein Team, sobald es einmal genug Geld
        // gesehen hat, und verkauft die Halle im naechsten Winter mit 40 %
        // Verlust wieder: gemessen 578 Ausbauten gegen 461 Zwangsverkaeufe.
        // Das war kein Wirtschaften, das war ein Reisswolf.
        if (balance - cost < reserve) continue;
        if ((surplus.get(team.team_id) ?? 0) - extraUpkeep < 0) continue;
        // Dritte Huerde: Der Ausbau darf den Kostendeckel nicht sprengen. Die
        // Bausumme faellt in dieser Saison an, die hoehere Fixkostenstufe ab
        // der naechsten - beides zaehlt mit.
        const capLimit = costCaps.get(team.tier) ?? 0;
        if ((cappedSpend.get(team.team_id) ?? 0) + extraUpkeep + cost > capLimit) continue;

        setLevel.run(next, team.team_id, season, key);
        owned.set(key, next);
        logMove.run(team.team_id, season, key, current, next, cost, 'built');
        summary.upgrades += 1;
        summary.invested += cost;
        break;
      }
    }
  });

  run();
  return summary;
}

/**
 * Zwangsverkauf nach Konzept 9.4: Wer die Saison im Minus beendet, trennt sich
 * von Anlagen, bis die Bilanz wieder steht - mit 40 % Verlust.
 *
 * Verkauft wird immer die teuerste laufende Stufe zuerst. Das ist die Stelle,
 * an der die Fixkostenfalle zuschnappt: Ein Absteiger zahlt weiter den Preis
 * seiner alten Liga und muss genau das abgeben, was ihn zurueckbringen wuerde.
 *
 * Der Bestand der laufenden Saison wird dabei nachtraeglich gesenkt. Das ist
 * richtig so: Die Fixkosten der Saison sind zum vollen Niveau gebucht, in die
 * naechste Saison geht das Team ohne die Anlage.
 */
export function forceSales(db: Database, season: number): FacilitySummary {
  const types = loadFacilityTypes(db);
  const levels = loadLevels(db, season);

  const debtors = db
    .prepare('SELECT team_id, closing FROM team_finances WHERE season = ? AND closing < 0')
    .all(season) as { team_id: number; closing: number }[];

  const setLevel = db.prepare(
    'UPDATE team_facilities SET level = ? WHERE team_id = ? AND season = ? AND facility_key = ?',
  );
  const logMove = db.prepare(
    `INSERT INTO team_facility_moves (team_id, season, facility_key, from_level, to_level, amount, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const setClosing = db.prepare(
    'UPDATE team_finances SET asset_sales = ?, closing = ? WHERE team_id = ? AND season = ?',
  );

  const summary: FacilitySummary = { upgrades: 0, invested: 0, sales: 0, recovered: 0 };

  const run = db.transaction(() => {
    for (const debtor of debtors) {
      const owned = levels.get(debtor.team_id);
      if (!owned) continue;

      let balance = debtor.closing;
      let recovered = 0;

      while (balance < 0) {
        // Teuerste laufende Stufe zuerst - sie bringt am meisten und nimmt am
        // meisten Last aus der Folgesaison.
        let best: { type: FacilityType; level: number; value: number } | null = null;
        for (const type of types) {
          const level = owned.get(type.key) ?? 0;
          if (level <= 0) continue;
          const value = saleValueFor(type, level);
          if (!best || value > best.value) best = { type, level, value };
        }
        if (!best || best.value <= 0) break;

        setLevel.run(best.level - 1, debtor.team_id, season, best.type.key);
        owned.set(best.type.key, best.level - 1);
        logMove.run(
          debtor.team_id,
          season,
          best.type.key,
          best.level,
          best.level - 1,
          best.value,
          'forced_sale',
        );
        balance += best.value;
        recovered += best.value;
        summary.sales += 1;
        summary.recovered += best.value;
      }

      if (recovered > 0) setClosing.run(recovered, balance, debtor.team_id, season);
    }
  });

  run();
  return summary;
}
