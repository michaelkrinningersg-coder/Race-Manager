import type { Database } from 'sql.js';
import {
  calendar,
  lapRecords,
  raceAnalysis,
  raceResults,
  type LapRow,
  type WorldInfo,
} from '../data/queries';
import {
  escapeHtml,
  formatGap,
  formatLapTime,
  formatSeconds,
  withSeason,
} from '../ui/format';

/** Werte aus `race_results.status`, wie die Engine sie schreibt. */
const STATUS_LABEL: Record<string, string> = {
  classified: 'im Ziel',
  dnf: 'Ausfall',
  dns: 'nicht gestartet',
  dsq: 'disqualifiziert',
};

function isDnf(status: string): boolean {
  return status !== 'classified';
}

/**
 * Klartext fuer `lap_records.event`.
 *
 * Die Engine schreibt Schluessel, keine Saetze - sonst haengt die Sprache der
 * Oberflaeche in der Simulation fest. Uebersetzt wird deshalb hier.
 */
const EVENT_LABEL: Record<string, string> = {
  pit: 'Boxenstopp',
  pit_sc: 'Boxenstopp unter Safety Car',
  pit_weather: 'Reifenwechsel wegen Wetter',
  pit_damage: 'Boxenstopp wegen Schadens',
  safety_car: 'Safety Car',
  traffic: 'im Verkehr aufgehalten',
  overtake: 'Überholmanöver',
  collision: 'Kollision',
  collision_hit: 'in eine Kollision verwickelt',
  mistake: 'Fahrfehler',
  spin: 'Dreher',
  crash: 'Ausritt',
  track_limits: 'Strafe: Streckenbegrenzung',
  dnf: 'technischer Ausfall',
};

/** Ereignisse, die als Zwischenfall gelten - sie bekommen einen eigenen Punkt. */
const INCIDENT_EVENTS = new Set([
  'collision',
  'collision_hit',
  'mistake',
  'spin',
  'crash',
  'track_limits',
]);

/**
 * Ein Rennwochenende.
 *
 * Ergebnisse gibt es fuer jedes Rennen aller zwanzig Saisons. Den vollstaendigen
 * Rundenverlauf nur fuer die Schlusssaison: Zwanzig Saisons Tick-Sim waeren rund
 * 570.000 Zeilen und ueber 60 MB Auslieferdatei gewesen.
 */
