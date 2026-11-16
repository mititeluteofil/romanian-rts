/**
 * Deterministic helpers. The simulation must never touch Math.random(),
 * Date, or transcendental Math functions (sin/cos/pow differ across engines),
 * so that the same seed + the same commands always give the same game.
 */

/** Seeded PRNG (mulberry32). Integer state, identical on every JS engine. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return this.nextU32() % n;
  }
}

/** Stateless 2D integer hash → unsigned 32-bit. */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** FNV-1a over a list of integers; used for state checksums. */
export function fnv1a(values: Iterable<number>): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
