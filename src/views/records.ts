import type { Database } from 'sql.js';
import {
  careers,
  champions,
  leagues,
  teamRecords,
  trackRecords,
  type CareerRow,
  type WorldInfo,
} from '../data/queries';
import { escapeHtml, formatLapTime, formatNumber, withSeason } from '../ui/format';

/**
 * Rekorde und Bestenlisten (Konzept 19, M7 Feinschliff).
 *
 * ALLES IST NACH LIGA GETRENNT. Das ist die getroffene Entscheidung und der
 * eigentliche Inhalt dieser Seite: In einer Pyramide aus zehn Ligen ist eine
 * ungewichtete Gesamtzahl keine Auskunft. Der Fahrer mit den meisten Siegen
 * hatte 134 davon - ohne die Aufteilung bliebe offen, ob das eine grosse
 * Karriere war oder eine lange in der Unterklasse.
 *
 * Eine Umrechnung zwischen den Ligen gibt es bewusst nicht: Sie waere eine
 * erfundene Zahl, die jede Rangfolge bestimmt und die niemand nachpruefen kann.
 */

/** Wie viele Zeilen eine Bestenliste zeigt. */
const TOP_N = 10;

interface Column<T> {
  label: string;
  value: (row: T) => string;
  numeric?: boolean;
}

