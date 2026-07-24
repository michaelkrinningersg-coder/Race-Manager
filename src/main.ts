import './style.css';
import { LEAGUES } from './data/leagues';
import { buildWorld } from './data/world';
import { renderConcept } from './views/concept';
import { renderLeague } from './views/league';
import { renderPyramid } from './views/pyramid';
import { renderTeam } from './views/team';
import { escapeHtml } from './ui/format';

const world = buildWorld();

type Route =
  | { view: 'pyramid' }
  | { view: 'league'; tier: number }
  | { view: 'team'; tier: number; teamId: string }
  | { view: 'concept' };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'liga' && parts[1]) {
    const tier = Number(parts[1]);
    if (Number.isInteger(tier) && tier >= 1 && tier <= LEAGUES.length) return { view: 'league', tier };
  }
  if (parts[0] === 'team' && parts[1] && parts[2]) {
    const tier = Number(parts[1]);
    if (Number.isInteger(tier) && tier >= 1 && tier <= LEAGUES.length) {
      return { view: 'team', tier, teamId: parts[2] };
    }
  }
  if (parts[0] === 'konzept') return { view: 'concept' };
  return { view: 'pyramid' };
}

function activeTier(route: Route): number | null {
  return route.view === 'league' || route.view === 'team' ? route.tier : null;
}

function renderSidebar(route: Route): string {
  const current = activeTier(route);
  const items = LEAGUES.map((league) => {
    const active = current === league.tier ? ' is-active' : '';
    return `
      <a class="nav-item${active}" href="#/liga/${league.tier}">
        <span class="nav-item__tier">T${league.tier}</span>
        <span class="nav-item__name">${escapeHtml(league.shortName)}</span>
        <span class="nav-item__full">${escapeHtml(league.name)}</span>
      </a>`;
  }).join('');

  return `
    <nav class="sidebar">
      <a class="nav-item nav-item--wide${route.view === 'pyramid' ? ' is-active' : ''}" href="#/">Pyramide</a>
      ${items}
      <a class="nav-item nav-item--wide${route.view === 'concept' ? ' is-active' : ''}" href="#/konzept">Konzept</a>
    </nav>`;
}

function renderMain(route: Route): string {
  switch (route.view) {
    case 'league':
      return renderLeague(world, route.tier);
    case 'team':
      return renderTeam(world, route.tier, route.teamId);
    case 'concept':
      return renderConcept();
    case 'pyramid':
    default:
      return renderPyramid(world);
  }
}

function render(): void {
  const route = parseRoute(window.location.hash);
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/">
        <span class="brand__mark">APEX</span>
        <span class="brand__sub">Racing Director</span>
      </a>
      <span class="topbar__hint">Ligen-Explorer · Beispielsaison ${world.season}</span>
    </header>
    <div class="layout">
      ${renderSidebar(route)}
      <main class="content">${renderMain(route)}</main>
    </div>
    <footer class="footer">
      Konzept-Prototyp · deterministische Beispielwelt (Seed ${world.seed}) ·
      keine echten Personen, Teams oder Serien
    </footer>`;

  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', render);
render();
