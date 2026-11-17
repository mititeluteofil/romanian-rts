import type { GameMap } from './map';

const ORTHO = 10;
const DIAG = 14;

// dx, dy, base cost — fixed order keeps the search deterministic.
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [0, -1, ORTHO],
  [1, 0, ORTHO],
  [0, 1, ORTHO],
  [-1, 0, ORTHO],
  [1, -1, DIAG],
  [1, 1, DIAG],
  [-1, 1, DIAG],
  [-1, -1, DIAG],
];

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ORTHO * (ax + ay) + (DIAG - 2 * ORTHO) * Math.min(ax, ay);
}

/** Min-heap of (f score, tile index) entries; ties broken by index. */
class Heap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];

  get size(): number {
    return this.vals.length;
  }

  private less(i: number, j: number): boolean {
    const ki = this.keys[i]!;
    const kj = this.keys[j]!;
    return ki < kj || (ki === kj && this.vals[i]! < this.vals[j]!);
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i]!;
    this.keys[i] = this.keys[j]!;
    this.keys[j] = k;
    const v = this.vals[i]!;
    this.vals[i] = this.vals[j]!;
    this.vals[j] = v;
  }

  push(key: number, val: number): void {
    let i = this.vals.length;
    this.keys.push(key);
    this.vals.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.vals[0]!;
    const lastKey = this.keys.pop()!;
    const lastVal = this.vals.pop()!;
    const n = this.vals.length;
    if (n > 0) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.less(l, m)) m = l;
        if (r < n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/**
 * Closest tile to (x, y) accepted by `accept`, or -1. Searches growing
 * square rings (perimeter only) and picks the nearest tile in the first ring
 * that has a candidate; ties go to the lowest index, so it is deterministic.
 */
export function nearestTile(
  map: GameMap,
  x: number,
  y: number,
  accept: (index: number, tx: number, ty: number) => boolean,
  maxRadius: number = Math.max(map.width, map.height),
): number {
  for (let r = 0; r <= maxRadius; r++) {
    let best = -1;
    let bestD = 0;
    const consider = (tx: number, ty: number): void => {
      if (!map.inBounds(tx, ty)) return;
      const idx = map.index(tx, ty);
      if (!accept(idx, tx, ty)) return;
      const dx = tx - x;
      const dy = ty - y;
      const d = dx * dx + dy * dy;
      if (best === -1 || d < bestD || (d === bestD && idx < best)) {
        best = idx;
        bestD = d;
      }
    };
    if (r === 0) {
      consider(x, y);
    } else {
      for (let dx = -r; dx <= r; dx++) {
        consider(x + dx, y - r);
        consider(x + dx, y + r);
      }
      for (let dy = -r + 1; dy <= r - 1; dy++) {
        consider(x - r, y + dy);
        consider(x + r, y + dy);
      }
    }
    if (best !== -1) return best;
  }
  return -1;
}

/** Closest passable tile to (x, y) that is not in `taken`, or -1. */
export function nearestPassable(
  map: GameMap,
  x: number,
  y: number,
  taken?: ReadonlySet<number>,
): number {
  return nearestTile(map, x, y, (idx, tx, ty) => map.isPassable(tx, ty) && !taken?.has(idx));
}

/**
 * A* over the tile grid, 8 directions, no cutting corners around obstacles.
 * Returns the tiles to walk through, first step first, goal last. If the goal
 * cannot be reached, returns the path to the reachable tile closest to it.
 * An empty array means "already there / nowhere better to go".
 */
export function findPath(map: GameMap, sx: number, sy: number, gx: number, gy: number): number[] {
  if (!map.inBounds(sx, sy) || !map.inBounds(gx, gy)) return [];
  const w = map.width;
  const size = w * map.height;
  const start = map.index(sx, sy);
  const goal = map.index(gx, gy);
  if (start === goal) return [];

  const g = new Int32Array(size).fill(0x7fffffff);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new Heap();

  g[start] = 0;
  let best = start;
  let bestH = octile(gx - sx, gy - sy);
  open.push(bestH, start);

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      best = goal;
      break;
    }
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const h = octile(gx - cx, gy - cy);
    if (h < bestH || (h === bestH && cur < best)) {
      best = cur;
      bestH = h;
    }

    for (const [dx, dy, base] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const cost = map.costAt(nx, ny);
      if (cost === 0) continue;
      if (dx !== 0 && dy !== 0 && (!map.isPassable(cx + dx, cy) || !map.isPassable(cx, cy + dy))) {
        continue;
      }
      const n = ny * w + nx;
      if (closed[n]) continue;
      const tentative = g[cur]! + base * cost;
      if (tentative < g[n]!) {
        g[n] = tentative;
        cameFrom[n] = cur;
        open.push(tentative + octile(gx - nx, gy - ny), n);
      }
    }
  }

  const path: number[] = [];
  for (let n = best; n !== start && n !== -1; n = cameFrom[n]!) path.push(n);
  path.reverse();
  return path;
}
