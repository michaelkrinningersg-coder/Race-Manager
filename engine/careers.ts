/**
 * Fahrerkarrieren: Altern, Entwicklung, Ruecktritte, Newgens, Markt.
 *
 * Trennung wie bei den Teams: `drivers` haelt die Identitaet (Name, Land,
 * Jahrgang) und waechst um Newgens, `driver_state` haelt alles, was sich je
 * Saison aendert - Attribute, Vertrag, Moral, Superlizenzpunkte.
 *
 * Der Markt fuellt nur frei gewordene Cockpits (getroffene Entscheidung).
 * Bewegung entsteht damit aus auslaufenden Vertraegen und Ruecktritten, nicht
 * aus Abwerbung.
 */

import type { Database } from './savegame.js';
import { createRng, gaussian, seedFrom } from './rng.js';
import { loadPayoutRules, payoutFor } from './finance.js';

/** Anteil der Ausschuettung, den ein Team in seine beiden Stammfahrer steckt. */
const DRIVER_BUDGET_SHARE = 0.12;

/**
 * Gehaltsmodell - die Schranke, die die Fahrerpyramide traegt.
 *
 * Der Preis eines Fahrers haengt allein an seiner Guete, nie an der Liga: Ein
 * 90er kostet in Tier 10 dasselbe wie in Tier 1, nur kann ihn dort niemand
 * bezahlen. Genau daraus entsteht die Staffelung, die in drivers.csv von Hand
 * gesetzt ist - ohne sie vergaebe jedes Team, auch das aermste, sein Cockpit an
 * den besten Verfuegbaren, und die unteren Ligen zoegen binnen zwanzig Saisons
 * bis auf wenige Punkte an die oberen heran.
 *
 * Beide Ankerpunkte kommen aus den Daten, nicht aus einer gesetzten Zahl: der
 * Preis aus dem Sitzbudget von Tier 1 und Tier 10, die zugehoerige Guete aus
 * dem Kernwertschnitt der handgepflegten Stammfahrer dieser beiden Ligen. Wer
 * league_payouts oder drivers.csv nachjustiert, justiert den Markt mit.
 */
interface SalaryModel {
  /** Sitzbudget je Liga bei mittlerer Platzierung - nur als Rueckfallwert. */
  seatBudget: Map<number, number>;
  reference: number;
  quality: number;
  exponent: number;
}

function loadSalaryModel(db: Database): SalaryModel {
  const rules = loadPayoutRules(db);
  const counts = new Map(
    (db.prepare('SELECT start_tier tier, COUNT(*) n FROM teams GROUP BY start_tier').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.n]),
  );

  const seatBudget = new Map<number, number>();
  for (const [tier, rule] of rules) {
    const count = counts.get(tier) ?? 16;
    seatBudget.set(tier, (payoutFor(rule, (count + 1) / 2, count) * DRIVER_BUDGET_SHARE) / 2);
  }

  const anchors = new Map(
    (db
      .prepare(
        `SELECT t.start_tier tier, AVG((d.pace + d.qualifying + d.braking + d.cornering) / 4.0) q
         FROM drivers d JOIN teams t ON t.team_id = d.start_team_id
         WHERE d.is_newgen = 0 AND d.start_role = 'race' AND t.start_tier IN (1, 10)
         GROUP BY t.start_tier`,
      )
      .all() as { tier: number; q: number }[]).map((row) => [row.tier, row.q]),
  );

  const topBudget = seatBudget.get(1) ?? 1;
  const bottomBudget = seatBudget.get(10) ?? 1;
  const topQuality = anchors.get(1) ?? 88;
  const bottomQuality = anchors.get(10) ?? 37;

  // Der Exponent ist nicht gewaehlt, sondern die Loesung von
  // topBudget / bottomBudget = (topQuality / bottomQuality) ^ exponent.
  const exponent = Math.log(topBudget / bottomBudget) / Math.log(topQuality / bottomQuality);

  return { seatBudget, reference: topBudget, quality: topQuality, exponent };
}

