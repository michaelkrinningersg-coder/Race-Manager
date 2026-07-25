/**
 * Dateiuebergreifende Konsistenzregeln.
 *
 * Die wichtigste steht in checkPromotionSymmetry: Wenn sich die Bewegungen an
 * einer Ligengrenze nicht decken, veraendern sich die Ligagroessen ueber die
 * Saisons hinweg schleichend - ein Fehler, der erst nach zehn simulierten
 * Saisons auffaellt. Deshalb harter Abbruch, keine Warnung.
 */

import { AERO_PART_KEYS, CORE_ATTRIBUTES, PART_KEYS } from './schema.js';
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

  for (const row of rows) {
    if (num(row, 'min_superlicence_points') > 0 && num(row, 'needs_engine_contract') !== 1) {
      findings.push(
        warning(
          'licence_requirements.csv',
          `Tier ${num(row, 'tier')}: Superlizenz-Mindestpunkte ohne Motorenvertragspflicht - ungewoehnliche Kombination`,
          row.line,
        ),
      );
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
    if (num(row, 'is_works_team') === 1 && row.values.engine_supplier_id === null) {
      findings.push(
        warning(
          'teams.csv',
          `'${row.values.name}': als Werksteam markiert, aber ohne engine_supplier_id (Vorwaertsreferenz noch leer)`,
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
  checkPartTypes(context, findings);
  checkTeams(context, findings);
  checkDrivers(context, findings);

  return findings;
}
