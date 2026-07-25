import type { Database } from 'sql.js';
import {
  ARCHETYPE_LABEL,
  MOVEMENT_LABEL,
  OBJECTIVE_LABEL,
  PART_LABEL,
  teamCapBreaches,
  teamSponsors,
  teamDetail,
  teamFacilities,
  teamFacilityMoves,
  teamFinances,
  teamHistory,
  teamParts,
  teamRoster,
  teamStaff,
} from '../data/queries';
import {
  ageIn,
  capPercent,
  escapeHtml,
  formatMoney,
  formatNumber,
  formatSigned,
  withSeason,
} from '../ui/format';

const ROLE_LABEL: Record<string, string> = {
  race: 'Stammfahrer',
  reserve: 'Ersatz',
  junior: 'Nachwuchs',
};

/**
 * Detailansicht eines Teams.
 *
 * Sie ist der Ort, an dem M3 bis M5 zum ersten Mal sichtbar werden: Bauteile
 * gegen den Reglementdeckel, der Kader mit Vertraegen, das Personal mit seinen
 * Werten, die Anlagen mit Level und Fixkosten und die Bilanz ueber alle Saisons.
 */
export function renderTeam(db: Database, season: number, teamId: number): string {
  const team = teamDetail(db, season, teamId);
  if (!team) {
    return `<section class="panel">
      <h1>Team nicht gefunden</h1>
      <p class="muted">In Saison ${season} existiert kein Team mit dieser Nummer.</p>
      <p><a href="${withSeason('#/', season)}">Zurück zur Pyramide</a></p>
    </section>`;
  }

  const tier = team.tier;
  const parts = teamParts(db, season, teamId, tier);
  const roster = teamRoster(db, season, teamId);
  const staff = teamStaff(db, season, teamId);
  const facilities = teamFacilities(db, season, teamId);
  const moves = teamFacilityMoves(db, teamId);
  const finances = teamFinances(db, teamId);
  const history = teamHistory(db, teamId);
  const sponsorList = teamSponsors(db, season, teamId);
  const breaches = teamCapBreaches(db, teamId);

  const finance = finances.find((entry) => entry.season === season);

  return `
    <section class="panel">
      <header class="panel__head team-head" style="--team-color:${escapeHtml(team.colour_primary)}">
        <div>
          <span class="tier-badge">Tier ${tier} · Saison ${season}</span>
          <h1>${escapeHtml(team.name)}</h1>
          <p class="lead">
            ${escapeHtml(ARCHETYPE_LABEL[team.ai_archetype] ?? team.ai_archetype)}
            aus ${escapeHtml(team.city)}, ${escapeHtml(team.country)} ·
            gegründet ${team.founded_year} ·
            ${team.final_rank ? `Platz ${team.final_rank}` : 'ohne Wertung'} mit ${team.points} Punkten${
              team.movement && MOVEMENT_LABEL[team.movement]
                ? ` · <strong>${escapeHtml(MOVEMENT_LABEL[team.movement])}</strong>`
                : ''
            }
          </p>
          <p class="muted small">${escapeHtml(team.flavour)}</p>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><span class="stat__value">${team.prestige}</span><span class="stat__label">Prestige</span></div>
        <div class="stat"><span class="stat__value">${team.wins}</span><span class="stat__label">Siege</span></div>
        <div class="stat"><span class="stat__value">${team.podiums}</span><span class="stat__label">Podien</span></div>
        <div class="stat"><span class="stat__value">${team.dnfs}</span><span class="stat__label">Ausfälle</span></div>
        <div class="stat"><span class="stat__value">${team.history_titles}</span><span class="stat__label">Titel historisch</span></div>
        <div class="stat"><span class="stat__value">${team.is_works_team ? 'Werk' : 'Kunde'}</span><span class="stat__label">${escapeHtml(team.engine_name ?? 'Serienmotor')}</span></div>
      </div>

      ${renderHistory(history, season, teamId)}
      ${renderParts(parts)}
      ${renderRoster(roster, season)}
      ${renderStaff(staff, season)}
      ${renderFacilities(facilities, moves)}
      ${renderSponsors(sponsorList)}
      ${renderFinance(finance, finances, season)}
      ${renderBreaches(breaches, season)}

      <p><a href="${withSeason(`#/liga/${tier}`, season)}">← Zurück zur Tabelle</a></p>
    </section>`;
}

/** Ligaverlauf als Balkenreihe - eine Zeile, die zwanzig Saisons erzaehlt. */
function renderHistory(
  history: { season: number; tier: number; final_rank: number | null; movement: string | null }[],
  season: number,
  teamId: number,
): string {
  if (history.length < 2) return '';

  const cells = history
    .map((entry) => {
      // Tier 1 ganz oben, Tier 10 ganz unten - die Balkenhoehe ist die Liga,
      // nicht der Erfolg darin.
      const height = 100 - (entry.tier - 1) * 9;
      const current = entry.season === season ? ' is-current' : '';
      const title = `Saison ${entry.season}: Tier ${entry.tier}${
        entry.final_rank ? `, Platz ${entry.final_rank}` : ''
      }`;
      return `<a class="ladder__step${current}" style="--h:${height}%"
                 title="${escapeHtml(title)}"
                 href="${withSeason(`#/team/${teamId}`, entry.season)}">
                <span class="ladder__bar"></span>
                <span class="ladder__season">${entry.season}</span>
              </a>`;
    })
    .join('');

  const best = Math.min(...history.map((entry) => entry.tier));
  const worst = Math.max(...history.map((entry) => entry.tier));

  return `
    <h2>Ligaverlauf</h2>
    <p class="muted small">
      Höchste erreichte Liga: Tier ${best} · tiefste: Tier ${worst} ·
      Spannweite ${worst - best} ${worst - best === 1 ? 'Stufe' : 'Stufen'}.
      Ein Klick springt in die jeweilige Saison.
    </p>
    <div class="ladder">${cells}</div>`;
}

function renderParts(parts: ReturnType<typeof teamParts>): string {
  if (!parts.length) return '';
  const items = parts
    .map((part) => {
      const percent = capPercent(part.performance, part.cap);
      return `
      <li class="part">
        <span class="part__label">${escapeHtml(PART_LABEL[part.part_key] ?? part.part_key)}</span>
        <span class="part__bar"><span class="part__fill" style="width:${percent.toFixed(1)}%"></span></span>
        <span class="part__value">
          ${formatNumber(part.performance)} <span class="muted">/ ${formatNumber(part.cap)}</span>
          <span class="muted small"> · Standfestigkeit ${part.reliability}</span>
        </span>
      </li>`;
    })
    .join('');

  return `
    <h2>Bauteilgruppen</h2>
    <p class="muted small">
      Der Balken zeigt die Ausschöpfung des Reglementdeckels dieser Liga. Beim Aufstieg
      steigt der Deckel, die eigenen Werte bleiben zunächst gleich – daher kommt der
      Nachteil, den ein Aufsteiger im ersten Jahr aufholen muss (Konzept 6.5).
    </p>
    <ul class="parts">${items}</ul>`;
}

function renderRoster(roster: ReturnType<typeof teamRoster>, season: number): string {
  if (!roster.length) return '<h2>Kader</h2><p class="muted">Kein Kader hinterlegt.</p>';

  const rows = roster
    .map(
      (driver) => `
      <tr>
        <td>
          <a class="team-link" href="${withSeason(`#/fahrer/${driver.driver_id}`, season)}">
            ${escapeHtml(driver.name)}
          </a>
          ${driver.is_newgen ? '<span class="tag tag--newgen">Newgen</span>' : ''}
        </td>
        <td>${escapeHtml(ROLE_LABEL[driver.role] ?? driver.role)}</td>
        <td class="num">${ageIn(season, driver.birth_year)}</td>
        <td>${escapeHtml(driver.country)}</td>
        <td class="num">${driver.pace}</td>
        <td class="num">${driver.qualifying}</td>
        <td class="num">${driver.consistency}</td>
        <td class="num muted">${driver.potential}</td>
        <td class="num">${driver.morale}</td>
        <td class="num">${driver.contract_until ?? '—'}</td>
        <td class="num">${formatMoney(driver.salary)}</td>
        <td class="num strong">${driver.points ?? 0}</td>
      </tr>`,
    )
    .join('');

  return `
    <h2>Kader</h2>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Fahrer</th><th>Rolle</th><th class="num">Alter</th><th>Land</th>
            <th class="num">Pace</th><th class="num">Quali</th><th class="num">Konstanz</th>
            <th class="num">Potenzial</th><th class="num">Moral</th>
            <th class="num">Vertrag bis</th><th class="num">Gehalt</th><th class="num">Punkte</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderStaff(staff: ReturnType<typeof teamStaff>, season: number): string {
  if (!staff.length) return '';

  const rows = staff
    .map(
      (person) => `
      <tr>
        <td>${escapeHtml(person.role)}</td>
        <td>${escapeHtml(person.name)} <span class="muted small">${escapeHtml(person.country)}</span></td>
        <td class="num">${ageIn(season, person.birth_year)}</td>
        <td class="num strong">${person.rating}</td>
        <td class="num muted">${person.potential}</td>
        <td class="num">${person.loyalty}</td>
        <td class="num">${person.contract_until ?? '—'}</td>
        <td class="num">${formatMoney(person.salary)}</td>
      </tr>`,
    )
    .join('');

  return `
    <h2>Personal</h2>
    <p class="muted small">
      Neun Stellen je Team, acht Rollen (Konzept 8.1). Was eine Rolle bewirkt, steht in
      <code>staff_roles.csv</code>; wie gut sie besetzt ist, entscheidet über die Entwicklung
      des Autos. Erfolgreiche Leute werden von zwei Ligen höher abgeworben.
    </p>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Rolle</th><th>Name</th><th class="num">Alter</th><th class="num">Wert</th>
            <th class="num">Potenzial</th><th class="num">Loyalität</th>
            <th class="num">Vertrag bis</th><th class="num">Gehalt</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

const LADDER = [0, 1, 4, 16, 60, 200];

function renderFacilities(
  facilities: ReturnType<typeof teamFacilities>,
  moves: ReturnType<typeof teamFacilityMoves>,
): string {
  if (!facilities.length) return '';

  const items = facilities
    .map((facility) => {
      const upkeep = facility.upkeep_base * (LADDER[facility.level] ?? 0);
      const pips = Array.from({ length: 5 }, (_, index) => {
        const filled = index < facility.level ? ' is-filled' : '';
        return `<span class="pip${filled}"></span>`;
      }).join('');
      return `
      <li class="facility">
        <span class="facility__name">
          ${escapeHtml(facility.name)}
          ${facility.licence_checked ? '<span class="tag tag--licence">Lizenz</span>' : ''}
        </span>
        <span class="facility__pips">${pips}</span>
        <span class="facility__level">Stufe ${facility.level}</span>
        <span class="facility__cost">${upkeep > 0 ? `${formatMoney(upkeep)} / Saison` : '<span class="muted">keine Kosten</span>'}</span>
      </li>`;
    })
    .join('');

  const total = facilities.reduce(
    (sum, facility) => sum + facility.upkeep_base * (LADDER[facility.level] ?? 0),
    0,
  );

  const recent = moves.slice(0, 8);
  const moveList = recent.length
    ? `<ul class="moves">
         ${recent
           .map(
             (move) => `<li class="move move--${move.reason}">
               <span class="move__season">S${move.season}</span>
               <span class="move__what">${escapeHtml(move.name)} ${move.from_level} → ${move.to_level}</span>
               <span class="move__label">${move.reason === 'built' ? 'ausgebaut' : 'Zwangsverkauf'}</span>
               <span class="move__amount">${formatMoney(move.amount)}</span>
             </li>`,
           )
           .join('')}
       </ul>`
    : '<p class="muted small">Dieses Team hat nie aus- oder rückgebaut.</p>';

  return `
    <h2>Infrastruktur</h2>
    <p class="muted small">
      Acht Anlagen, Level 0–5 (Konzept 8.2). Die Fixkosten sind <strong>absolut</strong> und
      fallen beim Abstieg nicht mit – wer zu hoch baut, trägt die Rechnung auch eine Liga
      tiefer weiter. Laufende Fixkosten zusammen: <strong>${formatMoney(total)}</strong> je Saison.
    </p>
    <ul class="facilities">${items}</ul>
    <h3>Aus- und Rückbauten</h3>
    ${moveList}`;
}

function renderFinance(
  finance: ReturnType<typeof teamFinances>[number] | undefined,
  all: ReturnType<typeof teamFinances>,
  season: number,
): string {
  if (!finance) return '';

  const rows = all
    .map(
      (entry) => `
      <tr class="${entry.season === season ? 'is-current' : ''}">
        <td class="num">${entry.season}</td>
        <td class="num">${entry.tier}</td>
        <td class="num">${formatSigned(entry.payout)}</td>
        <td class="num">${formatSigned(entry.prize_money)}</td>
        <td class="num">${formatSigned(entry.sponsors)}</td>
        <td class="num">${entry.parachute > 0 ? formatSigned(entry.parachute) : '—'}</td>
        <td class="num">${formatSigned(-entry.expenses)}</td>
        <td class="num">${formatSigned(-(entry.driver_wages + entry.staff_wages))}</td>
        <td class="num">${formatSigned(-entry.facility_cost)}</td>
        <td class="num">${formatSigned(-(entry.engine_lease + entry.logistics))}</td>
        <td class="num">${entry.investment > 0 ? formatSigned(-entry.investment) : '—'}</td>
        <td class="num strong">${formatMoney(entry.closing)}</td>
      </tr>`,
    )
    .join('');

  return `
    <h2>Bilanz</h2>
    <p class="muted small">
      Seit M6 vollständig: TV-Ausschüttung nach Vorjahresplatz, Preisgeld nach jedem Rennen,
      Sponsorengelder samt Bonus und Malus, dazu auf der Ausgabenseite Betrieb (Entwicklung
      und Fertigung), Fahrer- und Personalgehälter, Anlagenfixkosten, Motorenleasing und
      Logistik. <em>Betrieb</em> ist der Restposten – was nicht einzeln gebucht wird.
    </p>
    <div class="table-scroll">
      <table class="table table--compact">
        <thead>
          <tr>
            <th class="num">Saison</th><th class="num">Tier</th>
            <th class="num">TV</th><th class="num">Preisgeld</th><th class="num">Sponsoren</th>
            <th class="num">Fallschirm</th><th class="num">Betrieb</th><th class="num">Gehälter</th>
            <th class="num">Anlagen</th><th class="num">Leasing + Logistik</th>
            <th class="num">Ausbau</th><th class="num">Kasse</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Sponsorenvertraege einer Saison (Konzept 9.1).
 *
 * Der Hauptvertrag steht oben, danach die Nebenvertraege. Interessant ist nicht
 * der Betrag, sondern die Zielvorgabe daneben: Sie entscheidet, ob am Ende der
 * Bonus oder der Malus gebucht wird.
 */
function renderSponsors(sponsors: ReturnType<typeof teamSponsors>): string {
  if (!sponsors.length) return '';

  const rows = sponsors
    .map((sponsor) => {
      const objective =
        OBJECTIVE_LABEL[sponsor.objective_type]?.(sponsor.objective_value) ??
        `${sponsor.objective_type} ${sponsor.objective_value}`;
      const verdict =
        sponsor.achieved === null
          ? '<span class="muted">offen</span>'
          : sponsor.achieved
            ? '<span class="tag tag--met">erfüllt</span>'
            : '<span class="tag tag--missed">verfehlt</span>';
      return `
      <tr>
        <td>${sponsor.slot === 'title' ? '<strong>Hauptvertrag</strong>' : '<span class="muted">Nebenvertrag</span>'}</td>
        <td>${escapeHtml(sponsor.name)} <span class="muted small">${escapeHtml(sponsor.industry)}</span></td>
        <td class="num">${sponsor.contract_until}</td>
        <td>${escapeHtml(objective)}</td>
        <td>${verdict}</td>
        <td class="num">${formatMoney(sponsor.base_value)}</td>
        <td class="num strong">${formatMoney(sponsor.payout)}</td>
      </tr>`;
    })
    .join('');

  const total = sponsors.reduce((sum, sponsor) => sum + sponsor.payout, 0);

  return `
    <h2>Sponsoren</h2>
    <p class="muted small">
      Ein Hauptvertrag, dazu vier bis sechs Nebenverträge. Jeder trägt eine Zielvorgabe:
      Wird sie erfüllt, kommt ein Bonus obendrauf, wird sie verfehlt, ein Malus herunter.
      Zusammen in dieser Saison: <strong>${formatMoney(total)}</strong>.
    </p>
    <div class="table-scroll">
      <table class="table table--compact">
        <thead>
          <tr>
            <th>Slot</th><th>Sponsor</th><th class="num">Vertrag bis</th><th>Zielvorgabe</th>
            <th>Ergebnis</th><th class="num">Grundwert</th><th class="num">Ausgezahlt</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Deckelverstoesse (Konzept 9.3).
 *
 * Die Strafe wirkt erst im Folgejahr - wer im Dezember merkt, dass er zu viel
 * ausgegeben hat, kann die Saison nicht mehr aendern.
 */
function renderBreaches(
  breaches: ReturnType<typeof teamCapBreaches>,
  season: number,
): string {
  if (!breaches.length) return '';

  const rows = breaches
    .map(
      (breach) => `
      <tr class="${breach.season === season ? 'is-current' : ''}">
        <td class="num">${breach.season}</td>
        <td class="num">${formatMoney(breach.capped_spend)}</td>
        <td class="num muted">${formatMoney(breach.cost_cap)}</td>
        <td class="num">${(breach.overspend_pct * 100).toFixed(1)} %</td>
        <td class="num">−${breach.penalty_points}</td>
        <td class="num">−${(breach.atr_cut * 100).toFixed(0)} %</td>
      </tr>`,
    )
    .join('');

  return `
    <h2>Kostendeckel</h2>
    <p class="muted small">
      Deckelrelevant sind Betrieb, Anlagen, Personal, Leasing, Logistik und Ausbau –
      Fahrergehälter erst oberhalb eines Freibetrags von 8 % des Deckels (Konzept 9.3).
      Eine Überschreitung kostet Lizenzpunkte und Windkanalzeit, beides in der Folgesaison.
    </p>
    <div class="table-scroll">
      <table class="table table--compact">
        <thead>
          <tr>
            <th class="num">Saison</th><th class="num">Ausgaben</th><th class="num">Deckel</th>
            <th class="num">Überschreitung</th><th class="num">Lizenzpunkte</th><th class="num">Windkanal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