export function renderRace(
  db: Database,
  season: number,
  tier: number,
  round: number,
  leg: number,
  info: WorldInfo,
): string {
  const races = calendar(db, season, tier);
  const race = races.find((entry) => entry.round === round);
  const results = raceResults(db, season, tier, round, leg);

  if (!race || !results.length) {
    return `<section class="panel">
      <h1>Rennen nicht gefunden</h1>
      <p class="muted">In Saison ${season}, Tier ${tier} gibt es keinen Lauf ${leg} in Runde ${round}.</p>
      <p><a href="${withSeason(`#/liga/${tier}`, season)}">Zurück zur Liga</a></p>
    </section>`;
  }

  const laps = lapRecords(db, season, tier, round, leg);
  const analysis = raceAnalysis(db, season, tier, round, leg);

  const winner = results[0];
  const poleSitter = results.find((entry) => entry.pole === 1);
  const fastest = results.find((entry) => entry.fastest_lap === 1);
  const dnfs = results.filter((entry) => isDnf(entry.status)).length;

  // Wetter und Safety Car stehen nicht in einer eigenen Tabelle, sondern in den
  // Runden: die gefahrenen Mischungen verraten die Naesse, das Ereignisfeld die
  // Neutralisierung.
  const wetLaps = laps.filter((lap) => lap.compound === 'I' || lap.compound === 'R').length;
  const safetyCarLaps = new Set(
    laps.filter((lap) => lap.event === 'safety_car' || lap.event === 'pit_sc').map((lap) => lap.lap),
  ).size;
  // Zwischenfaelle zaehlen nur einmal je Vorfall: Eine Kollision schreibt zwei
  // Zeilen, die des Angreifers und die des Getroffenen.
  const incidents = laps.filter(
    (lap) => lap.event && INCIDENT_EVENTS.has(lap.event) && lap.event !== 'collision_hit',
  ).length;
  const penalties = results.filter((entry) => entry.penalty_s > 0).length;
  const weatherLabel = laps.length
    ? laps.some((lap) => lap.compound === 'R')
      ? 'Regen'
      : wetLaps > 0
        ? 'wechselhaft'
        : 'trocken'
    : null;

  const resultRows = results
    .map((entry) => {
      const gained = entry.position ? entry.grid - entry.position : null;
      const move =
        gained === null
          ? ''
          : gained > 0
            ? `<span class="gain gain--up">+${gained}</span>`
            : gained < 0
              ? `<span class="gain gain--down">${gained}</span>`
              : '<span class="muted">0</span>';
      return `
      <tr class="${isDnf(entry.status) ? 'row--dnf' : ''}">
        <td class="num">${entry.position ?? '—'}</td>
        <td class="num muted">${entry.grid}</td>
        <td class="num">${move}</td>
        <td>
          <a class="team-link" href="${withSeason(`#/fahrer/${entry.driver_id}`, season)}">
            ${escapeHtml(entry.name)}
          </a>
          ${entry.pole ? '<span class="tag tag--pole">Pole</span>' : ''}
          ${entry.fastest_lap ? '<span class="tag tag--fl">Schnellste</span>' : ''}
          ${
            entry.penalty_s > 0
              ? `<span class="tag tag--penalty" title="Zeitstrafe, bereits in der Platzierung verrechnet">+${entry.penalty_s} s</span>`
              : ''
          }
        </td>
        <td>
          <a class="team-link" href="${withSeason(`#/team/${entry.team_id}`, season)}">
            <i class="chip" style="background:${escapeHtml(entry.colour_primary)}"></i>
            ${escapeHtml(entry.team)}
          </a>
        </td>
        <td>${escapeHtml(STATUS_LABEL[entry.status] ?? entry.status)}</td>
        <td class="num strong">${entry.points}</td>
      </tr>`;
    })
    .join('');

  const isSprintWeekend = race.legs > 1 && tier === 1;
  const legLinks =
    race.legs > 1
      ? `<div class="leg-switch">
           ${Array.from({ length: race.legs }, (_, index) => {
             const value = index + 1;
             const active = value === leg ? ' is-active' : '';
             const label = isSprintWeekend
               ? value === 1
                 ? 'Sprint'
                 : 'Hauptrennen'
               : `Lauf ${value}`;
             return `<a class="leg-switch__item${active}"
                        href="${withSeason(`#/rennen/${tier}/${round}/${value}`, season)}">${label}</a>`;
           }).join('')}
         </div>`
      : '';

  const previous = races.find((entry) => entry.round === round - 1);
  const next = races.find((entry) => entry.round === round + 1);

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">Tier ${tier} · Saison ${season} · Runde ${round}</span>
          <h1>${escapeHtml(race.track)}</h1>
          <p class="lead">
            ${escapeHtml(race.country)} · ${escapeHtml(race.archetype)} ·
            ${laps.length ? Math.max(...laps.map((lap) => lap.lap)) : race.laps} Runden
          </p>
        </div>
      </header>

      ${legLinks}

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${escapeHtml(winner.name.split(' ').pop() ?? '')}</span><span class="stat__label">Sieger</span></div>
        <div class="stat"><span class="stat__value">${escapeHtml(poleSitter?.name.split(' ').pop() ?? '—')}</span><span class="stat__label">Pole</span></div>
        <div class="stat"><span class="stat__value">${escapeHtml(fastest?.name.split(' ').pop() ?? '—')}</span><span class="stat__label">Schnellste Runde</span></div>
        <div class="stat"><span class="stat__value">${dnfs}</span><span class="stat__label">Ausfälle</span></div>
        ${
          weatherLabel
            ? `<div class="stat"><span class="stat__value">${weatherLabel}</span><span class="stat__label">Bedingungen</span></div>`
            : ''
        }
        ${
          safetyCarLaps > 0
            ? `<div class="stat"><span class="stat__value">${safetyCarLaps}</span><span class="stat__label">Runden Safety Car</span></div>`
            : ''
        }
        ${
          incidents > 0
            ? `<div class="stat"><span class="stat__value">${incidents}</span><span class="stat__label">Zwischenfälle</span></div>`
            : ''
        }
        ${
          penalties > 0
            ? `<div class="stat"><span class="stat__value">${penalties}</span><span class="stat__label">Zeitstrafen</span></div>`
            : ''
        }
      </div>

      <h2>Ergebnis</h2>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th class="num">Pos</th><th class="num">Start</th><th class="num">±</th>
              <th>Fahrer</th><th>Team</th><th>Status</th><th class="num">Punkte</th>
            </tr>
          </thead>
          <tbody>${resultRows}</tbody>
        </table>
      </div>

      ${renderLapChart(laps)}
      ${renderAnalysis(analysis)}
      ${
        !laps.length && info.tickSeason
          ? `<p class="muted small">
               Der Rundenverlauf existiert nur für Saison ${info.tickSeason}, Tier ${info.tickTier} –
               dort lief das Rennen rundenweise statt als Light-Sim. Alle übrigen Rennen liefern
               Ergebnisse, aber keinen Verlauf.
             </p>`
          : ''
      }

      <div class="nav-between">
        ${
          previous
            ? `<a href="${withSeason(`#/rennen/${tier}/${previous.round}/1`, season)}">← ${escapeHtml(previous.short_name)}</a>`
            : '<span class="muted">Saisonauftakt</span>'
        }
        ${
          next
            ? `<a href="${withSeason(`#/rennen/${tier}/${next.round}/1`, season)}">${escapeHtml(next.short_name)} →</a>`
            : '<span class="muted">Saisonfinale</span>'
        }
      </div>

      <p><a href="${withSeason(`#/liga/${tier}`, season)}">← Zurück zur Liga</a></p>
    </section>`;
}

/**
 * Positionsverlauf als SVG.
 *
 * Eine Linie je Fahrer, Runde auf der Waagerechten, Platz auf der Senkrechten -
 * die kompakteste Form, ein Rennen zu erzaehlen. Boxenstopps und Zwischenfaelle
 * stehen als Punkte darauf.
 */
function renderLapChart(laps: LapRow[]): string {
  if (!laps.length) return '';

  const byDriver = new Map<number, LapRow[]>();
  for (const lap of laps) {
    const list = byDriver.get(lap.driver_id);
    if (list) list.push(lap);
    else byDriver.set(lap.driver_id, [lap]);
  }

  // Die Distanz kommt aus den Daten, nicht aus der Nenn-Rundenzahl der Strecke:
  // Ein Sprint geht ueber ein Drittel, ein Kurzformat ueber knapp die Haelfte.
  // Mit tracks.laps gezeichnet endete die Kurve nach einem Drittel der Breite.
  const maxLap = Math.max(...laps.map((lap) => lap.lap));
  const maxPosition = Math.max(...laps.map((lap) => lap.position));
  const width = 900;
  const height = 340;
  const padLeft = 34;
  const padTop = 12;
  const plotWidth = width - padLeft - 12;
  const plotHeight = height - padTop - 26;

  const x = (lap: number): number => padLeft + ((lap - 1) / Math.max(1, maxLap - 1)) * plotWidth;
  const y = (position: number): number =>
    padTop + ((position - 1) / Math.max(1, maxPosition - 1)) * plotHeight;

  const lines = [...byDriver.entries()]
    .map(([driverId, entries]) => {
      const sorted = [...entries].sort((a, b) => a.lap - b.lap);
      const d = sorted.map((lap, index) => `${index === 0 ? 'M' : 'L'}${x(lap.lap).toFixed(1)},${y(lap.position).toFixed(1)}`).join(' ');
      const colour = sorted[0].colour_primary ?? '#8899aa';
      // Verkehr und Safety Car stehen in fast jeder Runde und wuerden die Linie
      // zur Punktkette machen. Gezeichnet wird nur, was das Rennen veraendert.
      const events = sorted
        .filter((lap) => lap.event && lap.event !== 'traffic' && lap.event !== 'safety_car')
        .map((lap) => {
          const incident = INCIDENT_EVENTS.has(lap.event ?? '');
          return `<circle cx="${x(lap.lap).toFixed(1)}" cy="${y(lap.position).toFixed(1)}"
                     r="${incident ? 4 : 3}"
                     fill="${incident ? '#ff6b57' : escapeHtml(colour)}"
                     stroke="#0b0e14" stroke-width="1">
               <title>Runde ${lap.lap}: ${escapeHtml(EVENT_LABEL[lap.event ?? ''] ?? lap.event ?? '')}</title>
             </circle>`;
        })
        .join('');
      return `<g class="lapline" data-driver="${driverId}">
                <path d="${d}" fill="none" stroke="${escapeHtml(colour)}" stroke-width="1.6"
                      stroke-linejoin="round" opacity="0.85">
                  <title>${escapeHtml(sorted[0].name)}</title>
                </path>
                ${events}
              </g>`;
    })
    .join('');

  const gridLines = Array.from({ length: maxPosition }, (_, index) => {
    const position = index + 1;
    if (position !== 1 && position % 5 !== 0) return '';
    return `<line x1="${padLeft}" x2="${width - 12}" y1="${y(position).toFixed(1)}" y2="${y(position).toFixed(1)}"
                  stroke="currentColor" opacity="0.12" />
            <text x="4" y="${(y(position) + 4).toFixed(1)}" class="chart__tick">${position}</text>`;
  }).join('');

  const lapTicks = Array.from({ length: maxLap }, (_, index) => {
    const lap = index + 1;
    if (lap !== 1 && lap !== maxLap && lap % 10 !== 0) return '';
    return `<text x="${x(lap).toFixed(1)}" y="${height - 8}" class="chart__tick chart__tick--x">${lap}</text>`;
  }).join('');

  return `
    <h2>Positionsverlauf</h2>
    <p class="muted small">
      Eine Linie je Fahrer über ${maxLap} Runden. Punkte markieren Boxenstopps und Reifenwechsel,
      rote Punkte Zwischenfälle: Fahrfehler, Dreher, Kollisionen, Ausritte und Strafen –
      Mouseover zeigt, was passiert ist.
    </p>
    <div class="chart-scroll">
      <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Positionsverlauf">
        ${gridLines}
        ${lapTicks}
        ${lines}
      </svg>
    </div>`;
}

/** Verlustrechnung aus der Tick-Sim: woran die Zeit tatsaechlich verloren ging. */
function renderAnalysis(analysis: ReturnType<typeof raceAnalysis>): string {
  if (!analysis.length) return '';

  // Bezugspunkt ist der Sieger, nicht die kuerzeste Gesamtzeit: Wer ausfaellt,
  // hat die wenigsten Millisekunden auf der Uhr und stuende sonst ganz vorn.
  const winnerTime = analysis.find((entry) => !isDnf(entry.status))?.total_ms ?? 0;

  const rows = analysis
    .map(
      (entry) => `
      <tr class="${isDnf(entry.status) ? 'row--dnf' : ''}">
        <td>${escapeHtml(entry.name)}${isDnf(entry.status) ? ' <span class="muted small">(Ausfall)</span>' : ''}</td>
        <td class="num">${entry.stops}</td>
        <td class="num">${formatLapTime(entry.best_lap_ms)}</td>
        <td class="num">${isDnf(entry.status) ? '—' : formatGap(entry.total_ms - winnerTime)}</td>
        <td class="num">${formatSeconds(entry.lost_tyres_s)}</td>
        <td class="num">${formatSeconds(entry.lost_fuel_s)}</td>
        <td class="num">${formatSeconds(entry.lost_traffic_s)}</td>
        <td class="num">${formatSeconds(entry.lost_pits_s)}</td>
        <td class="num ${entry.lost_incidents_s > 0 ? 'num--incident' : ''}">${formatSeconds(entry.lost_incidents_s)}</td>
      </tr>`,
    )
    .join('');

  return `
    <h2>Rennanalyse</h2>
    <p class="muted small">
      Wo die Zeit geblieben ist: Reifenabbau, Spritlast, Verkehr, Boxenstopps – und was der
      Fahrer selbst verschenkt hat (Konzept 12.6). Die Spalte „Fehler“ fasst Verbremser,
      Dreher, Kollisionen und die Folgeschäden bis zur Reparatur zusammen.
    </p>
    <div class="table-scroll">
      <table class="table table--compact">
        <thead>
          <tr>
            <th>Fahrer</th><th class="num">Stopps</th><th class="num">Beste Runde</th>
            <th class="num">Rückstand</th><th class="num">Reifen</th><th class="num">Sprit</th>
            <th class="num">Verkehr</th><th class="num">Box</th><th class="num">Fehler</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
