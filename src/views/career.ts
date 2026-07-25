import type { Database } from 'sql.js';
import { rows } from '../data/db';
import {
  deleteCareer,
  downloadCareer,
  loadCareer,
  openBytes,
  saveCareer,
  startCareer,
  storedCareer,
} from '../data/savegame';
import type { EngineDatabase } from '../data/sqljs';
import { beginSeason, endSeason, judgeSeason, decidedAreas, AREA_LABEL, DECISION_AREAS } from '../../engine/career';
import { playerTeam } from '../../engine/player';
import { escapeHtml, formatMoney, formatNumber } from '../ui/format';

/**
 * Karrieremodus (Konzept 14.2).
 *
 * Die uebrigen Ansichten lesen eine fertig gerechnete Welt. Diese hier rechnet:
 * Sie haelt einen eigenen Spielstand, laesst die Engine im Browser laufen und
 * schreibt das Ergebnis zurueck. Der Rest der Seite bleibt davon unberuehrt -
 * `apex.db` und die Karriere sind zwei verschiedene Welten, und das ist
 * Absicht: Die eine zeigt, was die Engine kann, die andere gehoert dem Spieler.
 *
 * ZUSTAND. Der Spielstand liegt in IndexedDB und wird nach jeder Saison
 * geschrieben. Die geoeffnete Datenbank haelt dieses Modul, weil sie zwischen
 * zwei Seitenwechseln bestehen bleiben muss - sie neu zu laden kostet
 * Sekunden.
 */

let career: EngineDatabase | null = null;
let busy = false;
let notice: string | null = null;
/**
 * Der gespeicherte Stand wird EINMAL vorab geladen und danach nur noch gelesen.
 *
 * Vorher fragte ihn der Auswahlbildschirm bei jedem Neuzeichnen neu ab - und
 * genau daran scheiterte die Ansicht: Der Klick auf ein Team zeichnete zuerst
 * mit `busy` neu, landete mangels Spielstand im Auswahlzweig und stiess dort
 * eine Abfrage an. Bis die zurueckkam, stand das Armaturenbrett laengst - und
 * wurde von der spaeter eintreffenden Antwort wieder durch die Teamwahl
 * ersetzt. Ein synchrones Neuzeichnen kann diesen Wettlauf nicht haben.
 */
let stored: Awaited<ReturnType<typeof storedCareer>> = undefined;

interface TeamRow {
  team_id: number;
  name: string;
  short_name: string;
  colour_primary: string;
  start_tier: number;
  prestige: number;
  country: string;
  ai_archetype: string;
}

interface CareerState {
  teamId: number;
  teamName: string;
  colour: string;
  season: number;
  tier: number;
  confidence: number;
  /** Steht die Saison noch aus, oder ist sie vorbereitet? */
  prepared: boolean;
}

function readState(db: EngineDatabase): CareerState | null {
  const teamId = playerTeam(db as unknown as never);
  if (teamId === null) return null;

  const state = db.prepare('SELECT current_season, board_confidence FROM game_state WHERE id = 1').get() as
    | { current_season: number; board_confidence: number }
    | undefined;
  const season = (state?.current_season ?? 0) + 1;

  const team = db
    .prepare('SELECT name, colour_primary FROM teams WHERE team_id = ?')
    .get(teamId) as { name: string; colour_primary: string };

  const current = db
    .prepare('SELECT tier FROM team_seasons WHERE team_id = ? AND season = ?')
    .get(teamId, season) as { tier: number } | undefined;

  return {
    teamId,
    teamName: team.name,
    colour: team.colour_primary,
    season,
    tier: current?.tier ?? 0,
    confidence: state?.board_confidence ?? 60,
    prepared: current !== undefined,
  };
}

