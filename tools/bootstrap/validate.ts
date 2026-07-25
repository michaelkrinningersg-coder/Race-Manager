/**
 * Dateiuebergreifende Konsistenzregeln.
 *
 * Die wichtigste steht in checkPromotionSymmetry: Wenn sich die Bewegungen an
 * einer Ligengrenze nicht decken, veraendern sich die Ligagroessen ueber die
 * Saisons hinweg schleichend - ein Fehler, der erst nach zehn simulierten
 * Saisons auffaellt. Deshalb harter Abbruch, keine Warnung.
 */

import {
  AERO_PART_KEYS,
  CORE_ATTRIBUTES,
  DRIVER_WEIGHT_KEYS,
  PART_KEYS,
  PART_WEIGHT_KEYS,
  TRACK_ARCHETYPES,
} from './schema.js';
import type { LoadedTable, Row } from './load.js';
import { error, warning, type Finding } from './report.js';

export interface ValidationContext {
  tables: Map<string, LoadedTable>;
  /** Im Teilbestandsmodus werden Vollstaendigkeitsfehler zu Warnungen. */
  partial: boolean;
  /** Saison, gegen die Altersgrenzen geprueft werden. */
  startYear: number;
}

function num(row: Row, name: string): number {
  const value = row.values[name];
  return typeof value === 'number' ? value : Number.NaN;
}

function rowsOf(context: ValidationContext, file: string): Row[] {
  return context.tables.get(file)?.rows ?? [];
}

/** Erzeugt je nach Modus einen Fehler oder eine Warnung. */
function stock(context: ValidationContext, file: string, message: string, line?: number): Finding {
  return context.partial ? warning(file, message, line) : error(file, message, line);
}

/** Leistungsband einer Liga: min = 87 - 6 x (tier - 1), Breite 8. */
export function performanceBand(tier: number): { min: number; max: number } {
  const min = 87 - 6 * (tier - 1);
  return { min, max: min + 8 };
}

/**
 * Sollzahl der Pay Driver je Liga (Datenmodell 15.4). Zusammen 113 der 334
 * Stammcockpits. Geprueft wird erst, wenn eine Liga vollstaendig besetzt ist -
 * waehrend der Datenpflege waere die Abweichung sonst nur Rauschen.
 */
const PAY_DRIVER_TARGET = new Map<number, number>([
  [1, 0],
  [2, 0],
  [3, 1],
  [4, 4],
  [5, 10],
  [6, 14],
  [7, 16],
  [8, 20],
  [9, 22],
  [10, 26],
]);

function checkLeagues(context: ValidationContext, findings: Finding[]): void {
  const leagues = rowsOf(context, 'leagues.csv');
  const systems = new Set(rowsOf(context, 'points_systems.csv').map((row) => num(row, 'points_system_id')));

  const tiers = leagues.map((row) => num(row, 'tier')).sort((a, b) => a - b);
  for (let tier = 1; tier <= 10; tier += 1) {
    if (!tiers.includes(tier)) {
      findings.push(error('leagues.csv', `Tier ${tier} fehlt - die Pyramide muss lueckenlos 1-10 sein`));
    }
  }

  let teamTotal = 0;
  let seatTotal = 0;
  for (const row of leagues) {
    teamTotal += num(row, 'team_count');
    seatTotal += num(row, 'team_count') * num(row, 'cars_per_team');

    const system = num(row, 'points_system_id');
    if (!systems.has(system)) {
      findings.push(
        error('leagues.csv', `points_system_id ${system} existiert nicht in points_systems.csv`, row.line),
      );
    }
  }

  if (leagues.length === 10 && teamTotal !== 167) {
    findings.push(error('leagues.csv', `Summe team_count ist ${teamTotal}, erwartet sind 167`));
  }
  if (leagues.length === 10 && seatTotal !== 334) {
    findings.push(error('leagues.csv', `Summe der Stammcockpits ist ${seatTotal}, erwartet sind 334`));
  }

  const byTier = [...leagues].sort((a, b) => num(a, 'tier') - num(b, 'tier'));
  for (let i = 1; i < byTier.length; i += 1) {
    if (num(byTier[i], 'dnf_base_rate') < num(byTier[i - 1], 'dnf_base_rate')) {
      findings.push(
        warning(
          'leagues.csv',
          `dnf_base_rate faellt von Tier ${num(byTier[i - 1], 'tier')} nach ${num(byTier[i], 'tier')} - untere Ligen sollten unzuverlaessiger sein`,
          byTier[i].line,
        ),
      );
    }
  }
}

