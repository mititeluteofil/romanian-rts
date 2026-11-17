import { BUILDINGS, ORCHARD_CAPACITY, type BuildingKind } from '../data/buildings';
import { BRIBE_ERA, ERAS, LAST_ERA } from '../data/eras';
import {
  enemyOf,
  FACTION_IDS,
  FACTIONS,
  isFighter,
  type AbilityId,
  type FactionId,
  type UnitKind,
} from '../data/factions';
import { PLACES } from '../data/romania';
import { GameMap, generateRomania, placeTile, Terrain } from './map';
import { findPath, nearestPassable, nearestTile } from './pathfinding';
import { fnv1a, Rng } from './rng';

/** Simulation steps per second. Rendering interpolates between steps. */
export const TICK_RATE = 10;
export const TICK_MS = 1000 / TICK_RATE;

/** Positions are integers: SUB sub-units per tile. No floats in game state. */
export const SUB = 256;
const HALF = SUB >> 1;

// --- Balance (era 1) ---
/** Base walking speed in sub-units per tick (~1.5 tiles/s at 100%). */
const BASE_SPEED = 40;
/** What a peasant carries per trip. */
const CARRY = 5;
/** Work needed per load; a peasant does 2 per tick, 3 after a drink. */
const WORK_PER_LOAD = 80;
const WORK_RATE = 2;
const WORK_RATE_BUFFED = 3;
/** How far a woodcutter looks for the next tree when his runs out. */
const FOREST_SEARCH_RADIUS = 8;
/** Room for this many people, plus some more per apartment block. */
const BASE_UNIT_CAP = 24;
const UNITS_PER_BLOC = 6;
const MAX_UNIT_CAP = 48;
/** A bribe finishes the job at once — unless it is simply pocketed. */
export const BRIBE_PRUNE = 20;
const BRIBE_POCKETED_ONE_IN = 5;
/** The sawmill turns out one wood this often. */
const GATER_TICKS = 20;
/** European funds, for those who made it to the present. */
export const FUNDS_EVERY = 600;
export const FUNDS_AMOUNT = 60;
/** Scandals: who gets caught up, for how long, and how often they start. */
const SCANDAL_RADIUS = 3 * SUB;
const SCANDAL_STUN = 50;
const SCANDAL_MIN_GAP = 300;
const SCANDAL_GAP_SPREAD = 200;
const SCANDAL_RETRY = 50;
export const DISTILL_TICKS = 80;
const DISTILL_PRUNE = 5;
const DISTILL_LEMN = 1;
/** Pălincă: own units pause this long, nearby enemies longer, then the buff runs. */
const DRINK_TICKS = 30;
const ENEMY_DRINK_TICKS = 50;
const BUFF_TICKS = 300;
const DRINK_RADIUS = 5 * SUB;
/** Taunt: enemies this close must attack the taunter for this long. */
const TAUNT_RADIUS = 5 * SUB;
const TAUNT_TICKS = 50;
/** Melee reach, and how far a soldier notices an enemy. */
const ATTACK_RANGE = SUB + HALF;
const AGGRO_RADIUS = 5 * SUB;
const REPATH_TICKS = 8;

export type ResourceKind = 'lemn' | 'prune' | 'palinca';
export type Stock = Record<ResourceKind, number>;

export type Order =
  | { type: 'idle' }
  | { type: 'move' }
  | {
      type: 'gather';
      resource: 'lemn' | 'prune';
      /** Tile the peasant works on. */
      tile: number;
      /** Orchard id for plums, 0 for wood. */
      buildingId: number;
      phase: 'going' | 'working' | 'returning';
      work: number;
    }
  | {
      type: 'build';
      buildingId: number;
      phase: 'going' | 'working';
      /** The job he was pulled away from, to go back to afterwards. */
      resume: { resource: 'lemn' | 'prune'; tile: number; buildingId: number } | null;
    }
  | {
      type: 'attack';
      /** What he was told to attack (unit or building id). */
      target: number;
      /** What he is fighting right now: the target, or a threat on the way. */
      current: number;
      /** Ticks during which `current` may not change (he was taunted). */
      lock: number;
      repath: number;
    };

const ORDER_CODE: Readonly<Record<Order['type'], number>> = { idle: 0, move: 1, gather: 2, build: 3, attack: 4 };

export interface Unit {
  readonly id: number;
  readonly faction: FactionId;
  readonly kind: UnitKind;
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
  order: Order;
  hp: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly attackCooldown: number;
  /** Ticks until he can hit again. */
  cooldown: number;
  /** Ticks of "takes half damage" left (he is the one taunting). */
  shield: number;
  carryKind: 'lemn' | 'prune';
  carryAmount: number;
  /** Ticks left standing around with a glass in hand. */
  drink: number;
  /** Ticks left gawping at (or caught up in) a scandal. */
  stun: number;
  /** Băieți de băieți only: ticks until he starts the next scandal. */
  scandalIn: number;
}

export interface Building {
  readonly id: number;
  readonly kind: BuildingKind;
  readonly faction: FactionId;
  /** Top-left tile of the footprint. */
  readonly tx: number;
  readonly ty: number;
  hp: number;
  readonly maxHp: number;
  /** Builder-ticks of work still needed. */
  buildLeft: number;
  done: boolean;
  /** Units waiting to be trained (first is in progress), and ticks left on it. */
  queue: UnitKind[];
  trainLeft: number;
  /** Cazan: ticks left on the current batch, 0 when idle. */
  distillLeft: number;
  /** Gater: ticks until the next plank. */
  sawLeft: number;
  /** Court: ticks left until the next era begins, 0 when not advancing. */
  advanceLeft: number;
}

