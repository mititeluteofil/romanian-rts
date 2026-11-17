import { BUILDINGS, ORCHARD_CAPACITY, type BuildingKind } from '../data/buildings';
import { ERAS, LAST_ERA } from '../data/eras';
import { FACTIONS, isFighter, type FactionId } from '../data/factions';
import { Terrain } from '../sim/map';
import { nearestTile } from '../sim/pathfinding';
import { SUB, type Building, type Unit, type World } from '../sim/world';

/** How often the AI looks at the board, in ticks. */
export const AI_THINK_EVERY = 10;

export type Difficulty = 'usor' | 'normal' | 'greu';

export const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  usor: 'Ușor',
  normal: 'Normal',
  greu: 'Greu',
};

interface DifficultyTuning {
  readonly thinkSkipMod: number;
  readonly wantedPeasants: number;
  readonly firstAttackTick: number;
  readonly biggestWave: number;
  readonly waveStep: number;
}

const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyTuning>> = {
  usor: { thinkSkipMod: 2, wantedPeasants: 5, firstAttackTick: 4200, biggestWave: 6, waveStep: 1 },
  normal: { thinkSkipMod: 1, wantedPeasants: 6, firstAttackTick: 3000, biggestWave: 10, waveStep: 2 },
  greu: { thinkSkipMod: 1, wantedPeasants: 7, firstAttackTick: 2400, biggestWave: 12, waveStep: 2 },
};

const WOOD_RESERVE = 100;
const DEFEND_RADIUS = 9 * SUB;
const FIRST_WAVE = 4;
const HOME_GUARD = 2;
/** Keep this much of each resource in hand when paying for a new era. */
const ERA_RESERVE = 25;
const WANTED_SMECHERI = 2;
const BEACH_RADIUS = 8 * SUB;

export interface AiOptions {
  /** false = a quiet neighbour: builds, defends its court, never marches. */
  readonly attacks?: boolean;
  readonly difficulty?: Difficulty;
}

export interface AiSnapshot {
  readonly faction: FactionId;
  readonly attacks: boolean;
  readonly difficulty?: Difficulty;
  readonly waveSize: number;
  readonly wavesSent: number;
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

/**
 * A simple scripted opponent. It plays by the same rules as a person: it only
 * reads the world and issues commands. Everything it decides depends on the
 * world state alone (plus its own wave counter), so matches stay reproducible.
 *
 * The plan: orchard → army camp → (pălincă still, if the faction drinks) →
 * second orchard; keep six peasants busy; send soldiers out in growing waves;
 * come home to defend; use the faction ability when a fight is on. Whenever
 * it can spare the wood and plums it moves on to the next era and puts up
 * what that era brings (sawmill, apartment block, mall).
 */
export class SkirmishAi {
  private waveSize = FIRST_WAVE;
  private wavesSent = 0;
  private readonly attacks: boolean;
  readonly difficulty: Difficulty;
  private readonly tuning: DifficultyTuning;

  constructor(
    readonly faction: FactionId,
    options: AiOptions = {},
  ) {
    this.attacks = options.attacks ?? true;
    this.difficulty = options.difficulty ?? 'normal';
    this.tuning = DIFFICULTIES[this.difficulty];
  }

  toSnapshot(): AiSnapshot {
    return {
      faction: this.faction,
      attacks: this.attacks,
      difficulty: this.difficulty,
      waveSize: this.waveSize,
      wavesSent: this.wavesSent,
    };
  }

  static fromSnapshot(snap: AiSnapshot): SkirmishAi {
    const ai = new SkirmishAi(snap.faction, {
      attacks: snap.attacks,
      difficulty: snap.difficulty ?? 'normal',
    });
    ai.waveSize = snap.waveSize;
    ai.wavesSent = snap.wavesSent;
    return ai;
  }

  think(world: World): void {
    if (this.tuning.thinkSkipMod > 1 && Math.floor(world.tick / AI_THINK_EVERY) % this.tuning.thinkSkipMod !== 0) {
      return;
    }
    const faction = this.faction;
    const court = world.courtOf(faction);
    if (!court || world.winner !== null) return;

    const mine = world.units.filter((u) => u.faction === faction);
    const peasants = mine.filter((u) => u.kind === 'taran');
    const soldiers = mine.filter((u) => isFighter(u.kind));
    const buildings = world.buildings.filter((b) => b.faction === faction);

    const owed = world.haraci[faction];
    if (owed.due > 0 && world.stock[faction].prune >= owed.amount) {
      world.issue({ type: 'haraci', faction, pay: true });
    }

    // Commands only land next tick, so remember who was just given the hammer.
    const builder = this.growEconomy(world, court, peasants, buildings);
    this.putPeasantsToWork(world, court, peasants.filter((u) => u.id !== builder), buildings);
    this.raiseArmy(world, peasants, soldiers, buildings);
    this.command(world, court, soldiers);
    this.useAbility(world, court, soldiers, buildings);
  }

