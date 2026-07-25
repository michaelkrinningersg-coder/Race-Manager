import type { Database } from 'sql.js';
import {
  ARCHETYPE_LABEL,
  MOVEMENT_CLASS,
  MOVEMENT_LABEL,
  calendar,
  driverStandings,
  leagues,
  licenceDenials,
  promotionRule,
  regulation,
  standings,
} from '../data/queries';
import { escapeHtml, formatMoney, formatNumber, withSeason } from '../ui/format';

/** Tabellenansicht einer Liga: Teams, Fahrer, Kalender, verweigerte Lizenzen. */
export function renderLeague(db: Database, season: number, tier: number): string {
  const league = leagues(db).find((entry) => entry.tier === tier);
  if (!league) return notFound(season);

  const rule = regulation(db, tier);
  const movement = promotionRule(db, tier);
  const table = standings(db, season, tier);
  const drivers = driverStandings(db, season, tier);
  const races = calendar(db, season, tier);
  const denials = licenceDenials(db, season, tier);

  const teamRows = table
    .map((row) => {
      const label = row.movement ? (MOVEMENT_LABEL[row.movement] ?? '') : '';
      const cls = row.movement ? (MOVEMENT_CLASS[row.movement] ?? '') : '';
      return `
        <tr class="${cls}">
          <td class="num">${row.final_rank}</td>
          <td>
            <a class="team-link" href="${withSeason(`#/team/${row.team_id}`, season)}">
              <i class="chip" style="background:${escapeHtml(row.colour_primary)}"></i>
              ${escapeHtml(row.name)}
            </a>
            <span class="muted small"> · ${escapeHtml(ARCHETYPE_LABEL[row.ai_archetype] ?? row.ai_archetype)}</span>
          </td>
          <td class="num">${row.wins}</td>
          <td class="num">${row.podiums}</td>
          <td class="num">${row.dnfs}</td>
          <td class="num strong">${row.points}</td>
          <td class="movement">${label}</td>
        </tr>`;
    })
    .join('');

  const driverRows = drivers
    .map(
      (driver) => `
        <tr>
          <td class="num">${driver.final_rank}</td>
          <td>
            <a class="team-link" href="${withSeason(`#/fahrer/${driver.driver_id}`, season)}">
              ${escapeHtml(driver.name)}
            </a>
            <span class="muted small">${escapeHtml(driver.country)}</span>
          </td>
          <td>
            <a class="team-link" href="${withSeason(`#/team/${driver.team_id}`, season)}">
              <i class="chip" style="background:${escapeHtml(driver.colour_primary)}"></i>
              ${escapeHtml(driver.team)}
            </a>
          </td>
          <td class="num">${driver.wins}</td>
          <td class="num">${driver.poles}</td>
          <td class="num strong">${driver.points}</td>
        </tr>`,
    )
    .join('');

  const raceLinks = races
    .map((race) => {
      const legs = Math.max(1, race.legs);
      const parts = Array.from({ length: legs }, (_, index) => {
        const leg = index + 1;
        const suffix = legs > 1 ? ` <span class="muted">L${leg}</span>` : '';
        return `<a class="race-chip" href="${withSeason(`#/rennen/${tier}/${race.round}/${leg}`, season)}">
                  <span class="race-chip__round">${race.round}</span>
                  <span class="race-chip__track">${escapeHtml(race.short_name)}${suffix}</span>
                  <span class="race-chip__country">${escapeHtml(race.country)}</span>
                </a>`;
      }).join('');
      return parts;
    })
    .join('');

  const denialList = denials.length
    ? `<h2>Verweigerte Lizenzen</h2>
       <p class="muted small">
         Sportlich reicht es, formal nicht: Diese Teams standen in der Aufstiegszone und
         erfüllten die Anforderungen der Zielliga nicht (Konzept 5.1).
       </p>
       <ul class="denials">
         ${denials
           .map(
             (denial) => `<li><strong>${escapeHtml(denial.name)}</strong>
               <span class="muted">→ Tier ${denial.to_tier}</span>
               <span class="denial-reason">${escapeHtml(denial.reasons)}</span></li>`,
           )
           .join('')}
       </ul>`
    : '';

  const up =
    tier > 1
      ? `<a href="${withSeason(`#/liga/${tier - 1}`, season)}">↑ eine Liga höher</a>`
      : '<span class="muted">Spitze der Pyramide</span>';
  const down =
    tier < 10
      ? `<a href="${withSeason(`#/liga/${tier + 1}`, season)}">↓ eine Liga tiefer</a>`
      : '<span class="muted">Basis der Pyramide</span>';

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">Tier ${league.tier} · Saison ${season}</span>
          <h1>${escapeHtml(league.name)}</h1>
          <p class="lead">${escapeHtml(league.flavour)}</p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${league.team_count}</span><span class="stat__label">Teams · ${league.cars_per_team} Autos je Team</span></div>
        <div class="stat"><span class="stat__value">${league.race_count}</span><span class="stat__label">Rennen</span></div>
        <div class="stat"><span class="stat__value">${formatMoney(rule?.cost_cap ?? 0)}</span><span class="stat__label">Kostendeckel</span></div>
        <div class="stat"><span class="stat__value">${formatNumber(rule?.cap_chassis ?? 0)}</span><span class="stat__label">Bauteil-Deckel</span></div>
        <div class="stat"><span class="stat__value">${rule?.min_weight_kg ?? 0} kg</span><span class="stat__label">Mindestgewicht</span></div>
        <div class="stat"><span class="stat__value">${rule?.test_days ?? 0}</span><span class="stat__label">Testtage</span></div>
      </div>

      ${
        movement
          ? `<p class="format-line">
               <strong>Bewegung:</strong>
               ${movement.direct_up} direkte Aufsteiger,
               ${movement.promotion_barrage_slots} Barrage-Platz nach oben,
               ${movement.relegation_barrage_slots} Barrage-Platz nach unten,
               ${movement.direct_down} direkte Absteiger.
             </p>`
          : ''
      }

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

      <h2>Fahrerwertung</h2>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr><th class="num">#</th><th>Fahrer</th><th>Team</th><th class="num">Siege</th><th class="num">Poles</th><th class="num">Punkte</th></tr>
          </thead>
          <tbody>${driverRows}</tbody>
        </table>
      </div>

      <h2>Rennkalender</h2>
      <div class="race-chips">${raceLinks}</div>

      ${denialList}
    </section>`;
}

function notFound(season: number): string {
  return `<section class="panel">
    <h1>Liga nicht gefunden</h1>
    <p><a href="${withSeason('#/', season)}">Zurück zur Pyramide</a></p>
  </section>`;
}