type UnitIds = readonly number[];
export type Command =
  | { readonly type: 'move'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly tx: number; readonly ty: number }
  /** "Do the obvious thing here": chop, pick, help build, attack, or just walk. */
  | { readonly type: 'act'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly tx: number; readonly ty: number }
  | { readonly type: 'attack'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly targetId: number }
  | { readonly type: 'build'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly kind: BuildingKind; readonly tx: number; readonly ty: number }
  /** `kind` defaults to the first thing the building trains. */
  | { readonly type: 'train'; readonly faction: FactionId; readonly buildingId: number; readonly kind?: UnitKind }
  /** Start moving the faction's court into the next era. */
  | { readonly type: 'advance'; readonly faction: FactionId }
  /** Pay to have a building site or a training finished on the spot. */
  | { readonly type: 'bribe'; readonly faction: FactionId; readonly buildingId: number }
  /** The faction's signature ability; `unitId` is who does it, where that matters. */
  | { readonly type: 'ability'; readonly faction: FactionId; readonly unitId?: number };

/** What an 'act' command at a tile would do. */
export type ActKind = 'build' | 'plums' | 'wood' | 'attack' | 'move';

/** Things the renderer may want to react to. Never read by the simulation. */
export type SimEvent =
  | { readonly type: 'tile'; readonly index: number }
  | { readonly type: 'built'; readonly buildingId: number }
  | { readonly type: 'distilled'; readonly buildingId: number }
  | { readonly type: 'trained'; readonly unitId: number }
  | { readonly type: 'full'; readonly unitId: number }
  | { readonly type: 'ability'; readonly faction: FactionId; readonly ability: AbilityId; readonly unitId: number }
  | { readonly type: 'hit'; readonly x: number; readonly y: number }
  | { readonly type: 'died'; readonly unitId: number; readonly faction: FactionId; readonly x: number; readonly y: number }
  | { readonly type: 'destroyed'; readonly buildingId: number; readonly faction: FactionId }
  | { readonly type: 'era'; readonly faction: FactionId; readonly era: number }
  | { readonly type: 'bribe'; readonly faction: FactionId; readonly buildingId: number; readonly worked: boolean }
  | { readonly type: 'funds'; readonly faction: FactionId }
  | { readonly type: 'scandal'; readonly unitId: number; readonly onlookers: readonly number[] }
  | { readonly type: 'won'; readonly faction: FactionId };

export interface WorldOptions {
  readonly seed: number;
  /** Supply a ready map (tests); otherwise Romania is generated. */
  readonly map?: GameMap;
}

type Target = { readonly unit: Unit; readonly building?: undefined } | { readonly building: Building; readonly unit?: undefined };

/**
 * The whole game state plus the rules that advance it. Pure logic: no
 * rendering, no input, no clocks. The only way to change it from outside is
 * `issue()` (queued) followed by `step()`, which is what makes replays,
 * saves and — later — lockstep multiplayer possible.
 */
export class World {
  readonly map: GameMap;
  readonly units: Unit[] = [];
  readonly buildings: Building[] = [];
  readonly stock: Record<FactionId, Stock> = {
    ardeal: { lemn: 50, prune: 30, palinca: 0 },
    moldova: { lemn: 50, prune: 30, palinca: 0 },
  };
  /** Ticks of "better after a drink" left per faction. */
  readonly buff: Record<FactionId, number> = { ardeal: 0, moldova: 0 };
  /** Ticks until each faction's ability is ready again. */
  readonly abilityCooldown: Record<FactionId, number> = { ardeal: 0, moldova: 0 };
  /** Index into ERAS for each faction; they advance separately. */
  readonly era: Record<FactionId, number> = { ardeal: 0, moldova: 0 };
  /** Whoever still has a court when the other one's falls. */
  winner: FactionId | null = null;
  tick = 0;

  /** Building id occupying each tile, 0 if none. */
  private readonly occupant: Int32Array;
  private readonly rng: Rng;
  private nextId = 1;
  private pending: Command[] = [];
  private events: SimEvent[] = [];

  constructor(options: WorldOptions) {
    this.map = options.map ?? generateRomania(options.seed);
    this.occupant = new Int32Array(this.map.width * this.map.height);
    this.rng = new Rng(options.seed);
    if (!options.map) this.setupRomania();
  }

  /** Era 1 start: Ardeal holds court at Alba Iulia, Moldova at Iași. */
  private setupRomania(): void {
    const starts: readonly (readonly [FactionId, { x: number; y: number }])[] = [
      ['ardeal', placeTile(PLACES.albaIulia)],
      ['moldova', placeTile(PLACES.iasi)],
    ];
    for (const [faction, town] of starts) {
      const site = nearestTile(this.map, town.x - 1, town.y - 1, (_i, x, y) => this.canPlace('curte', x, y));
      const cx = site % this.map.width;
      const cy = (site - cx) / this.map.width;
      this.placeBuilding('curte', faction, cx, cy, true);
      this.spawnGroup(faction, 3, cx + 1, cy + BUILDINGS.curte.size);
    }
  }

  /** Spawn peasants on free meadow tiles as close as possible to (tx, ty). */
  private spawnGroup(faction: FactionId, count: number, tx: number, ty: number): void {
    const taken = new Set<number>();
    for (let n = 0; n < count; n++) {
      const tile = nearestTile(
        this.map,
        tx,
        ty,
        (i, x, y) => this.map.tiles[i] === Terrain.Grass && this.map.isPassable(x, y) && !taken.has(i),
      );
      if (tile === -1) return;
      taken.add(tile);
      const x = tile % this.map.width;
      this.spawnUnit(faction, x, (tile - x) / this.map.width);
    }
  }

  // --- Queries ---------------------------------------------------------------

