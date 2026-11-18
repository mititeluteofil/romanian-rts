import { BUILDINGS, ORCHARD_CAPACITY, TECH_IDS, TECHS, type BuildingKind, type TechDef, type TechId } from '../data/buildings';
import { BRIBE_ERA, ERAS, LAST_ERA } from '../data/eras';
import {
  ALL_FACTION_IDS,
  FACTION_IDS,
  FACTIONS,
  isFighter,
  isRival,
  perFaction,
  PLAYABLE_FACTION_IDS,
  RAIDERS,
  type AbilityId,
  type FactionId,
  type UnitKind,
} from '../data/factions';
import { PLACES } from '../data/romania';
import { GameMap, generateRomania, placeTile, Terrain, WOOD_PER_FOREST } from './map';
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
/** Room for this many people, plus houses, inns and apartment blocks. */
const BASE_UNIT_CAP = 24;
const UNITS_PER_CASA = 4;
const UNITS_PER_HAN = 6;
const UNITS_PER_BLOC = 6;
const MAX_UNIT_CAP = 48;
/** Watchtower range, cooldown and base damage. */
const TOWER_RANGE = 6 * SUB;
const TOWER_COOLDOWN = 12;
const TOWER_BASE_DAMAGE = 7;
const TOWER_GARRISON_DAMAGE = 3;
/** Stegarul aura radius and Han healing radius. */
const STEGAR_RADIUS = 4 * SUB;
const HAN_RADIUS = 4 * SUB;
const INTIMIDATION_RADIUS = 3 * SUB;

function factionCode(faction: FactionId): number {
  return ALL_FACTION_IDS.indexOf(faction) + 1;
}
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
/** The fishery lands one fish this often. */
const CHERHANA_TICKS = 15;
/** "Lasă, că se rezolvă": one time in this many it does not, and it costs. */
const REZOLVA_FAILS_ONE_IN = 4;
const REZOLVA_FAIL_PRUNE = 30;
/** "Hai la mare": who goes to the beach, for how long, and what they pay. */
const BEACH_RADIUS = 8 * SUB;
const BEACH_STUN = 80;
const BEACH_FEE = 5;
/** Against the faction you cannot stand, hits land this much harder (percent). */
const RIVAL_DAMAGE_PERCENT = 120;
/** The capital's cut of everybody else's European funds. */
export const CAPITAL_TAX = 10;
/** Bucharest traffic: speed near the court in the present, and how near. */
const TRAFFIC_SPEED_PERCENT = 70;
const TRAFFIC_RADIUS = 8 * SUB;
/** Summer on the coast, once Dobrogea has reached the present. */
export const SUMMER_EVERY = 900;
const SUMMER_FEE = 15;
const SUMMER_WEAR_PERCENT = 3;
/** Tribute to the Porte: how often, how long to pay, how much, until which era. */
export const HARACI_EVERY = 1800;
export const HARACI_DEADLINE = 300;
const HARACI_BASE = 30;
const HARACI_STEP = 15;
const HARACI_LAST_ERA = 1;
/** Unpaid tribute: how many janissaries come, and how long they stay. */
const RAID_BASE = 3;
const RAID_STEP = 2;
const RAID_TICKS = 300;

export interface Haraci {
  /** Ticks left to pay; 0 when nothing is owed. */
  due: number;
  /** Plums asked for this time. */
  amount: number;
  /** How many times the Porte has asked so far. */
  asked: number;
  /** How many times it went home empty-handed. */
  refused: number;
}
export const DISTILL_TICKS = 80;
const DISTILL_PRUNE = 5;
const DISTILL_LEMN = 1;
const MAX_PALINCA = 15;
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

type Resume = { resource: 'lemn' | 'prune'; tile: number; buildingId: number };

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
      resume: Resume | null;
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
    }
  | {
      type: 'attackMove';
      gx: number;
      gy: number;
    }
  | {
      type: 'garrison';
      buildingId: number;
      resume: Resume | null;
    };

/** The gathering job a peasant should go back to after a detour (building, sheltering). */
function resumeOf(o: Order): Resume | null {
  if (o.type === 'gather') return { resource: o.resource, tile: o.tile, buildingId: o.buildingId };
  if (o.type === 'build' || o.type === 'garrison') return o.resume;
  return null;
}

const ORDER_CODE: Readonly<Record<Order['type'], number>> = {
  idle: 0,
  move: 1,
  gather: 2,
  build: 3,
  attack: 4,
  attackMove: 5,
  garrison: 6,
};

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
  /** Raiders only: ticks until they go home; 0 = stays, -1 = just left. */
  expires: number;
}

export interface FactionDebuffs {
  /** Bureaucratic delay ("Dosar cu șină"): ticks left of slower building/training. */
  dosar: number;
  /** Blackout ("Pană de curent"): ticks left with gater and cazan paused. */
  panaCurent: number;
}

export interface GarrisonedUnit {
  readonly id: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly carryKind: 'lemn' | 'prune';
  readonly carryAmount: number;
  readonly resume: Resume | null;
}

export interface Building {
  readonly id: number;
  readonly kind: BuildingKind;
  readonly faction: FactionId;
  /** Top-left tile of the footprint. */
  readonly tx: number;
  readonly ty: number;
  hp: number;
  maxHp: number;
  /** Builder-ticks of work still needed. */
  buildLeft: number;
  done: boolean;
  /** Units waiting to be trained (first is in progress), and ticks left on it. */
  queue: UnitKind[];
  trainLeft: number;
  /** Cazan: ticks left on the current batch, 0 when idle. */
  distillLeft: number;
  /** Gater / Cherhana / Turn cooldown counter. */
  sawLeft: number;
  /** Court: ticks left until the next era begins, 0 when not advancing. */
  advanceLeft: number;
  /** Optional rally tile for newly trained units. */
  rally?: { readonly tx: number; readonly ty: number } | null;
  /** Active technology research on this building, if any. */
  researching?: TechId | null;
  researchLeft?: number;
  researchTarget?: FactionId;
  /** Villagers currently sheltered inside this defensive building. */
  garrison?: GarrisonedUnit[];
}

type UnitIds = readonly number[];
export type Command =
  | { readonly type: 'move'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly tx: number; readonly ty: number }
  /** "Do the obvious thing here": chop, pick, help build/repair, garrison, attack, or just walk. */
  | { readonly type: 'act'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly tx: number; readonly ty: number }
  | { readonly type: 'attack'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly targetId: number }
  | { readonly type: 'attackMove'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly tx: number; readonly ty: number }
  | { readonly type: 'build'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly kind: BuildingKind; readonly tx: number; readonly ty: number }
  | { readonly type: 'buildLine'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly kind: BuildingKind; readonly tiles: readonly (readonly [number, number])[] }
  /** Send peasants into a specific defensive building (`buildingId`), or the nearest one with room. */
  | { readonly type: 'garrison'; readonly faction: FactionId; readonly unitIds: UnitIds; readonly buildingId?: number }
  /** Release all sheltered peasants from a defensive building back to work. */
  | { readonly type: 'ungarrison'; readonly faction: FactionId; readonly buildingId: number }
  /** `kind` defaults to the first thing the building trains. */
  | { readonly type: 'train'; readonly faction: FactionId; readonly buildingId: number; readonly kind?: UnitKind }
  | { readonly type: 'cancelQueue'; readonly faction: FactionId; readonly buildingId: number }
  | { readonly type: 'rally'; readonly faction: FactionId; readonly buildingId: number; readonly tx: number; readonly ty: number }
  | { readonly type: 'research'; readonly faction: FactionId; readonly buildingId: number; readonly techId: TechId; readonly targetFaction?: FactionId }
  /** Start moving the faction's court into the next era. */
  | { readonly type: 'advance'; readonly faction: FactionId }
  /** Pay to have a building site or a training finished on the spot. */
  | { readonly type: 'bribe'; readonly faction: FactionId; readonly buildingId: number }
  /** The faction's signature ability; `unitId` is who does it, where that matters. */
  | { readonly type: 'ability'; readonly faction: FactionId; readonly unitId?: number }
  /** Answer the Porte: pay the tribute, or refuse and take the raid now. */
  | { readonly type: 'haraci'; readonly faction: FactionId; readonly pay: boolean };

