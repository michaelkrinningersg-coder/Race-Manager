/**
 * Auf- und Abstieg, Barrage, Lizenzpruefung (Konzept 4 und 5).
 *
 * Das Kernversprechen des Spiels. Die Reihenfolge am Saisonende ist
 * verbindlich (Konzept 13.2): Barrage, dann Auf-/Abstieg, dann Lizenzpruefung.
 * Erst danach steht fest, wer im Folgejahr wo faehrt.
 */

import type { Database } from './savegame.js';
import { createRng, seedFrom } from './rng.js';
import { loadTrackProfiles } from './scoring.js';
import { simulateWeekend, type Entry, type WeekendContext } from './lightsim.js';
import {
  derivedStaffCount,
  loadFacilityMinimums,
  loadLevels,
  prestigeSpans,
  relativePrestige,
} from './facilities.js';
import { checkLicence, type LicenceRequirement } from './licence.js';
import { licencePenalties } from './costcap.js';

export type Movement =
  | 'promoted'
  | 'promoted_barrage'
  | 'relegated'
  | 'relegated_barrage'
  | 'stay'
  | 'licence_denied'
  | 'licence_loss';

export interface MovementSummary {
  promoted: number;
  relegated: number;
  barrages: number;
  licenceDenied: number;
  licenceLoss: number;
}

interface Standing {
  teamId: number;
  name: string;
  tier: number;
  rank: number;
  points: number;
}

const DRIVER_KEYS = [
  'pace',
  'qualifying',
  'braking',
  'cornering',
  'car_control',
  'starts',
  'tyre_management',
  'consistency',
];

/** Baut die beiden Autos eines Teams, optional unter fremdem Reglementdeckel. */
function entriesFor(
  db: Database,
  season: number,
  teamId: number,
  caps: Record<string, number> | undefined,
): Entry[] {
  const parts: Record<string, number> = {};
  let reliability = 100;
  for (const row of db
    .prepare('SELECT part_key, performance, reliability FROM car_parts WHERE season = ? AND team_id = ?')
    .all(season, teamId) as Record<string, number>[]) {
    const key = row.part_key as unknown as string;
    // Die Barrage laeuft unter dem Reglement der unteren Liga: Das Auto des
    // hoeherklassigen Teams wird gekappt, nicht neu gebaut (Konzept 4.2).
    const cap = caps?.[`cap_${key}`];
    parts[key] = cap === undefined ? row.performance : Math.min(row.performance, cap);
    reliability = Math.min(reliability, row.reliability);
  }

  const drivers = db
    .prepare(
      `SELECT driver_id, ${DRIVER_KEYS.join(', ')} FROM driver_state
       WHERE season = ? AND team_id = ? AND role = 'race' AND retired = 0 ORDER BY seat`,
    )
    .all(season, teamId) as Record<string, number>[];

  return drivers.map((row) => ({
    driverId: row.driver_id,
    teamId,
    parts,
    attributes: Object.fromEntries(DRIVER_KEYS.map((key) => [key, row[key]])),
    reliability,
  }));
}

/**
 * Barrage-Event: zwei Laeufe auf neutraler Strecke, gemeinsame Wertung.
 * Bei Punktgleichheit entscheidet der bessere Startplatzschnitt des ersten
 * Laufs - die Umsetzung von `tiebreak_rule = quali_average`.
 */
