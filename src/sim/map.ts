import {
  ARDEAL_AREA,
  BORDER,
  BORDER_RIVER_HALF_WIDTH,
  BORDER_RIVERS,
  DOBROGEA_AREA,
  LAT_NORTH,
  LON_WEST,
  MAP_HEIGHT,
  MAP_WIDTH,
  MOLDOVA_SOUTH_LINE,
  MOUNTAINS,
  PASS_HALF_WIDTH,
  PASSES,
  PLACES,
  Region,
  RIVERS,
  SEA_NORTH_LAT,
  SEA_WEST_LON,
  TILES_PER_LAT,
  TILES_PER_LON,
  type LonLat,
  type Place,
} from '../data/romania';
import { hash2 } from './rng';

export const Terrain = {
  Grass: 0,
  Forest: 1,
  Water: 2,
  Mountain: 3,
  /** Beyond the border. Nobody goes there (yet). */
  Abroad: 4,
  /** Shallow river crossing: slow, but passable. */
  Ford: 5,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/** Movement cost multiplier per terrain. 0 = impassable. */
export const MOVE_COST: readonly number[] = [1, 2, 0, 0, 0, 3];

/** Wood in a fresh forest tile; it becomes grass when this runs out. */
export const WOOD_PER_FOREST = 40;

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  /** Region (principality) of each tile; see data/romania.ts. */
  readonly regions: Uint8Array;
  /** Wood left in each forest tile. */
  readonly wood: Uint8Array;
  /** 1 where a building blocks movement. */
  readonly blocked: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height);
    this.regions = new Uint8Array(width * height);
    this.wood = new Uint8Array(width * height);
    this.blocked = new Uint8Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  terrainAt(x: number, y: number): Terrain {
    return (this.tiles[y * this.width + x] ?? Terrain.Abroad) as Terrain;
  }

  regionAt(x: number, y: number): Region {
    if (!this.inBounds(x, y)) return Region.None;
    return (this.regions[y * this.width + x] ?? Region.None) as Region;
  }

  costAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    const i = y * this.width + x;
    if (this.blocked[i]) return 0;
    return MOVE_COST[this.tiles[i]!] ?? 0;
  }

  isPassable(x: number, y: number): boolean {
    return this.costAt(x, y) > 0;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers. Only + - * / and comparisons: deterministic everywhere.
// Everything below works in tile space (floats), y pointing south.
// ---------------------------------------------------------------------------

type Pt = readonly [number, number];

export function lonToX(lon: number): number {
  return (lon - LON_WEST) * TILES_PER_LON;
}

export function latToY(lat: number): number {
  return (LAT_NORTH - lat) * TILES_PER_LAT;
}

function project(points: readonly LonLat[]): Pt[] {
  return points.map(([lon, lat]) => [lonToX(lon), latToY(lat)] as const);
}

/** Tile that contains a place. */
export function placeTile(place: Place): { x: number; y: number } {
  return { x: Math.floor(lonToX(place.at[0])), y: Math.floor(latToY(place.at[1])) };
}

function insidePolygon(px: number, py: number, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distSqToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((px - a[0]) * abx + (py - a[1]) * aby) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (a[0] + abx * t);
  const dy = py - (a[1] + aby * t);
  return dx * dx + dy * dy;
}

function distSqToLine(px: number, py: number, line: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const d = distSqToSegment(px, py, line[i]!, line[i + 1]!);
    if (d < best) best = d;
  }
  return best;
}

/** y of a west→east polyline at x, clamped to its end points. */
function lineYAt(x: number, line: readonly Pt[]): number {
  const first = line[0]!;
  const last = line[line.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (x >= a[0] && x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
  }
  return last[1];
}

/** Value noise in [0, 1). */
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
  return valueNoise(seed, x, y) * 0.6 + valueNoise(seed + 101, x * 2, y * 2) * 0.4;
}

// ---------------------------------------------------------------------------

/**
 * Build the map of Romania. The outline, mountains, rivers and regions come
 * from data/romania.ts; the seed only varies the forests and the ragged edge
 * of the mountains.
 */
