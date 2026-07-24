import { PART_GROUPS, getLeague } from '../data/leagues';
import { carScore, driverScore, getSeason, type World } from '../data/world';
import { capPercent, escapeHtml, formatMoney, formatNumber } from '../ui/format';

/** Detailansicht eines Teams: Bauteile gegen den Reglementdeckel, Fahrer, Eckdaten. */
export function renderTeam(world: World, tier: number, teamId: string): string {
  const league = getLeague(tier);
  const season = getSeason(world, tier);
  const row = season.table.find((entry) => entry.team.id === teamId);
  if (!row) {
    return `<section class="panel"><h1>Team nicht gefunden</h1>
      <p><a href="#/liga/${tier}">Zurueck zur Liga</a></p></section>`;
  }
  const team = row.team;

  const parts = PART_GROUPS.map((group) => {
    const value = team.parts[group.key];
    const percent = capPercent(value, league.partCap);
    return `
      <li class="part">
        <span class="part__label">${escapeHtml(group.label)}</span>
        <span class="part__bar"><span class="part__fill" style="width:${percent.toFixed(1)}%"></span></span>
        <span class="part__value">${formatNumber(value)} <span class="muted">/ ${formatNumber(league.partCap)}</span></span>
      </li>`;
  }).join('');

  const drivers = team.drivers
    .map(
      (driver) => `
      <tr>
        <td>${escapeHtml(driver.name)}</td>
        <td class="num">${driver.age}</td>
        <td>${driver.country}</td>
        <td class="num">${driver.pace}</td>
        <td class="num">${driver.racecraft}</td>
        <td class="num">${driver.consistency}</td>
        <td class="num">${driver.potential}</td>
        <td class="num strong">${driver.points}</td>
      </tr>`,
    )
    .join('');

  const bestDriver = [...team.drivers].sort((a, b) => driverScore(b) - driverScore(a))[0];

  return `
    <section class="panel">
      <header class="panel__head team-head" style="--team-color:${team.colorPrimary}">
        <div>
          <span class="tier-badge">Tier ${tier} · ${escapeHtml(league.shortName)}</span>
          <h1>${escapeHtml(team.name)}</h1>
          <p class="lead">
            ${escapeHtml(team.archetype)} aus ${escapeHtml(team.country)} ·
            Platz ${row.rank} von ${season.table.length} · ${row.points} Punkte
          </p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${Math.round(carScore(team, league))} %</span><span class="stat__label">Auto am Deckel</span></div>
        <div class="stat"><span class="stat__value">${team.reliability}</span><span class="stat__label">Zuverlaessigkeit</span></div>
        <div class="stat"><span class="stat__value">${team.prestige}</span><span class="stat__label">Prestige</span></div>
        <div class="stat"><span class="stat__value">${formatMoney(team.budget)}</span><span class="stat__label">Budget (Deckel ${formatMoney(league.costCap)})</span></div>
        <div class="stat"><span class="stat__value">${row.wins}</span><span class="stat__label">Siege</span></div>
        <div class="stat"><span class="stat__value">${row.dnf}</span><span class="stat__label">Ausfaelle</span></div>
      </div>

      <h2>Bauteilgruppen</h2>
      <p class="muted small">
        Alle Werte liegen auf der weltweiten 0–1000-Skala. Der Balken zeigt die Ausschoepfung
        des Reglementdeckels dieser Liga – beim Aufstieg steigt der Deckel, die eigenen Werte
        bleiben zunaechst gleich.
      </p>
      <ul class="parts">${parts}</ul>

      <h2>Fahrer</h2>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr><th>Name</th><th class="num">Alter</th><th>Land</th><th class="num">Pace</th><th class="num">Racecraft</th><th class="num">Konstanz</th><th class="num">Potenzial</th><th class="num">Punkte</th></tr>
          </thead>
          <tbody>${drivers}</tbody>
        </table>
      </div>
      <p class="muted small">Staerkster Fahrer im Kader: ${escapeHtml(bestDriver.name)}
        (Score ${Math.round(driverScore(bestDriver))}).</p>

      <p><a href="#/liga/${tier}">← Zurueck zur Tabelle</a></p>
    </section>`;
}