/**
 * Ab wie vielen Superlizenzpunkten ein Fahrer seinen vollen Marktwert aufruft.
 * Etwa zwei starke Saisons in einer mittleren Liga.
 */
const REPUTATION_FULL = 45;

/** Was ein voellig unbeschriebener Fahrer von seinem spaeteren Wert kostet. */
const ROOKIE_DISCOUNT = 0.1;

/**
 * Gehaltsforderung eines Fahrers. Steigt so steil, wie die Ausschuettung faellt
 * - und wird um den Ruf gedaempft.
 *
 * Der Ruf ist nicht Kosmetik, sondern noetig, damit sich Superlizenz- und
 * Geldschranke nicht gegenseitig zuschnueren. Ohne ihn sass ein schneller
 * Neunzehnjaehriger in der Falle: Fuer Tier 1-4 fehlten ihm die Punkte, fuer
 * Tier 5-10 war er zu teuer. Er fuhr nie, verdiente nie Punkte und die Spitze
 * blutete aus - gemessen fiel der Kernwert der Tier-1-Fahrer in zwanzig
 * Saisons von 89 auf 74, waehrend im freien Pool dauerhaft ein 82er sass, den
 * niemand verpflichten konnte.
 *
 * Mit dem Ruf unterschreibt ein Rookie billig dort, wo er darf, faehrt sich
 * Punkte heraus und wird beim naechsten Vertrag teuer - der uebliche Weg nach
 * oben. Ein alternder Fahrer wird ueber den fallenden Kernwert von selbst
 * wieder billiger und findet weiter unten ein Cockpit.
 */
function askingSalary(model: SalaryModel, quality: number, superlicencePoints: number): number {
  const market = model.reference * Math.pow(Math.max(1, quality) / model.quality, model.exponent);
  const reputation =
    ROOKIE_DISCOUNT +
    (1 - ROOKIE_DISCOUNT) * Math.min(1, Math.max(0, superlicencePoints) / REPUTATION_FULL);
  return Math.round(market * reputation);
}

const ATTRIBUTES = [
  'pace',
  'qualifying',
  'braking',
  'cornering',
  'car_control',
  'overtaking',
  'defending',
  'starts',
  'racecraft_traffic',
  'consistency',
  'pressure',
  'aggression',
  'feedback',
  'tyre_management',
  'fuel_saving',
  'fitness',
  'wet_skill',
] as const;

/** Werte, die im Alter zuerst nachlassen (Konzept 7.2). */
const SPEED_KEYS = ['pace', 'qualifying', 'braking', 'cornering', 'car_control'] as const;

/** Werte, die mit Erfahrung weiter wachsen, auch wenn das Tempo faellt. */
const EXPERIENCE_KEYS = ['pressure', 'feedback', 'racecraft_traffic', 'defending'] as const;

export interface CareerSummary {
  retired: number;
  newgens: number;
  signings: number;
  promotedFromJunior: number;
  /** Cockpits, fuer die sich kein zugelassener Fahrer fand. */
  unfilled: number;
  /** Cockpits, die nur ueber dem Fahrerbudget zu besetzen waren. */
  overBudget: number;
}

/**
 * Wachstum je Saison nach Alter (Konzept 7.2).
 *
 * `speed` und `experience` sind *Annaeherungsraten*, keine Punktzuwaechse: 0.20
 * heisst, dass ein Fuenftel des Abstands zum Potenzial pro Saison geschlossen
 * wird. Ein fester Punktzuwachs waere hier falsch - er muss auslaufen, sonst
 * naehert sich niemand je seinem Potenzial und die Kurve haengt am Zufall der
 * Startwerte statt am Potenzial.
 *
 * Kalibriert an der Alterskurve der handgepflegten Startfahrer: deren
 * pace/potential-Quote liegt mit 16-19 Jahren bei 0.79, mit 24-27 bei 0.93 und
 * ab 28 bei 0.97. Mit diesen Raten trifft ein Newgen dieselbe Kurve.
 *
 * Negative Werte sind Abbau und wirken als Punktabzug, nicht als Rate - wer
 * abbaut, verliert unabhaengig davon, wie nah er seinem Potenzial einmal kam.
 */