  getUnit(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  getBuilding(id: number): Building | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  buildingAt(tx: number, ty: number): Building | undefined {
    if (!this.map.inBounds(tx, ty)) return undefined;
    const id = this.occupant[this.map.index(tx, ty)]!;
    return id === 0 ? undefined : this.getBuilding(id);
  }

  unitCount(faction: FactionId, kind?: UnitKind): number {
    let n = 0;
    for (const u of this.units) if (u.faction === faction && (kind === undefined || u.kind === kind)) n++;
    return n;
  }

  /** The faction's (first) finished court, if it still stands. */
  courtOf(faction: FactionId): Building | undefined {
    return this.buildings.find((b) => b.faction === faction && b.kind === 'curte' && b.done);
  }

  /** Peasants currently assigned to pick plums in an orchard. */
  orchardWorkers(buildingId: number): number {
    let n = 0;
    for (const u of this.units) {
      if (u.order.type === 'gather' && u.order.buildingId === buildingId) n++;
    }
    return n;
  }

  canPlace(kind: BuildingKind, tx: number, ty: number): boolean {
    const size = BUILDINGS[kind].size;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!this.map.inBounds(x, y)) return false;
        if (this.map.terrainAt(x, y) !== Terrain.Grass) return false;
        if (this.occupant[this.map.index(x, y)] !== 0) return false;
      }
    }
    return true;
  }

  /** Everyone who fights without being told to. */
  fighterCount(faction: FactionId): number {
    let n = 0;
    for (const u of this.units) if (u.faction === faction && isFighter(u.kind)) n++;
    return n;
  }

  /** A price in this faction's current era (half in the Epoca de Aur, dearer today). */
  private price(faction: FactionId, base: number): number {
    return Math.ceil((base * ERAS[this.era[faction]]!.costPercent) / 100);
  }

  buildingCost(faction: FactionId, kind: BuildingKind): number {
    return this.price(faction, BUILDINGS[kind].costLemn);
  }

  unitCost(faction: FactionId, kind: UnitKind): { prune: number; lemn: number } {
    const def = FACTIONS[faction].units[kind];
    return { prune: this.price(faction, def.costPrune), lemn: this.price(faction, def.costLemn) };
  }

  trainTime(faction: FactionId, kind: UnitKind): number {
    const base = FACTIONS[faction].units[kind].trainTicks;
    return Math.ceil((base * ERAS[this.era[faction]]!.trainTimePercent) / 100);
  }

  /** How many people the faction has room for. */
  unitCap(faction: FactionId): number {
    let blocks = 0;
    for (const b of this.buildings) if (b.faction === faction && b.kind === 'bloc' && b.done) blocks++;
    return Math.min(MAX_UNIT_CAP, BASE_UNIT_CAP + blocks * UNITS_PER_BLOC);
  }

  /** Whether the faction's era knows how to build this at all. */
  canBuild(faction: FactionId, kind: BuildingKind): boolean {
    return kind !== 'curte' && this.era[faction] >= BUILDINGS[kind].era;
  }

  canAfford(faction: FactionId, kind: BuildingKind): boolean {
    return this.stock[faction].lemn >= this.buildingCost(faction, kind);
  }

  /** What this building can train right now (the court stops in the present). */
  trainable(building: Building): readonly UnitKind[] {
    if (building.kind === 'curte' && this.era[building.faction] >= LAST_ERA) return [];
    return BUILDINGS[building.kind].trains;
  }

  /** Whether this building can queue one more unit (of `kind`, or its first). */
  canTrain(faction: FactionId, building: Building, kind?: UnitKind): boolean {
    const options = this.trainable(building);
    const wanted = kind ?? options[0];
    if (!wanted || !options.includes(wanted) || !building.done || building.faction !== faction) return false;
    const cost = this.unitCost(faction, wanted);
    const stock = this.stock[faction];
    return (
      stock.prune >= cost.prune &&
      stock.lemn >= cost.lemn &&
      this.unitCount(faction) + this.queuedUnits(faction) < this.unitCap(faction)
    );
  }

  private queuedUnits(faction: FactionId): number {
    let n = 0;
    for (const b of this.buildings) if (b.faction === faction) n += b.queue.length;
    return n;
  }

  /** Whether the faction can start moving into the next era. */
  canAdvance(faction: FactionId): boolean {
    const court = this.courtOf(faction);
    const next = ERAS[this.era[faction] + 1];
    if (!court || !next || court.advanceLeft > 0) return false;
    const stock = this.stock[faction];
    return stock.lemn >= next.advanceLemn && stock.prune >= next.advancePrune;
  }

  /** Whether there is something at this building a bribe could hurry along. */
  canBribe(faction: FactionId, building: Building): boolean {
    if (building.faction !== faction || this.era[faction] < BRIBE_ERA) return false;
    if (this.stock[faction].prune < BRIBE_PRUNE) return false;
    return !building.done || building.queue.length > 0 || building.advanceLeft > 0;
  }

  abilityReady(faction: FactionId): boolean {
    return (
      this.abilityCooldown[faction] === 0 &&
      this.stock[faction].palinca >= FACTIONS[faction].ability.costPalinca
    );
  }

  /** What an 'act' command from this faction would do at a tile. */
  describeTarget(faction: FactionId, tx: number, ty: number): ActKind {
    const building = this.buildingAt(tx, ty);
    if (building) {
      if (building.faction !== faction) return 'attack';
      if (!building.done) return 'build';
      if (building.kind === 'livada') return 'plums';
      return 'move';
    }
    if (this.map.inBounds(tx, ty)) {
      const i = this.map.index(tx, ty);
      if (this.map.tiles[i] === Terrain.Forest && this.map.wood[i]! > 0) return 'wood';
    }
    return 'move';
  }

  isMoving(unit: Unit): boolean {
    return unit.x !== unit.prevX || unit.y !== unit.prevY;
  }

  /** Chopping, picking, hammering or swinging: used for the work animation. */
  isWorking(unit: Unit): boolean {
    if (unit.drink > 0) return false;
    const o = unit.order;
    if (o.type === 'gather' || o.type === 'build') return o.phase === 'working';
    return o.type === 'attack' && unit.path.length === 0 && !this.isMoving(unit);
  }

  /** Events since the last call; for the renderer only. */
  drainEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  // --- Setup helpers (also used by tests) -------------------------------------

  spawnUnit(faction: FactionId, tx: number, ty: number, kind: UnitKind = 'taran'): Unit {
    const def = FACTIONS[faction].units[kind];
    const x = tx * SUB + HALF;
    const y = ty * SUB + HALF;
    const unit: Unit = {
      id: this.nextId++,
      faction,
      kind,
      x,
      y,
      prevX: x,
      prevY: y,
      path: [],
      speed: Math.floor((BASE_SPEED * (def.speedPercent ?? FACTIONS[faction].speedPercent)) / 100),
      facing: 1,
      order: { type: 'idle' },
      hp: def.hp,
      maxHp: def.hp,
      damage: def.damage,
      attackCooldown: def.cooldown,
      cooldown: 0,
      shield: 0,
      carryKind: 'lemn',
      carryAmount: 0,
      drink: 0,
      stun: 0,
      scandalIn: kind === 'smecher' ? SCANDAL_MIN_GAP + this.rng.int(SCANDAL_GAP_SPREAD) : 0,
    };
    this.units.push(unit);
    return unit;
  }

  placeBuilding(kind: BuildingKind, faction: FactionId, tx: number, ty: number, done: boolean): Building {
    const def = BUILDINGS[kind];
    const maxHp = Math.floor((def.hp * FACTIONS[faction].buildingHpPercent) / 100);
    const building: Building = {
      id: this.nextId++,
      kind,
      faction,
      tx,
      ty,
      hp: maxHp,
      maxHp,
      buildLeft: done ? 0 : Math.floor((def.buildTicks * FACTIONS[faction].buildTimePercent) / 100),
      done,
      queue: [],
      trainLeft: 0,
      distillLeft: 0,
      sawLeft: 0,
      advanceLeft: 0,
    };
    this.buildings.push(building);
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        const i = this.map.index(tx + dx, ty + dy);
        this.occupant[i] = building.id;
        if (def.blocks) this.map.blocked[i] = 1;
      }
    }
    return building;
  }

  // --- Stepping ---------------------------------------------------------------

  /** Queue a command; it takes effect at the start of the next step. */
  issue(command: Command): void {
    this.pending.push(command);
  }

  step(): void {
    const commands = this.pending;
    this.pending = [];
    for (const command of commands) this.apply(command);
    for (const unit of this.units) this.stepUnit(unit);
    // Snapshot: a unit trained this tick starts acting next tick.
    for (const building of [...this.buildings]) this.stepBuilding(building);
    this.removeDead();
    for (const faction of FACTION_IDS) {
      if (this.buff[faction] > 0) this.buff[faction]--;
      if (this.abilityCooldown[faction] > 0) this.abilityCooldown[faction]--;
    }
    this.tick++;
    if (this.tick % FUNDS_EVERY === 0) {
      for (const faction of FACTION_IDS) {
        if (this.era[faction] < LAST_ERA || !this.courtOf(faction)) continue;
        this.stock[faction].lemn += FUNDS_AMOUNT;
        this.stock[faction].prune += FUNDS_AMOUNT;
        this.events.push({ type: 'funds', faction });
      }
    }
  }

  private ownUnits(faction: FactionId, ids: UnitIds): Unit[] {
    return ids
      .map((id) => this.getUnit(id))
      .filter((u): u is Unit => u !== undefined && u.faction === faction)
      .sort((a, b) => a.id - b.id);
  }

  private apply(command: Command): void {
    switch (command.type) {
      case 'move':
        this.orderMove(this.ownUnits(command.faction, command.unitIds), command.tx, command.ty);
        break;
      case 'act':
        this.applyAct(command);
        break;
      case 'attack': {
        const target = this.resolve(command.targetId);
        if (!target || (target.unit ?? target.building).faction === command.faction) break;
        for (const unit of this.ownUnits(command.faction, command.unitIds)) this.orderAttack(unit, command.targetId);
        break;
      }
      case 'build':
        this.applyBuild(command);
        break;
      case 'train': {
        const building = this.getBuilding(command.buildingId);
        if (!building) break;
        const kind = command.kind ?? this.trainable(building)[0];
        if (!kind || !this.canTrain(command.faction, building, kind)) break;
        const cost = this.unitCost(command.faction, kind);
        this.stock[command.faction].prune -= cost.prune;
        this.stock[command.faction].lemn -= cost.lemn;
        if (building.queue.length === 0) building.trainLeft = this.trainTime(command.faction, kind);
        building.queue.push(kind);
        break;
      }
      case 'advance': {
        if (!this.canAdvance(command.faction)) break;
        const next = ERAS[this.era[command.faction] + 1]!;
        this.stock[command.faction].lemn -= next.advanceLemn;
        this.stock[command.faction].prune -= next.advancePrune;
        const slow = FACTIONS[command.faction].buildTimePercent;
        this.courtOf(command.faction)!.advanceLeft = Math.floor((next.advanceTicks * slow) / 100);
        break;
      }
      case 'bribe':
        this.applyBribe(command.faction, command.buildingId);
        break;
      case 'ability':
        this.applyAbility(command.faction, command.unitId);
        break;
    }
  }

  private applyAct(command: Extract<Command, { type: 'act' }>): void {
    const units = this.ownUnits(command.faction, command.unitIds);
    const kind = this.describeTarget(command.faction, command.tx, command.ty);
    const building = this.buildingAt(command.tx, command.ty);
    if (kind === 'attack' && building) {
      for (const unit of units) this.orderAttack(unit, building.id);
    } else if (kind === 'build' && building) {
      for (const unit of units) this.orderBuild(unit, building);
    } else if (kind === 'plums' && building) {
      for (const unit of units) this.orderPickPlums(unit, building);
    } else if (kind === 'wood') {
      // Spread the group over neighbouring trees.
      const taken = new Set<number>();
      for (const unit of units) {
        const tile = this.findForest(command.tx, command.ty, 6, taken);
        if (tile === -1) continue;
        taken.add(tile);
        this.orderChop(unit, tile);
      }
    } else {
      this.orderMove(units, command.tx, command.ty);
    }
  }

  private applyBuild(command: Extract<Command, { type: 'build' }>): void {
    if (!this.canBuild(command.faction, command.kind)) return;
    if (!this.canPlace(command.kind, command.tx, command.ty)) return;
    if (!this.canAfford(command.faction, command.kind)) return;
    this.stock[command.faction].lemn -= this.buildingCost(command.faction, command.kind);
    const building = this.placeBuilding(command.kind, command.faction, command.tx, command.ty, false);
    for (const unit of this.ownUnits(command.faction, command.unitIds)) this.orderBuild(unit, building);
  }

  private applyBribe(faction: FactionId, buildingId: number): void {
    const building = this.getBuilding(buildingId);
    if (!building || !this.canBribe(faction, building)) return;
    this.stock[faction].prune -= BRIBE_PRUNE;
    // Sometimes the plums are taken and nothing moves. That is the era.
    const worked = this.rng.int(BRIBE_POCKETED_ONE_IN) !== 0;
    if (worked) {
      if (!building.done) {
        building.buildLeft = 0;
        building.done = true;
        this.events.push({ type: 'built', buildingId: building.id });
      } else if (building.advanceLeft > 0) {
        building.advanceLeft = 1;
      } else {
        building.trainLeft = 1;
      }
    }
    this.events.push({ type: 'bribe', faction, buildingId, worked });
  }

  private applyAbility(faction: FactionId, unitId: number | undefined): void {
    if (!this.abilityReady(faction)) return;
    const def = FACTIONS[faction].ability;

    if (def.id === 'palinca') {
      // Everyone of ours stops for a glass; enemies standing close can't say no
      // either, and they take longer over it.
      const own = this.units.filter((u) => u.faction === faction);
      for (const enemy of this.units) {
        if (enemy.faction === faction) continue;
        if (own.some((u) => distSq(u.x, u.y, enemy.x, enemy.y) <= DRINK_RADIUS * DRINK_RADIUS)) {
          enemy.drink = ENEMY_DRINK_TICKS;
        }
      }
      for (const unit of own) unit.drink = DRINK_TICKS;
      this.buff[faction] = DRINK_TICKS + BUFF_TICKS;
      this.events.push({ type: 'ability', faction, ability: 'palinca', unitId: own[0]?.id ?? 0 });
    } else {
      const taunter = unitId === undefined ? undefined : this.getUnit(unitId);
      if (!taunter || taunter.faction !== faction) return;
      for (const enemy of this.units) {
        if (enemy.faction === faction || !isFighter(enemy.kind)) continue;
        if (distSq(taunter.x, taunter.y, enemy.x, enemy.y) > TAUNT_RADIUS * TAUNT_RADIUS) continue;
        const target = enemy.order.type === 'attack' ? enemy.order.target : taunter.id;
        enemy.order = { type: 'attack', target, current: taunter.id, lock: TAUNT_TICKS, repath: 0 };
      }
      taunter.shield = TAUNT_TICKS;
      this.events.push({ type: 'ability', faction, ability: 'taunt', unitId: taunter.id });
    }

    this.stock[faction].palinca -= def.costPalinca;
    this.abilityCooldown[faction] = def.cooldownTicks;
  }

  // --- Orders -----------------------------------------------------------------

  private tileOf(unit: Unit): number {
    return this.map.index(Math.floor(unit.x / SUB), Math.floor(unit.y / SUB));
  }

  private sendTo(unit: Unit, goal: number): void {
    const w = this.map.width;
    const sx = Math.floor(unit.x / SUB);
    const sy = Math.floor(unit.y / SUB);
    const gx = goal % w;
    const gy = (goal - gx) / w;
    unit.path = findPath(this.map, sx, sy, gx, gy).reverse();
    // Caught between tiles with nowhere to go: settle on the current tile.
    if (unit.path.length === 0) unit.path.push(this.map.index(sx, sy));
  }

  private orderMove(units: Unit[], tx: number, ty: number): void {
    // Each unit gets its own destination tile so a group does not stack.
    const taken = new Set<number>();
    for (const unit of units) {
      const goal = nearestPassable(this.map, tx, ty, taken);
      if (goal === -1) continue;
      taken.add(goal);
      unit.order = { type: 'move' };
      this.sendTo(unit, goal);
    }
  }

  private orderAttack(unit: Unit, targetId: number): void {
    unit.order = { type: 'attack', target: targetId, current: targetId, lock: 0, repath: 0 };
  }

  private findForest(tx: number, ty: number, radius: number, taken?: ReadonlySet<number>): number {
    return nearestTile(
      this.map,
      tx,
      ty,
      (i) => this.map.tiles[i] === Terrain.Forest && this.map.wood[i]! > 0 && !taken?.has(i),
      radius,
    );
  }

  private orderChop(unit: Unit, tile: number): void {
    unit.order = { type: 'gather', resource: 'lemn', tile, buildingId: 0, phase: 'going', work: 0 };
    this.startGatherTrip(unit);
  }

  private orderPickPlums(unit: Unit, orchard: Building): void {
    const already = unit.order.type === 'gather' && unit.order.buildingId === orchard.id;
    if (already) return;
    // One footprint tile per picker.
    const used = new Set<number>();
    for (const other of this.units) {
      if (other.order.type === 'gather' && other.order.buildingId === orchard.id) used.add(other.order.tile);
    }
    if (used.size >= ORCHARD_CAPACITY) {
      this.events.push({ type: 'full', unitId: unit.id });
      return;
    }
    const size = BUILDINGS[orchard.kind].size;
    let tile = -1;
    for (let dy = 0; dy < size && tile === -1; dy++) {
      for (let dx = 0; dx < size && tile === -1; dx++) {
        const i = this.map.index(orchard.tx + dx, orchard.ty + dy);
        if (!used.has(i)) tile = i;
      }
    }
    if (tile === -1) return;
    unit.order = { type: 'gather', resource: 'prune', tile, buildingId: orchard.id, phase: 'going', work: 0 };
    this.startGatherTrip(unit);
  }

  /** Head for the work tile — or for the depot first, if already loaded. */
  private startGatherTrip(unit: Unit): void {
    if (unit.order.type !== 'gather') return;
    if (unit.carryAmount > 0 && unit.carryKind === unit.order.resource) {
      this.headToDepot(unit);
      return;
    }
    unit.carryAmount = 0;
    unit.order.phase = 'going';
    this.sendTo(unit, unit.order.tile);
  }

  private orderBuild(unit: Unit, building: Building): void {
    const approach = this.approachTile(building, unit);
    if (approach === -1) return;
    const o = unit.order;
    const resume =
      o.type === 'gather'
        ? { resource: o.resource, tile: o.tile, buildingId: o.buildingId }
        : o.type === 'build'
          ? o.resume
          : null;
    unit.order = { type: 'build', buildingId: building.id, phase: 'going', resume };
    this.sendTo(unit, approach);
  }

  private isAdjacent(building: Building, tile: number): boolean {
    const size = BUILDINGS[building.kind].size;
    const tx = tile % this.map.width;
    const ty = (tile - tx) / this.map.width;
    return tx >= building.tx - 1 && tx <= building.tx + size && ty >= building.ty - 1 && ty <= building.ty + size;
  }

  /** Passable tile next to (or inside, if walkable) a building, nearest to the unit. */
  private approachTile(building: Building, unit: Unit): number {
    const size = BUILDINGS[building.kind].size;
    const ux = Math.floor(unit.x / SUB);
    const uy = Math.floor(unit.y / SUB);
    let best = -1;
    let bestD = 0;
    for (let ty = building.ty - 1; ty <= building.ty + size; ty++) {
      for (let tx = building.tx - 1; tx <= building.tx + size; tx++) {
        if (!this.map.isPassable(tx, ty)) continue;
        const d = (tx - ux) * (tx - ux) + (ty - uy) * (ty - uy);
        if (best === -1 || d < bestD) {
          best = this.map.index(tx, ty);
          bestD = d;
        }
      }
    }
    return best;
  }

  private nearestDepot(unit: Unit): Building | undefined {
    let best: Building | undefined;
    let bestD = 0;
    for (const b of this.buildings) {
      if (b.kind !== 'curte' || !b.done || b.faction !== unit.faction) continue;
      const cx = (b.tx * 2 + BUILDINGS[b.kind].size) * HALF;
      const cy = (b.ty * 2 + BUILDINGS[b.kind].size) * HALF;
      const d = distSq(cx, cy, unit.x, unit.y);
      if (!best || d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private headToDepot(unit: Unit): void {
    if (unit.order.type !== 'gather') return;
    const depot = this.nearestDepot(unit);
    const approach = depot ? this.approachTile(depot, unit) : -1;
    if (approach === -1) {
      unit.order = { type: 'idle' };
      return;
    }
    unit.order.phase = 'returning';
    this.sendTo(unit, approach);
  }

  // --- Per-tick behaviour -----------------------------------------------------

  private stepUnit(unit: Unit): void {
    unit.prevX = unit.x;
    unit.prevY = unit.y;
    if (unit.hp <= 0) return; // fell earlier this tick
    if (unit.cooldown > 0) unit.cooldown--;
    if (unit.shield > 0) unit.shield--;
    if (unit.drink > 0) {
      unit.drink--;
      return;
    }
    if (unit.stun > 0) {
      unit.stun--;
      return;
    }
    if (unit.kind === 'smecher') this.stepScandal(unit);
    const order = unit.order;
    switch (order.type) {
      case 'idle':
        // Soldiers standing around keep an eye out; peasants mind their own business.
        if (isFighter(unit.kind) && (this.tick + unit.id) % 5 === 0) {
          const threat = this.nearestEnemy(unit, AGGRO_RADIUS);
          if (threat !== 0) this.orderAttack(unit, threat);
        }
        break;
      case 'move':
        this.walk(unit);
        if (unit.path.length === 0) unit.order = { type: 'idle' };
        break;
      case 'gather':
        this.stepGather(unit, order);
        break;
      case 'build':
        this.stepBuild(unit, order);
        break;
      case 'attack':
        this.stepAttack(unit, order);
        break;
    }
  }

  /**
   * Băieții de băieți start scandals wherever there is an audience: everyone
   * within a few steps — friend or foe, but not their own kind — stops what
   * he is doing to watch. Handy in an enemy camp, a nuisance in your orchard.
   */
  private stepScandal(unit: Unit): void {
    unit.scandalIn--;
    if (unit.scandalIn > 0) return;
    const onlookers: number[] = [];
    for (const other of this.units) {
      if (other.kind === 'smecher' || other.hp <= 0) continue;
      if (distSq(unit.x, unit.y, other.x, other.y) > SCANDAL_RADIUS * SCANDAL_RADIUS) continue;
      other.stun = SCANDAL_STUN;
      onlookers.push(other.id);
    }
    if (onlookers.length === 0) {
      unit.scandalIn = SCANDAL_RETRY; // nobody to impress; he will try again soon
      return;
    }
    unit.scandalIn = SCANDAL_MIN_GAP + this.rng.int(SCANDAL_GAP_SPREAD);
    this.events.push({ type: 'scandal', unitId: unit.id, onlookers });
  }

  // --- Combat -----------------------------------------------------------------

  private resolve(id: number): Target | undefined {
    const unit = this.getUnit(id);
    if (unit) return unit.hp > 0 ? { unit } : undefined;
    const building = this.getBuilding(id);
    return building && building.hp > 0 ? { building } : undefined;
  }

  /** Squared distance from a unit to the nearest point of a target. */
  private reachSq(unit: Unit, target: Target): number {
    if (target.unit) return distSq(unit.x, unit.y, target.unit.x, target.unit.y);
    const b = target.building;
    const size = BUILDINGS[b.kind].size;
    const nx = Math.min(Math.max(unit.x, b.tx * SUB), (b.tx + size) * SUB);
    const ny = Math.min(Math.max(unit.y, b.ty * SUB), (b.ty + size) * SUB);
    return distSq(unit.x, unit.y, nx, ny);
  }

  /**
   * Id of the closest enemy within `radius`: soldiers first, then any unit,
   * then buildings. 0 if there is nothing to fight.
   */
  private nearestEnemy(unit: Unit, radius: number, unitsOnly = false): number {
    const limit = radius * radius;
    let best = 0;
    let bestD = 0;
    let bestRank = 3;
    for (const other of this.units) {
      if (other.faction === unit.faction || other.hp <= 0) continue;
      const d = distSq(unit.x, unit.y, other.x, other.y);
      if (d > limit) continue;
      const rank = isFighter(other.kind) ? 0 : 1;
      if (rank < bestRank || (rank === bestRank && d < bestD)) {
        best = other.id;
        bestD = d;
        bestRank = rank;
      }
    }
    if (best !== 0 || unitsOnly) return best;
    for (const b of this.buildings) {
      if (b.faction === unit.faction || b.hp <= 0) continue;
      const d = this.reachSq(unit, { building: b });
      if (d > limit) continue;
      if (best === 0 || d < bestD) {
        best = b.id;
        bestD = d;
      }
    }
    return best;
  }

  private stepAttack(unit: Unit, order: Extract<Order, { type: 'attack' }>): void {
    if (order.lock > 0) order.lock--;
    let current = this.resolve(order.current);
    if (!current) {
      // What he was fighting is gone: back to the original target, if any.
      order.lock = 0;
      order.current = order.target;
      current = this.resolve(order.target);
    }
    // On the way to a building (or with nothing left to hit), enemy units come first.
    const scan = !current || (order.lock === 0 && current.building && (this.tick + unit.id) % 5 === 0);
    if (scan) {
      const threat = this.nearestEnemy(unit, AGGRO_RADIUS, current !== undefined);
      if (threat !== 0) {
        order.current = threat;
        if (!current) order.target = threat;
        current = this.resolve(threat);
      }
    }
    if (!current) {
      unit.order = { type: 'idle' };
      unit.path.length = 0;
      return;
    }

    if (this.reachSq(unit, current) <= ATTACK_RANGE * ATTACK_RANGE) {
      unit.path.length = 0;
      const tx = current.unit ? current.unit.x : (current.building.tx * 2 + BUILDINGS[current.building.kind].size) * HALF;
      if (tx !== unit.x) unit.facing = tx > unit.x ? 1 : -1;
      if (unit.cooldown === 0) this.hit(unit, current);
      return;
    }

    order.repath--;
    if (order.repath <= 0 || unit.path.length === 0) {
      order.repath = REPATH_TICKS;
      const goal = current.unit ? this.tileOf(current.unit) : this.approachTile(current.building, unit);
      if (goal === -1) {
        unit.order = { type: 'idle' };
        return;
      }
      this.sendTo(unit, goal);
    }
    this.walk(unit);
  }

  private hit(attacker: Unit, target: Target): void {
    let damage = attacker.damage;
    if (this.buff[attacker.faction] > 0) damage = Math.floor((damage * 3) / 2);
    attacker.cooldown = attacker.attackCooldown;
    if (target.unit) {
      if (target.unit.shield > 0) damage = Math.max(1, damage >> 1);
      target.unit.hp -= damage;
      this.events.push({ type: 'hit', x: target.unit.x, y: target.unit.y });
    } else {
      const b = target.building;
      const size = BUILDINGS[b.kind].size;
      b.hp -= damage;
      this.events.push({
        type: 'hit',
        x: Math.min(Math.max(attacker.x, b.tx * SUB), (b.tx + size) * SUB),
        y: Math.min(Math.max(attacker.y, b.ty * SUB), (b.ty + size) * SUB),
      });
    }
  }

  private removeDead(): void {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const unit = this.units[i]!;
      if (unit.hp > 0) continue;
      this.events.push({ type: 'died', unitId: unit.id, faction: unit.faction, x: unit.x, y: unit.y });
      this.units.splice(i, 1);
    }
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const building = this.buildings[i]!;
      if (building.hp > 0) continue;
      const def = BUILDINGS[building.kind];
      for (let dy = 0; dy < def.size; dy++) {
        for (let dx = 0; dx < def.size; dx++) {
          const t = this.map.index(building.tx + dx, building.ty + dy);
          this.occupant[t] = 0;
          this.map.blocked[t] = 0;
        }
      }
      this.buildings.splice(i, 1);
      this.events.push({ type: 'destroyed', buildingId: building.id, faction: building.faction });
      const courtLeft = this.buildings.some((b) => b.faction === building.faction && b.kind === 'curte');
      if (building.kind === 'curte' && !courtLeft && this.winner === null) {
        this.winner = enemyOf(building.faction);
        this.events.push({ type: 'won', faction: this.winner });
      }
    }
  }

  // --- Economy ----------------------------------------------------------------

  private stepGather(unit: Unit, order: Extract<Order, { type: 'gather' }>): void {
    if (order.phase === 'going') {
      this.walk(unit);
      if (unit.path.length > 0) return;
      if (this.tileOf(unit) !== order.tile || !this.nodeHasResource(order)) {
        this.retarget(unit, order);
        return;
      }
      order.phase = 'working';
      order.work = WORK_PER_LOAD;
      return;
    }

    if (order.phase === 'working') {
      if (!this.nodeHasResource(order)) {
        this.retarget(unit, order);
        return;
      }
      order.work -= this.buff[unit.faction] > 0 ? WORK_RATE_BUFFED : WORK_RATE;
      if (order.work > 0) return;
      let amount = CARRY;
      if (order.resource === 'lemn') {
        amount = Math.min(CARRY, this.map.wood[order.tile]!);
        this.map.wood[order.tile] = this.map.wood[order.tile]! - amount;
        if (this.map.wood[order.tile] === 0) {
          this.map.tiles[order.tile] = Terrain.Grass;
          this.events.push({ type: 'tile', index: order.tile });
        }
      }
      unit.carryKind = order.resource;
      unit.carryAmount = amount;
      this.headToDepot(unit);
      return;
    }

    // returning
    this.walk(unit);
    if (unit.path.length > 0) return;
    const depot = this.nearestDepot(unit);
    if (!depot || !this.isAdjacent(depot, this.tileOf(unit))) {
      unit.order = { type: 'idle' };
      return;
    }
    this.stock[unit.faction][unit.carryKind] += unit.carryAmount;
    unit.carryAmount = 0;
    if (this.nodeHasResource(order)) {
      order.phase = 'going';
      this.sendTo(unit, order.tile);
    } else {
      this.retarget(unit, order);
    }
  }

  private nodeHasResource(order: Extract<Order, { type: 'gather' }>): boolean {
    if (order.resource === 'lemn') {
      return this.map.tiles[order.tile] === Terrain.Forest && this.map.wood[order.tile]! > 0;
    }
    const orchard = this.getBuilding(order.buildingId);
    return orchard !== undefined && orchard.done;
  }

  /** The tree is gone (or unreachable): look for the next one nearby. */
  private retarget(unit: Unit, order: Extract<Order, { type: 'gather' }>): void {
    if (order.resource === 'lemn') {
      const w = this.map.width;
      const tx = order.tile % w;
      const next = this.findForest(tx, (order.tile - tx) / w, FOREST_SEARCH_RADIUS);
      if (next !== -1 && next !== this.tileOf(unit)) {
        order.tile = next;
        order.phase = 'going';
        this.sendTo(unit, next);
        return;
      }
      if (next !== -1) {
        order.tile = next;
        order.phase = 'working';
        order.work = WORK_PER_LOAD;
        return;
      }
    }
    unit.order = { type: 'idle' };
  }

  private stepBuild(unit: Unit, order: Extract<Order, { type: 'build' }>): void {
    const building = this.getBuilding(order.buildingId);
    if (!building) {
      unit.order = { type: 'idle' };
      return;
    }
    if (order.phase === 'going') {
      this.walk(unit);
      if (unit.path.length > 0) return;
      if (!this.isAdjacent(building, this.tileOf(unit))) {
        unit.order = { type: 'idle' };
        return;
      }
      order.phase = 'working';
    }
    if (!building.done) {
      building.buildLeft--;
      if (building.buildLeft <= 0) {
        building.done = true;
        this.events.push({ type: 'built', buildingId: building.id });
      }
    }
    if (building.done) {
      const resume = order.resume;
      unit.order = { type: 'idle' };
      if (building.kind === 'livada') {
        // Whoever planted the orchard starts picking straight away.
        this.orderPickPlums(unit, building);
      } else if (resume?.resource === 'prune') {
        const orchard = this.getBuilding(resume.buildingId);
        if (orchard) this.orderPickPlums(unit, orchard);
      } else if (resume) {
        this.orderChop(unit, resume.tile);
      }
    }
  }

  private stepBuilding(building: Building): void {
    if (!building.done || building.hp <= 0) return;
    const def = BUILDINGS[building.kind];
    const stock = this.stock[building.faction];

    if (building.queue.length > 0) {
      building.trainLeft--;
      if (building.trainLeft <= 0) {
        const kind = building.queue.shift()!;
        // Step out onto a free tile, not onto somebody's head.
        const taken = new Set<number>();
        for (const u of this.units) taken.add(this.tileOf(u));
        const spot = nearestPassable(this.map, building.tx + (def.size >> 1), building.ty + def.size, taken);
        if (spot !== -1) {
          const sx = spot % this.map.width;
          const unit = this.spawnUnit(building.faction, sx, (spot - sx) / this.map.width, kind);
          this.events.push({ type: 'trained', unitId: unit.id });
        }
        const next = building.queue[0];
        building.trainLeft = next ? this.trainTime(building.faction, next) : 0;
      }
    }

    if (building.advanceLeft > 0) {
      building.advanceLeft--;
      if (building.advanceLeft === 0 && this.era[building.faction] < LAST_ERA) {
        this.era[building.faction]++;
        this.events.push({ type: 'era', faction: building.faction, era: this.era[building.faction] });
      }
    }

    if (building.kind === 'gater') {
      building.sawLeft--;
      if (building.sawLeft <= 0) {
        building.sawLeft = GATER_TICKS;
        stock.lemn++;
      }
    }

    if (building.kind === 'cazan') {
      if (building.distillLeft === 0) {
        if (stock.prune >= DISTILL_PRUNE && stock.lemn >= DISTILL_LEMN) {
          stock.prune -= DISTILL_PRUNE;
          stock.lemn -= DISTILL_LEMN;
          building.distillLeft = DISTILL_TICKS;
        }
      } else {
        building.distillLeft--;
        if (building.distillLeft === 0) {
          stock.palinca++;
          this.events.push({ type: 'distilled', buildingId: building.id });
        }
      }
    }
  }

  /** Advance along the path by this tick's movement budget. */
  private walk(unit: Unit): void {
    if (unit.path.length === 0) return;
    const w = this.map.width;
    const terrain = this.map.tiles[this.tileOf(unit)];
    let budget = unit.speed;
    if (terrain === Terrain.Forest) budget = unit.speed >> 1;
    else if (terrain === Terrain.Ford) budget = Math.floor(unit.speed / 3);

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

  /** Checksum of the full state; two clients in sync always agree on it. */
  checksum(): number {
    const values: number[] = [this.tick];
    for (const faction of FACTION_IDS) {
      const s = this.stock[faction];
      values.push(s.lemn, s.prune, s.palinca, this.buff[faction], this.abilityCooldown[faction], this.era[faction]);
    }
    for (const u of this.units) {
      values.push(u.id, u.x, u.y, u.hp, u.path.length, u.carryAmount, u.drink, u.stun, u.cooldown, ORDER_CODE[u.order.type]);
    }
    for (const b of this.buildings) {
      values.push(b.id, b.hp, b.buildLeft, b.done ? 1 : 0, b.queue.length, b.trainLeft, b.distillLeft, b.advanceLeft);
    }
    return fnv1a(values);
  }
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}
