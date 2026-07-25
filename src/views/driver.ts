import type { Database } from 'sql.js';
import { driverHistory, driverIdentity, driverSeasons } from '../data/queries';
import { ageIn, escapeHtml, formatMoney, withSeason } from '../ui/format';

const ROLE_LABEL: Record<string, string> = {
  race: 'Stammfahrer',
  reserve: 'Ersatz',
  junior: 'Nachwuchs',
  free_agent: 'ohne Vertrag',
  retired: 'zurückgetreten',
};

const EVENT_LABEL: Record<string, string> = {
  signed: 'verpflichtet',
  retired: 'Rücktritt',
  debut: 'Debüt',
  released: 'freigestellt',
};

/**
 * Fahrerakte: was aus `driver_state` ueber die Saisons geworden ist.
 *
 * Die Trennung von Identitaet (`drivers`) und Zustand (`driver_state`) aus M5
 * wird hier erst sichtbar - eine Zeile je Saison mit Team, Rolle, Vertrag und
 * den 17 Attributen. Ohne sie waere ein Fahrer bis heute unveraenderlich.
 */
export function renderDriver(db: Database, season: number, driverId: number): string {
  const driver = driverIdentity(db, driverId);
  if (!driver) {
    return `<section class="panel">
      <h1>Fahrer nicht gefunden</h1>
      <p><a href="${withSeason('#/', season)}">Zurück zur Pyramide</a></p>
    </section>`;
  }

  const seasons = driverSeasons(db, driverId);
  const events = driverHistory(db, driverId);
  const current = seasons.find((entry) => entry.season === season) ?? seasons[seasons.length - 1];

  const peak = seasons.reduce((best, entry) => Math.max(best, entry.pace), 0);
  const totalPoints = seasons.reduce((sum, entry) => sum + (entry.points ?? 0), 0);
  const totalWins = seasons.reduce((sum, entry) => sum + (entry.wins ?? 0), 0);
  const titles = seasons.filter((entry) => entry.final_rank === 1).length;

  const rows = seasons
    .map((entry) => {
      const team = entry.team
        ? `<a class="team-link" href="${withSeason(`#/team/${entry.team_id}`, entry.season)}">
             <i class="chip" style="background:${escapeHtml(entry.colour_primary ?? '#888888')}"></i>
             ${escapeHtml(entry.team)}
           </a>`
        : '<span class="muted">—</span>';
      return `
      <tr class="${entry.season === season ? 'is-current' : ''}">
        <td class="num">
          <a href="${withSeason(`#/fahrer/${driverId}`, entry.season)}">${entry.season}</a>
        </td>
        <td class="num">${ageIn(entry.season, driver.birth_year)}</td>
        <td>${team}</td>
        <td class="num">${entry.tier ?? '—'}</td>
        <td>${escapeHtml(ROLE_LABEL[entry.role] ?? entry.role)}</td>
        <td class="num strong">${entry.pace}</td>
        <td class="num muted">${entry.potential}</td>
        <td class="num">${entry.morale}</td>
        <td class="num">${entry.salary > 0 ? formatMoney(entry.salary) : '—'}</td>
        <td class="num">${entry.points ?? '—'}</td>
        <td class="num">${entry.final_rank ?? '—'}</td>
      </tr>`;
    })
    .join('');

  const timeline = events.length
    ? `<h2>Chronik</h2>
       <ul class="events">
         ${events
           .map(
             (event) => `<li class="event">
               <span class="event__season">S${event.season}</span>
               <span class="event__label">${escapeHtml(EVENT_LABEL[event.event] ?? event.event)}</span>
               <span class="event__detail">
                 ${event.team ? escapeHtml(event.team) : ''}
                 ${event.tier ? `<span class="muted">Tier ${event.tier}</span>` : ''}
                 ${event.detail ? `<span class="muted">${escapeHtml(event.detail)}</span>` : ''}
               </span>
             </li>`,
           )
           .join('')}
       </ul>`
    : '';

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">
            ${escapeHtml(driver.country)} · Jahrgang ${driver.birth_year}
            ${driver.is_newgen ? ' · Newgen' : ''}
          </span>
          <h1>${escapeHtml(driver.first_name)} ${escapeHtml(driver.last_name)}</h1>
          <p class="lead">
            ${
              current
                ? `Saison ${current.season}: ${escapeHtml(ROLE_LABEL[current.role] ?? current.role)}
                   ${current.team ? `bei ${escapeHtml(current.team)}` : ''}
                   ${current.tier ? `in Tier ${current.tier}` : ''}`
                : 'Keine Saisondaten'
            }
          </p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${seasons.length}</span><span class="stat__label">Saisons</span></div>
        <div class="stat"><span class="stat__value">${totalPoints}</span><span class="stat__label">Punkte gesamt</span></div>
        <div class="stat"><span class="stat__value">${totalWins}</span><span class="stat__label">Siege</span></div>
        <div class="stat"><span class="stat__value">${titles}</span><span class="stat__label">Titel</span></div>
        <div class="stat"><span class="stat__value">${peak}</span><span class="stat__label">Bester Pace-Wert</span></div>
        <div class="stat"><span class="stat__value">${driver.potential ?? '—'}</span><span class="stat__label">Potenzial</span></div>
      </div>

      <h2>Laufbahn</h2>
      <p class="muted small">
        Entwicklung läuft als Annäherungsrate an das Potenzial – ein junger Fahrer holt je
        Saison einen Bruchteil des Abstands auf, ab 32 baut er ab (Datenmodell 18.3).
        Simulator und Akademie des Teams beschleunigen das.
      </p>
      <div class="table-scroll">
        <table class="table table--compact">
          <thead>
            <tr>
              <th class="num">Saison</th><th class="num">Alter</th><th>Team</th><th class="num">Tier</th>
              <th>Rolle</th><th class="num">Pace</th><th class="num">Potenzial</th>
              <th class="num">Moral</th><th class="num">Gehalt</th><th class="num">Punkte</th><th class="num">Platz</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      ${timeline}
    </section>`;
}
