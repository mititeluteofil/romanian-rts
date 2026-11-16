import { hash2 } from './rng';

export const Terrain = {
  Grass: 0,
  Forest: 1,
  Water: 2,
  Mountain: 3,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/** Movement cost multiplier per terrain. 0 = impassable. */
export const MOVE_COST: readonly number[] = [1, 2, 0, 0];

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  terrainAt(x: number, y: number): Terrain {
    return (this.tiles[y * this.width + x] ?? Terrain.Water) as Terrain;
  }

  costAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return MOVE_COST[this.terrainAt(x, y)] ?? 0;
  }

  isPassable(x: number, y: number): boolean {
    return this.costAt(x, y) > 0;
  }
}

/** Value noise in [0, 1). Only + - * / and floor, so it is deterministic. */
function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v = (ix: number, iy: number) => hash2(seed, ix, iy) / 4294967296;
  const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const bottom = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

function fbm(seed: number, x: number, y: number): number {
  return (
    valueNoise(seed, x, y) * 0.5 +
    valueNoise(seed + 101, x * 2, y * 2) * 0.3 +
    valueNoise(seed + 202, x * 4, y * 4) * 0.2
  );
}

/** Tile where the player's first peasants appear (map centre). */
export function spawnPoint(map: GameMap): { x: number; y: number } {
  return { x: map.width >> 1, y: map.height >> 1 };
}

export function generateMap(seed: number, width: number, height: number): GameMap {
  const map = new GameMap(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elevation = fbm(seed, x / 14, y / 14);
      const woods = fbm(seed ^ 0x5bd1e995, x / 6, y / 6);
      let t: Terrain = Terrain.Grass;
      if (elevation < 0.37) t = Terrain.Water;
      else if (elevation > 0.63) t = Terrain.Mountain;
      else if (woods > 0.56) t = Terrain.Forest;
      map.tiles[map.index(x, y)] = t;
    }
  }
  // Guarantee an open meadow around the spawn so the settlement can start.
  const spawn = spawnPoint(map);
  const r = 5;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = spawn.x + dx;
      const y = spawn.y + dy;
      if (dx * dx + dy * dy <= r * r && map.inBounds(x, y)) {
        map.tiles[map.index(x, y)] = Terrain.Grass;
      }
    }
  }
  return map;
}
