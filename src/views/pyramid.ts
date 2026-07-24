import { LEAGUES } from '../data/leagues';
import { getSeason, worldTotals, type World } from '../data/world';
import { escapeHtml, formatMoney, formatNumber } from '../ui/format';

/** Startansicht: die komplette Pyramide mit Auf- und Abstiegsfluss. */
export function renderPyramid(world: World): string {
  const totals = worldTotals(world);

  const rows = LEAGUES.map((league) => {
    const season = getSeason(world, league.tier);
    const champion = season.table[0];
    // Breite der Stufe: oben schmal, unten breit - macht die Pyramide sichtbar.
    const width = 44 + (league.tier - 1) * 6;
    return `
      <a class="pyramid-step" href="#/liga/${league.tier}" style="--step-width:${width}%">
        <span class="pyramid-step__tier">T${league.tier}</span>
        <span class="pyramid-step__body">
          <span class="pyramid-step__name">${escapeHtml(league.name)}</span>
          <span class="pyramid-step__meta">
            ${league.teamCount} Teams · ${league.raceCount} Rennen · Deckel ${formatMoney(league.costCap)}
          </span>
        </span>
        <span class="pyramid-step__champ">
          <span class="pyramid-step__champ-label">Meister</span>
          <span class="pyramid-step__champ-name">${escapeHtml(champion.team.name)}</span>
        </span>
      </a>`;
  }).join('');

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <h1>Die Ligenpyramide</h1>
          <p class="lead">
            Zehn Ligen, eine Welt. Jede Saison steigen die beiden Ersten auf und die beiden
            Letzten ab; Platz 3 und der Drittletzte treffen sich in der Barrage.
            Alle Tabellen unten stammen aus einer vollständig durchsimulierten Beispielsaison.
          </p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${LEAGUES.length}</span><span class="stat__label">Ligen</span></div>
        <div class="stat"><span class="stat__value">${formatNumber(totals.teams)}</span><span class="stat__label">Teams</span></div>
        <div class="stat"><span class="stat__value">${formatNumber(totals.drivers)}</span><span class="stat__label">Stammfahrer</span></div>
        <div class="stat"><span class="stat__value">${formatNumber(totals.races)}</span><span class="stat__label">Rennen pro Saison</span></div>
        <div class="stat"><span class="stat__value">${world.seed}</span><span class="stat__label">Welt-Seed</span></div>
      </div>

      <div class="pyramid">${rows}</div>

      <div class="legend">
        <span class="legend__item"><i class="dot dot--promotion"></i>Aufstieg (Platz 1–2)</span>
        <span class="legend__item"><i class="dot dot--barrage"></i>Barrage (Platz 3 bzw. Drittletzter)</span>
        <span class="legend__item"><i class="dot dot--relegation"></i>Abstieg (letzte zwei)</span>
      </div>
    </section>`;
}
