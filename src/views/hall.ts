import type { Database } from 'sql.js';
import { careers, champions, type CareerRow, type WorldInfo } from '../data/queries';
import { escapeHtml, formatNumber, withSeason } from '../ui/format';

/**
 * Ruhmeshalle (Konzept 19, M7 Feinschliff).
 *
 * ZWEI AUFNAHMEBEDINGUNGEN, beide direkt aus den Daten pruefbar (getroffene
 * Entscheidung):
 *
 *   1. mindestens ein Ligatitel, in welcher Liga auch immer
 *   2. ein Karriereaufstieg von mindestens drei Ligen
 *
 * Die zweite Bedingung ist der Grund, warum es nicht bei den Tier-1-Meistern
 * bleibt. Ein Fahrer, der in Tier 9 anfaengt und Tier 4 erreicht, hat die
 * Geschichte erlebt, die dieses Spiel behauptet - und ohne sie waere die
 * Ruhmeshalle eine Liste von zwanzig Namen aus einer von zehn Ligen.
 *
 * Bezugspunkt des Aufstiegs ist die Liga der ERSTEN Saison, nicht die
 * schlechteste der Karriere. Sonst waere ein Fahrer, der von Tier 2 auf Tier 8
 * durchgereicht wird und einmal Tier 5 sieht, ein Aufsteiger.
 */

/** Wie viele Ligen ein Fahrer gestiegen sein muss, wenn er keinen Titel hat. */
const CLIMB_THRESHOLD = 3;

interface Member extends CareerRow {
  climb: number;
  titleTiers: number[];
}

export function renderHall(db: Database, season: number, info: WorldInfo): string {
  const titlesByDriver = new Map<number, number[]>();
  for (const entry of champions(db)) {
    const list = titlesByDriver.get(entry.driver_id);
    if (list) list.push(entry.tier);
    else titlesByDriver.set(entry.driver_id, [entry.tier]);
  }

  const members: Member[] = careers(db)
    .map((row) => ({
      ...row,
      climb: row.first_tier - row.best_tier,
      titleTiers: (titlesByDriver.get(row.driver_id) ?? []).sort((a, b) => a - b),
    }))
    .filter((row) => row.titles > 0 || row.climb >= CLIMB_THRESHOLD)
    // Titel zuerst, danach der weiteste Aufstieg, danach die Siege. Ohne die
    // dritte Stufe stuenden Namensvettern in zufaelliger Reihenfolge.
    .sort((a, b) => b.titles - a.titles || b.climb - a.climb || b.wins - a.wins);

  const titled = members.filter((row) => row.titles > 0);
  const climbers = members.filter((row) => row.titles === 0);

  const card = (row: Member): string => {
    const reason =
      row.titles > 0
        ? `${row.titles} Titel in Tier ${[...new Set(row.titleTiers)].join(', ')}`
        : `Aufstieg über ${row.climb} Ligen`;

    return `
      <article class="hof-card">
        <header class="hof-card__head">
          <a class="hof-card__name" href="${withSeason(`#/fahrer/${row.driver_id}`, season)}">
            ${escapeHtml(row.name)}
          </a>
          <span class="hof-card__country">${escapeHtml(row.country)}</span>
        </header>
        <p class="hof-card__reason">${escapeHtml(reason)}</p>
        <dl class="hof-card__stats">
          <div><dt>Saisons</dt><dd>${row.seasons}</dd></div>
          <div><dt>Starts</dt><dd>${formatNumber(row.starts)}</dd></div>
          <div><dt>Siege</dt><dd>${formatNumber(row.wins)}</dd></div>
          <div><dt>Podeste</dt><dd>${formatNumber(row.podiums)}</dd></div>
        </dl>
        <p class="hof-card__path">
          Tier ${row.first_tier} → Tier ${row.best_tier}
          <span class="muted">· Saison ${row.first_season}–${row.last_season}</span>
        </p>
      </article>`;
  };

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">${members.length} Aufnahmen · ${info.seasons} Saisons</span>
          <h1>Ruhmeshalle</h1>
          <p class="lead">
            Wer einen Titel gewonnen hat – oder über die Karriere mindestens
            ${CLIMB_THRESHOLD} Ligen aufgestiegen ist.
          </p>
        </div>
      </header>

      <p class="muted small">
        Zwei Bedingungen, keine Punktwertung. Die zweite ist der Grund, warum hier nicht nur
        die ${info.seasons} Meister der obersten Liga stehen: Ein Fahrer, der in Tier 9 anfängt
        und Tier 4 erreicht, hat die Geschichte erlebt, um die es in einer Pyramide geht.
        Bezugspunkt ist die Liga der ersten Saison – wer durchgereicht wird und einmal wieder
        hochkommt, ist kein Aufsteiger.
      </p>

      <h2>Titelträger <span class="muted">(${titled.length})</span></h2>
      ${
        titled.length
          ? `<div class="hof-grid">${titled.map(card).join('')}</div>`
          : '<p class="muted small">Noch kein Titel vergeben.</p>'
      }

      <h2>Aufstiegshelden <span class="muted">(${climbers.length})</span></h2>
      <p class="muted small">
        Ohne Titel, aber mit einem Karriereweg über mindestens ${CLIMB_THRESHOLD} Ligen nach oben.
      </p>
      ${
        climbers.length
          ? `<div class="hof-grid">${climbers.map(card).join('')}</div>`
          : '<p class="muted small">Bisher ist niemand weit genug aufgestiegen.</p>'
      }
    </section>`;
}
