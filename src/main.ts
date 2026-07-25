import './style.css';
import type { Database } from 'sql.js';
import { openWorld, type LoadProgress } from './data/db';
import { leagues, worldInfo, type League, type WorldInfo } from './data/queries';
import { renderCareer } from './views/career';
import { renderConcept } from './views/concept';
import { renderDriver } from './views/driver';
import { renderEditor } from './views/editor';
import { renderHall } from './views/hall';
import { renderLeague } from './views/league';
import { renderPyramid } from './views/pyramid';
import { renderRecords } from './views/records';
import { renderRace } from './views/race';
import { renderTeam } from './views/team';
import { escapeHtml, withSeason } from './ui/format';

/**
 * Einstiegspunkt der Webansicht.
 *
 * Anders als im Konzept-Prototyp entsteht die Welt hier nicht im Browser,
 * sondern wird als fertige SQLite-Datei geladen (siehe data/db.ts). Rendern ist
 * deshalb erst moeglich, wenn die Datei da ist - der Router wartet einmal auf
 * die Datenbank und laeuft danach synchron.
 */

interface Context {
  db: Database;
  info: WorldInfo;
  leagues: League[];
  season: number;
}

type Route =
  | { view: 'pyramid' }
  | { view: 'league'; tier: number }
  | { view: 'team'; teamId: number }
  | { view: 'driver'; driverId: number }
  | { view: 'race'; tier: number; round: number; leg: number }
  | { view: 'records' }
  | { view: 'editor'; file: string }
  | { view: 'career' }
  | { view: 'hall' }
  | { view: 'concept' };

function parseHash(hash: string): { parts: string[]; query: URLSearchParams } {
  const raw = hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  return {
    parts: path.split('/').filter(Boolean),
    query: new URLSearchParams(search),
  };
}

function parseRoute(parts: string[]): Route {
  const [head, a, b, c] = parts;
  if (head === 'liga' && a) {
    const tier = Number(a);
    if (Number.isInteger(tier) && tier >= 1 && tier <= 10) return { view: 'league', tier };
  }
  if (head === 'team' && a) {
    const teamId = Number(a);
    if (Number.isInteger(teamId)) return { view: 'team', teamId };
  }
  if (head === 'fahrer' && a) {
    const driverId = Number(a);
    if (Number.isInteger(driverId)) return { view: 'driver', driverId };
  }
  if (head === 'rennen' && a && b) {
    const tier = Number(a);
    const round = Number(b);
    const leg = Number(c ?? 1);
    if (Number.isInteger(tier) && Number.isInteger(round)) {
      return { view: 'race', tier, round, leg: Number.isInteger(leg) ? leg : 1 };
    }
  }
  if (head === 'karriere') return { view: 'career' };
  if (head === 'editor') return { view: 'editor', file: a ?? '' };
  if (head === 'rekorde') return { view: 'records' };
  if (head === 'ruhmeshalle') return { view: 'hall' };
  if (head === 'konzept') return { view: 'concept' };
  return { view: 'pyramid' };
}

function activeTier(route: Route): number | null {
  if (route.view === 'league' || route.view === 'race') return route.tier;
  return null;
}

function renderSidebar(context: Context, route: Route): string {
  const current = activeTier(route);
  const items = context.leagues
    .map((league) => {
      const active = current === league.tier ? ' is-active' : '';
      return `
      <a class="nav-item${active}" href="${withSeason(`#/liga/${league.tier}`, context.season)}">
        <span class="nav-item__tier">T${league.tier}</span>
        <span class="nav-item__name">${escapeHtml(league.short_name)}</span>
        <span class="nav-item__full">${escapeHtml(league.name)}</span>
      </a>`;
    })
    .join('');

  return `
    <nav class="sidebar">
      <a class="nav-item nav-item--wide${route.view === 'pyramid' ? ' is-active' : ''}"
         href="${withSeason('#/', context.season)}">Pyramide</a>
      ${items}
      <a class="nav-item nav-item--wide${route.view === 'career' ? ' is-active' : ''}"
         href="${withSeason('#/karriere', context.season)}">Karriere</a>
      <a class="nav-item nav-item--wide${route.view === 'records' ? ' is-active' : ''}"
         href="${withSeason('#/rekorde', context.season)}">Rekorde</a>
      <a class="nav-item nav-item--wide${route.view === 'hall' ? ' is-active' : ''}"
         href="${withSeason('#/ruhmeshalle', context.season)}">Ruhmeshalle</a>
      <a class="nav-item nav-item--wide${route.view === 'editor' ? ' is-active' : ''}"
         href="${withSeason('#/editor', context.season)}">Editor</a>
      <a class="nav-item nav-item--wide${route.view === 'concept' ? ' is-active' : ''}"
         href="${withSeason('#/konzept', context.season)}">Konzept</a>
    </nav>`;
}

/**
 * Der Saisonwechsler haelt den aktuellen Pfad und tauscht nur die Saison. Beim
 * Wechsel auf einer Team- oder Fahrerseite bleibt man damit bei demselben Team
 * und sieht dessen anderes Jahr - genau der Vergleich, um den es geht.
 */
function renderSeasonPicker(context: Context, parts: string[]): string {
  const path = parts.length ? `#/${parts.join('/')}` : '#/';
  const options = Array.from({ length: context.info.seasons }, (_, index) => {
    const season = index + 1;
    const selected = season === context.season ? ' selected' : '';
    const tick = season === context.info.tickSeason ? ' · mit Rundenverlauf' : '';
    return `<option value="${withSeason(path, season)}"${selected}>Saison ${season}${tick}</option>`;
  }).join('');

  return `
    <label class="season-picker">
      <span class="season-picker__label">Saison</span>
      <select class="season-picker__select" id="season-select">${options}</select>
    </label>`;
}

function renderMain(context: Context, route: Route): string {
  switch (route.view) {
    case 'league':
      return renderLeague(context.db, context.season, route.tier);
    case 'team':
      return renderTeam(context.db, context.season, route.teamId);
    case 'driver':
      return renderDriver(context.db, context.season, route.driverId);
    case 'race':
      return renderRace(
        context.db,
        context.season,
        route.tier,
        route.round,
        route.leg,
        context.info,
      );
    case 'career':
      return renderCareer(context.db);
    case 'editor':
      return renderEditor(route.file);
    case 'records':
      return renderRecords(context.db, context.season, context.info);
    case 'hall':
      return renderHall(context.db, context.season, context.info);
    case 'concept':
      return renderConcept();
    case 'pyramid':
    default:
      return renderPyramid(context.db, context.season, context.info);
  }
}

function mount(html: string): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) app.innerHTML = html;
}