function table<T>(items: T[], columns: Column<T>[], empty: string): string {
  if (!items.length) return `<p class="muted small">${empty}</p>`;
  const head = columns
    .map((column) => `<th${column.numeric ? ' class="num"' : ''}>${column.label}</th>`)
    .join('');
  const body = items
    .map(
      (item) =>
        `<tr>${columns
          .map((column) => `<td${column.numeric ? ' class="num"' : ''}>${column.value(item)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<div class="table-scroll">
            <table class="table table--compact"><thead><tr>${head}</tr></thead>
            <tbody>${body}</tbody></table>
          </div>`;
}

function driverLink(season: number, driverId: number, name: string): string {
  return `<a class="team-link" href="${withSeason(`#/fahrer/${driverId}`, season)}">${escapeHtml(name)}</a>`;
}

/** Eine Bestenliste je Liga, sortiert nach der uebergebenen Kennzahl. */
function leaderboard(
  db: Database,
  season: number,
  tier: number,
  key: 'wins' | 'podiums' | 'poles' | 'points',
  label: string,
): string {
  const list = careers(db, tier)
    .filter((row) => row[key] > 0)
    .sort((a, b) => b[key] - a[key])
    .slice(0, TOP_N);

  return table<CareerRow>(
    list,
    [
      { label: 'Fahrer', value: (row) => driverLink(season, row.driver_id, row.name) },
      { label: 'Land', value: (row) => escapeHtml(row.country) },
      { label: 'Saisons', value: (row) => String(row.seasons), numeric: true },
      { label, value: (row) => formatNumber(row[key]), numeric: true },
    ],
    'In dieser Liga hat noch niemand eine Bestleistung erreicht.',
  );
}

export function renderRecords(db: Database, season: number, info: WorldInfo): string {
  const all = leagues(db);
  const allChampions = champions(db);
  const tracks = trackRecords(db);
  const teams = teamRecords(db)
    .filter((row) => row.titles > 0 || row.wins > 0)
    .sort((a, b) => b.titles - a.titles || b.wins - a.wins)
    .slice(0, 20);

  // Die Meisterliste ist nach Saison gruppiert: In jeder Saison wird in allen
  // zehn Ligen ein Titel vergeben, und die Zeile darueber erzaehlt den Jahrgang.
  const bySeason = new Map<number, typeof allChampions>();
  for (const entry of allChampions) {
    const list = bySeason.get(entry.season);
    if (list) list.push(entry);
    else bySeason.set(entry.season, [entry]);
  }

  const championBlocks = [...bySeason.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => {
      const cells = list
        .map(
          (entry) => `
        <li class="champion">
          <span class="champion__tier">T${entry.tier}</span>
          <span class="champion__name">${driverLink(season, entry.driver_id, entry.name)}</span>
          <span class="champion__team">
            <i class="chip" style="background:${escapeHtml(entry.colour_primary ?? '#889')}"></i>
            ${escapeHtml(entry.team ?? '—')}
          </span>
          <span class="champion__stat">${entry.wins} Siege · ${formatNumber(entry.points)} Pkt</span>
        </li>`,
        )
        .join('');
      return `<section class="champion-year">
                <h3>Saison ${year}</h3>
                <ul class="champion-list">${cells}</ul>
              </section>`;
    })
    .join('');

  const leagueSections = all
    .map(
      (league) => `
      <details class="record-league"${league.tier === 1 ? ' open' : ''}>
        <summary>
          <span class="tier-badge">Tier ${league.tier}</span>
          ${escapeHtml(league.name)}
        </summary>
        <div class="record-grid">
          <div><h4>Meiste Siege</h4>${leaderboard(db, season, league.tier, 'wins', 'Siege')}</div>
          <div><h4>Meiste Podestplätze</h4>${leaderboard(db, season, league.tier, 'podiums', 'Podeste')}</div>
          <div><h4>Meiste Poles</h4>${leaderboard(db, season, league.tier, 'poles', 'Poles')}</div>
          <div><h4>Meiste Punkte</h4>${leaderboard(db, season, league.tier, 'points', 'Punkte')}</div>
        </div>
      </details>`,
    )
    .join('');

  const trackRows = table(
    tracks,
    [
      { label: 'Strecke', value: (row) => escapeHtml(row.track) },
      { label: 'Zeit', value: (row) => formatLapTime(row.lap_time_ms), numeric: true },
      { label: 'Fahrer', value: (row) => driverLink(season, row.driver_id, row.name) },
      { label: 'Saison', value: (row) => String(row.season), numeric: true },
      { label: 'Runde', value: (row) => String(row.lap), numeric: true },
    ],
    'Es liegen keine Rundenzeiten vor.',
  );

  const teamRows = table(
    teams,
    [
      {
        label: 'Team',
        value: (row) =>
          `<a class="team-link" href="${withSeason(`#/team/${row.team_id}`, season)}">
             <i class="chip" style="background:${escapeHtml(row.colour_primary)}"></i>
             ${escapeHtml(row.team)}</a>`,
      },
      { label: 'Titel', value: (row) => String(row.titles), numeric: true },
      { label: 'Siege', value: (row) => formatNumber(row.wins), numeric: true },
      { label: 'Podeste', value: (row) => formatNumber(row.podiums), numeric: true },
      { label: 'Aufstiege', value: (row) => String(row.promotions), numeric: true },
      { label: 'Abstiege', value: (row) => String(row.relegations), numeric: true },
      {
        label: 'Beste Liga',
        value: (row) => `T${row.best_tier}`,
        numeric: true,
      },
    ],
    'Keine Teamdaten vorhanden.',
  );

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">Alle Ligen · ${info.seasons} Saisons</span>
          <h1>Rekorde</h1>
          <p class="lead">
            Bestleistungen aus ${info.seasons} simulierten Saisons – getrennt nach Liga.
          </p>
        </div>
      </header>

      <p class="muted small">
        Eine ligaübergreifende Gesamtwertung gibt es bewusst nicht. Zehn Siege in Tier 1 und
        zehn in Tier 10 sind nicht dieselbe Leistung, und jede Umrechnung zwischen beiden wäre
        eine erfundene Zahl, die die Rangfolge bestimmt, ohne überprüfbar zu sein.
      </p>

      <h2>Meister</h2>
      <p class="muted small">
        In jeder Saison wird in allen zehn Ligen ein Titel vergeben – ${allChampions.length}
        Meisterschaften über ${info.seasons} Saisons.
      </p>
      <div class="champion-years">${championBlocks}</div>

      <h2>Bestenlisten je Liga</h2>
      ${leagueSections}

      <h2>Streckenrekorde</h2>
      <p class="muted small">
        Schnellste je gefahrene Runde. Rundenzeiten entstehen nur in der rundenweise
        gerechneten Liga – die Rekorde stammen deshalb aus Saison ${info.tickSeason},
        Tier ${info.tickTier}, nicht aus allen ${info.seasons} Saisons.
      </p>
      ${trackRows}

      <h2>Teams</h2>
      <p class="muted small">
        Über alle Ligen summiert. Aufstiege und Abstiege zählen mit, weil in einer Pyramide
        beides zur Bilanz gehört.
      </p>
      ${teamRows}
    </section>`;
}