function growthFor(age: number): { speed: number; experience: number } {
  if (age <= 21) return { speed: 0.2, experience: 0.24 };
  if (age <= 26) return { speed: 0.15, experience: 0.2 };
  if (age <= 31) return { speed: 0.1, experience: 0.14 };
  if (age <= 35) return { speed: -2.0, experience: 0.06 };
  return { speed: -3.5, experience: -0.5 };
}

/** Ruecktrittswahrscheinlichkeit. Ohne Cockpit hoert man deutlich frueher auf. */
function retirementChance(age: number, hasSeat: boolean): number {
  let base: number;
  if (age < 32) base = 0;
  else if (age <= 35) base = 0.04;
  else if (age <= 38) base = 0.16;
  else if (age <= 41) base = 0.4;
  else base = 1;
  return hasSeat ? base : Math.min(1, base * 2.5 + (age >= 28 ? 0.12 : 0.03));
}

/**
 * Superlizenzpunkte einer Saison (Konzept 7.3): Der Meister von Tier 1
 * bekommt 40, der von Tier 10 noch 2. Punkte gibt es bis etwa zur Haelfte
 * des Feldes.
 */
export function superlicenceFor(tier: number, rank: number, fieldSize: number): number {
  const champion = 40 - (tier - 1) * 4.22;
  const reach = Math.max(1, fieldSize * 0.6);
  return Math.max(0, Math.round(champion * Math.max(0, 1 - (rank - 1) / reach)));
}

/** Legt den Fahrerzustand der ersten Saison aus den Stammdaten an. */
export function seedDriverState(db: Database): void {
  const columns = [...ATTRIBUTES, 'potential', 'ego', 'adaptability', 'marketability'];
  db.prepare(
    `INSERT INTO driver_state (driver_id, season, team_id, role, seat, contract_until, salary,
       pay_driver_budget, morale, superlicence_points, retired, ${columns.join(', ')})
     SELECT driver_id, 1, start_team_id, start_role, start_seat,
            COALESCE(contract_until_season, 1), salary, pay_driver_budget, morale,
            superlicence_points, 0, ${columns.join(', ')}
     FROM drivers`,
  ).run();
}

/**
 * Traegt den Zustand in die Folgesaison fort: Altern, Entwicklung, Vertraege.
 *
 * Die Entwicklung haengt an der Ligastufe - wer oben faehrt, lernt schneller
 * (Konzept 7.2) - und am Abstand zum eigenen Potenzial. Ein Fahrer ohne
 * Cockpit entwickelt sich deutlich langsamer.
 */