/** Auswahl aus allen 167 Teams, nach Liga gegliedert (getroffene Entscheidung). */
function renderChooser(db: Database): string {
  const teams = rows<TeamRow>(
    db,
    `SELECT team_id, name, short_name, colour_primary, start_tier, prestige, country, ai_archetype
       FROM teams ORDER BY start_tier, prestige DESC, name`,
  );

  const byTier = new Map<number, TeamRow[]>();
  for (const team of teams) {
    const list = byTier.get(team.start_tier);
    if (list) list.push(team);
    else byTier.set(team.start_tier, [team]);
  }

  const blocks = [...byTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([tier, list]) => `
      <details class="career-tier"${tier >= 8 ? ' open' : ''}>
        <summary><span class="tier-badge">Tier ${tier}</span> ${list.length} Teams</summary>
        <div class="career-teams">
          ${list
            .map(
              (team) => `
            <button class="career-team" data-team="${team.team_id}">
              <i class="chip" style="background:${escapeHtml(team.colour_primary)}"></i>
              <span class="career-team__name">${escapeHtml(team.name)}</span>
              <span class="career-team__meta">${escapeHtml(team.country)} · Prestige ${team.prestige}</span>
            </button>`,
            )
            .join('')}
        </div>
      </details>`,
    )
    .join('');

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">Karriere</span>
          <h1>Team wählen</h1>
          <p class="lead">
            Du bist Teamchef, nicht Teambesitzer. Such dir eines der ${teams.length} Teams aus –
            in welcher Liga, entscheidest du.
          </p>
        </div>
      </header>

      <p class="muted small">
        Die Karriere rechnet die Engine im Browser, Saison für Saison. Sie hat mit der
        Beispielwelt der übrigen Ansichten nichts zu tun: Dort stehen zwanzig fertig gerechnete
        Jahre, hier fängst du bei Saison 1 an. Der Spielstand bleibt im Browser – sichere ihn
        als Datei, wenn er dir etwas wert ist.
      </p>

      ${
        stored
          ? `<div class="career-resume">
               <div>
                 <strong>Gespeicherter Stand:</strong> ${escapeHtml(stored.teamName)},
                 nach Saison ${stored.season}
               </div>
               <div class="career-actions">
                 <button class="editor-button" id="career-load">Fortsetzen</button>
                 <button class="editor-button editor-button--ghost" id="career-delete">Verwerfen</button>
               </div>
             </div>`
          : ''
      }

      <div class="career-import">
        <label class="editor-button editor-button--ghost">
          Spielstand aus Datei laden
          <input type="file" id="career-file" accept=".db" hidden />
        </label>
      </div>

      <h2>Teams</h2>
      ${blocks}
    </section>`;
}

function renderDashboard(state: CareerState): string {
  const db = career;
  if (!db) return '';

  const decided = decidedAreas(db as unknown as never, state.season);
  const areas = DECISION_AREAS.map((area) => {
    const own = decided.has(area);
    return `<li class="career-area ${own ? 'is-own' : ''}">
              <span class="career-area__name">${escapeHtml(AREA_LABEL[area])}</span>
              <span class="career-area__who">${own ? 'von dir entschieden' : 'von der KI übernommen'}</span>
            </li>`;
  }).join('');

  const last = db
    .prepare(
      `SELECT season, tier, final_rank, points, wins, podiums
         FROM team_seasons WHERE team_id = ? AND final_rank IS NOT NULL
        ORDER BY season DESC LIMIT 8`,
    )
    .all(state.teamId) as {
    season: number;
    tier: number;
    final_rank: number;
    points: number;
    wins: number;
    podiums: number;
  }[];

  const money = db
    .prepare('SELECT closing FROM team_finances WHERE team_id = ? ORDER BY season DESC LIMIT 1')
    .get(state.teamId) as { closing: number } | undefined;

  const history = last.length
    ? `<div class="table-scroll">
         <table class="table table--compact">
           <thead><tr>
             <th class="num">Saison</th><th class="num">Liga</th><th class="num">Platz</th>
             <th class="num">Punkte</th><th class="num">Siege</th><th class="num">Podeste</th>
           </tr></thead>
           <tbody>${last
             .map(
               (r) => `<tr>
                 <td class="num">${r.season}</td><td class="num">T${r.tier}</td>
                 <td class="num strong">${r.final_rank}</td><td class="num">${formatNumber(r.points)}</td>
                 <td class="num">${r.wins}</td><td class="num">${r.podiums}</td>
               </tr>`,
             )
             .join('')}</tbody>
         </table>
       </div>`
    : '<p class="muted small">Noch keine abgeschlossene Saison.</p>';

  return `
    <section class="panel">
      <header class="panel__head team-head" style="--team-color:${escapeHtml(state.colour)}">
        <div>
          <span class="tier-badge">Karriere · Saison ${state.season}${state.tier ? ` · Tier ${state.tier}` : ''}</span>
          <h1>${escapeHtml(state.teamName)}</h1>
          <p class="lead">Vertrauen des Vorstands: ${state.confidence} von 100.</p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${state.season}</span><span class="stat__label">Saison</span></div>
        <div class="stat"><span class="stat__value">${state.tier ? `T${state.tier}` : '—'}</span><span class="stat__label">Liga</span></div>
        <div class="stat"><span class="stat__value">${state.confidence}</span><span class="stat__label">Vertrauen</span></div>
        <div class="stat"><span class="stat__value">${money ? formatMoney(money.closing) : '—'}</span><span class="stat__label">Kasse</span></div>
      </div>

      ${notice ? `<div class="editor-status editor-status--ok">${escapeHtml(notice)}</div>` : ''}

      <div class="career-bar">
        ${
          state.prepared
            ? `<button class="editor-button" id="career-run" ${busy ? 'disabled' : ''}>
                 Saison ${state.season} fahren
               </button>`
            : `<button class="editor-button" id="career-begin" ${busy ? 'disabled' : ''}>
                 Saison ${state.season} vorbereiten
               </button>`
        }
        <button class="editor-button editor-button--ghost" id="career-export">Als Datei sichern</button>
        <button class="editor-button editor-button--ghost" id="career-quit">Karriere beenden</button>
        ${busy ? '<span class="career-busy">rechnet …</span>' : ''}
      </div>

      <h2>Entscheidungen</h2>
      <p class="muted small">
        Fünf Bereiche gehören dir. Was du nicht selbst entscheidest, übernimmt die KI für dich –
        genau das, was sie ohne dich getan hätte. Ohne diese Voreinstellung stünde dein Auto
        ohne Entwicklung da, während 166 andere sich weiterentwickeln.
      </p>
      <ul class="career-areas">${areas}</ul>

      <h2>Bilanz</h2>
      ${history}
    </section>`;
}

/** Ereignisse der Karriereansicht. Wird nach jedem Neuzeichnen neu gehaengt. */
function wire(mount: HTMLElement, rerender: () => void): void {
  const seed = 20260724;

  mount.querySelectorAll<HTMLButtonElement>('.career-team').forEach((button) => {
    button.addEventListener('click', async () => {
      busy = true;
      rerender();
      career = await startCareer(Number(button.dataset.team), seed);
      const state = readState(career);
      if (state) {
        await saveCareer(career, 0, state.teamName);
        stored = await storedCareer();
      }
      busy = false;
      notice = 'Karriere begonnen. Bereite die erste Saison vor.';
      rerender();
    });
  });

  mount.querySelector('#career-load')?.addEventListener('click', async () => {
    busy = true;
    rerender();
    career = (await loadCareer()) ?? null;
    busy = false;
    rerender();
  });

  mount.querySelector('#career-delete')?.addEventListener('click', async () => {
    await deleteCareer();
    career = null;
    stored = undefined;
    rerender();
  });

  mount.querySelector<HTMLInputElement>('#career-file')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    busy = true;
    rerender();
    career = await openBytes(new Uint8Array(await file.arrayBuffer()));
    busy = false;
    rerender();
  });

  mount.querySelector('#career-begin')?.addEventListener('click', async () => {
    if (!career) return;
    const state = readState(career);
    if (!state) return;
    busy = true;
    rerender();
    // Die Vorbereitung rechnet 166 Teams durch - das dauert und darf die
    // Oberflaeche nicht einfrieren, bevor der Knopf sichtbar deaktiviert ist.
    await new Promise((resolve) => setTimeout(resolve, 0));
    beginSeason(career as unknown as never, state.season);
    await saveCareer(career, state.season - 1, state.teamName);
    busy = false;
    notice = `Saison ${state.season} steht. Die anderen Teams haben entwickelt, gebaut und verpflichtet.`;
    rerender();
  });

  mount.querySelector('#career-run')?.addEventListener('click', async () => {
    if (!career) return;
    const state = readState(career);
    if (!state) return;
    busy = true;
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const report = { ...emptyish(state.season) };
    endSeason(career as unknown as never, state.season, 0, report as never);
    const verdict = judgeSeason(career as unknown as never, state.season, state.teamId, state.confidence);
    career
      .prepare('UPDATE game_state SET board_confidence = ? WHERE id = 1')
      .run(verdict.confidence);
    await saveCareer(career, state.season, state.teamName);

    busy = false;
    notice = verdict.message;
    if (verdict.fired) {
      notice = `${verdict.message} Deine Karriere bei ${state.teamName} endet hier.`;
      await deleteCareer();
      career = null;
      stored = undefined;
    }
    rerender();
  });

  mount.querySelector('#career-export')?.addEventListener('click', () => {
    if (!career) return;
    const state = readState(career);
    downloadCareer(career, state?.season ?? 1);
  });

  mount.querySelector('#career-quit')?.addEventListener('click', async () => {
    await deleteCareer();
    career = null;
    stored = undefined;
    notice = null;
    rerender();
  });
}

/** Leerer Saisonbericht - die Karriere braucht die Zaehler nicht, endSeason schon. */
function emptyish(season: number): Record<string, number> {
  const report: Record<string, number> = { season };
  for (const key of [
    'weekends','results','dnfs','retired','newgens','signings','unfilled','overBudget',
    'poached','hired','upgrades','invested','sales','recovered','sponsorsSigned',
    'sponsorsMet','sponsorsMissed','capBreaches','promoted','relegated','barrages',
    'licenceDenied','licenceLoss',
  ]) {
    report[key] = 0;
  }
  return report;
}

export function renderCareer(db: Database): string {
  queueMicrotask(() => {
    const mount = document.querySelector<HTMLElement>('#career-mount');
    if (!mount) return;

    // Synchron und ohne Ausnahme. Was asynchron sein muss - Spielstand laden,
    // Saison rechnen - passiert in den Ereignissen und ruft danach hierher
    // zurueck, nie umgekehrt.
    const rerender = (): void => {
      const state = career ? readState(career) : null;
      mount.innerHTML = state ? renderDashboard(state) : renderChooser(db);
      wire(mount, rerender);
    };

    void storedCareer().then((found) => {
      stored = found;
      rerender();
    });
  });

  return '<div id="career-mount"><p class="muted">Karriere wird geladen …</p></div>';
}
