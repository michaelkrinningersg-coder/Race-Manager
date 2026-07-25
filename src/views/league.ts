import { getLeague, movementRules } from '../data/leagues';
import { carScore, getSeason, type Movement, type World } from '../data/world';
import { escapeHtml, formatMoney, formatNumber } from '../ui/format';

const MOVEMENT_LABEL: Record<Movement, string> = {
  promotion: 'Aufstieg',
  promotion_barrage: 'Barrage (Aufstieg)',
  relegation_barrage: 'Barrage (Abstieg)',
  relegation: 'Abstieg',
  stay: '',
};

const MOVEMENT_CLASS: Record<Movement, string> = {
  promotion: 'row--promotion',
  promotion_barrage: 'row--barrage',
  relegation_barrage: 'row--barrage',
  relegation: 'row--relegation',
  stay: '',
};

/** Tabellenansicht einer einzelnen Liga inklusive Auf-/Abstiegszonen. */
export function renderLeague(world: World, tier: number): string {
  const league = getLeague(tier);
  const season = getSeason(world, tier);
  const rules = movementRules(tier);

  const teamRows = season.table
    .map((row) => {
      const label = MOVEMENT_LABEL[row.movement];
      return `
        <tr class="${MOVEMENT_CLASS[row.movement]}">
          <td class="num">${row.rank}</td>
          <td>
            <a class="team-link" href="#/team/${tier}/${row.team.id}">
              <i class="chip" style="background:${row.team.colorPrimary}"></i>
              ${escapeHtml(row.team.name)}
            </a>
            <span class="muted small"> · ${escapeHtml(row.team.archetype)}</span>
          </td>
          <td class="num">${row.wins}</td>
          <td class="num">${row.podiums}</td>
          <td class="num">${row.dnf}</td>
          <td class="num strong">${row.points}</td>
          <td class="movement">${label}</td>
        </tr>`;
    })
    .join('');

  const driverRows = season.driverTable
    .slice(0, 10)
    .map((driver, index) => {
      const team = season.table.find((row) => row.team.drivers.includes(driver))!.team;
      return `
        <tr>
          <td class="num">${index + 1}</td>
          <td>${escapeHtml(driver.name)} <span class="muted small">${driver.country} · ${driver.age} J.</span></td>
          <td><i class="chip" style="background:${team.colorPrimary}"></i> ${escapeHtml(team.shortName)}</td>
          <td class="num">${driver.wins}</td>
          <td class="num strong">${driver.points}</td>
        </tr>`;
    })
    .join('');

  const strongest = [...season.table].sort(
    (a, b) => carScore(b.team, league) - carScore(a.team, league),
  )[0];

  const up = tier > 1 ? `<a href="#/liga/${tier - 1}">↑ ${getLeague(tier - 1).name}</a>` : '<span class="muted">Spitze der Pyramide</span>';
  const down = tier < 10 ? `<a href="#/liga/${tier + 1}">↓ ${getLeague(tier + 1).name}</a>` : '<span class="muted">Basis der Pyramide</span>';

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">Tier ${league.tier}</span>
          <h1>${escapeHtml(league.name)}</h1>
          <p class="lead">${escapeHtml(league.flavour)}</p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${league.teamCount}</span><span class="stat__label">Teams · ${league.carsPerTeam} Autos je Team</span></div>
        <div class="stat"><span class="stat__value">${league.raceCount}</span><span class="stat__label">Rennen</span></div>
        <div class="stat"><span class="stat__value">${formatMoney(league.costCap)}</span><span class="stat__label">Kostendeckel</span></div>
        <div class="stat"><span class="stat__value">${formatNumber(league.partCap)}</span><span class="stat__label">Bauteil-Deckel</span></div>
        <div class="stat"><span class="stat__value">${league.minWeightKg} kg</span><span class="stat__label">Mindestgewicht</span></div>
        <div class="stat"><span class="stat__value">${Math.round(league.dnfRate * 100)} %</span><span class="stat__label">Ausfallquote</span></div>
      </div>

      <p class="format-line"><strong>Wochenendformat:</strong> ${escapeHtml(league.weekendFormat)}</p>
      <p class="format-line">
        <strong>Bewegung:</strong>
        ${rules.promotionSlots} direkte Aufsteiger,
        ${rules.promotionBarrageSlots} Barrage-Platz nach oben,
        ${rules.relegationBarrageSlots} Barrage-Platz nach unten,
        ${rules.relegationSlots} direkte Absteiger.
        <span class="muted">Bestes Auto der Liga: ${escapeHtml(strongest.team.name)}
        (${Math.round(carScore(strongest.team, league))} % des Deckels)</span>
      </p>

      <div class="nav-between">${up}${down}</div>

      <h2>Teamwertung</h2>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr><th class="num">#</th><th>Team</th><th class="num">Siege</th><th class="num">Podien</th><th class="num">DNF</th><th class="num">Punkte</th><th>Bewegung</th></tr>
          </thead>
          <tbody>${teamRows}</tbody>
        </table>
      </div>

      <h2>Fahrerwertung – Top 10</h2>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr><th class="num">#</th><th>Fahrer</th><th>Team</th><th class="num">Siege</th><th class="num">Punkte</th></tr>
          </thead>
          <tbody>${driverRows}</tbody>
        </table>
      </div>
    </section>`;
}