export function ageAndDevelop(db: Database, fromSeason: number, toSeason: number): void {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;
  const startYear = 2026;

  const rows = db
    .prepare(
      `SELECT ds.*, d.birth_year, ts.tier
       FROM driver_state ds
       JOIN drivers d ON d.driver_id = ds.driver_id
       LEFT JOIN team_seasons ts ON ts.team_id = ds.team_id AND ts.season = ds.season
       WHERE ds.season = ? AND ds.retired = 0`,
    )
    .all(fromSeason) as Record<string, number | string | null>[];

  const columns = [...ATTRIBUTES, 'potential', 'ego', 'adaptability', 'marketability'];
  const insert = db.prepare(
    `INSERT INTO driver_state (driver_id, season, team_id, role, seat, contract_until, salary,
       pay_driver_budget, morale, superlicence_points, retired, ${columns.join(', ')})
     VALUES (@driver_id, @season, @team_id, @role, @seat, @contract_until, @salary,
       @pay_driver_budget, @morale, @superlicence_points, 0, ${columns.map((c) => `@${c}`).join(', ')})`,
  );

  const run = db.transaction(() => {
    db.prepare('DELETE FROM driver_state WHERE season = ?').run(toSeason);

    for (const row of rows) {
      const age = startYear + toSeason - (row.birth_year as number);
      const growth = growthFor(age);
      const rng = createRng(seedFrom(worldSeed, toSeason, row.driver_id as number, 3));

      const tier = (row.tier as number | null) ?? 10;
      const hasSeat = row.role === 'race';
      // Eine haertere Liga entwickelt schneller, ein Fahrer ohne Cockpit kaum.
      const leagueFactor = (1.16 - (tier - 1) * 0.04) * (hasSeat ? 1 : 0.35);

      const values: Record<string, number> = {};
      const potential = row.potential as number;

      for (const key of ATTRIBUTES) {
        const current = row[key] as number;
        let delta: number;
        if ((SPEED_KEYS as readonly string[]).includes(key)) {
          // Naehe zum Potenzial bremst den Zuwachs, den Abbau nicht.
          delta =
            growth.speed >= 0
              ? growth.speed * leagueFactor * Math.max(0, potential - current)
              : growth.speed * (0.7 + 0.6 * (current / 100));
        } else if ((EXPERIENCE_KEYS as readonly string[]).includes(key)) {
          // Erfahrung waechst ueber das Potenzial hinaus und faellt erst spaet.
          const ceiling = Math.min(100, potential + 5);
          delta =
            growth.experience >= 0
              ? growth.experience * leagueFactor * Math.max(0, ceiling - current)
              : growth.experience * (0.7 + 0.6 * (current / 100));
        } else {
          // Alles Uebrige naehert sich langsamer und bleibt unter dem Potenzial.
          delta = Math.abs(growth.experience) * 0.5 * leagueFactor * (potential - current);
        }
        values[key] = Math.max(1, Math.min(100, Math.round(current + delta + gaussian(rng) * 0.6)));
      }

      insert.run({
        driver_id: row.driver_id,
        season: toSeason,
        team_id: row.team_id,
        role: row.role,
        seat: row.seat,
        contract_until: row.contract_until,
        salary: row.salary,
        pay_driver_budget: row.pay_driver_budget,
        morale: row.morale,
        superlicence_points: row.superlicence_points,
        potential,
        ego: row.ego,
        adaptability: row.adaptability,
        marketability: row.marketability,
        ...values,
      });
    }
  });

  run();
}

/** Vergibt Superlizenzpunkte aus den Ergebnissen einer Saison. */
export function awardSuperlicence(db: Database, season: number): void {
  const fieldSizes = new Map(
    (db.prepare('SELECT tier, COUNT(*) n FROM driver_seasons WHERE season = ? GROUP BY tier')
      .all(season) as Record<string, number>[]).map((row) => [row.tier, row.n]),
  );

  const rows = db
    .prepare('SELECT driver_id, tier, final_rank FROM driver_seasons WHERE season = ?')
    .all(season) as { driver_id: number; tier: number; final_rank: number | null }[];

  const update = db.prepare(
    'UPDATE driver_state SET superlicence_points = superlicence_points + ? WHERE driver_id = ? AND season = ?',
  );
  const run = db.transaction(() => {
    for (const row of rows) {
      const points = superlicenceFor(row.tier, row.final_rank ?? 99, fieldSizes.get(row.tier) ?? 20);
      if (points > 0) update.run(points, row.driver_id, season);
    }
  });
  run();
}

/** Ruecktritte am Saisonende. */
export function retireDrivers(db: Database, season: number): number {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;
  const startYear = 2026;

  const rows = db
    .prepare(
      `SELECT ds.driver_id, ds.role, ds.team_id, d.birth_year FROM driver_state ds
       JOIN drivers d ON d.driver_id = ds.driver_id
       WHERE ds.season = ? AND ds.retired = 0`,
    )
    .all(season) as { driver_id: number; role: string; team_id: number | null; birth_year: number }[];

  const update = db.prepare(
    "UPDATE driver_state SET retired = 1, team_id = NULL, role = 'retired', seat = NULL WHERE driver_id = ? AND season = ?",
  );
  const note = db.prepare(
    `INSERT OR REPLACE INTO driver_history (driver_id, season, event, tier, team_id, detail)
     VALUES (?, ?, 'retired', (SELECT tier FROM driver_seasons WHERE driver_id = ? AND season = ?), ?, ?)`,
  );

  let count = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      const age = startYear + season - row.birth_year;
      const rng = createRng(seedFrom(worldSeed, season, row.driver_id, 5));
      if (rng() < retirementChance(age, row.role === 'race')) {
        note.run(row.driver_id, season, row.driver_id, season, row.team_id, `Alter ${age}`);
        update.run(row.driver_id, season);
        count += 1;
      }
    }
  });
  run();
  return count;
}

