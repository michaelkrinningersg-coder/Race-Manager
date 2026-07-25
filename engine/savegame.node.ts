/**
 * Savegame-Erzeugung unter Node.
 *
 * Der einzige Teil der Engine, der ein Dateisystem und better-sqlite3 braucht.
 * Alles Weitere steht in savegame.ts und kommt ohne beides aus - sonst waere
 * die Engine im Browser nicht lauffaehig.
 */

import DatabaseConstructor from 'better-sqlite3';
import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database } from './db.js';
import { initSavegame } from './savegame.js';

/**
 * Oeffnet eine Datenbank als Engine-Datenbank.
 *
 * Die Umdeutung ist der einzige Ort im Projekt, an dem better-sqlite3 auf die
 * Schnittstelle aus db.ts trifft. Sie ist strukturell erfuellt - die
 * Typdefinition von better-sqlite3 beschreibt Parameter und Rueckgaben nur
 * weiter, als die Engine sie benutzt.
 */
export function openDatabase(path: string): Database {
  return new DatabaseConstructor(path) as unknown as Database;
}

export function createSavegame(worldPath: string, savePath: string, worldSeed: number): Database {
  mkdirSync(dirname(savePath), { recursive: true });
  try {
    unlinkSync(savePath);
  } catch {
    // Existierte nicht - Normalfall beim ersten Lauf.
  }
  copyFileSync(worldPath, savePath);
  return initSavegame(openDatabase(savePath), worldSeed);
}