  // --- Economy ----------------------------------------------------------------

  /** Trains peasants and runs the build order. Returns the id of a peasant sent to build, if any. */
  private growEconomy(world: World, court: Building, peasants: Unit[], buildings: Building[]): number | null {
    const faction = this.faction;
    const era = world.era[faction];
    const nursery = buildings.find((b) => b.done && world.trainable(b).includes('taran'));
    if (nursery) {
      const coming = nursery.queue.filter((k) => k === 'taran').length;
      if (peasants.length + coming < this.tuning.wantedPeasants && world.canTrain(faction, nursery, 'taran')) {
        world.issue({ type: 'train', faction, buildingId: nursery.id, kind: 'taran' });
      }
    }

    // New times, when they can be paid for without emptying the pantry.
    const next = ERAS[era + 1];
    const stock = world.stock[faction];
    if (
      next &&
      buildings.some((b) => b.kind === 'tabara' && b.done) &&
      stock.lemn >= next.advanceLemn + ERA_RESERVE &&
      stock.prune >= next.advancePrune + ERA_RESERVE &&
      world.canAdvance(faction)
    ) {
      world.issue({ type: 'advance', faction });
    }

    const pickBuilder = () =>
      peasants.find((u) => u.order.type === 'idle') ??
      peasants.find((u) => u.order.type === 'gather' && u.order.resource === 'lemn') ??
      peasants[0];

    // One building site at a time — and never leave one standing unfinished.
    const site0 = buildings.find((b) => !b.done);
    if (site0) {
      const tended = peasants.some((u) => u.order.type === 'build' && u.order.buildingId === site0.id);
      const helper = tended ? undefined : pickBuilder();
      if (!helper) return null;
      world.issue({ type: 'act', faction, unitIds: [helper.id], tx: site0.tx, ty: site0.ty });
      return helper.id;
    }
    const count = (kind: BuildingKind) => buildings.filter((b) => b.kind === kind).length;
    let kindNext: BuildingKind | null = null;
    if (count('livada') === 0) kindNext = 'livada';
    else if (world.canBuild(faction, 'cherhana') && count('cherhana') === 0) kindNext = 'cherhana';
    else if (count('tabara') === 0) kindNext = 'tabara';
    else if (FACTIONS[faction].ability.id === 'palinca' && count('cazan') === 0) kindNext = 'cazan';
    else if (era >= LAST_ERA && count('mall') === 0) kindNext = 'mall';
    else if (world.canBuild(faction, 'gater') && count('gater') === 0) kindNext = 'gater';
    else if (count('livada') < 2 && peasants.length >= 5) kindNext = 'livada';
    else if (world.canBuild(faction, 'bloc') && count('bloc') < 2 && world.unitCount(faction) >= world.unitCap(faction) - 3) {
      kindNext = 'bloc';
    }
    if (!kindNext || !world.canAfford(faction, kindNext)) return null;

    // Leave a one-tile lane around everything so nothing gets walled in.
    const size = BUILDINGS[kindNext].size;
    const kind = kindNext;
    const site = nearestTile(
      world.map,
      court.tx + 1,
      court.ty + 1,
      (_i, x, y) => {
        for (let dy = -1; dy <= size; dy++) {
          for (let dx = -1; dx <= size; dx++) {
            if (world.buildingAt(x + dx, y + dy)) return false;
          }
        }
        return world.canPlace(kind, x, y);
      },
      14,
    );
    if (site === -1) return null;
    const builder = pickBuilder();
    if (!builder) return null;
    const tx = site % world.map.width;
    world.issue({ type: 'build', faction, unitIds: [builder.id], kind, tx, ty: (site - tx) / world.map.width });
    return builder.id;
  }

