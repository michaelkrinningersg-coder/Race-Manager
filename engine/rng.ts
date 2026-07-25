/**
 * Deterministischer Zufall.
 *
 * Jede Zufallsentscheidung der Light-Sim leitet ihren Seed aus Saison, Liga,
 * Runde und Lauf ab. Damit ist eine Saison exakt reproduzierbar, ohne dass
 * irgendwo Zustand zwischen den Rennen mitgeschleppt werden muss - dieselbe
 * Eigenschaft, die der Bootstrapper fuer die Datenbank hat.
 */

/** mulberry32: klein, schnell, ausreichend gleichverteilt fuer Spielzwecke. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stabiler Seed aus mehreren ganzen Zahlen. */
export function seedFrom(...parts: number[]): number {
  let hash = 2166136261;
  for (const part of parts) {
    hash ^= part;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Standardnormalverteilte Zufallszahl (Box-Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
