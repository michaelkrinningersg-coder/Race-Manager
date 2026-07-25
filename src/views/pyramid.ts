import type { Database } from 'sql.js';
import { movementTotals, pyramid, type WorldInfo } from '../data/queries';
import { escapeHtml, formatMoney, withSeason } from '../ui/format';

/** Startansicht: die komplette Pyramide einer Saison mit ihren Meistern. */
export function renderPyramid(db: Database, season: number, info: WorldInfo): string {
  const steps = pyramid(db, season);
  const totals = movementTotals(db, season);

  const rows = steps
    .map((step) => {
      // Breite der Stufe: oben schmal, unten breit - macht die Pyramide sichtbar.
      const width = 44 + (step.tier - 1) * 6;
      const champion = step.champion
        ? `<a class="pyramid-step__champ-name" href="${withSeason(`#/team/${step.champion_id}`, season)}">
             <i class="chip" style="background:${escapeHtml(step.champion_colour ?? '#888888')}"></i>
             ${escapeHtml(step.champion)}
           </a>`
        : '<span class="muted">—</span>';

      return `
      <div class="pyramid-step" style="--step-width:${width}%">
        <a class="pyramid-step__tier" href="${withSeason(`#/liga/${step.tier}`, season)}">T${step.tier}</a>
        <span class="pyramid-step__body">
          <a class="pyramid-step__name" href="${withSeason(`#/liga/${step.tier}`, season)}">
            ${escapeHtml(step.name)}
          </a>
          <span class="pyramid-step__meta">
            ${step.team_count} Teams · ${step.race_count} Rennen · Deckel ${formatMoney(step.cost_cap)}
          </span>
        </span>
        <span class="pyramid-step__champ">
          <span class="pyramid-step__champ-label">Meister</span>
          ${champion}
          ${
            step.driver_champion
              ? `<span class="pyramid-step__champ-driver">${escapeHtml(step.driver_champion)}</span>`
              : ''
          }
        </span>
      </div>`;
    })
    .join('');

  const promoted = (totals.promoted ?? 0) + (totals.promoted_barrage ?? 0);
  const relegated = (totals.relegated ?? 0) + (totals.relegated_barrage ?? 0);

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">Saison ${season} von ${info.seasons}</span>
          <h1>Die Pyramide</h1>
          <p class="lead">
            Zehn Ligen, ${info.teams} Teams, ${info.drivers} Fahrer. Jede Stufe ist eine
            eigene Meisterschaft – und am Saisonende wechseln Teams zwischen ihnen.
          </p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${promoted}</span><span class="stat__label">Aufstiege</span></div>
        <div class="stat"><span class="stat__value">${relegated}</span><span class="stat__label">Abstiege</span></div>
        <div class="stat"><span class="stat__value">${totals.licence_denied ?? 0}</span><span class="stat__label">Lizenz verweigert</span></div>
        <div class="stat"><span class="stat__value">${totals.licence_loss ?? 0}</span><span class="stat__label">Lizenzverlust</span></div>
      </div>

      <div class="pyramid">${rows}</div>

      <p class="muted small">
        Alle Zahlen stammen aus der Engine: <code>data/*.csv</code> werden vom Bootstrapper
        geprüft, ${info.seasons} Saisons durchsimuliert und als SQLite-Datenbank ausgeliefert.
        ${
          info.tickSeason
            ? `In Saison ${info.tickSeason} lief Tier ${info.tickTier} rundenweise – dort gibt es
               zu jedem Rennen den vollständigen Verlauf.`
            : ''
        }
      </p>
    </section>`;
}