/** What an 'act' command at a tile would do. */
export type ActKind = 'build' | 'plums' | 'wood' | 'attack' | 'garrison' | 'move';

/** Things the renderer may want to react to. Never read by the simulation. */
export type SimEvent =
  | { readonly type: 'tile'; readonly index: number }
  | { readonly type: 'built'; readonly buildingId: number }
  | { readonly type: 'distilled'; readonly buildingId: number }
  | { readonly type: 'trained'; readonly unitId: number }
  | { readonly type: 'full'; readonly unitId: number }
  | { readonly type: 'garrisoned'; readonly buildingId: number; readonly unitId: number }
  | { readonly type: 'ungarrisoned'; readonly buildingId: number; readonly unitId: number }
  /** `count`: how many it touched (tourists, jobs hurried); 0 = it backfired. */
  | {
      readonly type: 'ability';
      readonly faction: FactionId;
      readonly ability: AbilityId;
      readonly unitId: number;
      readonly count: number;
    }
  | { readonly type: 'haraci'; readonly faction: FactionId; readonly amount: number }
  | { readonly type: 'haraciPaid'; readonly faction: FactionId; readonly amount: number }
  | { readonly type: 'raid'; readonly faction: FactionId; readonly count: number }
  | { readonly type: 'left'; readonly unitId: number }
  | { readonly type: 'tax'; readonly faction: FactionId }
  | { readonly type: 'summer'; readonly visitors: number }
  | { readonly type: 'eliminated'; readonly faction: FactionId }
  | { readonly type: 'hit'; readonly x: number; readonly y: number }
  | { readonly type: 'died'; readonly unitId: number; readonly faction: FactionId; readonly x: number; readonly y: number }
  | { readonly type: 'destroyed'; readonly buildingId: number; readonly faction: FactionId }
  | { readonly type: 'era'; readonly faction: FactionId; readonly era: number }
  | { readonly type: 'bribe'; readonly faction: FactionId; readonly buildingId: number; readonly worked: boolean }
  | { readonly type: 'researched'; readonly faction: FactionId; readonly techId: TechId; readonly targetFaction?: FactionId }
  | { readonly type: 'funds'; readonly faction: FactionId }
  | { readonly type: 'scandal'; readonly unitId: number; readonly onlookers: readonly number[] }
  | { readonly type: 'won'; readonly faction: FactionId };

export interface WorldOptions {
  readonly seed: number;
  /** Supply a ready map (tests); otherwise Romania is generated. */
  readonly map?: GameMap;
  /** Whether the Porte sends for tribute. Default: yes on Romania, no on a supplied map. */
  readonly haraci?: boolean;
  /** Map size scale (1 = 144×104 default, 1.5 = 216×156 bigger map). */
  readonly mapScale?: number;
  /** Whether to spawn Principatul Oltenia at Craiova in 5-faction mode. */
  readonly includeOltenia?: boolean;
}

export interface WorldSnapshot {
  readonly version: 1;
  readonly seed: number;
  readonly haraciOn: boolean;
  readonly mapScale?: number;
  readonly includeOltenia?: boolean;
  readonly tick: number;
  readonly nextId: number;
  readonly winner: FactionId | null;
  readonly rngState: number;
  readonly stock: Record<FactionId, Stock>;
  readonly buff: Record<FactionId, number>;
  readonly abilityCooldown: Record<FactionId, number>;
  readonly era: Record<FactionId, number>;
  readonly haraci: Record<FactionId, Haraci>;
  readonly researched?: Record<FactionId, TechId[]>;
  readonly debuffs?: Record<FactionId, FactionDebuffs>;
  readonly units: Unit[];
  readonly buildings: Building[];
  readonly pending: Command[];
  readonly forestChanges: readonly (readonly [number, number])[];
  readonly customMap?: {
    readonly width: number;
    readonly height: number;
    readonly tiles: number[];
    readonly regions: number[];
    readonly wood: number[];
  };
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
  readonly mapScale: number;
  readonly includeOltenia: boolean;
  readonly units: Unit[] = [];
  readonly buildings: Building[] = [];
  readonly stock: Record<FactionId, Stock> = perFaction(() => ({ lemn: 50, prune: 30, palinca: 0 }));
  /** Ticks of "better after a drink" left per faction. */
  readonly buff: Record<FactionId, number> = perFaction(() => 0);
  /** Ticks until each faction's ability is ready again. */
  readonly abilityCooldown: Record<FactionId, number> = perFaction(() => 0);
  /** Index into ERAS for each faction; they advance separately. */
  readonly era: Record<FactionId, number> = perFaction(() => 0);
  /** What each faction owes the Porte right now. */
  readonly haraci: Record<FactionId, Haraci> = perFaction(() => ({ due: 0, amount: 0, asked: 0, refused: 0 }));
  /** Completed research per faction. */
  readonly researched: Record<FactionId, TechId[]> = perFaction(() => []);
  /** Active timed sabotage debuffs per faction. */
  readonly debuffs: Record<FactionId, FactionDebuffs> = perFaction(() => ({ dosar: 0, panaCurent: 0 }));
  /** The last faction with a court standing. */
  winner: FactionId | null = null;
  tick = 0;

  /** Building id occupying each tile, 0 if none. */
  private readonly occupant: Int32Array;
  private readonly rng: Rng;
  private readonly seed: number;
  private readonly haraciOn: boolean;
  private readonly hasCustomMap: boolean;
  private nextId = 1;
  private pending: Command[] = [];
  private events: SimEvent[] = [];
  private readonly clearedForestTiles: number[] = [];

  constructor(options: WorldOptions, skipSetup = false) {
    this.seed = options.seed;
    this.mapScale = options.mapScale ?? 1;
    this.includeOltenia = options.includeOltenia ?? false;
    this.hasCustomMap = Boolean(options.map);
    this.map = options.map ?? generateRomania(options.seed, this.mapScale);
    this.occupant = new Int32Array(this.map.width * this.map.height);
    this.rng = new Rng(options.seed);
    this.haraciOn = options.haraci ?? !options.map;
    if (!options.map && !skipSetup) this.setupRomania();
  }

  toSnapshot(): WorldSnapshot {
    return {
      version: 1,
      seed: this.seed,
      haraciOn: this.haraciOn,
      mapScale: this.mapScale,
      includeOltenia: this.includeOltenia,
      tick: this.tick,
      nextId: this.nextId,
      winner: this.winner,
      rngState: this.rng.getState(),
      stock: perFaction((f) => ({ ...this.stock[f] })),
      buff: perFaction((f) => this.buff[f]),
      abilityCooldown: perFaction((f) => this.abilityCooldown[f]),
      era: perFaction((f) => this.era[f]),
      haraci: perFaction((f) => ({ ...this.haraci[f] })),
      researched: perFaction((f) => [...this.researched[f]]),
      debuffs: perFaction((f) => ({ ...this.debuffs[f] })),
      units: this.units.map((u) => ({
        ...u,
        path: [...u.path],
        order:
          u.order.type === 'build' || u.order.type === 'garrison'
            ? { ...u.order, resume: u.order.resume ? { ...u.order.resume } : null }
            : { ...u.order },
      })),
      buildings: this.buildings.map((b) => ({
        ...b,
        queue: [...b.queue],
        rally: b.rally ? { ...b.rally } : null,
        garrison: (b.garrison ?? []).map((g) => ({
          ...g,
          resume: g.resume ? { ...g.resume } : null,
        })),
      })),
      pending: this.pending.map((c) => ('unitIds' in c ? { ...c, unitIds: [...c.unitIds] } : { ...c })),
      forestChanges: this.hasCustomMap ? [] : this.collectForestChanges(),
      customMap: this.hasCustomMap
        ? {
            width: this.map.width,
            height: this.map.height,
            tiles: Array.from(this.map.tiles),
            regions: Array.from(this.map.regions),
            wood: Array.from(this.map.wood),
          }
        : undefined,
    };
  }

