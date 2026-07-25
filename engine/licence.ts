/**
 * Lizenzpruefung (Konzept 5.1).
 *
 * Der Aufstieg ist sportlich erkaempft, aber genehmigungspflichtig. Scheitert
 * die Lizenz, rueckt das naechstplatzierte lizenzfaehige Team nach - das ist
 * `licence_fallback = next_eligible` aus promotion_rules.csv.
 */

import type { Facilities } from './facilities.js';

export interface LicenceRequirement {
  tier: number;
  minLiquidityPct: number;
  minWindtunnel: number;
  minDyno: number;
  minSimulator: number;
  minFactory: number;
  minStaff: number;
  needsEngineContract: boolean;
  minLicencePoints: number;
}

export interface LicenceCandidate {
  teamId: number;
  name: string;
  balance: number;
  facilities: Facilities;
  hasEngineContract: boolean;
  licencePoints: number;
}

export interface LicenceVerdict {
  granted: boolean;
  /** Alle nicht erfuellten Kriterien, nicht nur das erste. */
  failures: string[];
}

/**
 * Prueft gegen die Anforderungen der **Zielliga** und deren Kostendeckel -
 * die Liquiditaetshuerde ist ein Anteil davon, nicht des alten Deckels.
 */
export function checkLicence(
  candidate: LicenceCandidate,
  requirement: LicenceRequirement,
  targetCostCap: number,
): LicenceVerdict {
  const failures: string[] = [];

  const requiredLiquidity = requirement.minLiquidityPct * targetCostCap;
  if (candidate.balance < requiredLiquidity) {
    failures.push(
      `Liquiditaet ${Math.round(candidate.balance / 1000)}k unter ${Math.round(requiredLiquidity / 1000)}k`,
    );
  }
  if (candidate.facilities.windtunnel < requirement.minWindtunnel) {
    failures.push(`Windkanal ${candidate.facilities.windtunnel} unter ${requirement.minWindtunnel}`);
  }
  if (candidate.facilities.dyno < requirement.minDyno) {
    failures.push(`Pruefstand ${candidate.facilities.dyno} unter ${requirement.minDyno}`);
  }
  if (candidate.facilities.simulator < requirement.minSimulator) {
    failures.push(`Simulator ${candidate.facilities.simulator} unter ${requirement.minSimulator}`);
  }
  if (candidate.facilities.factory < requirement.minFactory) {
    failures.push(`Fabrik ${candidate.facilities.factory} unter ${requirement.minFactory}`);
  }
  if (candidate.facilities.staff < requirement.minStaff) {
    failures.push(`Personal ${candidate.facilities.staff} unter ${requirement.minStaff}`);
  }
  if (requirement.needsEngineContract && !candidate.hasEngineContract) {
    failures.push('kein Motorenvertrag');
  }
  if (candidate.licencePoints < requirement.minLicencePoints) {
    failures.push(`Lizenzpunkte ${candidate.licencePoints} unter ${requirement.minLicencePoints}`);
  }

  return { granted: failures.length === 0, failures };
}