  private putPeasantsToWork(world: World, court: Building, peasants: Unit[], buildings: Building[]): void {
    const faction = this.faction;
    let onWood = peasants.filter((u) => u.order.type === 'gather' && u.order.resource === 'lemn').length;
    const hasFishery = buildings.some((b) => b.kind === 'cherhana' && b.done);
    const wantedOnWood =
      hasFishery && world.stock[faction].prune >= 150 ? 4 : world.stock[faction].lemn < WOOD_RESERVE ? 3 : 2;

    const idle = peasants.filter((u) => u.order.type === 'idle');
    if (idle.length > 0) {
      const orchards = buildings.filter((b) => b.kind === 'livada' && b.done);
      const free = new Map<number, number>();
      for (const o of orchards) free.set(o.id, ORCHARD_CAPACITY - world.orchardWorkers(o.id));

      for (const unit of idle) {
        const orchard = orchards.find((o) => (free.get(o.id) ?? 0) > 0);
        if (orchard && onWood >= wantedOnWood) {
          free.set(orchard.id, (free.get(orchard.id) ?? 0) - 1);
          world.issue({ type: 'act', faction, unitIds: [unit.id], tx: orchard.tx, ty: orchard.ty });
          continue;
        }
        const forest = this.forestByFoot(world, court);
        if (forest !== -1) {
          const fx = forest % world.map.width;
          world.issue({ type: 'act', faction, unitIds: [unit.id], tx: fx, ty: (forest - fx) / world.map.width });
          onWood++;
        } else if (orchard) {
          free.set(orchard.id, (free.get(orchard.id) ?? 0) - 1);
          world.issue({ type: 'act', faction, unitIds: [unit.id], tx: orchard.tx, ty: orchard.ty });
        }
      }
    }

    // With a fishery keeping food full, pull spare orchard pickers onto wood.
    if (hasFishery && world.stock[faction].prune >= 200 && onWood < wantedOnWood) {
      const pickers = peasants.filter(
        (u) => u.order.type === 'gather' && u.order.resource === 'prune' && u.order.phase !== 'returning',
      );
      for (const picker of pickers) {
        if (onWood >= wantedOnWood) break;
        const forest = this.forestByFoot(world, court);
        if (forest === -1) break;
        const fx = forest % world.map.width;
        world.issue({ type: 'act', faction, unitIds: [picker.id], tx: fx, ty: (forest - fx) / world.map.width });
        onWood++;
      }
    }
  }

  /**
   * The forest tile that is the shortest walk from the court — not the closest
   * as the crow flies, which may sit across a river. Fords are not crossed.
   */
  private forestByFoot(world: World, court: Building): number {
    const map = world.map;
    const w = map.width;
    const seen = new Uint8Array(w * map.height);
    const queue: number[] = [];
    const size = BUILDINGS.curte.size;
    for (let y = court.ty - 1; y <= court.ty + size; y++) {
      for (let x = court.tx - 1; x <= court.tx + size; x++) {
        if (!map.isPassable(x, y)) continue;
        seen[map.index(x, y)] = 1;
        queue.push(map.index(x, y));
      }
    }
    for (let head = 0; head < queue.length && head < 4000; head++) {
      const i = queue[head]!;
      if (map.tiles[i] === Terrain.Forest && map.wood[i]! > 0) return i;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!map.isPassable(nx, ny)) continue;
        const n = map.index(nx, ny);
        if (seen[n] || map.tiles[n] === Terrain.Ford) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    // Nothing on this bank: settle for the closest in a straight line.
    return nearestTile(map, court.tx + 1, court.ty + 1, (i) => map.tiles[i] === Terrain.Forest && map.wood[i]! > 0, 40);
  }

  // --- War ----------------------------------------------------------------------

  private raiseArmy(world: World, peasants: Unit[], soldiers: Unit[], buildings: Building[]): void {
    const faction = this.faction;
    const prune = world.stock[faction].prune;
    // Don't starve the economy: peasants come first until there are enough.
    const reserve = peasants.length < this.tuning.wantedPeasants ? world.unitCost(faction, 'taran').prune : 0;

    const mall = buildings.find((b) => b.kind === 'mall' && b.done);
    const smecheri = soldiers.filter((u) => u.kind === 'smecher').length;
    if (
      mall &&
      smecheri + mall.queue.filter((k) => k === 'smecher').length < WANTED_SMECHERI &&
      prune >= world.unitCost(faction, 'smecher').prune + reserve &&
      world.canTrain(faction, mall, 'smecher')
    ) {
      world.issue({ type: 'train', faction, buildingId: mall.id, kind: 'smecher' });
      return;
    }

    const camp = buildings.find((b) => b.kind === 'tabara' && b.done);
    if (!camp || camp.queue.length >= 2) return;
    // Keep only the next wave plus a small home guard; the army grows wave by wave.
    if (soldiers.length + camp.queue.length >= this.waveSize + HOME_GUARD) return;
    if (prune < world.unitCost(faction, 'ostas').prune + reserve) return;
    if (world.canTrain(faction, camp)) world.issue({ type: 'train', faction, buildingId: camp.id });
  }