  private collectForestChanges(): [number, number][] {
    const changes: [number, number][] = [];
    // Track tiles that started as forest (either have wood < WOOD_PER_FOREST, or became grass via clearing).
    for (const i of this.clearedForestTiles) changes.push([i, 0]);
    for (let i = 0; i < this.map.wood.length; i++) {
      const w = this.map.wood[i]!;
      if (w > 0 && w < WOOD_PER_FOREST) changes.push([i, w]);
    }
    return changes;
  }

  static fromSnapshot(snap: WorldSnapshot): World {
    let map: GameMap | undefined;
    if (snap.customMap) {
      map = new GameMap(snap.customMap.width, snap.customMap.height);
      map.tiles.set(snap.customMap.tiles);
      map.regions.set(snap.customMap.regions);
      map.wood.set(snap.customMap.wood);
    }
    const world = new World(
      {
        seed: snap.seed,
        map,
        haraci: snap.haraciOn,
        mapScale: snap.mapScale ?? 1,
        includeOltenia: snap.includeOltenia ?? false,
      },
      true,
    );
    if (!snap.customMap) {
      for (const [i, w] of snap.forestChanges) {
        world.map.wood[i] = w;
        if (w === 0 && world.map.tiles[i] === Terrain.Forest) {
          world.map.tiles[i] = Terrain.Grass;
          world.clearedForestTiles.push(i);
        }
      }
    }
    world.tick = snap.tick;
    world.nextId = snap.nextId;
    world.winner = snap.winner;
    world.rng.setState(snap.rngState);
    for (const f of ALL_FACTION_IDS) {
      if (snap.stock[f]) world.stock[f] = { ...snap.stock[f] };
      if (snap.buff[f] !== undefined) world.buff[f] = snap.buff[f];
      if (snap.abilityCooldown[f] !== undefined) world.abilityCooldown[f] = snap.abilityCooldown[f];
      if (snap.era[f] !== undefined) world.era[f] = snap.era[f];
      if (snap.haraci[f]) world.haraci[f] = { ...snap.haraci[f] };
      if (snap.researched?.[f]) world.researched[f] = [...snap.researched[f]];
      if (snap.debuffs?.[f]) world.debuffs[f] = { ...snap.debuffs[f] };
    }
    for (const u of snap.units) {
      world.units.push({
        ...u,
        path: [...u.path],
        order:
          u.order.type === 'build' || u.order.type === 'garrison'
            ? { ...u.order, resume: u.order.resume ? { ...u.order.resume } : null }
            : { ...u.order },
      });
    }
    for (const b of snap.buildings) {
      const copy: Building = {
        ...b,
        queue: [...b.queue],
        rally: b.rally ? { ...b.rally } : null,
        garrison: (b.garrison ?? []).map((g) => ({
          ...g,
          resume: g.resume ? { ...g.resume } : null,
        })),
      };
      world.buildings.push(copy);
      const def = BUILDINGS[copy.kind];
      for (let dy = 0; dy < def.size; dy++) {
        for (let dx = 0; dx < def.size; dx++) {
          const idx = world.map.index(copy.tx + dx, copy.ty + dy);
          world.occupant[idx] = copy.id;
          if (def.blocks) world.map.blocked[idx] = 1;
          if (copy.kind === 'poarta') world.map.gateOwner[idx] = factionCode(copy.faction);
        }
      }
    }
    world.pending = snap.pending.map((c) => ('unitIds' in c ? { ...c, unitIds: [...c.unitIds] } : { ...c }));
    return world;
  }

  /** 1600: Alba Iulia, Iași, Târgoviște, Constanța (and Craiova when Oltenia joins). */
  private setupRomania(): void {
    const s = this.mapScale;
    const starts: [FactionId, { x: number; y: number }][] = [
      ['ardeal', placeTile(PLACES.albaIulia, s)],
      ['moldova', placeTile(PLACES.iasi, s)],
      ['tara', placeTile(PLACES.targoviste, s)],
      ['dobrogea', placeTile(PLACES.constanta, s)],
    ];
    if (this.includeOltenia) starts.push(['oltenia', placeTile(PLACES.craiova, s)]);
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
    if (kind === undefined || kind === 'taran') {
      for (const b of this.buildings) {
        if (b.faction === faction && b.garrison) n += b.garrison.length;
      }
    }
    return n;
  }

  garrisonCap(building: Building): number {
    return BUILDINGS[building.kind].garrisonCap ?? 0;
  }

  garrisonCount(building: Building): number {
    return building.garrison?.length ?? 0;
  }

  canGarrison(faction: FactionId, building: Building): boolean {
    return (
      building.faction === faction &&
      building.done &&
      this.garrisonCount(building) < this.garrisonCap(building)
    );
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
    if (!BUILDINGS[kind].needsWater) return true;
    // A fishery needs a shore: some water right next to the footprint.
    for (let dy = -1; dy <= size; dy++) {
      for (let dx = -1; dx <= size; dx++) {
        if (!this.map.inBounds(tx + dx, ty + dy)) continue;
        const t = this.map.terrainAt(tx + dx, ty + dy);
        if (t === Terrain.Water || t === Terrain.Ford) return true;
      }
    }
    return false;
  }

  /** Factions that still have a court. */
  alive(): FactionId[] {
    return PLAYABLE_FACTION_IDS.filter((f) => this.buildings.some((b) => b.faction === f && b.kind === 'curte'));
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
    let houses = 0;
    let hans = 0;
    let blocks = 0;
    for (const b of this.buildings) {
      if (b.faction !== faction || !b.done) continue;
      if (b.kind === 'casa') houses++;
      else if (b.kind === 'han') hans++;
      else if (b.kind === 'bloc') blocks++;
    }
    const maxCap = houses > 0 || hans > 0 ? MAX_UNIT_CAP + 12 : MAX_UNIT_CAP;
    return Math.min(maxCap, BASE_UNIT_CAP + houses * UNITS_PER_CASA + hans * UNITS_PER_HAN + blocks * UNITS_PER_BLOC);
  }

  hasTech(faction: FactionId, techId: TechId): boolean {
    return this.researched[faction].includes(techId);
  }

  /** Technologies this building can research right now. */
  availableTechs(building: Building): TechDef[] {
    if (!building.done || building.researching) return [];
    const faction = building.faction;
    const era = this.era[faction];
    return TECH_IDS.map((id) => TECHS[id]).filter(
      (t) =>
        t.building === building.kind &&
        era >= t.era &&
        !this.hasTech(faction, t.id) &&
        !this.buildings.some((b) => b.faction === faction && b.researching === t.id),
    );
  }

  canResearch(faction: FactionId, building: Building, techId: TechId): boolean {
    if (building.faction !== faction || !building.done || building.researching) return false;
    const def = TECHS[techId];
    if (!def || def.building !== building.kind || this.era[faction] < def.era) return false;
    if (this.hasTech(faction, techId)) return false;
    if (this.buildings.some((b) => b.faction === faction && b.researching === techId)) return false;
    const stock = this.stock[faction];
    return stock.lemn >= def.costLemn && stock.prune >= def.costPrune;
  }