function renderShell(context: Context, parts: string[], route: Route): void {
  mount(`
    <header class="topbar">
      <a class="brand" href="${withSeason('#/', context.season)}">
        <span class="brand__mark">APEX</span>
        <span class="brand__sub">Racing Director</span>
      </a>
      ${renderSeasonPicker(context, parts)}
      <span class="topbar__hint">
        ${context.info.teams} Teams · ${context.info.drivers} Fahrer ·
        ${context.info.seasons} simulierte Saisons
      </span>
    </header>
    <div class="layout">
      ${renderSidebar(context, route)}
      <main class="content">${renderMain(context, route)}</main>
    </div>
    <footer class="footer">
      Erzeugt von der APEX-Engine aus <code>data/*.csv</code> ·
      keine echten Personen, Teams oder Serien
    </footer>`);

  const select = document.querySelector<HTMLSelectElement>('#season-select');
  select?.addEventListener('change', () => {
    window.location.hash = select.value;
  });

  window.scrollTo({ top: 0 });
}

function renderLoading(progress: LoadProgress | null): void {
  const percent =
    progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : null;
  const megabytes = progress ? (progress.loaded / 1024 / 1024).toFixed(1) : '0.0';

  mount(`
    <div class="boot">
      <span class="brand__mark">APEX</span>
      <p class="boot__title">Welt wird geladen</p>
      <div class="boot__bar"><span class="boot__fill" style="width:${percent ?? 12}%"></span></div>
      <p class="boot__hint">
        ${percent === null ? `${megabytes} MB gelesen` : `${percent} % · ${megabytes} MB`}
      </p>
      <p class="boot__note">
        Zwanzig simulierte Saisons als SQLite-Datenbank – sie wird einmalig geladen
        und danach vollständig im Browser abgefragt.
      </p>
    </div>`);
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  mount(`
    <div class="boot">
      <span class="brand__mark">APEX</span>
      <p class="boot__title">Die Welt konnte nicht geladen werden</p>
      <p class="boot__hint">${escapeHtml(message)}</p>
      <p class="boot__note">
        Die Datei <code>apex.db</code> entsteht mit <code>npm run world</code> und wird
        beim Deployment erzeugt. Fehlt sie, liegt kein Erzeugnis der Engine vor.
      </p>
    </div>`);
}

async function start(): Promise<void> {
  renderLoading(null);

  let db: Database;
  try {
    db = await openWorld((progress) => renderLoading(progress));
  } catch (error) {
    renderError(error);
    return;
  }

  const info = worldInfo(db);
  const all = leagues(db);

  const render = (): void => {
    const { parts, query } = parseHash(window.location.hash);
    const requested = Number(query.get('s'));
    // Ohne Angabe zeigt die Seite die letzte simulierte Saison - dort steht das
    // Ergebnis von zwanzig Jahren Auf- und Abstieg, und nur dort gibt es den
    // Rundenverlauf.
    const season =
      Number.isInteger(requested) && requested >= 1 && requested <= info.seasons
        ? requested
        : info.seasons;
    renderShell({ db, info, leagues: all, season }, parts, parseRoute(parts));
  };

  window.addEventListener('hashchange', render);
  render();
}

void start();