  private command(world: World, court: Building, soldiers: Unit[]): void {
    if (soldiers.length === 0) return;
    const faction = this.faction;
    const cx = (court.tx * 2 + BUILDINGS.curte.size) * (SUB / 2);
    const cy = (court.ty * 2 + BUILDINGS.curte.size) * (SUB / 2);

    // Home under attack: everybody back.
    let intruder: Unit | undefined;
    let intruderD = DEFEND_RADIUS * DEFEND_RADIUS;
    for (const u of world.units) {
      if (u.faction === faction) continue;
      const d = distSq(u.x, u.y, cx, cy);
      if (d <= intruderD) {
        intruder = u;
        intruderD = d;
      }
    }
    if (intruder) {
      // Whoever is already out fighting stays out; the rest defend.
      const defenders = soldiers.filter((u) => u.order.type !== 'attack');
      if (defenders.length > 0) {
        world.issue({ type: 'attack', faction, unitIds: defenders.map((u) => u.id), targetId: intruder.id });
      }
      return;
    }

    // Otherwise gather a wave at home, then march on the enemy court.
    const waiting = soldiers.filter((u) => u.order.type === 'idle');
    if (!this.attacks || world.tick < this.tuning.firstAttackTick || waiting.length < this.waveSize) return;
    const enemyCourt = this.pickTarget(world, cx, cy);
    if (enemyCourt) {
      world.issue({ type: 'attack', faction, unitIds: waiting.slice(0, this.waveSize).map((u) => u.id), targetId: enemyCourt.id });
      this.waveSize = Math.min(this.tuning.biggestWave, this.waveSize + this.tuning.waveStep);
      this.wavesSent++;
    }
  }

  /** Waves alternate: the closest neighbour that is not the rival, then the rival. */
  private pickTarget(world: World, cx: number, cy: number): Building | undefined {
    const courts = world
      .alive()
      .filter((f) => f !== this.faction)
      .map((f) => world.courtOf(f))
      .filter((b): b is Building => b !== undefined);
    const rival = FACTIONS[this.faction].rival;
    const rivalCourt = courts.find((b) => b.faction === rival);
    if (rivalCourt && (this.wavesSent % 2 === 1 || courts.length === 1)) return rivalCourt;
    let best: Building | undefined;
    let bestD = 0;
    for (const b of courts) {
      if (b === rivalCourt) continue;
      const d = distSq(b.tx * SUB, b.ty * SUB, cx, cy);
      if (!best || d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best ?? rivalCourt;
  }

  private useAbility(world: World, court: Building, soldiers: Unit[], buildings: Building[]): void {
    const faction = this.faction;
    if (!world.abilityReady(faction)) return;
    const ability = FACTIONS[faction].ability.id;

    if (ability === 'rezolva') {
      // Worth a try whenever two things are waiting, or the times are changing.
      const busy = buildings.filter((b) => !b.done || b.queue.length > 0 || b.advanceLeft > 0);
      if (busy.length >= 2 || busy.some((b) => b.advanceLeft > 0)) world.issue({ type: 'ability', faction });
      return;
    }

    const enemies = world.units.filter((u) => u.faction !== faction && isFighter(u.kind));
    if (enemies.length === 0) return;

    if (ability === 'plaja') {
      // Send them to the beach once a proper raiding party is at the gates.
      const cx = (court.tx * 2 + BUILDINGS.curte.size) * (SUB / 2);
      const cy = (court.ty * 2 + BUILDINGS.curte.size) * (SUB / 2);
      const atTheGates = enemies.filter((e) => distSq(cx, cy, e.x, e.y) <= BEACH_RADIUS * BEACH_RADIUS);
      if (atTheGates.length >= 2) world.issue({ type: 'ability', faction });
      return;
    }

    const near = 3 * SUB;
    const foesAround = (u: Unit) => enemies.filter((e) => distSq(u.x, u.y, e.x, e.y) <= near * near).length;
    if (ability === 'taunt') {
      // The healthiest soldier with at least two enemies on him does the shouting.
      let best: Unit | undefined;
      for (const u of soldiers) {
        if (foesAround(u) >= 2 && (!best || u.hp > best.hp)) best = u;
      }
      if (best) world.issue({ type: 'ability', faction, unitId: best.id });
    } else if (ability === 'palinca' && soldiers.filter((u) => foesAround(u) >= 1).length >= 2) {
      // A round for everyone once a proper fight is on.
      world.issue({ type: 'ability', faction });
    }
  }
}