  /** Whether the faction's era knows how to build this at all. */
  canBuild(faction: FactionId, kind: BuildingKind): boolean {
    const def = BUILDINGS[kind];
    if (kind === 'curte' || (def.only && def.only !== faction)) return false;
    return this.era[faction] >= def.era;
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
    return this.isBusy(building);
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
      if (building.kind === 'livada' && building.hp >= building.maxHp) return 'plums';
      if (building.hp < building.maxHp) return 'build';
      if (building.kind === 'livada') return 'plums';
      if (building.kind === 'turn' && this.canGarrison(faction, building)) return 'garrison';
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

  /** `back` is only passed when an existing unit comes back (e.g. out of a shelter). */
  spawnUnit(
    faction: FactionId,
    tx: number,
    ty: number,
    kind: UnitKind = 'taran',
    back?: { readonly id: number; readonly hp: number; readonly maxHp: number },
  ): Unit {
    const def = FACTIONS[faction].units[kind];
    const x = tx * SUB + HALF;
    const y = ty * SUB + HALF;
    const unit: Unit = {
      id: back?.id ?? this.nextId++,
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
      hp: back?.hp ?? def.hp,
      maxHp: back?.maxHp ?? def.hp,
      damage: def.damage,
      attackCooldown: def.cooldown,
      cooldown: 0,
      shield: 0,
      carryKind: 'lemn',
      carryAmount: 0,
      drink: 0,
      stun: 0,
      scandalIn: kind === 'smecher' ? SCANDAL_MIN_GAP + this.rng.int(SCANDAL_GAP_SPREAD) : 0,
      expires: 0,
    };
    this.units.push(unit);
    return unit;
  }

  placeBuilding(kind: BuildingKind, faction: FactionId, tx: number, ty: number, done: boolean): Building {
    const def = BUILDINGS[kind];
    let maxHp = Math.floor((def.hp * FACTIONS[faction].buildingHpPercent) / 100);
    if (this.hasTech(faction, 'zidarie')) maxHp = Math.floor(maxHp * 1.25);
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
      rally: null,
      researching: null,
      researchLeft: 0,
      garrison: [],
    };
    this.buildings.push(building);
    const fCode = factionCode(faction);
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        const i = this.map.index(tx + dx, ty + dy);
        this.occupant[i] = building.id;
        if (def.blocks) this.map.blocked[i] = 1;
        if (kind === 'poarta') this.map.gateOwner[i] = fCode;
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
    for (const faction of PLAYABLE_FACTION_IDS) {
      if (this.buff[faction] > 0) this.buff[faction]--;
      if (this.abilityCooldown[faction] > 0) this.abilityCooldown[faction]--;
      if (this.debuffs[faction].dosar > 0) this.debuffs[faction].dosar--;
      if (this.debuffs[faction].panaCurent > 0) this.debuffs[faction].panaCurent--;
    }
    this.tick++;
    if (this.tick % FUNDS_EVERY === 0) {
      // Once Țara Românească is in the present, the capital takes its cut.
      const capital = this.era.tara >= LAST_ERA && this.courtOf('tara') ? this.stock.tara : null;
      for (const faction of PLAYABLE_FACTION_IDS) {
        if (this.era[faction] < LAST_ERA || !this.courtOf(faction)) continue;
        let amount = FUNDS_AMOUNT;
        if (capital && faction !== 'tara') {
          amount -= CAPITAL_TAX;
          capital.lemn += CAPITAL_TAX;
          capital.prune += CAPITAL_TAX;
          this.events.push({ type: 'tax', faction });
        }
        this.stock[faction].lemn += amount;
        this.stock[faction].prune += amount;
        this.events.push({ type: 'funds', faction });
      }
    }
    if (this.tick % SUMMER_EVERY === 0 && this.era.dobrogea >= LAST_ERA && this.courtOf('dobrogea')) {
      // Everybody comes to the seaside, pays, and leaves the place a little worse.
      const visitors = this.alive().length - 1;
      if (visitors > 0) {
        this.stock.dobrogea.prune += SUMMER_FEE * visitors;
        for (const b of this.buildings) {
          if (b.faction !== 'dobrogea') continue;
          b.hp = Math.max(1, b.hp - Math.floor((b.maxHp * SUMMER_WEAR_PERCENT) / 100));
        }
        this.events.push({ type: 'summer', visitors });
      }
    }
    if (this.haraciOn) this.stepHaraci();
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
      case 'attackMove':
        this.orderAttackMove(this.ownUnits(command.faction, command.unitIds), command.tx, command.ty);
        break;
      case 'build':
        this.applyBuild(command);
        break;
      case 'buildLine':
        this.applyBuildLine(command);
        break;
      case 'garrison':
        this.applyGarrison(command.faction, command.unitIds, command.buildingId);
        break;
      case 'ungarrison':
        this.applyUngarrison(command.faction, command.buildingId, true);
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
      case 'cancelQueue':
        this.applyCancelQueue(command.faction, command.buildingId);
        break;
      case 'rally': {
        const building = this.getBuilding(command.buildingId);
        if (!building || building.faction !== command.faction || !this.map.inBounds(command.tx, command.ty)) break;
        building.rally = { tx: command.tx, ty: command.ty };
        break;
      }
      case 'research':
        this.applyResearch(command.faction, command.buildingId, command.techId, command.targetFaction);
        break;
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
      case 'haraci': {
        const owed = this.haraci[command.faction];
        if (owed.due === 0) break;
        if (!command.pay) {
          owed.due = 0;
          this.raid(command.faction);
        } else if (this.stock[command.faction].prune >= owed.amount) {
          this.stock[command.faction].prune -= owed.amount;
          owed.due = 0;
          this.events.push({ type: 'haraciPaid', faction: command.faction, amount: owed.amount });
        }
        break;
      }
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
    } else if (kind === 'garrison' && building) {
      for (const unit of units) {
        if (unit.kind === 'taran') this.orderGarrison(unit, building);
        else this.orderMove([unit], command.tx, command.ty);
      }
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

  private nearestShelter(unit: Unit, reserved?: ReadonlyMap<number, number>): Building | undefined {
    let best: Building | undefined;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (!this.canGarrison(unit.faction, b)) continue;
      const incoming = reserved?.get(b.id) ?? 0;
      if (this.garrisonCount(b) + incoming >= this.garrisonCap(b)) continue;
      const size = BUILDINGS[b.kind].size;
      const cx = (b.tx * 2 + size) * HALF;
      const cy = (b.ty * 2 + size) * HALF;
      const d = distSq(cx, cy, unit.x, unit.y);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private applyGarrison(faction: FactionId, unitIds: UnitIds, buildingId?: number): void {
    const peasants = this.ownUnits(faction, unitIds).filter((u) => u.kind === 'taran');
    if (peasants.length === 0) return;
    if (buildingId !== undefined) {
      const building = this.getBuilding(buildingId);
      if (!building || !this.canGarrison(faction, building)) return;
      for (const unit of peasants) this.orderGarrison(unit, building);
      return;
    }
    const reserved = new Map<number, number>();
    for (const unit of peasants) {
      const shelter = this.nearestShelter(unit, reserved) ?? this.nearestShelter(unit);
      if (!shelter) continue;
      reserved.set(shelter.id, (reserved.get(shelter.id) ?? 0) + 1);
      this.orderGarrison(unit, shelter);
    }
  }

  /**
   * Let sheltered peasants out next to the building. `evacuate` is used when the
   * building is being removed: then nobody may stay behind, so peasants may share a tile.
   */
  private applyUngarrison(faction: FactionId, buildingId: number, resumeWork: boolean, evacuate = false): void {
    const building = this.getBuilding(buildingId);
    if (!building || building.faction !== faction || !building.garrison || building.garrison.length === 0) return;
    const def = BUILDINGS[building.kind];
    const taken = new Set<number>();
    for (const u of this.units) taken.add(this.tileOf(u));
    const fCode = factionCode(faction);
    const ex = building.tx + (def.size >> 1);
    const ey = building.ty + def.size;
    while (building.garrison.length > 0) {
      let spot = nearestPassable(this.map, ex, ey, taken, fCode);
      if (spot === -1 && evacuate) spot = nearestPassable(this.map, ex, ey, new Set(), fCode);
      if (spot === -1) break;
      const g = building.garrison.shift()!;
      taken.add(spot);
      const sx = spot % this.map.width;
      const unit = this.spawnUnit(faction, sx, (spot - sx) / this.map.width, 'taran', g);
      unit.carryKind = g.carryKind;
      unit.carryAmount = g.carryAmount;
      this.events.push({ type: 'ungarrisoned', buildingId: building.id, unitId: unit.id });
      if (resumeWork && g.resume) {
        if (g.resume.resource === 'prune') {
          const orchard = this.getBuilding(g.resume.buildingId);
          if (orchard) this.orderPickPlums(unit, orchard);
        } else {
          this.orderChop(unit, g.resume.tile);
        }
      }
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

  private applyBuildLine(command: Extract<Command, { type: 'buildLine' }>): void {
    if (!this.canBuild(command.faction, command.kind)) return;
    const placed: Building[] = [];
    for (const [tx, ty] of command.tiles) {
      if (!this.canPlace(command.kind, tx, ty) || !this.canAfford(command.faction, command.kind)) continue;
      this.stock[command.faction].lemn -= this.buildingCost(command.faction, command.kind);
      placed.push(this.placeBuilding(command.kind, command.faction, tx, ty, false));
    }
    if (placed.length > 0) {
      for (const unit of this.ownUnits(command.faction, command.unitIds)) this.orderBuild(unit, placed[0]!);
    }
  }

  private applyCancelQueue(faction: FactionId, buildingId: number): void {
    const building = this.getBuilding(buildingId);
    if (!building || building.faction !== faction) return;
    if (building.researching) {
      const def = TECHS[building.researching];
      this.stock[faction].lemn += def.costLemn;
      this.stock[faction].prune += def.costPrune;
      building.researching = null;
      building.researchLeft = 0;
      building.researchTarget = undefined;
      return;
    }
    const kind = building.queue.pop();
    if (!kind) return;
    const cost = this.unitCost(faction, kind);
    this.stock[faction].prune += cost.prune;
    this.stock[faction].lemn += cost.lemn;
    if (building.queue.length === 0) building.trainLeft = 0;
  }

  private applyResearch(
    faction: FactionId,
    buildingId: number,
    techId: TechId,
    targetFaction?: FactionId,
  ): void {
    const building = this.getBuilding(buildingId);
    if (!building || !this.canResearch(faction, building, techId)) return;
    const def = TECHS[techId];
    this.stock[faction].lemn -= def.costLemn;
    this.stock[faction].prune -= def.costPrune;
    building.researching = techId;
    building.researchLeft = Math.floor((def.researchTicks * FACTIONS[faction].buildTimePercent) / 100);
    building.researchTarget = targetFaction ?? this.pickRivalTarget(faction);
  }

  private pickRivalTarget(faction: FactionId): FactionId | undefined {
    const rivals = this.alive().filter((f) => f !== faction);
    if (rivals.length === 0) return undefined;
    return rivals.find((f) => isRival(faction, f)) ?? rivals[0];
  }

  private completeResearch(building: Building): void {
    const techId = building.researching;
    if (!techId) return;
    const faction = building.faction;
    const target = building.researchTarget ?? this.pickRivalTarget(faction);
    building.researching = null;
    building.researchLeft = 0;
    building.researchTarget = undefined;
    if (!this.hasTech(faction, techId)) this.researched[faction].push(techId);

    if (techId === 'zidarie') {
      for (const b of this.buildings) {
        if (b.faction !== faction) continue;
        const gain = Math.floor(b.maxHp * 0.25);
        b.maxHp += gain;
        b.hp += gain;
      }
    } else if (techId === 'dosar' && target) {
      this.debuffs[target].dosar = 450;
    } else if (techId === 'para' && target) {
      const owed = this.haraci[target];
      if (owed.due > 0) {
        owed.amount += 20;
      } else if (FACTIONS[target].paysHaraci && this.era[target] <= HARACI_LAST_ERA && this.courtOf(target)) {
        owed.amount = HARACI_BASE + HARACI_STEP * owed.asked + 20;
        owed.asked++;
        owed.due = HARACI_DEADLINE;
        this.events.push({ type: 'haraci', faction: target, amount: owed.amount });
      }
    } else if (techId === 'pana_curent' && target) {
      this.debuffs[target].panaCurent = 300;
    }
    this.events.push({ type: 'researched', faction, techId, targetFaction: target });
  }

  private applyBribe(faction: FactionId, buildingId: number): void {
    const building = this.getBuilding(buildingId);
    if (!building || !this.canBribe(faction, building)) return;
    this.stock[faction].prune -= BRIBE_PRUNE;
    // Sometimes the plums are taken and nothing moves. That is the era.
    const pocketedOneIn = this.hasTech(faction, 'pila') ? 10 : BRIBE_POCKETED_ONE_IN;
    const worked = this.rng.int(pocketedOneIn) !== 0;
    if (worked) this.hurry(building);
    this.events.push({ type: 'bribe', faction, buildingId, worked });
  }

  /** Whether a building has something in progress. */
  private isBusy(building: Building): boolean {
    return (
      !building.done ||
      building.queue.length > 0 ||
      building.advanceLeft > 0 ||
      (building.researchLeft ?? 0) > 0
    );
  }

  /** Finish whatever the building is in the middle of. */
  private hurry(building: Building): void {
    if (!building.done) {
      building.buildLeft = 0;
      building.done = true;
      this.events.push({ type: 'built', buildingId: building.id });
    } else if (building.advanceLeft > 0) {
      building.advanceLeft = 1;
    } else if ((building.researchLeft ?? 0) > 0) {
      building.researchLeft = 1;
    } else if (building.queue.length > 0) {
      building.trainLeft = 1;
    }
  }

  // --- The Porte ---------------------------------------------------------------

  private stepHaraci(): void {
    for (const faction of PLAYABLE_FACTION_IDS) {
      const owed = this.haraci[faction];
      if (owed.due > 0) {
        owed.due--;
        if (owed.due === 0) this.raid(faction);
      }
    }
    if (this.tick % HARACI_EVERY !== 0) return;
    for (const faction of PLAYABLE_FACTION_IDS) {
      const owed = this.haraci[faction];
      // Dobrogea already belongs to the Porte, and nobody pays after independence.
      if (!FACTIONS[faction].paysHaraci || this.era[faction] > HARACI_LAST_ERA) continue;
      if (owed.due > 0 || !this.courtOf(faction)) continue;
      owed.amount = HARACI_BASE + HARACI_STEP * owed.asked;
      owed.asked++;
      owed.due = HARACI_DEADLINE;
      this.events.push({ type: 'haraci', faction, amount: owed.amount });
    }
  }

  /** The tribute was not paid: janissaries come for the court, more each time. */
  private raid(faction: FactionId): void {
    const court = this.courtOf(faction);
    if (!court) return;
    const owed = this.haraci[faction];
    const count = RAID_BASE + RAID_STEP * owed.refused;
    owed.refused++;
    const taken = new Set<number>();
    for (const u of this.units) taken.add(this.tileOf(u));
    for (let n = 0; n < count; n++) {
      // They come up from the south, from the Danube.
      const spot = nearestPassable(this.map, court.tx + 1, court.ty + 12, taken);
      if (spot === -1) break;
      taken.add(spot);
      const sx = spot % this.map.width;
      const raider = this.spawnUnit(RAIDERS, sx, (spot - sx) / this.map.width, 'ostas');
      raider.expires = RAID_TICKS;
      this.orderAttack(raider, court.id);
    }
    this.events.push({ type: 'raid', faction, count });
  }

  private applyAbility(faction: FactionId, unitId: number | undefined): void {
    if (!this.abilityReady(faction)) return;
    const def = FACTIONS[faction].ability;

    if (def.id === 'palinca') {
      // Everyone of ours stops for a glass; enemies standing close can't say no
      // either, and they take longer over it.
      const doubleRefined = this.hasTech(faction, 'palinca_dubla');
      const enemyDrink = doubleRefined ? Math.floor(ENEMY_DRINK_TICKS * 1.5) : ENEMY_DRINK_TICKS;
      const buffDur = doubleRefined ? Math.floor(BUFF_TICKS * 1.5) : BUFF_TICKS;
      const own = this.units.filter((u) => u.faction === faction);
      for (const enemy of this.units) {
        if (enemy.faction === faction) continue;
        if (own.some((u) => distSq(u.x, u.y, enemy.x, enemy.y) <= DRINK_RADIUS * DRINK_RADIUS)) {
          enemy.drink = enemyDrink;
        }
      }
      for (const unit of own) unit.drink = DRINK_TICKS;
      this.buff[faction] = DRINK_TICKS + buffDur;
      this.events.push({ type: 'ability', faction, ability: 'palinca', unitId: own[0]?.id ?? 0, count: own.length });
    } else if (def.id === 'iures') {
      const own = this.units.filter((u) => u.faction === faction);
      for (const unit of own) {
        unit.drink = 0;
        unit.stun = 0;
      }
      this.buff[faction] = 220;
      this.events.push({ type: 'ability', faction, ability: 'iures', unitId: own[0]?.id ?? 0, count: own.length });
    } else if (def.id === 'rezolva') {
      // Everything in progress gets "sorted out" — or, one time in four, nothing does.
      const busy = this.buildings.filter((b) => b.faction === faction && this.isBusy(b));
      if (busy.length === 0) return;
      const worked = this.rng.int(REZOLVA_FAILS_ONE_IN) !== 0;
      if (worked) for (const b of busy) this.hurry(b);
      else this.stock[faction].prune = Math.max(0, this.stock[faction].prune - REZOLVA_FAIL_PRUNE);
      this.events.push({ type: 'ability', faction, ability: 'rezolva', unitId: 0, count: worked ? busy.length : 0 });
    } else if (def.id === 'plaja') {
      // Enemy soldiers near the court drop everything for the beach, and pay for the sunbed.
      const court = this.courtOf(faction);
      if (!court) return;
      const cx = (court.tx * 2 + BUILDINGS.curte.size) * HALF;
      const cy = (court.ty * 2 + BUILDINGS.curte.size) * HALF;
      let tourists = 0;
      for (const enemy of this.units) {
        if (enemy.faction === faction || !isFighter(enemy.kind)) continue;
        if (distSq(cx, cy, enemy.x, enemy.y) > BEACH_RADIUS * BEACH_RADIUS) continue;
        enemy.stun = BEACH_STUN;
        tourists++;
      }
      if (tourists === 0) return;
      this.stock[faction].prune += BEACH_FEE * tourists;
      this.events.push({ type: 'ability', faction, ability: 'plaja', unitId: 0, count: tourists });
    } else if (def.id === 'taunt') {
      const taunter = unitId === undefined ? undefined : this.getUnit(unitId);
      if (!taunter || taunter.faction !== faction) return;
      for (const enemy of this.units) {
        if (enemy.faction === faction || !isFighter(enemy.kind)) continue;
        if (distSq(taunter.x, taunter.y, enemy.x, enemy.y) > TAUNT_RADIUS * TAUNT_RADIUS) continue;
        const target = enemy.order.type === 'attack' ? enemy.order.target : taunter.id;
        enemy.order = { type: 'attack', target, current: taunter.id, lock: TAUNT_TICKS, repath: 0 };
      }
      taunter.shield = TAUNT_TICKS;
      this.events.push({ type: 'ability', faction, ability: 'taunt', unitId: taunter.id, count: 1 });
    } else {
      return;
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
    unit.path = findPath(this.map, sx, sy, gx, gy, factionCode(unit.faction)).reverse();
    // Caught between tiles with nowhere to go: settle on the current tile.
    if (unit.path.length === 0) unit.path.push(this.map.index(sx, sy));
  }

  /** Destination (or current) tile for every unit except `excludeId`, for crowd fan-out. */
  private unitDestinations(excludeId = -1): Set<number> {
    const taken = new Set<number>();
    for (const u of this.units) {
      if (u.id === excludeId) continue;
      taken.add(u.path.length > 0 ? u.path[0]! : this.tileOf(u));
    }
    return taken;
  }

  private orderMove(units: Unit[], tx: number, ty: number): void {
    // Fan out around the target tile and avoid stationary bystanders.
    const moving = new Set(units.map((u) => u.id));
    const taken = new Set<number>();
    for (const other of this.units) {
      if (!moving.has(other.id) && other.path.length === 0) taken.add(this.tileOf(other));
    }
    for (const unit of units) {
      const goal = nearestPassable(this.map, tx, ty, taken, factionCode(unit.faction));
      if (goal === -1) continue;
      taken.add(goal);
      unit.order = { type: 'move' };
      this.sendTo(unit, goal);
    }
  }

  private orderAttackMove(units: Unit[], tx: number, ty: number): void {
    const moving = new Set(units.map((u) => u.id));
    const taken = new Set<number>();
    for (const other of this.units) {
      if (!moving.has(other.id) && other.path.length === 0) taken.add(this.tileOf(other));
    }
    for (const unit of units) {
      const goal = nearestPassable(this.map, tx, ty, taken, factionCode(unit.faction));
      if (goal === -1) continue;
      taken.add(goal);
      const gx = goal % this.map.width;
      const gy = (goal - gx) / this.map.width;
      unit.order = { type: 'attackMove', gx, gy };
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
    const approach = this.approachTile(building, unit, this.unitDestinations(unit.id));
    if (approach === -1) return;
    const resume = resumeOf(unit.order);
    unit.order = { type: 'build', buildingId: building.id, phase: 'going', resume };
    this.sendTo(unit, approach);
  }

  private orderGarrison(unit: Unit, building: Building): void {
    if (unit.kind !== 'taran') return;
    const approach = this.approachTile(building, unit, this.unitDestinations(unit.id));
    if (approach === -1) return;
    const resume = resumeOf(unit.order);
    unit.order = { type: 'garrison', buildingId: building.id, resume };
    this.sendTo(unit, approach);
  }

  private isAdjacent(building: Building, tile: number): boolean {
    const size = BUILDINGS[building.kind].size;
    const tx = tile % this.map.width;
    const ty = (tile - tx) / this.map.width;
    return tx >= building.tx - 1 && tx <= building.tx + size && ty >= building.ty - 1 && ty <= building.ty + size;
  }

  /** Passable tile next to (or inside, if walkable) a building, nearest to the unit, fanning out around `taken`. */
  private approachTile(building: Building, unit: Unit, taken?: ReadonlySet<number>): number {
    const size = BUILDINGS[building.kind].size;
    const ux = Math.floor(unit.x / SUB);
    const uy = Math.floor(unit.y / SUB);
    let freeBest = -1;
    let freeD = 0;
    let anyBest = -1;
    let anyD = 0;
    for (let ty = building.ty - 1; ty <= building.ty + size; ty++) {
      for (let tx = building.tx - 1; tx <= building.tx + size; tx++) {
        if (!this.map.isPassable(tx, ty, factionCode(unit.faction))) continue;
        const idx = this.map.index(tx, ty);
        const d = (tx - ux) * (tx - ux) + (ty - uy) * (ty - uy);
        if (anyBest === -1 || d < anyD) {
          anyBest = idx;
          anyD = d;
        }
        if (!taken?.has(idx) && (freeBest === -1 || d < freeD)) {
          freeBest = idx;
          freeD = d;
        }
      }
    }
    return freeBest !== -1 ? freeBest : anyBest;
  }

  /** Passable tile adjacent to an enemy unit so attackers surround it instead of stacking. */
  private approachUnitTile(target: Unit, unit: Unit, taken: ReadonlySet<number>): number {
    const targetTile = this.tileOf(target);
    if (!taken.has(targetTile)) return targetTile;
    const ttx = Math.floor(target.x / SUB);
    const tty = Math.floor(target.y / SUB);
    const ux = Math.floor(unit.x / SUB);
    const uy = Math.floor(unit.y / SUB);
    let best = -1;
    let bestD = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const tx = ttx + dx;
        const ty = tty + dy;
        if (!this.map.isPassable(tx, ty, factionCode(unit.faction))) continue;
        const idx = this.map.index(tx, ty);
        if (taken.has(idx)) continue;
        const d = (tx - ux) * (tx - ux) + (ty - uy) * (ty - uy);
        if (best === -1 || d < bestD) {
          best = idx;
          bestD = d;
        }
      }
    }
    return best !== -1 ? best : targetTile;
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
    if (unit.expires > 0 && --unit.expires === 0) {
      // The raid is over: back to Stambul with whatever they got.
      unit.expires = -1;
      unit.hp = 0;
      return;
    }
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
      case 'attackMove':
        if (isFighter(unit.kind) && (this.tick + unit.id) % 5 === 0) {
          const threat = this.nearestEnemy(unit, AGGRO_RADIUS);
          if (threat !== 0) {
            this.orderAttack(unit, threat);
            break;
          }
        }
        this.walk(unit);
        if (unit.path.length === 0) unit.order = { type: 'idle' };
        break;
      case 'gather':
        this.stepGather(unit, order);
        break;
      case 'build':
        this.stepBuild(unit, order);
        break;
      case 'garrison':
        this.stepGarrison(unit, order);
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
  private nearestEnemy(unit: Unit, radius: number, unitsOnly = false, fightersOnly = false): number {
    const limit = radius * radius;
    let best = 0;
    let bestD = 0;
    let bestRank = 3;
    for (const other of this.units) {
      if (other.faction === unit.faction || other.hp <= 0) continue;
      if (fightersOnly && !isFighter(other.kind)) continue;
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
    // On the way to a building, defenders come first — but an army on a siege
    // leaves the peasants alone. With nothing left to hit, anything will do.
    const scan = !current || (order.lock === 0 && current.building && (this.tick + unit.id) % 5 === 0);
    if (scan) {
      const threat = this.nearestEnemy(unit, AGGRO_RADIUS, current !== undefined, current !== undefined);
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
      const taken = this.unitDestinations(unit.id);
      const goal = current.unit
        ? this.approachUnitTile(current.unit, unit, taken)
        : this.approachTile(current.building, unit, taken);
      if (goal === -1) {
        unit.order = { type: 'idle' };
        return;
      }
      this.sendTo(unit, goal);
    }
    this.walk(unit);
  }

  private hasNearbyStegar(unit: Unit): boolean {
    const r2 = STEGAR_RADIUS * STEGAR_RADIUS;
    for (const u of this.units) {
      if (u.hp <= 0 || u.id === unit.id || u.faction !== unit.faction || u.kind !== 'stegar') continue;
      const dx = u.x - unit.x;
      const dy = u.y - unit.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  private hasNearbyFriendlyFighter(stegar: Unit): boolean {
    const r2 = STEGAR_RADIUS * STEGAR_RADIUS;
    for (const u of this.units) {
      if (u.hp <= 0 || u.id === stegar.id || u.faction !== stegar.faction || !isFighter(u.kind) || u.kind === 'stegar') continue;
      const dx = u.x - stegar.x;
      const dy = u.y - stegar.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  private hasEnemySmecherNearby(unit: Unit): boolean {
    const r2 = INTIMIDATION_RADIUS * INTIMIDATION_RADIUS;
    for (const u of this.units) {
      if (u.hp <= 0 || u.faction === unit.faction || u.kind !== 'smecher') continue;
      const dx = u.x - unit.x;
      const dy = u.y - unit.y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  private hit(attacker: Unit, target: Target): void {
    let damage = attacker.damage;
    if (attacker.kind === 'stegar') {
      // "De ce nu lovește? Ăla-i cu steagul!" — only swings his pole for 3 dmg when cornered alone.
      if (this.hasNearbyFriendlyFighter(attacker)) {
        attacker.cooldown = attacker.attackCooldown;
        return;
      }
      damage = 3;
    }
    if (isFighter(attacker.kind) && attacker.kind !== 'stegar' && this.hasTech(attacker.faction, 'instructie')) {
      damage += 2;
    }
    if (this.hasNearbyStegar(attacker)) {
      damage += 2;
    }
    if (this.buff[attacker.faction] > 0) damage = Math.floor((damage * 3) / 2);
    const victim = (target.unit ?? target.building).faction;
    if (isRival(attacker.faction, victim)) damage = Math.floor((damage * RIVAL_DAMAGE_PERCENT) / 100);
    if (this.hasEnemySmecherNearby(attacker)) damage = Math.max(1, Math.floor((damage * 4) / 5));
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
      if (unit.expires === -1) this.events.push({ type: 'left', unitId: unit.id });
      else this.events.push({ type: 'died', unitId: unit.id, faction: unit.faction, x: unit.x, y: unit.y });
      this.units.splice(i, 1);
    }
    const fallen: FactionId[] = [];
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const building = this.buildings[i]!;
      if (building.hp > 0) continue;
      this.removeBuilding(i);
      const courtLeft = this.buildings.some((b) => b.faction === building.faction && b.kind === 'curte');
      if (building.kind === 'curte' && !courtLeft) fallen.push(building.faction);
    }
    for (const faction of fallen) {
      // No court, no principality: its buildings stand empty no more and its people go home.
      // Buildings first: tearing down a shelter lets its peasants out, and they must go home too.
      for (let i = this.buildings.length - 1; i >= 0; i--) {
        if (this.buildings[i]!.faction === faction) this.removeBuilding(i);
      }
      for (let i = this.units.length - 1; i >= 0; i--) {
        const unit = this.units[i]!;
        if (unit.faction !== faction) continue;
        this.events.push({ type: 'left', unitId: unit.id });
        this.units.splice(i, 1);
      }
      this.haraci[faction].due = 0;
      this.events.push({ type: 'eliminated', faction });
    }
    if (fallen.length > 0 && this.winner === null) {
      const alive = this.alive();
      if (alive.length === 1) {
        this.winner = alive[0]!;
        this.events.push({ type: 'won', faction: this.winner });
      }
    }
  }

  private removeBuilding(index: number): void {
    const building = this.buildings[index]!;
    if (building.garrison && building.garrison.length > 0) {
      this.applyUngarrison(building.faction, building.id, false, true);
    }
    const def = BUILDINGS[building.kind];
    for (let dy = 0; dy < def.size; dy++) {
      for (let dx = 0; dx < def.size; dx++) {
        const t = this.map.index(building.tx + dx, building.ty + dy);
        this.occupant[t] = 0;
        this.map.blocked[t] = 0;
        this.map.gateOwner[t] = 0;
      }
    }
    this.buildings.splice(index, 1);
    this.events.push({ type: 'destroyed', buildingId: building.id, faction: building.faction });
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
      const carry = this.hasTech(unit.faction, 'topor') ? CARRY + 2 : CARRY;
      let amount = carry;
      if (order.resource === 'lemn') {
        amount = Math.min(carry, this.map.wood[order.tile]!);
        this.map.wood[order.tile] = this.map.wood[order.tile]! - amount;
        if (this.map.wood[order.tile] === 0) {
          this.map.tiles[order.tile] = Terrain.Grass;
          if (!this.hasCustomMap) this.clearedForestTiles.push(order.tile);
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

  private findAdjacentUnfinishedWall(faction: FactionId, tx: number, ty: number): Building | undefined {
    let best: Building | undefined;
    let bestDist = Infinity;
    for (const b of this.buildings) {
      if (b.done || b.faction !== faction || (b.kind !== 'zid' && b.kind !== 'poarta')) continue;
      const dist = Math.abs(b.tx - tx) + Math.abs(b.ty - ty);
      if (dist <= 3 && dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best;
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
    if (this.debuffs[unit.faction].dosar > 0 && this.tick % 3 === 0) {
      return;
    }
    if (!building.done) {
      building.buildLeft--;
      if (building.buildLeft <= 0) {
        building.done = true;
        this.events.push({ type: 'built', buildingId: building.id });
        if (building.kind === 'zid' || building.kind === 'poarta') {
          const nextWall = this.findAdjacentUnfinishedWall(unit.faction, building.tx, building.ty);
          if (nextWall) {
            const savedResume = order.resume;
            this.orderBuild(unit, nextWall);
            if (unit.order.type === 'build' && savedResume) {
              unit.order.resume = savedResume;
            }
            return;
          }
        }
      }
    } else if (building.hp < building.maxHp) {
      if (this.tick % 25 === 0 && this.stock[unit.faction].lemn > 0) {
        this.stock[unit.faction].lemn--;
      }
      building.hp = Math.min(building.maxHp, building.hp + 5);
    }
    if (building.done && building.hp >= building.maxHp) {
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

  private stepGarrison(unit: Unit, order: Extract<Order, { type: 'garrison' }>): void {
    const building = this.getBuilding(order.buildingId);
    if (!building || !building.done || building.faction !== unit.faction) {
      unit.order = { type: 'idle' };
      return;
    }
    if (!this.canGarrison(unit.faction, building)) {
      const nextShelter = this.nearestShelter(unit);
      if (nextShelter) {
        this.orderGarrison(unit, nextShelter);
      } else {
        this.events.push({ type: 'full', unitId: unit.id });
        unit.order = { type: 'idle' };
      }
      return;
    }
    if (!this.isAdjacent(building, this.tileOf(unit))) {
      this.walk(unit);
      if (unit.path.length > 0) return;
      if (!this.isAdjacent(building, this.tileOf(unit))) {
        const approach = this.approachTile(building, unit, this.unitDestinations(unit.id));
        if (approach === -1) {
          unit.order = { type: 'idle' };
          return;
        }
        this.sendTo(unit, approach);
        return;
      }
    }
    if (!this.canGarrison(unit.faction, building)) {
      unit.order = { type: 'idle' };
      return;
    }
    // Only the court takes deliveries; anywhere else the peasant keeps the load on his back.
    if (unit.carryAmount > 0 && building.kind === 'curte') {
      this.stock[unit.faction][unit.carryKind] += unit.carryAmount;
      unit.carryAmount = 0;
    }
    if (!building.garrison) building.garrison = [];
    building.garrison.push({
      id: unit.id,
      hp: unit.hp,
      maxHp: unit.maxHp,
      carryKind: unit.carryKind,
      carryAmount: unit.carryAmount,
      resume: order.resume,
    });
    unit.expires = -1;
    unit.hp = 0;
    this.events.push({ type: 'garrisoned', buildingId: building.id, unitId: unit.id });
  }

  private stepBuilding(building: Building): void {
    if (!building.done || building.hp <= 0) return;
    const def = BUILDINGS[building.kind];
    const stock = this.stock[building.faction];
    const slowDosar = this.debuffs[building.faction].dosar > 0 && this.tick % 3 === 0;

    if (building.queue.length > 0 && !slowDosar) {
      building.trainLeft--;
      if (building.trainLeft <= 0) {
        const kind = building.queue.shift()!;
        // Step out onto a free tile, not onto somebody's head.
        const taken = new Set<number>();
        for (const u of this.units) taken.add(this.tileOf(u));
        const spot = nearestPassable(
          this.map,
          building.tx + (def.size >> 1),
          building.ty + def.size,
          taken,
          factionCode(building.faction),
        );
        if (spot !== -1) {
          const sx = spot % this.map.width;
          const unit = this.spawnUnit(building.faction, sx, (spot - sx) / this.map.width, kind);
          this.events.push({ type: 'trained', unitId: unit.id });
          if (building.rally) {
            if (unit.kind === 'taran') {
              this.applyAct({
                type: 'act',
                faction: building.faction,
                unitIds: [unit.id],
                tx: building.rally.tx,
                ty: building.rally.ty,
              });
            } else {
              this.orderAttackMove([unit], building.rally.tx, building.rally.ty);
            }
          }
        }
        const next = building.queue[0];
        building.trainLeft = next ? this.trainTime(building.faction, next) : 0;
      }
    }

    if (building.researching && (building.researchLeft ?? 0) > 0 && !slowDosar) {
      building.researchLeft = (building.researchLeft ?? 1) - 1;
      if (building.researchLeft <= 0) {
        this.completeResearch(building);
      }
    }

    if (building.advanceLeft > 0) {
      building.advanceLeft--;
      if (building.advanceLeft === 0 && this.era[building.faction] < LAST_ERA) {
        this.era[building.faction]++;
        this.events.push({ type: 'era', faction: building.faction, era: this.era[building.faction] });
      }
    }

    const garrisoned = building.garrison?.length ?? 0;
    if (building.kind === 'turn' || (building.kind === 'curte' && garrisoned > 0)) {
      if (building.sawLeft > 0) building.sawLeft--;
      if (building.sawLeft <= 0) {
        const cx = (building.tx * 2 + def.size) * HALF;
        const cy = (building.ty * 2 + def.size) * HALF;
        let bestEnemy: Unit | undefined;
        let bestD2 = TOWER_RANGE * TOWER_RANGE;
        for (const u of this.units) {
          if (u.hp <= 0 || u.faction === building.faction) continue;
          const d2 = distSq(cx, cy, u.x, u.y);
          if (d2 <= bestD2) {
            bestD2 = d2;
            bestEnemy = u;
          }
        }
        if (bestEnemy) {
          const baseDmg = building.kind === 'turn' ? TOWER_BASE_DAMAGE : 4;
          let dmg = baseDmg + this.era[building.faction] * 2 + garrisoned * TOWER_GARRISON_DAMAGE;
          if (bestEnemy.shield > 0) dmg = Math.max(1, dmg >> 1);
          bestEnemy.hp -= dmg;
          this.events.push({ type: 'hit', x: bestEnemy.x, y: bestEnemy.y });
          building.sawLeft = Math.max(6, TOWER_COOLDOWN - garrisoned);
        }
      }
    }

    if (building.kind === 'han' && this.tick % 15 === 0) {
      const cx = (building.tx * 2 + def.size) * HALF;
      const cy = (building.ty * 2 + def.size) * HALF;
      const r2 = HAN_RADIUS * HAN_RADIUS;
      for (const u of this.units) {
        if (u.hp <= 0 || u.faction !== building.faction || u.hp >= u.maxHp) continue;
        if (distSq(cx, cy, u.x, u.y) <= r2) {
          u.hp = Math.min(u.maxHp, u.hp + 2);
        }
      }
    }

    if (building.kind === 'cherhana') {
      building.sawLeft--;
      if (building.sawLeft <= 0) {
        building.sawLeft = CHERHANA_TICKS;
        stock.prune++;
      }
    }

    const powerOut = this.debuffs[building.faction].panaCurent > 0;

    if (building.kind === 'gater' && !powerOut) {
      building.sawLeft--;
      if (building.sawLeft <= 0) {
        building.sawLeft = GATER_TICKS;
        stock.lemn++;
      }
    }

    if (building.kind === 'cazan' && !powerOut) {
      if (building.distillLeft === 0) {
        if (stock.palinca < MAX_PALINCA && stock.prune >= DISTILL_PRUNE && stock.lemn >= DISTILL_LEMN) {
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
    if (this.hasNearbyStegar(unit)) {
      budget = Math.floor((budget * 115) / 100);
    }
    if (FACTIONS[unit.faction].traffic && this.era[unit.faction] >= LAST_ERA) {
      // The present, near the capital: everybody is stuck in it together.
      const court = this.courtOf(unit.faction);
      if (court) {
        const cx = (court.tx * 2 + BUILDINGS.curte.size) * HALF;
        const cy = (court.ty * 2 + BUILDINGS.curte.size) * HALF;
        if (distSq(cx, cy, unit.x, unit.y) <= TRAFFIC_RADIUS * TRAFFIC_RADIUS) {
          budget = Math.floor((budget * TRAFFIC_SPEED_PERCENT) / 100);
        }
      }
    }

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
      values.push(this.haraci[faction].due, this.haraci[faction].refused);
    }
    for (const u of this.units) {
      values.push(u.id, u.x, u.y, u.hp, u.path.length, u.carryAmount, u.drink, u.stun, u.cooldown, u.expires, ORDER_CODE[u.order.type]);
    }
    for (const b of this.buildings) {
      values.push(b.id, b.hp, b.buildLeft, b.done ? 1 : 0, b.queue.length, b.trainLeft, b.distillLeft, b.advanceLeft);
      if (b.garrison && b.garrison.length > 0) values.push(b.garrison.length);
    }
    return fnv1a(values);
  }
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}
