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
import {
  beginSeason, endSeason, judgeSeason, decidedAreas, markDecided,
  setDevelopmentFocus, developmentFocus, AREA_LABEL, DECISION_AREAS,
} from '../../engine/career';
import { buildFacility, buildCostFor, loadFacilityTypes, MAX_FACILITY_LEVEL } from '../../engine/facilities';
import { PART_KEYS, PART_LABEL } from '../data/queries';
import {
  ownStaff, freeStaff, hireStaff, ownDrivers, freeDrivers, signDriver,
  ownSponsors, sponsorOffers, signSponsor,
} from '../../engine/playerMarket';
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

  const decisions = state.prepared ? renderDecisions(state) : '';

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
      ${decisions}

      <h2>Bilanz</h2>
      ${history}
    </section>`;
}

/**
 * Die beiden Masken mit dem laengsten Hebel (Konzept 17).
 *
 * Erst nach der Vorbereitung sichtbar: Vorher gibt es weder einen
 * Anlagenbestand der laufenden Saison noch eine Bilanz, gegen die sich ein
 * Ausbau pruefen liesse.
 */
function renderDecisions(state: CareerState): string {
  const db = career;
  if (!db || state.season < 2) {
    return `<p class="muted small">
              Entscheidungen gibt es ab der zweiten Saison – das erste Auto und der erste
              Anlagenbestand werden aus Prestige und Ligadeckel abgeleitet.
            </p>`;
  }

  const focus = developmentFocus(db as unknown as never, state.season) ?? {};
  const sliders = PART_KEYS.map((key) => {
    const value = focus[key] ?? 1;
    return `<label class="focus-row">
              <span class="focus-row__name">${escapeHtml(PART_LABEL[key] ?? key)}</span>
              <input class="focus-slider" type="range" min="0.6" max="1.4" step="0.05"
                     data-part="${key}" value="${value}" />
              <span class="focus-row__value" data-for="${key}">${value.toFixed(2)}</span>
            </label>`;
  }).join('');

  const types = loadFacilityTypes(db as unknown as never);
  const levels = new Map(
    (db.prepare('SELECT facility_key, level FROM team_facilities WHERE team_id = ? AND season = ?')
      .all(state.teamId, state.season) as { facility_key: string; level: number }[])
      .map((r) => [r.facility_key, r.level]),
  );
  const balance = (db
    .prepare('SELECT closing FROM team_finances WHERE team_id = ? AND season = ?')
    .get(state.teamId, state.season - 1) as { closing: number } | undefined)?.closing ?? 0;

  const facilities = types
    .map((type) => {
      const level = levels.get(type.key) ?? 0;
      const top = level >= MAX_FACILITY_LEVEL;
      const cost = top ? 0 : buildCostFor(type, level + 1);
      const affordable = !top && cost <= balance;
      return `<div class="build-row">
                <span class="build-row__name">${escapeHtml(type.name)}</span>
                <span class="build-row__level">Stufe ${level} von ${MAX_FACILITY_LEVEL}</span>
                <span class="build-row__cost">${top ? '—' : formatMoney(cost)}</span>
                <button class="editor-button build-button" data-facility="${escapeHtml(type.key)}"
                        ${top || !affordable ? 'disabled' : ''}>
                  ${top ? 'ausgebaut' : affordable ? 'Ausbauen' : 'zu teuer'}
                </button>
              </div>`;
    })
    .join('');

  return `
    <h2>Entwicklung</h2>
    <p class="muted small">
      Der Schwerpunkt verteilt die Entwicklungsarbeit über die neun Bauteilgruppen. 1,00 ist
      neutral; was darüber liegt, wird bevorzugt entwickelt. Die Gesamtmenge bestimmt er nicht –
      die hängt an Einnahmen, Personal und Anlagen. Ohne eigene Vorgabe nimmt die KI den
      Schwerpunkt deines Team-Archetyps.
    </p>
    <div class="focus-grid">${sliders}</div>
    <div class="career-bar">
      <button class="editor-button" id="focus-save">Schwerpunkt übernehmen</button>
      <button class="editor-button editor-button--ghost" id="focus-reset">Der KI überlassen</button>
    </div>

    <h2>Anlagen</h2>
    <p class="muted small">
      Kasse: ${formatMoney(balance)}. Der Kostendeckel wird hier bewusst nicht geprüft – er ist
      eine Nachschau am Saisonende, keine Sperre. Wer ihn reißt, bekommt die Strafe im Folgejahr.
    </p>
    <div class="build-grid">${facilities}</div>

    <h2>Personal</h2>
    ${renderStaff(state)}

    <h2>Fahrer</h2>
    ${renderDrivers(state)}

    <h2>Sponsoren</h2>
    ${renderSponsors(state)}`;
}

/**
 * Personal (Konzept 8.1).
 *
 * Nur Vertragslose sind zu haben. Abwerbung kann die KI, der Spieler nicht:
 * Sie braucht eine Abloesesumme, und die ist in Konzept 9.1 beschrieben, aber
 * nicht gebaut - lieber eine ehrliche Luecke als eine erfundene Zahl.
 */
function renderStaff(state: CareerState): string {
  const db = career;
  if (!db) return '';
  const own = ownStaff(db as unknown as never, state.season, state.teamId);
  const rows = own
    .map((member) => {
      const free = freeStaff(db as unknown as never, state.season, member.role_key);
      const best = free[0];
      return `<div class="build-row">
                <span class="build-row__name">${escapeHtml(member.name)}
                  <span class="muted small">${escapeHtml(member.role_key)}</span></span>
                <span class="build-row__level">Wert ${member.rating}</span>
                <span class="build-row__cost">${formatMoney(member.salary)}</span>
                ${
                  best
                    ? `<button class="editor-button hire-button" data-staff="${best.staff_id}">
                         ${escapeHtml(best.name)} (${best.rating}) für ${formatMoney(best.salary)}
                       </button>`
                    : '<span class="muted small">niemand frei</span>'
                }
              </div>`;
    })
    .join('');
  return rows
    ? `<p class="muted small">
         Je Rolle die beste vertragslose Alternative. Wer unter Vertrag steht, ist nicht zu
         holen – Ablösesummen sind im Konzept beschrieben, aber nicht gebaut.
       </p>
       <div class="build-grid">${rows}</div>`
    : '<p class="muted small">Noch kein Personal unter Vertrag.</p>';
}

/** Cockpits und vertragslose Fahrer (Konzept 7). */
function renderDrivers(state: CareerState): string {
  const db = career;
  if (!db) return '';
  const own = ownDrivers(db as unknown as never, state.season, state.teamId);
  const free = freeDrivers(db as unknown as never, state.season).slice(0, 8);

  const seats = own
    .map(
      (driver) => `<div class="build-row">
        <span class="build-row__name">Cockpit ${driver.seat}: ${escapeHtml(driver.name)}</span>
        <span class="build-row__level">Tempo ${driver.pace} · Konstanz ${driver.consistency}</span>
        <span class="build-row__cost">${formatMoney(driver.salary)}</span>
        <span></span>
      </div>`,
    )
    .join('');

  const offers = free
    .map(
      (driver) => `<div class="build-row">
        <span class="build-row__name">${escapeHtml(driver.name)}</span>
        <span class="build-row__level">Tempo ${driver.pace} · Potenzial ${driver.potential}</span>
        <span class="build-row__cost">${formatMoney(driver.salary)}</span>
        <span class="career-actions">
          ${own
            .map(
              (seat) =>
                `<button class="editor-button sign-button" data-driver="${driver.driver_id}"
                         data-seat="${seat.seat}">auf ${seat.seat}</button>`,
            )
            .join('')}
        </span>
      </div>`,
    )
    .join('');

  return `<div class="build-grid">${seats}</div>
          <p class="muted small">Vertragslose Fahrer – der bisherige Fahrer wird dabei frei.</p>
          <div class="build-grid">${offers || '<p class="muted small">Kein Fahrer frei.</p>'}</div>`;
}

/** Sponsoren (Konzept 9.1). */
function renderSponsors(state: CareerState): string {
  const db = career;
  if (!db) return '';
  const own = ownSponsors(db as unknown as never, state.season, state.teamId);
  const offers = sponsorOffers(db as unknown as never, state.season, state.teamId).slice(0, 10);

  const running = own
    .map(
      (contract) => `<div class="build-row">
        <span class="build-row__name">${escapeHtml(String(contract.name))}
          <span class="muted small">${escapeHtml(String(contract.slot))}</span></span>
        <span class="build-row__level">bis Saison ${contract.contract_until}</span>
        <span class="build-row__cost">${formatMoney(Number(contract.base_value))}</span>
        <span></span>
      </div>`,
    )
    .join('');

  const open = offers
    .map(
      (offer) => `<div class="build-row">
        <span class="build-row__name">${escapeHtml(offer.name)}
          <span class="muted small">${escapeHtml(offer.slot)} · ${escapeHtml(offer.industry)}</span></span>
        <span class="build-row__level">${escapeHtml(offer.objective_type)} ${offer.objective_value}</span>
        <span class="build-row__cost">${(offer.value_pct * 100).toFixed(1)} % vom Deckel</span>
        <button class="editor-button sponsor-button" data-sponsor="${escapeHtml(offer.sponsor_key)}">
          Abschließen
        </button>
      </div>`,
    )
    .join('');

  return `<div class="build-grid">${running || '<p class="muted small">Kein Vertrag.</p>'}</div>
          <p class="muted small">
            Angebote deiner Liga. Der Titelsponsor ist je Liga nur einmal zu haben; der Wert
            hängt am Ligadeckel, die Zielvorgabe an sponsors.csv.
          </p>
          <div class="build-grid">${open || '<p class="muted small">Keine Angebote.</p>'}</div>`;
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

  mount.querySelectorAll<HTMLInputElement>('.focus-slider').forEach((slider) => {
    slider.addEventListener('input', () => {
      const out = mount.querySelector(`[data-for="${slider.dataset.part}"]`);
      if (out) out.textContent = Number(slider.value).toFixed(2);
    });
  });

  mount.querySelector('#focus-save')?.addEventListener('click', async () => {
    if (!career) return;
    const state = readState(career);
    if (!state) return;
    const focus: Record<string, number> = {};
    mount.querySelectorAll<HTMLInputElement>('.focus-slider').forEach((slider) => {
      focus[slider.dataset.part as string] = Number(slider.value);
    });
    setDevelopmentFocus(career as unknown as never, state.season, focus);
    await saveCareer(career, state.season - 1, state.teamName);
    notice = 'Schwerpunkt übernommen. Er gilt für die Entwicklung dieser Saison.';
    rerender();
  });

  mount.querySelector('#focus-reset')?.addEventListener('click', async () => {
    if (!career) return;
    const state = readState(career);
    if (!state) return;
    career.prepare('DELETE FROM player_focus WHERE season = ?').run(state.season);
    career.prepare('DELETE FROM player_decisions WHERE season = ? AND area = ?')
      .run(state.season, 'development');
    await saveCareer(career, state.season - 1, state.teamName);
    notice = 'Der Schwerpunkt kommt wieder von der KI.';
    rerender();
  });

  mount.querySelectorAll<HTMLButtonElement>('.build-button').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!career) return;
      const state = readState(career);
      if (!state) return;
      const result = buildFacility(
        career as unknown as never,
        state.season,
        state.teamId,
        button.dataset.facility as string,
      );
      if (result.ok) {
        markDecided(career as unknown as never, state.season, 'facilities');
        notice = `Ausbau beauftragt für ${formatMoney(result.cost ?? 0)}.`;
        await saveCareer(career, state.season - 1, state.teamName);
      } else {
        notice = result.reason ?? 'Ausbau nicht möglich.';
      }
      rerender();
    });
  });

  const act = async (
    area: 'staff' | 'drivers' | 'sponsors',
    run: (db: EngineDatabase, state: CareerState) => { ok: boolean; reason?: string },
    done: string,
  ): Promise<void> => {
    if (!career) return;
    const state = readState(career);
    if (!state) return;
    const result = run(career, state);
    if (result.ok) {
      markDecided(career as unknown as never, state.season, area);
      await saveCareer(career, state.season - 1, state.teamName);
      notice = done;
    } else {
      notice = result.reason ?? 'Nicht möglich.';
    }
    rerender();
  };

  mount.querySelectorAll<HTMLButtonElement>('.hire-button').forEach((button) => {
    button.addEventListener('click', () =>
      act('staff', (db, state) =>
        hireStaff(db as unknown as never, state.season, state.teamId, Number(button.dataset.staff)),
        'Verpflichtet.'),
    );
  });

  mount.querySelectorAll<HTMLButtonElement>('.sign-button').forEach((button) => {
    button.addEventListener('click', () =>
      act('drivers', (db, state) =>
        signDriver(db as unknown as never, state.season, state.teamId,
          Number(button.dataset.driver), Number(button.dataset.seat)),
        'Fahrer verpflichtet.'),
    );
  });

  mount.querySelectorAll<HTMLButtonElement>('.sponsor-button').forEach((button) => {
    button.addEventListener('click', () =>
      act('sponsors', (db, state) =>
        signSponsor(db as unknown as never, state.season, state.teamId,
          String(button.dataset.sponsor)),
        'Sponsorenvertrag geschlossen.'),
    );
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