/**
 * Erzeugt Newgens, bis der Bestand wieder seine Sollgroesse hat.
 * Junge Fahrer mit niedrigen Ist- und hohen Potenzialwerten.
 */
export function generateNewgens(db: Database, season: number, targetPool = 450): number {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;

  const active = (db
    .prepare('SELECT COUNT(*) n FROM driver_state WHERE season = ? AND retired = 0')
    .get(season) as { n: number }).n;
  const missing = targetPool - active;
  if (missing <= 0) return 0;

  const pools = db.prepare('SELECT * FROM driver_names').all() as {
    country: string;
    weight: number;
    first_names: string;
    last_names: string;
  }[];
  const totalWeight = pools.reduce((sum, pool) => sum + pool.weight, 0);

  // Potenzialverteilung der handgepflegten Startfahrer als Referenz. Newgens
  // werden daraus gezogen statt aus einer erfundenen Formel: Nur so bleibt die
  // Pyramide erhalten, die in drivers.csv steckt - mit ihrer breiten Mitte und
  // ihrer duennen Spitze. Eine frei gewaehlte Verteilung laesst die Welt ueber
  // die Jahre entweder verarmen oder ueberlaufen.
  const reference = (db
    .prepare('SELECT potential FROM drivers WHERE is_newgen = 0 ORDER BY potential')
    .all() as { potential: number }[]).map((row) => row.potential);

  const maxId = (db.prepare('SELECT MAX(driver_id) m FROM drivers').get() as { m: number }).m;
  const insertDriver = db.prepare(
    `INSERT INTO drivers (driver_id, first_name, last_name, country, birth_year,
       ${ATTRIBUTES.join(', ')}, potential, ego, adaptability, marketability, morale,
       superlicence_points, start_team_id, start_role, start_seat, contract_until_season, salary, pay_driver_budget, is_newgen)
     VALUES (@driver_id, @first_name, @last_name, @country, @birth_year,
       ${ATTRIBUTES.map((a) => `@${a}`).join(', ')}, @potential, @ego, @adaptability, @marketability, @morale,
       0, NULL, 'free_agent', NULL, NULL, 0, 0, 1)`,
  );
  const columns = [...ATTRIBUTES, 'potential', 'ego', 'adaptability', 'marketability'];
  const insertState = db.prepare(
    `INSERT INTO driver_state (driver_id, season, team_id, role, seat, contract_until, salary,
       pay_driver_budget, morale, superlicence_points, retired, ${columns.join(', ')})
     VALUES (@driver_id, @season, NULL, 'free_agent', NULL, NULL, 0, 0, @morale, 0, 0,
       ${columns.map((c) => `@${c}`).join(', ')})`,
  );

  let created = 0;
  const run = db.transaction(() => {
    for (let i = 0; i < missing; i += 1) {
      const rng = createRng(seedFrom(worldSeed, season, maxId + i, 11));
      let pick = rng() * totalWeight;
      let pool = pools[0];
      for (const candidate of pools) {
        pick -= candidate.weight;
        if (pick <= 0) {
          pool = candidate;
          break;
        }
      }
      const first = pool.first_names.split('|');
      const last = pool.last_names.split('|');

      // Newgens sind 17 bis 19. Der Startwert folgt der Alterskurve der
      // Startfahrer (0.79 des Potenzials mit 18), das Potenzial selbst der
      // Verteilung des Startfelds.
      const age = 17 + Math.floor(rng() * 3);
      const potential = Math.max(
        20,
        Math.min(100, reference[Math.floor(rng() * reference.length)] + Math.round(gaussian(rng) * 2)),
      );
      const base = Math.round(potential * (0.75 + (age - 17) * 0.03));

      const attributes: Record<string, number> = {};
      for (const key of ATTRIBUTES) {
        attributes[key] = Math.max(1, Math.min(100, Math.round(base + gaussian(rng) * 5)));
      }

      const driverId = maxId + i + 1;
      const row = {
        driver_id: driverId,
        first_name: first[Math.floor(rng() * first.length)],
        last_name: last[Math.floor(rng() * last.length)],
        country: pool.country,
        birth_year: 2026 + season - age,
        potential,
        ego: Math.round(25 + rng() * 50),
        adaptability: Math.round(55 + rng() * 35),
        marketability: Math.round(20 + rng() * 40),
        morale: Math.round(70 + rng() * 20),
        ...attributes,
      };
      insertDriver.run(row);
      insertState.run({ ...row, season });
      created += 1;
    }
  });

  run();
  return created;
}

