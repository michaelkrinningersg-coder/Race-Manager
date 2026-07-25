/**
 * M1: eine komplette Saison ueber alle zehn Ligen.
 *
 * Aufruf:
 *   npm run season                    # Saison 1, schreibt build/savegame.db
 *   npm run season -- --seasons 10    # zehn Saisons mit Auf- und Abstieg
 *   npm run season -- --seed 20260724
 *   npm run season -- --world <pfad> --out <pfad>
 *   npm run season -- --quiet         # nur die Kennzahlen, keine Tabellen
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSavegame } from './savegame.js';
import { seedCarParts } from './car.js';
import { applyFinances, buildStandings, prepareSeason, runSeason } from './season.js';
import { resolveMovements } from './promotion.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Options {
  worldPath: string;
  savePath: string;
  seed: number;
  seasons: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    worldPath: resolve(repoRoot, 'build', 'world_data.db'),
    savePath: resolve(repoRoot, 'build', 'savegame.db'),
    seed: 20260724,
    seasons: 1,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quiet') options.quiet = true;
    else if (arg === '--world') options.worldPath = resolve(argv[++i]);
    else if (arg === '--out') options.savePath = resolve(argv[++i]);
    else if (arg === '--seed') options.seed = Number(argv[++i]);
    else if (arg === '--seasons') options.seasons = Number(argv[++i]);
    else {
      console.error(`Unbekannte Option: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

function printLeagueTable(db: ReturnType<typeof createSavegame>, tier: number, season: number): void {
  const league = db.prepare('SELECT name, short_name FROM leagues WHERE tier = ?').get(tier) as {
    name: string;
    short_name: string;
  };
  const rows = db
    .prepare(
      `SELECT ts.final_rank r, t.name, t.code, ts.points p, ts.wins w, ts.podiums pod, ts.dnfs d, ts.movement m
       FROM team_seasons ts JOIN teams t ON t.team_id = ts.team_id
       WHERE ts.season = ? AND ts.tier = ? ORDER BY ts.final_rank`,
    )
    .all(season, tier) as Record<string, number | string>[];

  const MARK: Record<string, string> = {
    promoted: 'AUF',
    promoted_barrage: 'AUF*',
    relegated: 'AB',
    relegated_barrage: 'AB*',
    licence_denied: 'LIZ!',
    licence_loss: 'LIZ-',
  };

  console.log(`\n  Tier ${tier} - ${league.name}`);
  console.log('    Pl  Team                        Pkt   S  Pod  DNF');
  for (const row of rows) {
    const mark = MARK[String(row.m ?? '')] ?? '';
    console.log(
      `    ${String(row.r).padStart(2)}  ${String(row.name).padEnd(26).slice(0, 26)} ${String(row.p).padStart(4)} ${String(row.w).padStart(3)} ${String(row.pod).padStart(4)} ${String(row.d).padStart(4)}  ${mark}`,
    );
  }

  const champion = db
    .prepare(
      `SELECT d.first_name || ' ' || d.last_name AS name, t.code, ds.points p, ds.wins w, ds.poles po
       FROM driver_seasons ds
       JOIN drivers d ON d.driver_id = ds.driver_id
       JOIN teams t ON t.team_id = ds.team_id
       WHERE ds.season = ? AND ds.tier = ? AND ds.final_rank = 1`,
    )
    .get(season, tier) as Record<string, number | string> | undefined;
  if (champion) {
    console.log(
      `    Fahrertitel: ${champion.name} (${champion.code}), ${champion.p} Punkte, ${champion.w} Siege, ${champion.po} Poles`,
    );
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(options.worldPath)) {
    console.error(`world_data.db fehlt: ${options.worldPath}`);
    console.error('Zuerst "npm run bootstrap" ausfuehren.');
    process.exit(1);
  }

  console.log('APEX-Saisonlauf');
  console.log(`  Welt:     ${options.worldPath}`);
  console.log(`  Savegame: ${options.savePath}`);
  console.log(`  Seed:     ${options.seed}`);
  console.log(`  Saisons:  ${options.seasons}`);

  const db = createSavegame(options.worldPath, options.savePath, options.seed);

  try {
    const started = process.hrtime.bigint();
    let totalWeekends = 0;
    let totalResults = 0;
    let totalDnfs = 0;

    for (let season = 1; season <= options.seasons; season += 1) {
      prepareSeason(db, season);
      seedCarParts(db, season);

      const summary = runSeason(db, season);
      buildStandings(db, season);
      applyFinances(db, season);
      const movements = resolveMovements(db, season);

      totalWeekends += summary.weekends;
      totalResults += summary.results;
      totalDnfs += summary.dnfs;

      console.log(
        `\n  Saison ${season}: ${summary.weekends} Wochenenden, ${movements.promoted} Aufstiege, ` +
          `${movements.relegated} Abstiege, ${movements.barrages} Barragen, ` +
          `${movements.licenceDenied} Lizenz verweigert, ${movements.licenceLoss} Lizenzverlust`,
      );

      db.prepare('UPDATE game_state SET current_season = ? WHERE id = 1').run(season);
    }

    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`\n  Rennwochenenden gesamt: ${totalWeekends}`);
    console.log(`  Einzelergebnisse:       ${totalResults}`);
    console.log(
      `  Ausfaelle:              ${totalDnfs} (${((100 * totalDnfs) / totalResults).toFixed(1)} %)`,
    );
    console.log(`  Rechenzeit:             ${ms.toFixed(0)} ms`);

    if (!options.quiet) {
      console.log(`\n  --- Abschlusstabellen Saison ${options.seasons} ---`);
      for (let tier = 1; tier <= 10; tier += 1) printLeagueTable(db, tier, options.seasons);
    }

    console.log(`\nFertig: ${options.savePath}`);
  } finally {
    db.close();
  }
}

main();