export function generateRomania(seed: number): GameMap {
  const map = new GameMap(MAP_WIDTH, MAP_HEIGHT);

  const border = project(BORDER);
  const ardeal = project(ARDEAL_AREA);
  const dobrogea = project(DOBROGEA_AREA);
  const moldovaSouth = project(MOLDOVA_SOUTH_LINE);
  const chains = MOUNTAINS.map((c) => ({ halfWidth: c.halfWidth, line: project(c.points) }));
  const passes = PASSES.map((p) => project(p.line));
  const rivers = RIVERS.map((r) => ({
    halfWidth: r.halfWidth,
    line: project(r.points),
    fords: project(r.fords),
  }));
  const borderRivers = BORDER_RIVERS.map((r) => project(r));
  const seaX = lonToX(SEA_WEST_LON);
  const seaY = latToY(SEA_NORTH_LAT);
  const seaShoulderX = lonToX(29.78);

  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const px = tx + 0.5;
      const py = ty + 0.5;
      const i = map.index(tx, ty);

      let onBorderRiver = false;
      for (const line of borderRivers) {
        if (distSqToLine(px, py, line) <= BORDER_RIVER_HALF_WIDTH * BORDER_RIVER_HALF_WIDTH) {
          onBorderRiver = true;
          break;
        }
      }
      if (onBorderRiver) {
        map.tiles[i] = Terrain.Water;
        continue;
      }

      if (!insidePolygon(px, py, border)) {
        // South of the Chilia arm the sea starts at the coast; north of it the
        // shore runs off to the north-east (the Bugeac belongs to the neighbours).
        const isSea = px >= seaX && (py >= seaY || px >= seaShoulderX + (seaY - py) * 0.65);
        map.tiles[i] = isSea ? Terrain.Water : Terrain.Abroad;
        continue;
      }

      // Region
      let region: Region;
      if (insidePolygon(px, py, dobrogea)) region = Region.Dobrogea;
      else if (insidePolygon(px, py, ardeal)) region = Region.Ardeal;
      else if (py < lineYAt(px, moldovaSouth)) region = Region.Moldova;
      else region = Region.TaraRomaneasca;
      map.regions[i] = region;

      // Rivers and fords
      let terrain: Terrain | undefined;
      for (const river of rivers) {
        if (distSqToLine(px, py, river.line) > river.halfWidth * river.halfWidth) continue;
        terrain = Terrain.Water;
        const reach = river.halfWidth + 0.75;
        for (const ford of river.fords) {
          const dx = px - ford[0];
          const dy = py - ford[1];
          if (dx * dx + dy * dy <= reach * reach) terrain = Terrain.Ford;
        }
        break;
      }

      if (terrain === undefined) {
        // How deep into the mountains this tile is (negative = inside a chain).
        let edge = Infinity;
        for (const chain of chains) {
          const d = distSqToLine(px, py, chain.line);
          const reach = chain.halfWidth + 8;
          if (d > reach * reach) continue;
          const e = Math.sqrt(d) - chain.halfWidth;
          if (e < edge) edge = e;
        }
        let inPass = false;
        for (const pass of passes) {
          if (distSqToLine(px, py, pass) <= PASS_HALF_WIDTH * PASS_HALF_WIDTH) inPass = true;
        }
        const ragged = (hash2(seed, tx, ty) / 4294967296 - 0.5) * 0.9;
        if (edge + ragged < 0 && !inPass) {
          terrain = Terrain.Mountain;
        } else {
          // Forests thin out away from the mountains; the plains are almost bare.
          const threshold = edge < 3 ? 0.44 : edge < 8 ? 0.55 : 0.7;
          terrain = fbm(seed ^ 0x5bd1e995, tx / 4, ty / 4) > threshold ? Terrain.Forest : Terrain.Grass;
        }
      }

      map.tiles[i] = terrain;
    }
  }

  // Open ground around the towns so settlements have room to start.
  for (const place of Object.values(PLACES)) {
    const c = placeTile(place);
    const r = 3;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1 || !map.inBounds(c.x + dx, c.y + dy)) continue;
        const i = map.index(c.x + dx, c.y + dy);
        if (map.tiles[i] === Terrain.Forest || map.tiles[i] === Terrain.Mountain) {
          map.tiles[i] = Terrain.Grass;
        }
      }
    }
  }

  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === Terrain.Forest) map.wood[i] = WOOD_PER_FOREST;
  }
  return map;
}