function runBarrage(
  db: Database,
  season: number,
  boundaryTier: number,
  upperTeam: number,
  lowerTeam: number,
  worldSeed: number,
): { winner: number; loser: number; points: Map<number, number> } {
  const rule = db
    .prepare('SELECT * FROM promotion_rules WHERE tier = ? AND valid_from_season = 1')
    .get(boundaryTier) as Record<string, number | null>;
  const regulationTier = rule.barrage_regulation_tier as number;

  const caps = db
    .prepare('SELECT * FROM league_regulations WHERE tier = ? AND season = 1')
    .get(regulationTier) as Record<string, number>;

  const league = db.prepare('SELECT * FROM leagues WHERE tier = ?').get(regulationTier) as Record<
    string,
    number
  >;

  // Neutrale Strecke: ist keine gesetzt, waehlt der Seed deterministisch eine.
  const trackIds = (db.prepare('SELECT track_id FROM tracks ORDER BY track_id').all() as {
    track_id: number;
  }[]).map((row) => row.track_id);
  const rng = createRng(seedFrom(worldSeed, season, boundaryTier, 9999));
  const trackId =
    (rule.barrage_track_id as number | null) ?? trackIds[Math.floor(rng() * trackIds.length)];

  const profile = loadTrackProfiles(db).get(trackId);
  const track = db
    .prepare('SELECT overtaking_difficulty d, risk FROM tracks WHERE track_id = ?')
    .get(trackId) as { d: number; risk: number };

  const pointsTable = new Map<number, number>();
  for (const row of db
    .prepare('SELECT position, points FROM points_systems WHERE points_system_id = ?')
    .all(league.points_system_id) as Record<string, number>[]) {
    pointsTable.set(row.position, row.points);
  }

  const entries = [
    ...entriesFor(db, season, upperTeam, caps),
    ...entriesFor(db, season, lowerTeam, undefined),
  ];

  const context: WeekendContext = {
    worldSeed,
    season,
    // Eigener Rundenraum, damit die Barrage nie denselben Seed wie ein
    // regulaeres Rennwochenende bekommt.
    tier: 100 + boundaryTier,
    round: 1,
    profile: profile ?? [],
    overtakingDifficulty: track.d,
    dnfBaseRate: league.dnf_base_rate,
    risk: track.risk,
    legCount: (rule.barrage_leg_count as number) ?? 2,
    reverseGridTopN: 0,
    points: pointsTable,
    bonusPole: 0,
    bonusFastestLap: 0,
    fastestLapMaxPosition: 10,
  };

  const rows = simulateWeekend(entries, context);

  const points = new Map<number, number>([
    [upperTeam, 0],
    [lowerTeam, 0],
  ]);
  const gridSum = new Map<number, number>([
    [upperTeam, 0],
    [lowerTeam, 0],
  ]);
  for (const row of rows) {
    points.set(row.teamId, (points.get(row.teamId) ?? 0) + row.points);
    if (row.leg === 1) gridSum.set(row.teamId, (gridSum.get(row.teamId) ?? 0) + row.grid);
  }

  const upperPoints = points.get(upperTeam) ?? 0;
  const lowerPoints = points.get(lowerTeam) ?? 0;
  let winner: number;
  if (upperPoints !== lowerPoints) {
    winner = upperPoints > lowerPoints ? upperTeam : lowerTeam;
  } else {
    // Kleinerer Startplatzschnitt gewinnt.
    winner = (gridSum.get(upperTeam) ?? 0) <= (gridSum.get(lowerTeam) ?? 0) ? upperTeam : lowerTeam;
  }

  const insert = db.prepare(
    `INSERT INTO barrage_results (season, boundary_tier, track_id, team_id, from_tier, points, won)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(season, boundaryTier, trackId, upperTeam, boundaryTier, upperPoints, winner === upperTeam ? 1 : 0);
  insert.run(
    season,
    boundaryTier,
    trackId,
    lowerTeam,
    boundaryTier + 1,
    lowerPoints,
    winner === lowerTeam ? 1 : 0,
  );

  return { winner, loser: winner === upperTeam ? lowerTeam : upperTeam, points };
}

/**
 * Bestimmt alle Bewegungen einer Saison und schreibt sie nach
 * team_seasons.movement.
 */
export function resolveMovements(db: Database, season: number): MovementSummary {
  const worldSeed = (db.prepare('SELECT world_seed FROM game_state WHERE id = 1').get() as {
    world_seed: number;
  }).world_seed;

  const standings = (db
    .prepare(
      `SELECT ts.team_id AS teamId, t.name, ts.tier, ts.final_rank AS rank, ts.points
       FROM team_seasons ts JOIN teams t ON t.team_id = ts.team_id
       WHERE ts.season = ? ORDER BY ts.tier, ts.final_rank`,
    )
    .all(season) as Standing[]);

  const byTier = new Map<number, Standing[]>();
  for (const row of standings) {
    byTier.set(row.tier, [...(byTier.get(row.tier) ?? []), row]);
  }

  const requirements = new Map<number, LicenceRequirement>(
    (db.prepare('SELECT * FROM licence_requirements').all() as Record<string, number>[]).map(
      (row) => [
        row.tier,
        {
          tier: row.tier,
          minLiquidityPct: row.min_liquidity_pct,
          minWindtunnel: row.min_windtunnel_level,
          minDyno: row.min_dyno_level,
          minSimulator: row.min_simulator_level,
          minFactory: row.min_factory_level,
          minStaff: row.min_staff_count,
          needsEngineContract: row.needs_engine_contract === 1,
          minLicencePoints: row.min_licence_points,
        },
      ],
    ),
  );
  const costCaps = new Map(
    (db.prepare('SELECT tier, cost_cap FROM league_regulations WHERE season = 1').all() as Record<
      string,
      number
    >[]).map((row) => [row.tier, row.cost_cap]),
  );
  const minimums = loadFacilityMinimums(db);
  const spans = prestigeSpans(standings.map((s) => ({ teamId: s.teamId, tier: s.tier, prestige: 0 })));

  const teamMeta = new Map(
    (db.prepare('SELECT team_id, name, prestige, engine_supplier_id FROM teams').all() as Record<
      string,
      number | string | null
    >[]).map((row) => [row.team_id as number, row]),
  );
  // Prestigespanne der aktuellen Ligazugehoerigkeit, nicht der Startliga.
  const realSpans = prestigeSpans(
    standings.map((s) => ({
      teamId: s.teamId,
      tier: s.tier,
      prestige: (teamMeta.get(s.teamId)?.prestige as number) ?? 50,
    })),
  );
  void spans;

  const balances = new Map(
    (db.prepare('SELECT team_id, closing FROM team_finances WHERE season = ?').all(season) as Record<
      string,
      number
    >[]).map((row) => [row.team_id, row.closing]),
  );

  // Anlagenbestand der laufenden Saison. Seit Konzept 8.2 als echter Bestand
  // umgesetzt wird hier nichts mehr abgeleitet: Geprueft wird, was das Team
  // tatsaechlich besitzt und bezahlt. Nur die Belegschaftsstaerke haengt
  // weiterhin an Liga und Prestige - sie ist keine Anlage.
  const facilityLevels = loadLevels(db, season);

  // Lizenzpunktabzug aus einem Deckelverstoss derselben Saison (Konzept 9.3).
  // Der Grundstock von 12 Punkten steht bis M7 fest - abgezogen wird davon.
  const capPenalties = licencePenalties(db, season);

  const movement = new Map<number, Movement>();
  for (const row of standings) movement.set(row.teamId, 'stay');

  /** Ist ein Team fuer die Zielliga lizenzfaehig? */
  const eligible = (team: Standing, targetTier: number): boolean => {
    const requirement = requirements.get(targetTier);
    const meta = teamMeta.get(team.teamId);
    const minimum = minimums.get(team.tier);
    if (!requirement || !meta || !minimum) return true;

    const rel = relativePrestige((meta.prestige as number) ?? 50, realSpans.get(team.tier));
    const owned = facilityLevels.get(team.teamId) ?? new Map<string, number>();
    const verdict = checkLicence(
      {
        teamId: team.teamId,
        name: String(meta.name),
        balance: balances.get(team.teamId) ?? 0,
        facilities: {
          windtunnel: owned.get('windtunnel') ?? 0,
          dyno: owned.get('dyno') ?? 0,
          simulator: owned.get('simulator') ?? 0,
          factory: owned.get('factory') ?? 0,
          staff: derivedStaffCount(minimum, rel),
        },
        hasEngineContract: meta.engine_supplier_id !== null,
        licencePoints: Math.max(0, 12 - (capPenalties.get(team.teamId) ?? 0)),
      },
      requirement,
      costCaps.get(targetTier) ?? 0,
    );

    if (!verdict.granted) {
      // Ein Barrage-Sieger wird zweimal geprueft - einmal in der Aufstiegszone,
      // einmal nach gewonnener Barrage. REPLACE haelt den letzten Befund.
      db.prepare(
        `INSERT OR REPLACE INTO licence_denials (season, team_id, from_tier, to_tier, reasons)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(season, team.teamId, team.tier, targetTier, verdict.failures.join('; '));
    }
    return verdict.granted;
  };

  const summary: MovementSummary = {
    promoted: 0,
    relegated: 0,
    barrages: 0,
    licenceDenied: 0,
    licenceLoss: 0,
  };

  const rules = new Map(
    (db.prepare('SELECT * FROM promotion_rules WHERE valid_from_season = 1').all() as Record<
      string,
      number | string | null
    >[]).map((row) => [row.tier as number, row]),
  );

  const run = db.transaction(() => {
    for (let tier = 1; tier <= 9; tier += 1) {
      const upper = byTier.get(tier);
      const lower = byTier.get(tier + 1);
      const rule = rules.get(tier);
      const lowerRule = rules.get(tier + 1);
      if (!upper || !lower || !rule || !lowerRule) continue;

      const directUp = lowerRule.direct_up as number;

      // Aufsteiger der Reihe nach, mit Nachruecken bei verweigerter Lizenz
      // (Konzept 5.1). Die Suche endet zwei Plaetze hinter der Aufstiegszone -
      // ein Zwoelfter soll nicht aufsteigen, nur weil vor ihm alle scheitern.
      const searchWindow = directUp + 2;
      const promoted: Standing[] = [];
      for (const candidate of lower.slice(0, searchWindow)) {
        if (promoted.length >= directUp) break;
        if (eligible(candidate, tier)) {
          promoted.push(candidate);
          movement.set(candidate.teamId, 'promoted');
        } else if ((candidate.rank ?? 99) <= directUp) {
          // Nur wer die Aufstiegszone sportlich erreicht hat, bekommt den
          // Vermerk. Ein Fuenfter, der nur als Nachruecker geprueft wurde,
          // ist nicht an der Lizenz gescheitert.
          movement.set(candidate.teamId, 'licence_denied');
          summary.licenceDenied += 1;
        }
      }

      // Entscheidend fuer die Pyramide: Es steigen genau so viele ab, wie
      // aufsteigen. Findet sich kein lizenzfaehiger Aufsteiger, bleibt auch
      // der Absteiger oben - sonst schrumpfte die Liga Saison um Saison.
      const relegated = promoted.length === 0 ? [] : upper.slice(-promoted.length);
      for (const team of relegated) movement.set(team.teamId, 'relegated');

      summary.promoted += promoted.length;
      summary.relegated += relegated.length;

      // Barrage: Drittletzter oben gegen den Bestplatzierten unten, der weder
      // aufgestiegen noch an der Lizenz gescheitert ist.
      if ((rule.relegation_barrage_slots as number) > 0) {
        const upperCandidate = upper[upper.length - relegated.length - 1];
        const lowerCandidate = lower
          .slice(0, searchWindow + 1)
          .find((team) => movement.get(team.teamId) === 'stay');
        if (upperCandidate && lowerCandidate && movement.get(upperCandidate.teamId) === 'stay') {
          const outcome = runBarrage(
            db,
            season,
            tier,
            upperCandidate.teamId,
            lowerCandidate.teamId,
            worldSeed,
          );
          summary.barrages += 1;

          // Gewinnt der Aufsteiger, wird getauscht - wieder eins zu eins.
          if (outcome.winner === lowerCandidate.teamId && eligible(lowerCandidate, tier)) {
            movement.set(lowerCandidate.teamId, 'promoted_barrage');
            movement.set(upperCandidate.teamId, 'relegated_barrage');
            summary.promoted += 1;
            summary.relegated += 1;
          }
        }
      }
    }

    // Tier 10: Die letzten zwei verlieren die Lizenz. Nach der getroffenen
    // Entscheidung bleiben sie im Rookie Cup und starten dort neu - vermerkt,
    // aber nicht verschwunden.
    const bottom = byTier.get(10);
    const bottomRule = rules.get(10);
    if (bottom && bottomRule && bottomRule.relegation_mode === 'licence_loss') {
      for (const team of bottom.slice(-(bottomRule.direct_down as number))) {
        movement.set(team.teamId, 'licence_loss');
        summary.licenceLoss += 1;
      }
    }

    const update = db.prepare('UPDATE team_seasons SET movement = ? WHERE team_id = ? AND season = ?');
    for (const [teamId, value] of movement) update.run(value, teamId, season);
  });

  run();
  return summary;
}

/** Liga der Folgesaison aus Liga und Bewegung dieser Saison. */
export function nextTier(tier: number, movement: Movement | null): number {
  switch (movement) {
    case 'promoted':
    case 'promoted_barrage':
      return Math.max(1, tier - 1);
    case 'relegated':
    case 'relegated_barrage':
      return Math.min(10, tier + 1);
    default:
      return tier;
  }
}