/**
 * Fuellt frei gewordene Cockpits.
 *
 * Ein Cockpit ist frei, wenn der Vertrag ausgelaufen ist oder der Fahrer
 * zuruecktritt. Das Team nimmt den besten verfuegbaren Fahrer, der die
 * Superlizenz seiner Liga erfuellt - Abwerbung aus laufenden Vertraegen gibt
 * es nicht (getroffene Entscheidung).
 */
export function runMarket(db: Database, season: number): CareerSummary {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;

  const superlicenceMin = new Map(
    (db.prepare('SELECT tier, min_superlicence_points FROM licence_requirements').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.min_superlicence_points]),
  );
  const teams = db.prepare('SELECT team_id, tier FROM team_seasons WHERE season = ?').all(season) as {
    team_id: number;
    tier: number;
  }[];

  type StateRow = Record<string, number | string | null>;
  const core = ['pace', 'qualifying', 'braking', 'cornering'];
  const quality = (row: StateRow): number =>
    core.reduce((sum, key) => sum + (row[key] as number), 0) / core.length;

  const seated = db
    .prepare(
      "SELECT driver_id, team_id, seat, contract_until FROM driver_state WHERE season = ? AND role = 'race' AND retired = 0",
    )
    .all(season) as {
    driver_id: number;
    team_id: number;
    seat: number;
    contract_until: number | null;
  }[];

  // Fahrerbudget eines Teams: sein Anteil an der Ausschuettung, die es in
  // seiner *neuen* Liga zu erwarten hat. Bezugspunkt ist die Platzierung der
  // Vorsaison - der Meister einer Liga hat mehr fuer Fahrer uebrig als ihr
  // Letzter, und ein Aufsteiger rechnet bereits mit dem Geld der neuen Liga.
  const salaries = loadSalaryModel(db);
  const payoutRules = loadPayoutRules(db);
  const teamCounts = new Map(
    (db.prepare('SELECT tier, COUNT(*) n FROM team_seasons WHERE season = ? GROUP BY tier')
      .all(season) as Record<string, number>[]).map((row) => [row.tier, row.n]),
  );
  const priorRank = new Map(
    (db.prepare('SELECT team_id, final_rank FROM team_seasons WHERE season = ?').all(season - 1) as {
      team_id: number;
      final_rank: number | null;
    }[]).map((row) => [row.team_id, row.final_rank]),
  );

  const budgetFor = (teamId: number, tier: number): number => {
    const rule = payoutRules.get(tier);
    const count = teamCounts.get(tier) ?? 16;
    if (!rule) return salaries.seatBudget.get(tier) ?? 0;
    const rank = Math.min(count, priorRank.get(teamId) ?? Math.round((count + 1) / 2));
    return (payoutFor(rule, rank, count) * DRIVER_BUDGET_SHARE) / 2;
  };

  const summary: CareerSummary = {
    retired: 0,
    newgens: 0,
    signings: 0,
    promotedFromJunior: 0,
    unfilled: 0,
    overBudget: 0,
  };

  const run = db.transaction(() => {
    // Auslaufende Vertraege loesen: Der Fahrer wird Free Agent.
    const release = db.prepare(
      "UPDATE driver_state SET team_id = NULL, role = 'free_agent', seat = NULL, contract_until = NULL WHERE driver_id = ? AND season = ?",
    );
    // contract_until ist die letzte gedeckte Saison: Wer bis N unterschrieben
    // hat, faehrt N noch und ist erst zu N+1 frei.
    for (const row of seated) {
      if (row.contract_until === null || row.contract_until < season) {
        release.run(row.driver_id, season);
      }
    }

    // Freie Cockpits ermitteln und der Reihe nach besetzen - obere Ligen
    // zuerst, damit sie die besten Fahrer bekommen.
    const occupied = new Set(
      (db
        .prepare(
          "SELECT team_id || '|' || seat AS k FROM driver_state WHERE season = ? AND role = 'race' AND retired = 0",
        )
        .all(season) as { k: string }[]).map((row) => row.k),
    );

    const vacancies: { teamId: number; tier: number; seat: number }[] = [];
    for (const team of teams) {
      for (const seat of [1, 2]) {
        if (!occupied.has(`${team.team_id}|${seat}`)) {
          vacancies.push({ teamId: team.team_id, tier: team.tier, seat });
        }
      }
    }
    vacancies.sort((a, b) => a.tier - b.tier || a.teamId - b.teamId);

    const sign = db.prepare(
      `UPDATE driver_state SET team_id = ?, role = 'race', seat = ?, contract_until = ?, salary = ?
       WHERE driver_id = ? AND season = ?`,
    );
    const noteSigning = db.prepare(
      `INSERT OR REPLACE INTO driver_history (driver_id, season, event, tier, team_id, detail)
       VALUES (?, ?, 'signed', ?, ?, ?)`,
    );

    const selectCandidates = db.prepare(
      `SELECT * FROM driver_state
       WHERE season = ? AND retired = 0 AND role != 'race'
         AND superlicence_points >= ?
       ORDER BY (pace + qualifying + braking + cornering) DESC, driver_id`,
    );

    for (const vacancy of vacancies) {
      const required = superlicenceMin.get(vacancy.tier) ?? 0;
      // Kandidat ist jeder, der kein Stammcockpit hat - Free Agents ebenso wie
      // Junioren und Ersatzfahrer des eigenen oder eines fremden Teams.
      const candidates = selectCandidates.all(season, required) as StateRow[];

      if (candidates.length === 0) {
        summary.unfilled += 1;
        continue;
      }

      const budget = budgetFor(vacancy.teamId, vacancy.tier);
      // Was ein Fahrer das Team netto kostet. Ein Pay-Driver bringt sein Budget
      // mit und senkt damit den Preis - genau dafuer steht pay_driver_budget in
      // drivers.csv.
      const netCost = (row: StateRow): number =>
        askingSalary(salaries, quality(row), (row.superlicence_points as number) ?? 0) -
        ((row.pay_driver_budget as number) ?? 0);

      // Der beste Fahrer, den dieses Team bezahlen kann.
      let pick = candidates.find((row) => netCost(row) <= budget);
      if (!pick) {
        // Ein Team muss zwei Autos an den Start bringen. Findet sich niemand im
        // Rahmen, wird der guenstigste ueber Budget verpflichtet.
        pick = candidates.reduce((best, row) => (netCost(row) < netCost(best) ? row : best));
        summary.overBudget += 1;
      }

      const rng = createRng(seedFrom(worldSeed, season, vacancy.teamId, vacancy.seat, 13));
      const years = 1 + Math.floor(rng() * 4);
      const salary = askingSalary(
        salaries,
        quality(pick),
        (pick.superlicence_points as number) ?? 0,
      );
      sign.run(vacancy.teamId, vacancy.seat, season + years, salary, pick.driver_id as number, season);
      noteSigning.run(
        pick.driver_id as number,
        season,
        vacancy.tier,
        vacancy.teamId,
        `Vertrag bis ${season + years}, ${salary} EUR`,
      );
      summary.signings += 1;
      if (pick.role === 'junior') summary.promotedFromJunior += 1;
    }
  });

  run();
  return summary;
}