function checkRegulations(context: ValidationContext, findings: Finding[]): void {
  const regulations = rowsOf(context, 'league_regulations.csv');
  const leagueTiers = new Set(rowsOf(context, 'leagues.csv').map((row) => num(row, 'tier')));

  const seasonOne = new Map<number, Row>();
  for (const row of regulations) {
    const tier = num(row, 'tier');
    if (!leagueTiers.has(tier)) {
      findings.push(error('league_regulations.csv', `Tier ${tier} existiert nicht in leagues.csv`, row.line));
    }
    if (num(row, 'season') === 1) seasonOne.set(tier, row);

    // Aero-Deckel duerfen den mechanischen Deckel derselben Liga nicht ueberschreiten.
    const chassis = num(row, 'cap_chassis');
    for (const key of AERO_PART_KEYS) {
      if (num(row, `cap_${key}`) > chassis) {
        findings.push(
          error(
            'league_regulations.csv',
            `cap_${key} (${num(row, `cap_${key}`)}) liegt ueber dem mechanischen Deckel cap_chassis (${chassis})`,
            row.line,
          ),
        );
      }
    }
  }

  for (const tier of leagueTiers) {
    if (!seasonOne.has(tier)) {
      findings.push(error('league_regulations.csv', `Tier ${tier} hat keine Zeile fuer season = 1`));
    }
  }

  const ordered = [...seasonOne.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
  for (let i = 1; i < ordered.length; i += 1) {
    const upper = ordered[i - 1];
    const lower = ordered[i];
    const upperTier = num(upper, 'tier');
    const lowerTier = num(lower, 'tier');

    for (const key of PART_KEYS) {
      if (num(lower, `cap_${key}`) > num(upper, `cap_${key}`)) {
        findings.push(
          error(
            'league_regulations.csv',
            `cap_${key}: Tier ${lowerTier} (${num(lower, `cap_${key}`)}) liegt ueber Tier ${upperTier} (${num(upper, `cap_${key}`)})`,
            lower.line,
          ),
        );
      }
    }
    if (num(lower, 'min_weight_kg') < num(upper, 'min_weight_kg')) {
      findings.push(
        error(
          'league_regulations.csv',
          `min_weight_kg muss mit dem Tier steigen: Tier ${lowerTier} unter Tier ${upperTier}`,
          lower.line,
        ),
      );
    }
    if (num(lower, 'cost_cap') > num(upper, 'cost_cap')) {
      findings.push(
        error(
          'league_regulations.csv',
          `cost_cap muss mit dem Tier fallen: Tier ${lowerTier} ueber Tier ${upperTier}`,
          lower.line,
        ),
      );
    }
    const lowerDays = lower.values.test_days;
    const upperDays = upper.values.test_days;
    if (typeof lowerDays === 'number' && typeof upperDays === 'number' && lowerDays > upperDays) {
      findings.push(
        warning(
          'league_regulations.csv',
          `test_days steigt von Tier ${upperTier} (${upperDays}) nach Tier ${lowerTier} (${lowerDays}) - erwartet ist fallend`,
          lower.line,
        ),
      );
    }
  }
}

function checkPromotionSymmetry(context: ValidationContext, findings: Finding[]): void {
  const rules = rowsOf(context, 'promotion_rules.csv');
  const byTier = new Map<number, Row>();
  for (const row of rules) {
    if (num(row, 'valid_from_season') === 1) byTier.set(num(row, 'tier'), row);
  }

  for (let tier = 1; tier <= 9; tier += 1) {
    const upper = byTier.get(tier);
    const lower = byTier.get(tier + 1);
    if (!upper || !lower) continue;

    if (num(upper, 'direct_down') !== num(lower, 'direct_up')) {
      findings.push(
        error(
          'promotion_rules.csv',
          `Ligengrenze ${tier}/${tier + 1}: direct_down (${num(upper, 'direct_down')}) und direct_up (${num(lower, 'direct_up')}) stimmen nicht ueberein - die Ligagroessen wuerden ueber die Saisons driften`,
          lower.line,
        ),
      );
    }
    if (num(upper, 'relegation_barrage_slots') !== num(lower, 'promotion_barrage_slots')) {
      findings.push(
        error(
          'promotion_rules.csv',
          `Ligengrenze ${tier}/${tier + 1}: Barrage-Plaetze stimmen nicht ueberein (${num(upper, 'relegation_barrage_slots')} gegen ${num(lower, 'promotion_barrage_slots')})`,
          lower.line,
        ),
      );
    }
    if (num(upper, 'barrage_regulation_tier') !== tier + 1) {
      findings.push(
        error(
          'promotion_rules.csv',
          `Tier ${tier}: barrage_regulation_tier muss ${tier + 1} sein (Barrage laeuft unter dem Reglement der unteren Liga)`,
          upper.line,
        ),
      );
    }
  }

  const top = byTier.get(1);
  if (top && (num(top, 'direct_up') !== 0 || num(top, 'promotion_barrage_slots') !== 0)) {
    findings.push(error('promotion_rules.csv', 'Aus Tier 1 kann nicht aufgestiegen werden', top.line));
  }
  const bottom = byTier.get(10);
  if (bottom) {
    if (num(bottom, 'relegation_barrage_slots') !== 0) {
      findings.push(
        error('promotion_rules.csv', 'Aus Tier 10 gibt es keine Abstiegsbarrage', bottom.line),
      );
    }
    if (bottom.values.relegation_mode !== 'licence_loss') {
      findings.push(
        error(
          'promotion_rules.csv',
          "Tier 10 muss relegation_mode = 'licence_loss' haben (Konzept 4.1)",
          bottom.line,
        ),
      );
    }
  }
}

function checkPointsSystems(context: ValidationContext, findings: Finding[]): void {
  const rows = rowsOf(context, 'points_systems.csv');
  const bySystem = new Map<number, Row[]>();
  for (const row of rows) {
    const id = num(row, 'points_system_id');
    bySystem.set(id, [...(bySystem.get(id) ?? []), row]);
  }

  const systemWide = ['system_name', 'bonus_pole', 'bonus_fastest_lap', 'fastest_lap_max_position', 'min_distance_pct'];

  for (const [id, entries] of bySystem) {
    const sorted = [...entries].sort((a, b) => num(a, 'position') - num(b, 'position'));

    sorted.forEach((row, index) => {
      if (num(row, 'position') !== index + 1) {
        findings.push(
          error(
            'points_systems.csv',
            `System ${id}: Position ${num(row, 'position')} - die Positionen muessen lueckenlos bei 1 beginnen`,
            row.line,
          ),
        );
      }
    });

    for (let i = 1; i < sorted.length; i += 1) {
      if (num(sorted[i], 'points') >= num(sorted[i - 1], 'points')) {
        findings.push(
          error(
            'points_systems.csv',
            `System ${id}: Punkte muessen streng fallen (Position ${num(sorted[i], 'position')} bekommt nicht weniger als die davor)`,
            sorted[i].line,
          ),
        );
      }
    }

    const first = sorted[0];
    for (const name of systemWide) {
      for (const row of sorted) {
        if (row.values[name] !== first.values[name]) {
          findings.push(
            error(
              'points_systems.csv',
              `System ${id}: '${name}' weicht ab (${String(row.values[name])} gegen ${String(first.values[name])}) - systemweite Spalten muessen identisch sein`,
              row.line,
            ),
          );
        }
      }
    }
  }
}

function checkLicences(context: ValidationContext, findings: Finding[]): void {
  const rows = [...rowsOf(context, 'licence_requirements.csv')].sort((a, b) => num(a, 'tier') - num(b, 'tier'));
  const falling = [
    'min_liquidity_pct',
    'min_windtunnel_level',
    'min_dyno_level',
    'min_simulator_level',
    'min_factory_level',
    'min_staff_count',
    'min_superlicence_points',
  ];

  for (let i = 1; i < rows.length; i += 1) {
    for (const name of falling) {
      if (num(rows[i], name) > num(rows[i - 1], name)) {
        findings.push(
          error(
            'licence_requirements.csv',
            `'${name}' steigt von Tier ${num(rows[i - 1], 'tier')} nach ${num(rows[i], 'tier')} - Anforderungen muessen nach unten hin fallen`,
            rows[i].line,
          ),
        );
      }
    }
  }

  // Superlizenz- und Motorenvertragspflicht haben bewusst verschiedene Grenzen:
  // Superlizenzpunkte bis Tier 4 (Konzept 7.3), Herstellervertrag bis Tier 3,
  // weil acht Hersteller mit je vier Kundenslots nicht weiter reichen. Eine
  // Kopplung der beiden waere eine Annahme ohne Grundlage.
}

function checkTyres(context: ValidationContext, findings: Finding[]): void {
  const dry = rowsOf(context, 'tyre_compounds.csv').filter((row) => num(row, 'wet_only') === 0);
  if (dry.length === 0) {
    findings.push(error('tyre_compounds.csv', 'Keine Trockenmischung vorhanden'));
    return;
  }
  // Mehr Grip muss mehr Verschleiss kosten - sonst gaebe es eine Mischung,
  // die jede andere schlaegt, und die Strategie waere entschieden, bevor das
  // Rennen beginnt.
  const byGrip = [...dry].sort((a, b) => num(b, 'grip') - num(a, 'grip'));
  for (let i = 1; i < byGrip.length; i += 1) {
    if (num(byGrip[i], 'wear_rate') >= num(byGrip[i - 1], 'wear_rate')) {
      findings.push(
        error(
          'tyre_compounds.csv',
          `'${String(byGrip[i].values.name)}' hat weniger Grip als '${String(byGrip[i - 1].values.name)}', verschleisst aber nicht langsamer - sie waere nie die richtige Wahl`,
          byGrip[i].line,
        ),
      );
    }
  }
}

function checkPayouts(context: ValidationContext, findings: Finding[]): void {
  const rows = [...rowsOf(context, 'league_payouts.csv')].sort((a, b) => num(a, 'tier') - num(b, 'tier'));
  const tiers = new Set(rowsOf(context, 'leagues.csv').map((row) => num(row, 'tier')));

  for (const row of rows) {
    if (!tiers.has(num(row, 'tier'))) {
      findings.push(error('league_payouts.csv', `Tier ${num(row, 'tier')} existiert nicht in leagues.csv`, row.line));
    }
    if (num(row, 'parachute_pct_2') > num(row, 'parachute_pct_1')) {
      findings.push(
        error(
          'league_payouts.csv',
          'Der Fallschirm der zweiten Saison darf nicht groesser sein als der der ersten (Konzept 4.3)',
          row.line,
        ),
      );
    }
  }

  // Die Ausschuettung muss mit dem Tier fallen - sonst waere ein Abstieg
  // finanziell attraktiv und die ganze Pyramidenlogik stuende auf dem Kopf.
  for (let i = 1; i < rows.length; i += 1) {
    for (const name of ['tv_fixed', 'tv_variable_top']) {
      if (num(rows[i], name) > num(rows[i - 1], name)) {
        findings.push(
          error(
            'league_payouts.csv',
            `'${name}' steigt von Tier ${num(rows[i - 1], 'tier')} nach ${num(rows[i], 'tier')} - Abstieg darf sich nie lohnen`,
            rows[i].line,
          ),
        );
      }
    }
  }
}

function checkPartTypes(context: ValidationContext, findings: Finding[]): void {
  const rows = rowsOf(context, 'car_part_types.csv');
  if (rows.length === 0) return;

  const sum = rows.reduce((total, row) => total + num(row, 'base_failure_rate'), 0);
  if (Math.abs(sum - 1) > 1e-6) {
    findings.push(
      error('car_part_types.csv', `Summe base_failure_rate ist ${sum.toFixed(4)}, erwartet ist genau 1.0`),
    );
  }

  const supplied = rows.filter((row) => num(row, 'supplied_by_engine') === 1).map((row) => row.values.part_key);
  if (supplied.length !== 2 || !supplied.includes('powertrain') || !supplied.includes('ers')) {
    findings.push(
      error(
        'car_part_types.csv',
        `supplied_by_engine muss genau fuer powertrain und ers gesetzt sein, gefunden: ${supplied.join(', ') || 'keine'}`,
      ),
    );
  }

  const aero = rows.filter((row) => AERO_PART_KEYS.includes(row.values.part_key as never));
  const carryOver = new Set(aero.map((row) => num(row, 'carry_over_default')));
  if (carryOver.size > 1) {
    findings.push(
      warning(
        'car_part_types.csv',
        `carry_over_default der drei Aero-Gruppen weicht ab (${[...carryOver].join(', ')}) - Konzept 5.3 behandelt sie einheitlich`,
      ),
    );
  }
}

function checkTeams(context: ValidationContext, findings: Finding[]): void {
  const teams = rowsOf(context, 'teams.csv');
  const leagues = rowsOf(context, 'leagues.csv');
  const expected = new Map(leagues.map((row) => [num(row, 'tier'), num(row, 'team_count')]));

  const perTier = new Map<number, number>();
  for (const row of teams) {
    const tier = num(row, 'start_tier');
    perTier.set(tier, (perTier.get(tier) ?? 0) + 1);

    // Wer in einer Liga antritt, hat sie erreicht - die beste je erreichte Liga
    // kann also nie schlechter sein als die aktuelle. Umgekehrt ist ein deutlich
    // besseres history_best_tier der gewollte 'gefallene Riese' und kein Befund.
    if (num(row, 'history_best_tier') > num(row, 'start_tier')) {
      findings.push(
        error(
          'teams.csv',
          `'${row.values.name}': history_best_tier ${num(row, 'history_best_tier')} ist schlechter als das Start-Tier ${num(row, 'start_tier')} - ein Team hat seine aktuelle Liga zwangslaeufig schon erreicht`,
          row.line,
        ),
      );
    }
    if (row.values.colour_primary === row.values.colour_secondary) {
      findings.push(
        warning('teams.csv', `'${row.values.name}': beide Farben sind identisch`, row.line),
      );
    }
    // Die Gegenrichtung - Hersteller ohne passendes Werksteam - prueft
    // checkEngineSuppliers.
    if (num(row, 'is_works_team') === 1 && row.values.engine_supplier_id === null) {
      findings.push(
        error(
          'teams.csv',
          `'${row.values.name}': als Werksteam markiert, aber ohne engine_supplier_id`,
          row.line,
        ),
      );
    }
  }

  for (const [tier, count] of expected) {
    const actual = perTier.get(tier) ?? 0;
    if (actual !== count) {
      findings.push(
        stock(context, 'teams.csv', `Tier ${tier}: ${actual} Teams im Bestand, erwartet sind ${count}`),
      );
    }
  }
}

function checkDrivers(context: ValidationContext, findings: Finding[]): void {
  const drivers = rowsOf(context, 'drivers.csv');
  const teams = rowsOf(context, 'teams.csv');
  const leagues = rowsOf(context, 'leagues.csv');
  const licences = rowsOf(context, 'licence_requirements.csv');

  const teamById = new Map(teams.map((row) => [num(row, 'team_id'), row]));
  const carsPerTeam = new Map(leagues.map((row) => [num(row, 'tier'), num(row, 'cars_per_team')]));
  const superlicenceMin = new Map(
    licences.map((row) => [num(row, 'tier'), num(row, 'min_superlicence_points')]),
  );

  const seats = new Map<string, number>();
  const raceCountPerTeam = new Map<number, number>();
  const racePerTier = new Map<number, number>();
  const payPerTier = new Map<number, number>();
  const coreRange = new Map<number, { min: number; max: number }>();
  let raceTotal = 0;

  for (const row of drivers) {
    const role = row.values.start_role;
    const teamId = row.values.start_team_id;

    if (role === 'free_agent') {
      if (teamId !== null) {
        findings.push(error('drivers.csv', 'free_agent darf kein start_team_id haben', row.line));
      }
    } else if (teamId === null) {
      findings.push(error('drivers.csv', `start_role '${String(role)}' verlangt ein start_team_id`, row.line));
    }

    const age = context.startYear - num(row, 'birth_year');
    if (age < 16 || age > 45) {
      findings.push(error('drivers.csv', `Alter ${age} liegt ausserhalb von 16-45`, row.line));
    }

    // potential deckelt die Kernwerte, nicht die Erfahrungswerte: feedback,
    // tyre_management und racecraft wachsen laut Konzept 7.2 auch dann noch,
    // wenn pace und qualifying laengst erodieren. Ein Routinier mit feedback 81
    // und potential 71 ist deshalb kein Fehler.
    const bestCore = Math.max(...CORE_ATTRIBUTES.map((name) => num(row, name)));
    if (num(row, 'potential') < bestCore) {
      findings.push(
        warning(
          'drivers.csv',
          `potential ${num(row, 'potential')} liegt unter dem hoechsten Kernwert ${bestCore} - Spaetentwickler oder Tippfehler?`,
          row.line,
        ),
      );
    }

    if (num(row, 'pay_driver_budget') > 0 && num(row, 'salary') > 0) {
      findings.push(
        error(
          'drivers.csv',
          'Ein Fahrer bringt Geld mit oder bekommt welches, nicht beides (pay_driver_budget und salary gesetzt)',
          row.line,
        ),
      );
    }

    if (typeof teamId !== 'number') continue;
    const team = teamById.get(teamId);
    if (!team) {
      findings.push(error('drivers.csv', `start_team_id ${teamId} existiert nicht in teams.csv`, row.line));
      continue;
    }

    const tier = num(team, 'start_tier');

    if (role === 'race') {
      raceTotal += 1;
      raceCountPerTeam.set(teamId, (raceCountPerTeam.get(teamId) ?? 0) + 1);
      racePerTier.set(tier, (racePerTier.get(tier) ?? 0) + 1);
      if (num(row, 'pay_driver_budget') > 0) {
        payPerTier.set(tier, (payPerTier.get(tier) ?? 0) + 1);
      }

      const seat = row.values.start_seat;
      if (typeof seat !== 'number') {
        findings.push(error('drivers.csv', "start_role 'race' verlangt ein start_seat", row.line));
      } else {
        const key = `${teamId}|${seat}`;
        const first = seats.get(key);
        if (first !== undefined) {
          findings.push(
            error(
              'drivers.csv',
              `Cockpit ${seat} bei Team ${teamId} ist doppelt besetzt (bereits in Zeile ${first})`,
              row.line,
            ),
          );
        } else {
          seats.set(key, row.line);
        }
      }

      const band = performanceBand(tier);
      const core = CORE_ATTRIBUTES.reduce((total, name) => total + num(row, name), 0) / CORE_ATTRIBUTES.length;
      const range = coreRange.get(tier);
      coreRange.set(tier, {
        min: Math.min(range?.min ?? core, core),
        max: Math.max(range?.max ?? core, core),
      });
      if (core < band.min || core > band.max) {
        findings.push(
          warning(
            'drivers.csv',
            `Kernschnitt ${core.toFixed(2)} liegt ausserhalb des Bands fuer Tier ${tier} (${band.min}-${band.max})`,
            row.line,
          ),
        );
      }
      if (num(row, 'pay_driver_budget') > 0) {
        const lowerThird = band.min + (band.max - band.min) / 3;
        if (core > lowerThird) {
          findings.push(
            warning(
              'drivers.csv',
              `Pay Driver mit Kernschnitt ${core.toFixed(2)} liegt ueber dem unteren Drittel (bis ${lowerThird.toFixed(2)}) seines Ligabands`,
              row.line,
            ),
          );
        }
      }

      const required = superlicenceMin.get(tier) ?? 0;
      if (num(row, 'superlicence_points') < required) {
        findings.push(
          error(
            'drivers.csv',
            `Superlizenzpunkte ${num(row, 'superlicence_points')} unter der Anforderung von Tier ${tier} (${required})`,
            row.line,
          ),
        );
      }
    }
  }

  for (const [teamId, team] of teamById) {
    const tier = num(team, 'start_tier');
    const required = carsPerTeam.get(tier) ?? 2;
    const actual = raceCountPerTeam.get(teamId) ?? 0;
    if (actual !== required) {
      findings.push(
        stock(
          context,
          'drivers.csv',
          `Team ${teamId} ('${String(team.values.name)}') hat ${actual} Stammfahrer, Tier ${tier} verlangt ${required}`,
          team.line,
        ),
      );
    }
  }

  if (raceTotal !== 334) {
    findings.push(
      stock(context, 'drivers.csv', `${raceTotal} Stammfahrer im Bestand, erwartet sind 334`),
    );
  }

  const fullyStaffed = new Set<number>();
  for (const league of leagues) {
    const tier = num(league, 'tier');
    const seatCount = num(league, 'team_count') * num(league, 'cars_per_team');
    // Erst bei voll besetzter Liga aussagekraeftig.
    if ((racePerTier.get(tier) ?? 0) !== seatCount) continue;
    fullyStaffed.add(tier);

    const target = PAY_DRIVER_TARGET.get(tier);
    const actual = payPerTier.get(tier) ?? 0;
    if (target !== undefined && actual !== target) {
      findings.push(
        warning(
          'drivers.csv',
          `Tier ${tier}: ${actual} Pay Driver, die Verteilungsvorgabe nennt ${target} (Datenmodell 15.4)`,
        ),
      );
    }
  }

  // Die Baender ueberlappen sich laut Datenmodell 15.2 um ein Viertel - der beste
  // Fahrer einer Liga soll ueber dem schwaechsten der naechsthoeheren liegen.
  // Ein Bestand, der die Ueberlappung nicht ausnutzt, erfuellt jedes einzelne
  // Band und laesst den Fahrermarkt zwischen den Ligen trotzdem austrocknen.
  for (let tier = 1; tier <= 9; tier += 1) {
    if (!fullyStaffed.has(tier) || !fullyStaffed.has(tier + 1)) continue;
    const upper = coreRange.get(tier);
    const lower = coreRange.get(tier + 1);
    if (!upper || !lower) continue;
    if (lower.max <= upper.min) {
      findings.push(
        warning(
          'drivers.csv',
          `Ligengrenze ${tier}/${tier + 1}: bester Fahrer aus Tier ${tier + 1} (${lower.max.toFixed(2)}) liegt nicht ueber dem schwaechsten aus Tier ${tier} (${upper.min.toFixed(2)}) - die Baender ueberlappen sich auf dem Papier, der Bestand nutzt es nicht`,
        ),
      );
    }
  }
}

/**
 * Gewichtsprofile: je Zeile muessen die neun Bauteil- und die sechs
 * Fahrergewichte jeweils auf 1.0 summieren, je Strecke bzw. Archetyp die drei
 * sector_share. Ohne diese Pruefung verschieben sich Rundenzeiten
 * systematisch, ohne dass eine einzelne Zahl falsch aussieht.
 */
function checkWeightProfiles(context: ValidationContext, findings: Finding[]): void {
  const archetypes = rowsOf(context, 'track_archetype_weights.csv');
  const overrides = rowsOf(context, 'track_sector_weights.csv');
  const trackIds = new Set(rowsOf(context, 'tracks.csv').map((row) => num(row, 'track_id')));

  const sumOf = (row: Row, keys: readonly string[]): number =>
    keys.reduce((total, name) => total + num(row, name), 0);

  for (const [file, rows] of [
    ['track_archetype_weights.csv', archetypes],
    ['track_sector_weights.csv', overrides],
  ] as const) {
    for (const row of rows) {
      const parts = sumOf(row, PART_WEIGHT_KEYS);
      if (Math.abs(parts - 1) > 1e-6) {
        findings.push(
          error(file, `Summe der Bauteilgewichte ist ${parts.toFixed(4)}, erwartet ist 1.0`, row.line),
        );
      }
      const drivers = sumOf(row, DRIVER_WEIGHT_KEYS);
      if (Math.abs(drivers - 1) > 1e-6) {
        findings.push(
          error(file, `Summe der Fahrergewichte ist ${drivers.toFixed(4)}, erwartet ist 1.0`, row.line),
        );
      }
    }
  }

  // Jeder Archetyp braucht alle drei Sektoren, sonst faellt eine Strecke
  // beim Aufloesen ins Leere.
  const perArchetype = new Map<string, Row[]>();
  for (const row of archetypes) {
    const key = String(row.values.archetype);
    perArchetype.set(key, [...(perArchetype.get(key) ?? []), row]);
  }
  for (const key of TRACK_ARCHETYPES) {
    const rows = perArchetype.get(key) ?? [];
    if (rows.length !== 3) {
      findings.push(
        error('track_archetype_weights.csv', `Archetyp '${key}' hat ${rows.length} Sektoren, erwartet sind 3`),
      );
      continue;
    }
    const share = rows.reduce((total, row) => total + num(row, 'sector_share'), 0);
    if (Math.abs(share - 1) > 1e-6) {
      findings.push(
        error(
          'track_archetype_weights.csv',
          `Archetyp '${key}': Summe sector_share ist ${share.toFixed(4)}, erwartet ist 1.0`,
        ),
      );
    }
  }

  // Eine Strecke mit Abweichungen muss alle drei Sektoren setzen - sonst
  // mischten sich Archetyp- und Streckenanteile und die Summe stimmte nicht mehr.
  const perTrack = new Map<number, Row[]>();
  for (const row of overrides) {
    const id = num(row, 'track_id');
    if (!trackIds.has(id)) {
      findings.push(
        error('track_sector_weights.csv', `track_id ${id} existiert nicht in tracks.csv`, row.line),
      );
      continue;
    }
    perTrack.set(id, [...(perTrack.get(id) ?? []), row]);
  }
  for (const [id, rows] of perTrack) {
    if (rows.length !== 3) {
      findings.push(
        error(
          'track_sector_weights.csv',
          `Strecke ${id} ueberschreibt ${rows.length} von 3 Sektoren - entweder alle drei oder keinen`,
          rows[0].line,
        ),
      );
      continue;
    }
    const share = rows.reduce((total, row) => total + num(row, 'sector_share'), 0);
    if (Math.abs(share - 1) > 1e-6) {
      findings.push(
        error(
          'track_sector_weights.csv',
          `Strecke ${id}: Summe sector_share ist ${share.toFixed(4)}, erwartet ist 1.0`,
          rows[0].line,
        ),
      );
    }
  }
}

function checkCalendar(context: ValidationContext, findings: Finding[]): void {
  const calendar = rowsOf(context, 'calendar.csv');
  const leagues = rowsOf(context, 'leagues.csv');
  const trackIds = new Set(rowsOf(context, 'tracks.csv').map((row) => num(row, 'track_id')));
  const formatIds = new Set(
    rowsOf(context, 'race_weekend_formats.csv').map((row) => num(row, 'format_id')),
  );

  const raceCount = new Map(leagues.map((row) => [num(row, 'tier'), num(row, 'race_count')]));
  const leagueFormat = new Map(
    leagues.map((row) => [num(row, 'tier'), row.values.weekend_format_id]),
  );

  // leagues.weekend_format_id war bis zu dieser Datei-Runde eine
  // Vorwaertsreferenz - jetzt existiert das Ziel und wird scharf geprueft.
  for (const league of leagues) {
    const format = league.values.weekend_format_id;
    if (typeof format === 'number' && !formatIds.has(format)) {
      findings.push(
        error(
          'leagues.csv',
          `weekend_format_id ${format} existiert nicht in race_weekend_formats.csv`,
          league.line,
        ),
      );
    }
  }

  const roundsPerTier = new Map<number, number>();
  for (const row of calendar) {
    const tier = num(row, 'tier');
    roundsPerTier.set(tier, (roundsPerTier.get(tier) ?? 0) + 1);

    if (!raceCount.has(tier)) {
      findings.push(error('calendar.csv', `Tier ${tier} existiert nicht in leagues.csv`, row.line));
    }
    if (!trackIds.has(num(row, 'track_id'))) {
      findings.push(
        error('calendar.csv', `track_id ${num(row, 'track_id')} existiert nicht in tracks.csv`, row.line),
      );
    }
    if (!formatIds.has(num(row, 'format_id'))) {
      findings.push(
        error(
          'calendar.csv',
          `format_id ${num(row, 'format_id')} existiert nicht in race_weekend_formats.csv`,
          row.line,
        ),
      );
    }

    const week = num(row, 'week');
    if (week < 8 || week > 46) {
      findings.push(
        warning(
          'calendar.csv',
          `Woche ${week} liegt ausserhalb des Rennfensters 8-46 (Konzept 13.1)`,
          row.line,
        ),
      );
    }

    const expectedFormat = leagueFormat.get(tier);
    if (typeof expectedFormat === 'number' && num(row, 'format_id') !== expectedFormat) {
      findings.push(
        warning(
          'calendar.csv',
          `Lauf weicht vom Ligaformat ab (${num(row, 'format_id')} statt ${expectedFormat}) - beabsichtigtes Sonderformat?`,
          row.line,
        ),
      );
    }
  }

  for (const [tier, expected] of raceCount) {
    const actual = roundsPerTier.get(tier) ?? 0;
    if (actual !== expected) {
      findings.push(
        stock(context, 'calendar.csv', `Tier ${tier}: ${actual} Laeufe im Kalender, leagues.csv nennt ${expected}`),
      );
    }
  }
}

function checkEngineSuppliers(context: ValidationContext, findings: Finding[]): void {
  const suppliers = rowsOf(context, 'engine_suppliers.csv');
  const teams = rowsOf(context, 'teams.csv');
  const licences = rowsOf(context, 'licence_requirements.csv');

  const teamById = new Map(teams.map((row) => [num(row, 'team_id'), row]));
  const supplierById = new Map(suppliers.map((row) => [num(row, 'supplier_id'), row]));
  const needsContract = new Map(
    licences.map((row) => [num(row, 'tier'), num(row, 'needs_engine_contract') === 1]),
  );

  for (const supplier of suppliers) {
    const teamId = num(supplier, 'works_team_id');
    const team = teamById.get(teamId);
    if (!team) {
      findings.push(
        error('engine_suppliers.csv', `works_team_id ${teamId} existiert nicht in teams.csv`, supplier.line),
      );
      continue;
    }
    if (num(team, 'is_works_team') !== 1) {
      findings.push(
        error(
          'engine_suppliers.csv',
          `'${String(team.values.name)}' ist als Werksteam eingetragen, hat in teams.csv aber is_works_team = 0`,
          supplier.line,
        ),
      );
    }
    if (num(team, 'engine_supplier_id') !== num(supplier, 'supplier_id')) {
      findings.push(
        error(
          'engine_suppliers.csv',
          `Werksteam '${String(team.values.name)}' verweist auf einen anderen Hersteller`,
          supplier.line,
        ),
      );
    }
    if (num(supplier, 'customer_tuning_pct') > num(supplier, 'works_tuning_pct')) {
      findings.push(
        warning(
          'engine_suppliers.csv',
          'Kundenteams haben mehr Tuning-Spielraum als das Werksteam (Konzept 6.6 sieht es umgekehrt)',
          supplier.line,
        ),
      );
    }
  }

  // Belegte Kundenslots je Hersteller - das Werksteam zaehlt nicht dagegen.
  const customers = new Map<number, number>();
  for (const team of teams) {
    const supplierId = team.values.engine_supplier_id;
    const tier = num(team, 'start_tier');

    if (typeof supplierId !== 'number') {
      if (needsContract.get(tier)) {
        findings.push(
          error(
            'teams.csv',
            `'${String(team.values.name)}': Tier ${tier} verlangt einen Motorenvertrag, engine_supplier_id ist leer`,
            team.line,
          ),
        );
      }
      continue;
    }

    const supplier = supplierById.get(supplierId);
    if (!supplier) {
      findings.push(
        error('teams.csv', `engine_supplier_id ${supplierId} existiert nicht in engine_suppliers.csv`, team.line),
      );
      continue;
    }
    if (num(supplier, 'works_team_id') !== num(team, 'team_id')) {
      customers.set(supplierId, (customers.get(supplierId) ?? 0) + 1);
    }
  }

  // Ein Motor muss zur Liga passen, in der er faehrt. Ein Tier-1-Team mit
  // einem Antrieb, der weit unter dem Ligadeckel liegt, ist chancenlos - und
  // faellt in den Ergebnissen erst nach einer durchsimulierten Saison auf.
  const caps = new Map<number, number>();
  for (const row of rowsOf(context, 'league_regulations.csv')) {
    if (num(row, 'season') === 1) caps.set(num(row, 'tier'), num(row, 'cap_powertrain'));
  }
  for (const team of teams) {
    const supplierId = team.values.engine_supplier_id;
    if (typeof supplierId !== 'number') continue;
    const supplier = supplierById.get(supplierId);
    const cap = caps.get(num(team, 'start_tier'));
    if (!supplier || cap === undefined) continue;

    const isWorks = num(supplier, 'works_team_id') === num(team, 'team_id');
    const delivered =
      num(supplier, 'powertrain_performance') - (isWorks ? 0 : num(supplier, 'customer_spec_offset'));
    if (delivered < cap * 0.75) {
      findings.push(
        warning(
          'teams.csv',
          `'${String(team.values.name)}': gelieferter Antrieb ${delivered} liegt unter 75 % des Ligadeckels ${cap} - in dieser Liga chancenlos`,
          team.line,
        ),
      );
    }
  }

  for (const supplier of suppliers) {
    const id = num(supplier, 'supplier_id');
    const used = customers.get(id) ?? 0;
    const slots = num(supplier, 'customer_slots');
    if (used > slots) {
      findings.push(
        error(
          'teams.csv',
          `'${String(supplier.values.name)}' beliefert ${used} Kundenteams, hat aber nur ${slots} Slots`,
          supplier.line,
        ),
      );
    }
  }
}

function checkExpectedRowCounts(context: ValidationContext, findings: Finding[]): void {
  for (const [, table] of context.tables) {
    const expected = table.spec.expectedRows;
    if (expected === undefined) continue;
    if (table.rows.length !== expected) {
      findings.push(
        stock(
          context,
          table.spec.file,
          `${table.rows.length} Zeilen im Bestand, erwartet sind ${expected}`,
        ),
      );
    }
  }
}

export function validateWorld(context: ValidationContext): Finding[] {
  const findings: Finding[] = [];

  checkExpectedRowCounts(context, findings);
  checkLeagues(context, findings);
  checkRegulations(context, findings);
  checkPromotionSymmetry(context, findings);
  checkPointsSystems(context, findings);
  checkLicences(context, findings);
  checkPayouts(context, findings);
  checkTyres(context, findings);
  checkPartTypes(context, findings);
  checkTeams(context, findings);
  checkEngineSuppliers(context, findings);
  checkWeightProfiles(context, findings);
  checkCalendar(context, findings);
  checkDrivers(context, findings);

  return findings;
}
