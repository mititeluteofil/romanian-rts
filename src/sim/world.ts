import { FACTIONS, type FactionId } from '../data/factions';
import { GameMap, generateMap, spawnPoint, Terrain } from './map';
import { findPath, nearestPassable } from './pathfinding';
import { fnv1a } from './rng';

/** Simulation steps per second. Rendering interpolates between steps. */
export const TICK_RATE = 10;
export const TICK_MS = 1000 / TICK_RATE;

/** Positions are integers: SUB sub-units per tile. No floats in game state. */
export const SUB = 256;
const HALF = SUB >> 1;

/** Base peasant speed in sub-units per tick (~1.5 tiles/s at 100%). */
const BASE_SPEED = 40;

export interface Unit {
  readonly id: number;
  readonly faction: FactionId;
  /** Centre position in sub-units. */
  x: number;
  y: number;
  /** Position at the previous tick, for render interpolation. */
  prevX: number;
  prevY: number;
  /** Remaining waypoints as tile indices, next waypoint LAST (pop to advance). */
  path: number[];
  speed: number;
  facing: 1 | -1;
}

export type Command = {
  readonly type: 'move';
  readonly unitIds: readonly number[];
  readonly tx: number;
  readonly ty: number;
};

export interface WorldOptions {
  readonly seed: number;
  readonly width?: number;
  readonly height?: number;
}

/**
 * The whole game state plus the rules that advance it. Pure logic: no
 * rendering, no input, no clocks. The only way to change it from outside is
 * `issue()` (queued) followed by `step()`, which is what makes replays,
 * saves and — later — lockstep multiplayer possible.
 */
export class World {
  readonly map: GameMap;
  readonly units: Unit[] = [];
  tick = 0;

  private nextId = 1;
  private pending: Command[] = [];

  constructor(options: WorldOptions) {
    this.map = generateMap(options.seed, options.width ?? 80, options.height ?? 80);
    this.spawnStartingUnits();
  }

  private spawnStartingUnits(): void {
    const spawn = spawnPoint(this.map);
    const start: readonly (readonly [FactionId, number, number])[] = [
      ['ardeal', -2, 0],
      ['ardeal', -3, 1],
      ['ardeal', -2, 2],
      ['moldova', 2, 0],
      ['moldova', 3, 1],
    ];
    for (const [faction, dx, dy] of start) this.spawnUnit(faction, spawn.x + dx, spawn.y + dy);
  }

  spawnUnit(faction: FactionId, tx: number, ty: number): Unit {
    const x = tx * SUB + HALF;
    const y = ty * SUB + HALF;
    const unit: Unit = {
      id: this.nextId++,
      faction,
      x,
      y,
      prevX: x,
      prevY: y,
      path: [],
      speed: Math.floor((BASE_SPEED * FACTIONS[faction].speedPercent) / 100),
      facing: faction === 'moldova' ? -1 : 1,
    };
    this.units.push(unit);
    return unit;
  }

  getUnit(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  /** Queue a command; it takes effect at the start of the next step. */
  issue(command: Command): void {
    this.pending.push(command);
  }

  step(): void {
    const commands = this.pending;
    this.pending = [];
    for (const command of commands) this.apply(command);
    for (const unit of this.units) this.moveUnit(unit);
    this.tick++;
  }

  private apply(command: Command): void {
    if (command.type !== 'move') return;
    const units = command.unitIds
      .map((id) => this.getUnit(id))
      .filter((u): u is Unit => u !== undefined)
      .sort((a, b) => a.id - b.id);
    // Each unit gets its own destination tile so a group does not stack.
    const taken = new Set<number>();
    for (const unit of units) {
      const goal = nearestPassable(this.map, command.tx, command.ty, taken);
      if (goal === -1) continue;
      taken.add(goal);
      const gx = goal % this.map.width;
      const gy = (goal - gx) / this.map.width;
      const sx = Math.floor(unit.x / SUB);
      const sy = Math.floor(unit.y / SUB);
      unit.path = findPath(this.map, sx, sy, gx, gy).reverse();
      // Re-centre on the current tile first if the unit was caught mid-step
      // and has nowhere else to go, so it never rests between tiles.
      if (unit.path.length === 0) unit.path.push(this.map.index(sx, sy));
    }
  }

  private moveUnit(unit: Unit): void {
    unit.prevX = unit.x;
    unit.prevY = unit.y;
    if (unit.path.length === 0) return;

    const w = this.map.width;
    const inForest =
      this.map.terrainAt(Math.floor(unit.x / SUB), Math.floor(unit.y / SUB)) === Terrain.Forest;
    let budget = inForest ? unit.speed >> 1 : unit.speed;

    while (budget > 0 && unit.path.length > 0) {
      const next = unit.path[unit.path.length - 1]!;
      const tx = next % w;
      const ty = (next - tx) / w;
      const dx = tx * SUB + HALF - unit.x;
      const dy = ty * SUB + HALF - unit.y;
      if (dx !== 0) unit.facing = dx > 0 ? 1 : -1;
      // Math.sqrt is correctly rounded by spec, so this stays deterministic.
      const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));
      if (dist <= budget) {
        unit.x += dx;
        unit.y += dy;
        budget -= dist;
        unit.path.pop();
      } else {
        unit.x += Math.trunc((dx * budget) / dist);
        unit.y += Math.trunc((dy * budget) / dist);
        budget = 0;
      }
    }
  }

  isMoving(unit: Unit): boolean {
    return unit.path.length > 0 || unit.x !== unit.prevX || unit.y !== unit.prevY;
  }

  /** Checksum of the full state; two clients in sync always agree on it. */
  checksum(): number {
    const values: number[] = [this.tick];
    for (const u of this.units) values.push(u.id, u.x, u.y, u.path.length);
    return fnv1a(values);
  }
}
