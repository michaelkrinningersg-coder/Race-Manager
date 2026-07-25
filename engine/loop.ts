/**
 * Eine Saison von Anfang bis Ende (Konzept 13.2).
 *
 * Stand bis v0.20.0 im Rumpf der CLI. Dort war sie nicht aufrufbar - und damit
 * war die Spielschleife des Spiels genau in der Datei eingesperrt, die es nie
 * ausliefert. Der Karrieremodus im Browser braucht dieselbe Abfolge, und zwei
 * Fassungen davon waeren zwei verschiedene Spiele.
 *
 * DIE REIHENFOLGE IST DER INHALT dieser Datei. Sie ist an mehreren Stellen
 * zwingend und an keiner beliebig; die Begruendungen stehen als Kommentare an
 * den jeweiligen Schritten. Wer hier etwas verschiebt, aendert das Spiel.
 */

import type { Database } from './db.js';
import { seedCarParts } from './car.js';
import { applyFinances, buildStandings, prepareSeason, runSeason } from './season.js';
import { resolveMovements } from './promotion.js';
import { developParts } from './development.js';
import {
  ageAndDevelop,
  awardSuperlicence,
  generateNewgens,
  retireDrivers,
  runMarket,
  seedDriverState,
} from './careers.js';
import { ageStaff, generateStaffNewcomers, retireStaff, runStaffMarket, seedStaff } from './staff.js';
import { carryFacilities, forceSales, planInvestments, seedFacilities } from './facilities.js';
import { assignSponsors, settleSponsors } from './sponsors.js';
import { checkCostCaps } from './costcap.js';

export interface SeasonReport {
  season: number;
  weekends: number;
  results: number;
  dnfs: number;
  retired: number;
  newgens: number;
  signings: number;
  unfilled: number;
  overBudget: number;
  poached: number;
  hired: number;
  upgrades: number;
  invested: number;
  sales: number;
  recovered: number;
  sponsorsSigned: number;
  sponsorsMet: number;
  sponsorsMissed: number;
  capBreaches: number;
  promoted: number;
  relegated: number;
  barrages: number;
  licenceDenied: number;
  licenceLoss: number;
}

function empty(season: number): SeasonReport {
  return {
    season,
    weekends: 0,
    results: 0,
    dnfs: 0,
    retired: 0,
    newgens: 0,
    signings: 0,
    unfilled: 0,
    overBudget: 0,
    poached: 0,
    hired: 0,
    upgrades: 0,
    invested: 0,
    sales: 0,
    recovered: 0,
    sponsorsSigned: 0,
    sponsorsMet: 0,
    sponsorsMissed: 0,
    capBreaches: 0,
    promoted: 0,
    relegated: 0,
    barrages: 0,
    licenceDenied: 0,
    licenceLoss: 0,
  };
}

/**
 * Alles, was VOR den Rennen passiert: Entwicklung, Ausbau, Personal, Fahrer.
 *
 * Getrennt vom Rest, weil der Karrieremodus genau hier anhalten muss. Der
 * Spieler trifft seine Entscheidungen zwischen Vorbereitung und Rennen - danach
 * ist die Saison gelaufen, und vorher gibt es noch nichts zu entscheiden.
 */
export function prepareSeasonStart(db: Database, season: number, report: SeasonReport): void {
  prepareSeason(db, season);
  // Sponsorenvertraege werden vor der Saison geschlossen - der Wert haengt am
  // Vorjahresplatz, die Zielvorgabe gilt fuer das kommende Jahr.
  report.sponsorsSigned += assignSponsors(db, season).signed;

  // Nur die erste Saison wird aus Prestige und Deckel abgeleitet. Danach traegt
  // jedes Team sein gewachsenes Auto weiter (Konzept 6.3).
  if (season === 1) {
    seedCarParts(db, season);
    seedDriverState(db);
    seedStaff(db);
    seedFacilities(db, season);
    return;
  }

  // Entwicklung zuerst: Sie rechnet mit dem Personal UND den Anlagen der
  // Vorsaison, die bis hierher unangetastet in der Datenbank stehen.
  developParts(db, season - 1, season);
  // Erst danach wandert der Anlagenbestand weiter und wird ausgebaut - eine
  // neue Halle wirkt fruehestens auf die Entwicklung des Folgejahrs.
  carryFacilities(db, season - 1, season);
  const built = planInvestments(db, season);
  report.upgrades += built.upgrades;
  report.invested += built.invested;

  ageStaff(db, season - 1, season);
  // Nachwuchsjahrgang VOR dem Markt - sonst gibt es keinen Pool, aus dem er
  // sich bedienen koennte, und jedes Team ruft sich sein Personal selbst herbei.
  generateStaffNewcomers(db, season);
  const staffMarket = runStaffMarket(db, season);
  report.poached += staffMarket.poached;
  report.hired += staffMarket.hired;

  // Fahrerjahr: Altern und Entwicklung, dann Nachwuchs auffuellen, dann die
  // freien Cockpits besetzen. Die Reihenfolge ist zwingend - der Markt kann nur
  // vergeben, wer zu diesem Zeitpunkt schon existiert.
  ageAndDevelop(db, season - 1, season);
  report.newgens += generateNewgens(db, season);
  const market = runMarket(db, season);
  report.signings += market.signings;
  report.unfilled += market.unfilled;
  report.overBudget += market.overBudget;
}

/** Rennen, Bilanz, Lizenz, Auf- und Abstieg. */
export function finishSeason(
  db: Database,
  season: number,
  tickTier: number,
  report: SeasonReport,
): void {
  const summary = runSeason(db, season, tickTier);
  report.weekends += summary.weekends;
  report.results += summary.results;
  report.dnfs += summary.dnfs;

  buildStandings(db, season);
  // Zielvorgaben auswerten, bevor die Bilanz sie braucht.
  const sponsorResult = settleSponsors(db, season);
  report.sponsorsMet += sponsorResult.achieved;
  report.sponsorsMissed += sponsorResult.missed;

  applyFinances(db, season);
  // Deckelpruefung auf der fertigen Bilanz. Die Strafe wirkt im Folgejahr.
  report.capBreaches += checkCostCaps(db, season).breaches;

  // Zwangsverkauf direkt nach der Bilanz und noch vor der Lizenzpruefung: Wer
  // im Minus steht, geht ohne die verkaufte Anlage in die Pruefung - und faellt
  // genau dann durch, wenn er sich aus der Not heraus unter das Ligaminimum
  // verkauft hat (Konzept 9.4).
  const sold = forceSales(db, season);
  report.sales += sold.sales;
  report.recovered += sold.recovered;

  // Superlizenzpunkte vor den Ruecktritten: Wer aufhoert, hat sie sich in
  // dieser Saison trotzdem verdient - und sie zaehlen fuer die Statistik.
  awardSuperlicence(db, season);
  report.retired += retireDrivers(db, season);
  retireStaff(db, season);

  const movements = resolveMovements(db, season);
  report.promoted += movements.promoted;
  report.relegated += movements.relegated;
  report.barrages += movements.barrages;
  report.licenceDenied += movements.licenceDenied;
  report.licenceLoss += movements.licenceLoss;

  db.prepare('UPDATE game_state SET current_season = ? WHERE id = 1').run(season);
}

/** Eine vollstaendige Saison in einem Aufruf - der Weg der CLI. */
export function advanceSeason(db: Database, season: number, tickTier: number): SeasonReport {
  const report = empty(season);
  prepareSeasonStart(db, season, report);
  finishSeason(db, season, tickTier, report);
  return report;
}

export { empty as emptyReport };
