import { describe, expect, it } from 'vitest';
import { clipForLine, shouldPlayVoice, SoundEngine, type VoiceLineContext } from '../src/audio/sound';
import { BUILDINGS } from '../src/data/buildings';
import {
  clearSave,
  DEFAULT_NICKNAME,
  formatSaveSummary,
  loadGame,
  loadNickname,
  sanitizeNickname,
  saveGame,
  saveNickname,
} from '../src/save';
import { PLACES, Region } from '../src/data/romania';
import { GameMap, generateRomania, latToY, lonToX, placeTile, Terrain } from '../src/sim/map';
import { findPath, nearestPassable, nearestTile } from '../src/sim/pathfinding';
import { AI_THINK_EVERY, SkirmishAi } from '../src/ai/skirmish';
import { ERAS, LAST_ERA } from '../src/data/eras';
import { FACTION_IDS, isRival, PLAYABLE_FACTION_IDS, RAIDERS } from '../src/data/factions';
import { LockstepSink, TURN_TICKS, type RelayClientMsg } from '../src/net/lockstep';
import {
  BRIBE_PRUNE,
  CAPITAL_TAX,
  DISTILL_TICKS,
  FUNDS_AMOUNT,
  FUNDS_EVERY,
  HARACI_DEADLINE,
  HARACI_EVERY,
  SUB,
  SUMMER_EVERY,
  World,
} from '../src/sim/world';

function mapFromRows(rows: string[]): GameMap {
  const map = new GameMap(rows[0]!.length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = map.index(x, y);
      map.tiles[i] =
        ch === '#' ? Terrain.Mountain : ch === '~' ? Terrain.Water : ch === 'f' ? Terrain.Forest : Terrain.Grass;
      if (ch === 'f') map.wood[i] = 20;
    });
  });
  return map;
}

function tileAt(lon: number, lat: number): { x: number; y: number } {
  return { x: Math.floor(lonToX(lon)), y: Math.floor(latToY(lat)) };
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

describe('the map of Romania', () => {
  const map = generateRomania(1600);

  it('is identical every time for the same seed', () => {
    expect([...generateRomania(1600).tiles]).toEqual([...map.tiles]);
  });

  it('puts the towns in the right principalities', () => {
    const region = (p: { at: readonly [number, number] }) => {
      const t = tileAt(p.at[0], p.at[1]);
      return map.regionAt(t.x, t.y);
    };
    expect(region(PLACES.albaIulia)).toBe(Region.Ardeal);
    expect(region(PLACES.cluj)).toBe(Region.Ardeal);
    expect(region(PLACES.timisoara)).toBe(Region.Ardeal);
    expect(region(PLACES.iasi)).toBe(Region.Moldova);
    expect(region(PLACES.suceava)).toBe(Region.Moldova);
    expect(region(PLACES.targoviste)).toBe(Region.TaraRomaneasca);
    expect(region(PLACES.bucuresti)).toBe(Region.TaraRomaneasca);
    expect(region(PLACES.craiova)).toBe(Region.TaraRomaneasca);
    expect(region(PLACES.constanta)).toBe(Region.Dobrogea);
  });

  it('has the neighbours, the sea and the Carpathians where they belong', () => {
    const terrain = (lon: number, lat: number) => {
      const t = tileAt(lon, lat);
      return map.terrainAt(t.x, t.y);
    };
    expect(terrain(28.86, 47.0)).toBe(Terrain.Abroad); // Chișinău
    expect(terrain(20.5, 47.3)).toBe(Terrain.Abroad); // Hungary
    expect(terrain(25.6, 43.4)).toBe(Terrain.Abroad); // Bulgaria
    expect(terrain(29.6, 44.0)).toBe(Terrain.Water); // Black Sea
    expect(terrain(24.74, 45.6)).toBe(Terrain.Mountain); // Făgăraș
    expect(terrain(25.6, 46.8)).toBe(Terrain.Mountain); // Eastern Carpathians
    expect(terrain(26.1, 44.43)).not.toBe(Terrain.Mountain); // București, on the plain
  });

  it('lets a peasant walk from Alba Iulia to every other town', () => {
    const from = placeTile(PLACES.albaIulia);
    for (const place of Object.values(PLACES)) {
      const to = placeTile(place);
      if (to.x === from.x && to.y === from.y) continue;
      expect(map.isPassable(to.x, to.y), place.name).toBe(true);
      const path = findPath(map, from.x, from.y, to.x, to.y);
      expect(path[path.length - 1], place.name).toBe(map.index(to.x, to.y));
    }
  });

  it('has no way out of the country', () => {
    const from = placeTile(PLACES.albaIulia);
    const abroad = tileAt(20.5, 47.3);
    const path = findPath(map, from.x, from.y, abroad.x, abroad.y);
    for (const i of path) expect(map.tiles[i]).not.toBe(Terrain.Abroad);
  });
});

describe('pathfinding', () => {
  it('walks around a wall and never steps on impassable tiles', () => {
    const map = mapFromRows(['.......', '.####..', '....#..', '....#..', '.......']);
    const path = findPath(map, 1, 2, 5, 2);
    expect(path.length).toBeGreaterThan(4);
    expect(path[path.length - 1]).toBe(map.index(5, 2));
    for (const idx of path) {
      const x = idx % map.width;
      expect(map.isPassable(x, (idx - x) / map.width)).toBe(true);
    }
  });

  it('does not cut diagonally between two obstacles', () => {
    const map = mapFromRows(['.#.', '#..', '...']);
    expect(findPath(map, 0, 0, 2, 2)).toEqual([]);
  });

  it('stops at the closest reachable tile when the goal is cut off', () => {
    const map = mapFromRows(['...~.', '...~.', '...~.']);
    const path = findPath(map, 0, 1, 4, 1);
    expect(path[path.length - 1]).toBe(map.index(2, 1));
  });

  it('prefers open ground over forest', () => {
    const map = mapFromRows(['.....', '.fff.', '.....']);
    const path = findPath(map, 0, 1, 4, 1);
    for (const idx of path.slice(0, -1)) {
      const x = idx % map.width;
      expect(map.terrainAt(x, (idx - x) / map.width)).toBe(Terrain.Grass);
    }
  });

  it('finds distinct nearby tiles for a group', () => {
    const map = mapFromRows(['.....', '..#..', '.....']);
    const taken = new Set<number>();
    for (let i = 0; i < 4; i++) {
      const idx = nearestPassable(map, 2, 1, taken);
      expect(idx).not.toBe(-1);
      expect(idx).not.toBe(map.index(2, 1));
      expect(taken.has(idx)).toBe(false);
      taken.add(idx);
    }
  });

  it('walks around buildings', () => {
    const map = mapFromRows(['.....', '.....', '.....']);
    map.blocked[map.index(2, 0)] = 1;
    map.blocked[map.index(2, 1)] = 1;
    const path = findPath(map, 0, 0, 4, 0);
    expect(path).not.toContain(map.index(2, 0));
    expect(path).not.toContain(map.index(2, 1));
    expect(path[path.length - 1]).toBe(map.index(4, 0));
  });
});

/** A small meadow with a court, a wood and three peasants. */
function village(): { world: World; ids: number[] } {
  const map = mapFromRows([
    '..............ff',
    '..............ff',
    '..............ff',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]);
  const world = new World({ seed: 1, map });
  world.placeBuilding('curte', 'ardeal', 1, 1, true);
  const ids = [
    world.spawnUnit('ardeal', 5, 2).id,
    world.spawnUnit('ardeal', 5, 3).id,
    world.spawnUnit('ardeal', 5, 4).id,
  ];
  return { world, ids };
}

describe('economy', () => {
  it('starts with a court and three peasants in each of the four capitals', () => {
    const world = new World({ seed: 1600 });
    const alba = placeTile(PLACES.albaIulia);
    const towns = { ardeal: PLACES.albaIulia, moldova: PLACES.iasi, tara: PLACES.targoviste, dobrogea: PLACES.constanta };
    for (const faction of FACTION_IDS) {
      const town = placeTile(towns[faction as keyof typeof towns]);
      const court = world.courtOf(faction)!;
      expect(Math.abs(court.tx - town.x) + Math.abs(court.ty - town.y), faction).toBeLessThan(6);
      expect(world.unitCount(faction), faction).toBe(3);
    }
    expect(world.alive()).toEqual([...FACTION_IDS]);
    expect(world.unitCount(RAIDERS)).toBe(0);
    for (const u of world.units) expect(world.map.isPassable(Math.floor(u.x / SUB), Math.floor(u.y / SUB))).toBe(true);
    expect(nearestTile(world.map, alba.x, alba.y, (i) => world.map.wood[i]! > 0, 12)).not.toBe(-1);
  });

  it('moves a unit to the tile it was sent to', () => {
    const { world, ids } = village();
    world.issue({ type: 'move', faction: 'ardeal', unitIds: [ids[0]!], tx: 9, ty: 8 });
    run(world, 200);
    const unit = world.getUnit(ids[0]!)!;
    expect(unit.x).toBe(9 * SUB + SUB / 2);
    expect(unit.y).toBe(8 * SUB + SUB / 2);
    expect(unit.order.type).toBe('idle');
  });

  it('ignores commands for units of another faction', () => {
    const { world, ids } = village();
    world.issue({ type: 'move', faction: 'moldova', unitIds: ids, tx: 9, ty: 8 });
    run(world, 50);
    expect(world.getUnit(ids[0]!)!.x).toBe(5 * SUB + SUB / 2);
  });

  it('chops wood, brings it to the court and clears the forest', () => {
    const { world, ids } = village();
    const before = world.stock.ardeal.lemn;
    world.issue({ type: 'act', faction: 'ardeal', unitIds: ids, tx: 14, ty: 1 });
    run(world, 3000);
    // 6 forest tiles × 20 wood, all of it delivered.
    expect(world.stock.ardeal.lemn).toBe(before + 120);
    expect([...world.map.tiles].filter((t) => t === Terrain.Forest)).toHaveLength(0);
    expect(world.drainEvents().filter((e) => e.type === 'tile')).toHaveLength(6);
    for (const id of ids) expect(world.getUnit(id)!.order.type).toBe('idle');
  });

  it('builds an orchard slowly, then picks plums in it', () => {
    const { world, ids } = village();
    const lemn = world.stock.ardeal.lemn;
    const prune = world.stock.ardeal.prune;
    world.issue({ type: 'build', faction: 'ardeal', unitIds: [ids[0]!], kind: 'livada', tx: 7, ty: 6 });
    world.step();
    const orchard = world.buildingAt(7, 6)!;
    expect(orchard.done).toBe(false);
    expect(world.stock.ardeal.lemn).toBe(lemn - BUILDINGS.livada.costLemn);
    // Ardeal needs 30% more builder-ticks than the base 60.
    expect(orchard.buildLeft).toBe(78);
    run(world, 150);
    expect(orchard.done).toBe(true);
    run(world, 400);
    expect(world.stock.ardeal.prune).toBeGreaterThan(prune);
    expect(world.orchardWorkers(orchard.id)).toBe(1);
  });

  it('sends builders back to what they were doing', () => {
    const { world, ids } = village();
    world.stock.ardeal.lemn = 100;
    world.issue({ type: 'act', faction: 'ardeal', unitIds: [ids[0]!], tx: 14, ty: 1 });
    run(world, 20);
    world.issue({ type: 'build', faction: 'ardeal', unitIds: [ids[0]!], kind: 'cazan', tx: 7, ty: 6 });
    run(world, 400);
    expect(world.buildingAt(7, 6)?.done).toBe(true);
    const order = world.getUnit(ids[0]!)!.order;
    expect(order.type).toBe('gather');
    expect(order.type === 'gather' && order.resource).toBe('lemn');
  });

  it('refuses to build on forest, on another building, or without wood', () => {
    const { world, ids } = village();
    expect(world.canPlace('livada', 14, 0)).toBe(false);
    expect(world.canPlace('livada', 2, 2)).toBe(false);
    expect(world.canPlace('livada', 15, 9)).toBe(false);
    world.stock.ardeal.lemn = 10;
    world.issue({ type: 'build', faction: 'ardeal', unitIds: ids, kind: 'cazan', tx: 7, ty: 6 });
    world.step();
    expect(world.buildingAt(7, 6)).toBeUndefined();
    expect(world.stock.ardeal.lemn).toBe(10);
  });

  it('lets only three peasants pick in one orchard', () => {
    const { world, ids } = village();
    const fourth = world.spawnUnit('ardeal', 6, 4).id;
    const orchard = world.placeBuilding('livada', 'ardeal', 7, 6, true);
    world.issue({ type: 'act', faction: 'ardeal', unitIds: [...ids, fourth], tx: 7, ty: 6 });
    world.step();
    expect(world.orchardWorkers(orchard.id)).toBe(3);
    expect(world.drainEvents().filter((e) => e.type === 'full')).toHaveLength(1);
  });

  it('trains a peasant for plums', () => {
    const { world } = village();
    const court = world.buildings[0]!;
    world.issue({ type: 'train', faction: 'ardeal', buildingId: court.id });
    world.step();
    expect(world.stock.ardeal.prune).toBe(15);
    run(world, 100);
    expect(world.unitCount('ardeal')).toBe(4);
    world.stock.ardeal.prune = 0;
    world.issue({ type: 'train', faction: 'ardeal', buildingId: court.id });
    run(world, 100);
    expect(world.unitCount('ardeal')).toBe(4);
  });

  it('turns plums and wood into pălincă until one of them runs out', () => {
    const { world } = village();
    world.placeBuilding('cazan', 'ardeal', 8, 6, true);
    world.stock.ardeal.prune = 50;
    world.stock.ardeal.lemn = 4;
    run(world, (DISTILL_TICKS + 1) * 10);
    expect(world.stock.ardeal.palinca).toBe(4);
    expect(world.stock.ardeal.prune).toBe(30);
    expect(world.stock.ardeal.lemn).toBe(0);
  });

  it('a round of pălincă stops work, then speeds it up', () => {
    const timeToFirstLoad = (treat: boolean) => {
      const { world, ids } = village();
      world.stock.ardeal.palinca = 3;
      const before = world.stock.ardeal.lemn;
      if (treat) world.issue({ type: 'ability', faction: 'ardeal' });
      world.issue({ type: 'act', faction: 'ardeal', unitIds: [ids[0]!], tx: 14, ty: 1 });
      world.step();
      if (treat) {
        expect(world.stock.ardeal.palinca).toBe(0);
        expect(world.getUnit(ids[0]!)!.drink).toBeGreaterThan(0);
      }
      let ticks = 1;
      while (world.stock.ardeal.lemn === before && ticks < 2000) {
        world.step();
        ticks++;
      }
      return ticks;
    };
    const sober = timeToFirstLoad(false);
    const treated = timeToFirstLoad(true);
    // 30 ticks lost to drinking, some of them won back by chopping faster.
    expect(treated).toBeGreaterThan(sober);
    expect(treated).toBeLessThan(sober + 30);
  });

  it('is deterministic: same seed and commands give the same checksums', () => {
    const play = () => {
      const world = new World({ seed: 1600 });
      const ids = world.units.filter((u) => u.faction === 'ardeal').map((u) => u.id);
      const alba = placeTile(PLACES.albaIulia);
      const forest = nearestTile(world.map, alba.x, alba.y, (i) => world.map.wood[i]! > 0, 12);
      const fx = forest % world.map.width;
      const fy = (forest - fx) / world.map.width;
      const spot = nearestTile(world.map, alba.x + 4, alba.y + 4, (_i, x, y) => world.canPlace('livada', x, y), 10);
      const ox = spot % world.map.width;
      const oy = (spot - ox) / world.map.width;
      const sums: number[] = [];
      for (let i = 0; i < 1500; i++) {
        if (i === 3) world.issue({ type: 'act', faction: 'ardeal', unitIds: ids.slice(1), tx: fx, ty: fy });
        if (i === 5) {
          world.issue({ type: 'build', faction: 'ardeal', unitIds: [ids[0]!], kind: 'livada', tx: ox, ty: oy });
        }
        if (i === 600) world.issue({ type: 'train', faction: 'ardeal', buildingId: world.buildings[0]!.id });
        if (i === 700) {
          world.issue({ type: 'move', faction: 'ardeal', unitIds: ids.slice(2), tx: alba.x - 6, ty: alba.y + 5 });
        }
        world.step();
        sums.push(world.checksum());
      }
      return { sums, lemn: world.stock.ardeal.lemn, prune: world.stock.ardeal.prune };
    };
    const a = play();
    const b = play();
    expect(a.sums).toEqual(b.sums);
    expect(a.lemn).toBeGreaterThan(20);
    expect(a.prune).toBeGreaterThan(15);
  });
});

/** An open field with one court per side, far enough apart not to notice each other. */
function battlefield(): World {
  const map = mapFromRows(Array.from({ length: 16 }, () => '.'.repeat(40)));
  const world = new World({ seed: 1, map });
  world.placeBuilding('curte', 'ardeal', 1, 6, true);
  world.placeBuilding('curte', 'moldova', 36, 6, true);
  return world;
}

describe('combat', () => {
  it('trains soldiers at the army camp, for plums and wood', () => {
    const world = battlefield();
    const camp = world.placeBuilding('tabara', 'ardeal', 6, 6, true);
    world.stock.ardeal.prune = 25;
    world.stock.ardeal.lemn = 10;
    world.issue({ type: 'train', faction: 'ardeal', buildingId: camp.id });
    run(world, 130);
    expect(world.unitCount('ardeal', 'ostas')).toBe(1);
    expect(world.stock.ardeal.prune).toBe(0);
    expect(world.stock.ardeal.lemn).toBe(0);
    world.issue({ type: 'train', faction: 'ardeal', buildingId: camp.id });
    run(world, 130);
    expect(world.unitCount('ardeal', 'ostas')).toBe(1);
  });

  it('a plăieș beats a răzeș one on one, but not two', () => {
    const duel = (razesi: number) => {
      const world = battlefield();
      world.spawnUnit('ardeal', 18, 8, 'ostas');
      for (let i = 0; i < razesi; i++) world.spawnUnit('moldova', 21, 7 + i, 'ostas');
      run(world, 600);
      return { ardeal: world.unitCount('ardeal'), moldova: world.unitCount('moldova') };
    };
    expect(duel(1)).toEqual({ ardeal: 1, moldova: 0 });
    expect(duel(2).ardeal).toBe(0);
  });

  it('idle soldiers notice enemies nearby, peasants and far-away soldiers do not', () => {
    const world = battlefield();
    const guard = world.spawnUnit('ardeal', 18, 8, 'ostas');
    const peasant = world.spawnUnit('ardeal', 18, 9);
    const farGuard = world.spawnUnit('ardeal', 8, 2, 'ostas');
    const victim = world.spawnUnit('moldova', 21, 8);
    run(world, 10);
    expect(guard.order.type).toBe('attack');
    expect(peasant.order.type).toBe('idle');
    expect(farGuard.order.type).toBe('idle');
    run(world, 200);
    expect(world.getUnit(victim.id)).toBeUndefined();
    expect(world.drainEvents().some((e) => e.type === 'died' && e.unitId === victim.id)).toBe(true);
    expect(guard.order.type).toBe('idle');
  });

  it('a soldier told to walk away does not stop to fight', () => {
    const world = battlefield();
    const runner = world.spawnUnit('ardeal', 18, 8, 'ostas');
    world.spawnUnit('moldova', 20, 8);
    world.issue({ type: 'move', faction: 'ardeal', unitIds: [runner.id], tx: 10, ty: 8 });
    run(world, 30);
    expect(runner.order.type).toBe('move');
  });

  it('tearing down the court wins the game and frees the ground', () => {
    const world = battlefield();
    const ids = [0, 1, 2, 3].map((i) => world.spawnUnit('ardeal', 33, 5 + i, 'ostas').id);
    const court = world.courtOf('moldova')!;
    expect(world.describeTarget('ardeal', 37, 7)).toBe('attack');
    world.issue({ type: 'act', faction: 'ardeal', unitIds: ids, tx: 37, ty: 7 });
    run(world, 20);
    expect(court.hp).toBeLessThan(court.maxHp);
    expect(world.winner).toBeNull();
    run(world, 600);
    expect(world.winner).toBe('ardeal');
    expect(world.buildingAt(37, 7)).toBeUndefined();
    expect(world.map.isPassable(37, 7)).toBe(true);
    expect(world.drainEvents().filter((e) => e.type === 'won')).toHaveLength(1);
  });

  it('soldiers sent at a building deal with defenders first', () => {
    const world = battlefield();
    const attacker = world.spawnUnit('ardeal', 30, 7, 'ostas');
    const defender = world.spawnUnit('moldova', 33, 7, 'ostas');
    defender.drink = 1000; // he is not going to help
    world.issue({ type: 'attack', faction: 'ardeal', unitIds: [attacker.id], targetId: world.courtOf('moldova')!.id });
    run(world, 150);
    expect(world.getUnit(defender.id)).toBeUndefined();
    expect(attacker.order.type).toBe('attack');
    run(world, 100);
    expect(world.courtOf('moldova')!.hp).toBeLessThan(world.courtOf('moldova')!.maxHp);
  });

  it('an army sent at a building leaves the peasants alone', () => {
    const world = battlefield();
    const attacker = world.spawnUnit('ardeal', 30, 7, 'ostas');
    const peasant = world.spawnUnit('moldova', 33, 7);
    world.issue({ type: 'attack', faction: 'ardeal', unitIds: [attacker.id], targetId: world.courtOf('moldova')!.id });
    run(world, 250);
    expect(peasant.hp).toBe(peasant.maxHp);
    expect(world.courtOf('moldova')!.hp).toBeLessThan(world.courtOf('moldova')!.maxHp);
  });

  it('Ardeal builds tougher walls', () => {
    const world = battlefield();
    expect(world.courtOf('ardeal')!.maxHp).toBe(1800);
    expect(world.courtOf('moldova')!.maxHp).toBe(1200);
  });

  it('„Și vrei, wăi?” pulls enemies onto the taunter, who takes half damage', () => {
    const world = battlefield();
    const taunter = world.spawnUnit('moldova', 20, 8, 'ostas');
    const friend = world.spawnUnit('moldova', 20, 10, 'ostas');
    const a = world.spawnUnit('ardeal', 22, 10, 'ostas');
    const b = world.spawnUnit('ardeal', 23, 11, 'ostas');
    world.issue({ type: 'attack', faction: 'ardeal', unitIds: [a.id, b.id], targetId: friend.id });
    world.issue({ type: 'ability', faction: 'moldova', unitId: taunter.id });
    world.step();
    expect(world.abilityReady('moldova')).toBe(false);
    for (const u of [a, b]) {
      expect(u.order.type === 'attack' && u.order.current).toBe(taunter.id);
      expect(u.order.type === 'attack' && u.order.target).toBe(friend.id);
    }
    const friendHp = friend.hp;
    run(world, 40);
    expect(friend.hp).toBe(friendHp); // nobody touched him while the taunt held
    expect(taunter.hp).toBeLessThan(taunter.maxHp);
    // Halved: 10 → 5 per hit, so every loss is a multiple of 5.
    expect((taunter.maxHp - taunter.hp) % 5).toBe(0);
    world.issue({ type: 'ability', faction: 'moldova', unitId: taunter.id });
    world.step();
    expect(taunter.shield).toBeLessThan(50); // still cooling down: no second taunt
  });

  it('„Stai să bem o pălincă” stops the fight, and the enemy stands longer', () => {
    const world = battlefield();
    const mine = world.spawnUnit('ardeal', 20, 8, 'ostas');
    const near = world.spawnUnit('moldova', 22, 8, 'ostas');
    const far = world.spawnUnit('moldova', 30, 14, 'ostas');
    far.drink = 0;
    world.stock.ardeal.palinca = 2;
    world.issue({ type: 'ability', faction: 'ardeal' });
    world.step();
    expect(mine.drink).toBe(0); // not enough pălincă: nothing happens
    world.stock.ardeal.palinca = 3;
    world.issue({ type: 'ability', faction: 'ardeal' });
    world.step();
    expect(world.stock.ardeal.palinca).toBe(0);
    expect(mine.drink).toBeGreaterThan(0);
    expect(near.drink).toBeGreaterThan(mine.drink);
    expect(far.drink).toBe(0);
    const hp = { mine: mine.hp, near: near.hp };
    run(world, 25);
    expect({ mine: mine.hp, near: near.hp }).toEqual(hp); // everybody is drinking
    run(world, 20);
    expect(mine.hp).toBe(hp.mine); // he is back at it, the other one still has his glass up
    expect(near.hp).toBeLessThan(hp.near);
  });
});

describe('skirmish AI', () => {
  function play(ticks: number, factions: readonly ('ardeal' | 'moldova')[]) {
    const world = new World({ seed: 1600 });
    const ais = factions.map((f) => new SkirmishAi(f));
    const sums: number[] = [];
    for (let i = 0; i < ticks && world.winner === null; i++) {
      world.step();
      if (world.tick % AI_THINK_EVERY === 0) for (const ai of ais) ai.think(world);
      if (i % 50 === 0) sums.push(world.checksum());
    }
    return { world, sums };
  }

  it('builds an economy, a camp and an army for either faction', () => {
    const { world } = play(4000, ['ardeal', 'moldova']);
    for (const f of ['ardeal', 'moldova'] as const) {
      const kinds = world.buildings.filter((b) => b.faction === f && b.done).map((b) => b.kind);
      expect(kinds, f).toContain('livada');
      expect(kinds, f).toContain('tabara');
      expect(world.unitCount(f, 'taran'), f).toBeGreaterThanOrEqual(5);
    }
    expect(world.buildings.some((b) => b.faction === 'ardeal' && b.kind === 'cazan')).toBe(true);
    expect(world.buildings.some((b) => b.faction === 'moldova' && b.kind === 'cazan')).toBe(false);
  });

  it('marches on an idle opponent and takes the court', () => {
    const { world } = play(20000, ['moldova']);
    expect(world.winner).toBe('moldova');
  });

  it('plays the same match twice when left alone', () => {
    const a = play(6000, ['ardeal', 'moldova']);
    const b = play(6000, ['ardeal', 'moldova']);
    expect(a.sums).toEqual(b.sums);
  });
});

describe('eras', () => {
  it('moves to the next era for wood and plums — and Ardeal takes its time', () => {
    const world = battlefield();
    for (const f of ['ardeal', 'moldova'] as const) {
      world.stock[f].lemn = 80;
      world.stock[f].prune = 79;
    }
    expect(world.canAdvance('ardeal')).toBe(false);
    world.stock.ardeal.prune = 80;
    world.stock.moldova.prune = 80;
    world.issue({ type: 'advance', faction: 'ardeal' });
    world.issue({ type: 'advance', faction: 'moldova' });
    world.step();
    expect(world.stock.ardeal).toMatchObject({ lemn: 0, prune: 0 });
    expect(world.canAdvance('ardeal')).toBe(false); // already on its way
    run(world, 199);
    expect(world.era).toMatchObject({ ardeal: 0, moldova: 1 });
    run(world, 59);
    expect(world.era.ardeal).toBe(0);
    world.step();
    expect(world.era.ardeal).toBe(1);
    expect(world.drainEvents().filter((e) => e.type === 'era')).toHaveLength(2);
  });

  it('each era knows its own buildings', () => {
    const world = battlefield();
    const unlocked = () => (['gater', 'bloc', 'mall'] as const).filter((k) => world.canBuild('ardeal', k));
    expect(unlocked()).toEqual([]);
    world.era.ardeal = 2;
    expect(unlocked()).toEqual(['gater']);
    world.era.ardeal = 3;
    expect(unlocked()).toEqual(['gater', 'bloc']);
    world.era.ardeal = LAST_ERA;
    expect(unlocked()).toEqual(['gater', 'bloc', 'mall']);
    expect(world.canBuild('ardeal', 'curte')).toBe(false);

    // Moldova is still in 1600: a mall order is simply ignored.
    world.stock.moldova.lemn = 999;
    const builder = world.spawnUnit('moldova', 30, 8);
    world.issue({ type: 'build', faction: 'moldova', unitIds: [builder.id], kind: 'mall', tx: 28, ty: 10 });
    world.step();
    expect(world.buildingAt(28, 10)).toBeUndefined();
    expect(world.stock.moldova.lemn).toBe(999);
  });

  it('a bribe finishes a building site at once — most of the time', () => {
    const bribeTwenty = () => {
      const world = battlefield();
      world.era.ardeal = 1;
      world.stock.ardeal.prune = 20 * BRIBE_PRUNE;
      const results: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        const site = world.placeBuilding('livada', 'ardeal', 6 + (i % 10) * 3, i < 10 ? 1 : 12, false);
        world.issue({ type: 'bribe', faction: 'ardeal', buildingId: site.id });
        world.step();
        results.push(site.done);
      }
      expect(world.stock.ardeal.prune).toBe(0); // paid every time, worked or not
      return results;
    };
    const first = bribeTwenty();
    const worked = first.filter(Boolean).length;
    expect(worked).toBeGreaterThanOrEqual(12);
    expect(worked).toBeLessThan(20);
    expect(bribeTwenty()).toEqual(first); // the luck is part of the game state
  });

  it('nobody takes bribes in 1600, and a bribe needs something to hurry', () => {
    const world = battlefield();
    world.stock.ardeal.prune = 100;
    const site = world.placeBuilding('livada', 'ardeal', 8, 1, false);
    world.issue({ type: 'bribe', faction: 'ardeal', buildingId: site.id });
    world.step();
    expect(site.done).toBe(false);
    world.era.ardeal = 1;
    world.issue({ type: 'bribe', faction: 'ardeal', buildingId: world.courtOf('ardeal')!.id });
    world.step();
    expect(world.stock.ardeal.prune).toBe(100);
  });

  it('the sawmill makes wood without anybody', () => {
    const world = battlefield();
    world.era.ardeal = 2;
    world.placeBuilding('gater', 'ardeal', 8, 1, true);
    world.stock.ardeal.lemn = 0;
    run(world, 200);
    expect(world.stock.ardeal.lemn).toBe(10);
  });

  it('apartment blocks make room for more people, up to a point', () => {
    const world = battlefield();
    world.stock.ardeal.prune = 1000;
    const court = world.courtOf('ardeal')!;
    expect(world.unitCap('ardeal')).toBe(24);
    for (let i = 0; i < 24; i++) world.spawnUnit('ardeal', 6 + (i % 12), 2 + (i > 11 ? 1 : 0));
    expect(world.canTrain('ardeal', court)).toBe(false);
    world.placeBuilding('bloc', 'ardeal', 6, 10, true);
    expect(world.unitCap('ardeal')).toBe(30);
    expect(world.canTrain('ardeal', court)).toBe(true);
    for (let i = 1; i < 6; i++) world.placeBuilding('bloc', 'ardeal', 6 + i * 3, 10, true);
    expect(world.unitCap('ardeal')).toBe(48);
  });

  it('Epoca de Aur: half price, twice the queue', () => {
    const world = battlefield();
    world.era.moldova = 3;
    expect(ERAS[3]!.name).toBe('Epoca de Aur');
    expect(world.unitCost('moldova', 'taran')).toEqual({ prune: 8, lemn: 0 });
    expect(world.buildingCost('moldova', 'livada')).toBe(15);
    expect(world.trainTime('moldova', 'taran')).toBe(160);
    world.stock.moldova.prune = 8;
    world.issue({ type: 'train', faction: 'moldova', buildingId: world.courtOf('moldova')!.id });
    run(world, 100);
    expect(world.stock.moldova.prune).toBe(0);
    expect(world.unitCount('moldova')).toBe(0);
    run(world, 65);
    expect(world.unitCount('moldova')).toBe(1);
  });

  it('today the court trains nobody: peasants and băieți de băieți come from the mall', () => {
    const world = battlefield();
    world.era.ardeal = LAST_ERA;
    world.stock.ardeal.prune = 500;
    const court = world.courtOf('ardeal')!;
    expect(world.trainable(court)).toEqual([]);
    world.issue({ type: 'train', faction: 'ardeal', buildingId: court.id });
    run(world, 200);
    expect(world.unitCount('ardeal')).toBe(0);

    const mall = world.placeBuilding('mall', 'ardeal', 8, 8, true);
    expect(world.unitCost('ardeal', 'taran').prune).toBe(23); // everything got dearer
    expect(world.unitCost('ardeal', 'smecher').prune).toBe(180);
    world.issue({ type: 'train', faction: 'ardeal', buildingId: mall.id });
    world.issue({ type: 'train', faction: 'ardeal', buildingId: mall.id, kind: 'smecher' });
    run(world, 300);
    expect(world.unitCount('ardeal', 'taran')).toBe(1);
    expect(world.unitCount('ardeal', 'smecher')).toBe(1);
    expect(world.stock.ardeal.prune).toBe(500 - 23 - 180);
    const peasant = world.units.find((u) => u.kind === 'taran')!;
    const smecher = world.units.find((u) => u.kind === 'smecher')!;
    expect(smecher.speed).toBeGreaterThan(peasant.speed);
  });

  it('European funds arrive in the present, and only there', () => {
    const world = battlefield();
    world.era.ardeal = LAST_ERA;
    const before = { ardeal: { ...world.stock.ardeal }, moldova: { ...world.stock.moldova } };
    run(world, FUNDS_EVERY);
    expect(world.stock.ardeal.lemn).toBe(before.ardeal.lemn + FUNDS_AMOUNT);
    expect(world.stock.ardeal.prune).toBe(before.ardeal.prune + FUNDS_AMOUNT);
    expect(world.stock.moldova).toEqual(before.moldova);
    expect(world.drainEvents().filter((e) => e.type === 'funds')).toEqual([{ type: 'funds', faction: 'ardeal' }]);
  });

  it('a scandal stops everyone nearby, friend or foe — but not his own kind', () => {
    const world = battlefield();
    const loud = world.spawnUnit('ardeal', 20, 8, 'smecher');
    const mate = world.spawnUnit('ardeal', 20, 9, 'smecher');
    const friend = world.spawnUnit('ardeal', 21, 8);
    const foe = world.spawnUnit('moldova', 22, 9);
    const far = world.spawnUnit('ardeal', 6, 2);
    world.issue({ type: 'move', faction: 'ardeal', unitIds: [friend.id], tx: 26, ty: 8 });
    mate.scandalIn = 9999;
    loud.scandalIn = 2;
    run(world, 2);
    expect(friend.stun).toBeGreaterThan(0);
    expect(foe.stun).toBeGreaterThan(0);
    expect(mate.stun).toBe(0);
    expect(far.stun).toBe(0);
    expect(loud.scandalIn).toBeGreaterThanOrEqual(300);
    const scandals = world.drainEvents().filter((e) => e.type === 'scandal');
    expect(scandals).toHaveLength(1);
    expect(scandals[0]!.type === 'scandal' && [...scandals[0]!.onlookers].sort()).toEqual([friend.id, foe.id].sort());
    // The peasant was on his way somewhere; he stands and watches instead.
    const x = friend.x;
    run(world, 30);
    expect(friend.x).toBe(x);
    run(world, 60);
    expect(friend.x).toBeGreaterThan(x);
  });

  it('with nobody to impress, he tries again a little later', () => {
    const world = battlefield();
    const loud = world.spawnUnit('ardeal', 20, 2, 'smecher');
    loud.scandalIn = 1;
    world.step();
    expect(loud.scandalIn).toBe(50);
    expect(world.drainEvents().some((e) => e.type === 'scandal')).toBe(false);
  });

  it('a quiet AI neighbour walks through the eras, ends up with a mall and never marches', () => {
    const world = new World({ seed: 1600, haraci: false });
    const ai = new SkirmishAi('moldova', { attacks: false });
    const hasMall = () => world.buildings.some((b) => b.faction === 'moldova' && b.kind === 'mall' && b.done);
    for (let i = 0; i < 60000 && !hasMall(); i++) {
      world.step();
      if (world.tick % AI_THINK_EVERY === 0) ai.think(world);
    }
    expect(world.era.moldova).toBe(LAST_ERA);
    expect(hasMall()).toBe(true);
    expect(world.buildings.some((b) => b.faction === 'moldova' && b.kind === 'gater')).toBe(true);
    const court = world.courtOf('ardeal')!;
    expect(court.hp).toBe(court.maxHp);
    expect(world.winner).toBeNull();
  });
});

describe('four principalities and the Porte', () => {
  /** The battlefield, with Țara Românească and Dobrogea holding court as well. */
  function fourWay(options: { haraci?: boolean } = {}): World {
    const map = mapFromRows([
      ...Array.from({ length: 16 }, () => '.'.repeat(40)),
      '~'.repeat(40), // a shore along the south
    ]);
    const world = new World({ seed: 1, map, haraci: options.haraci ?? false });
    world.placeBuilding('curte', 'ardeal', 1, 1, true);
    world.placeBuilding('curte', 'moldova', 36, 1, true);
    world.placeBuilding('curte', 'tara', 1, 11, true);
    world.placeBuilding('curte', 'dobrogea', 36, 11, true);
    return world;
  }

  it('the last court standing wins; a fallen principality goes home', () => {
    const world = fourWay();
    const lost = world.spawnUnit('moldova', 30, 3);
    world.placeBuilding('livada', 'moldova', 30, 5, true);
    world.courtOf('moldova')!.hp = 0;
    world.step();
    expect(world.alive()).toEqual(['ardeal', 'tara', 'dobrogea']);
    expect(world.winner).toBeNull();
    expect(world.getUnit(lost.id)).toBeUndefined();
    expect(world.buildings.some((b) => b.faction === 'moldova')).toBe(false);
    expect(world.drainEvents().some((e) => e.type === 'eliminated' && e.faction === 'moldova')).toBe(true);
    world.courtOf('tara')!.hp = 0;
    world.courtOf('dobrogea')!.hp = 0;
    world.step();
    expect(world.winner).toBe('ardeal');
  });

  it('hits land harder on the rival', () => {
    const firstHit = (victim: 'tara' | 'moldova') => {
      const world = fourWay();
      const attacker = world.spawnUnit('ardeal', 20, 6, 'ostas');
      const target = world.spawnUnit(victim, 21, 6, 'ostas');
      target.drink = 1000;
      world.issue({ type: 'attack', faction: 'ardeal', unitIds: [attacker.id], targetId: target.id });
      run(world, 3);
      return target.maxHp - target.hp;
    };
    expect(firstHit('moldova')).toBe(10);
    expect(firstHit('tara')).toBe(12);
  });

  it('only Dobrogea builds a fishery, only on the shore, and it feeds itself', () => {
    const world = fourWay();
    expect(world.canBuild('dobrogea', 'cherhana')).toBe(true);
    expect(world.canBuild('ardeal', 'cherhana')).toBe(false);
    expect(world.canPlace('cherhana', 20, 5)).toBe(false);
    expect(world.canPlace('cherhana', 20, 14)).toBe(true);
    world.placeBuilding('cherhana', 'dobrogea', 20, 14, true);
    const before = world.stock.dobrogea.prune;
    run(world, 150);
    expect(world.stock.dobrogea.prune).toBe(before + 10);
  });

  it('„Lasă, că se rezolvă” finishes everything in progress — three times out of four', () => {
    const tryIt = (seed: number) => {
      const map = mapFromRows(Array.from({ length: 16 }, () => '.'.repeat(40)));
      const world = new World({ seed, map });
      const court = world.placeBuilding('curte', 'tara', 1, 11, true);
      world.stock.tara.prune = 100;
      const site = world.placeBuilding('livada', 'tara', 10, 10, false);
      const camp = world.placeBuilding('tabara', 'tara', 14, 10, true);
      world.issue({ type: 'train', faction: 'tara', buildingId: court.id });
      world.issue({ type: 'train', faction: 'tara', buildingId: camp.id });
      world.step();
      const prune = world.stock.tara.prune;
      world.issue({ type: 'ability', faction: 'tara' });
      run(world, 2);
      return { done: site.done, units: world.unitCount('tara'), lost: prune - world.stock.tara.prune, ready: world.abilityReady('tara') };
    };
    const outcomes = Array.from({ length: 24 }, (_, seed) => tryIt(seed + 1));
    const worked = outcomes.filter((o) => o.done);
    const failed = outcomes.filter((o) => !o.done);
    expect(worked.length).toBeGreaterThan(12);
    expect(failed.length).toBeGreaterThan(0);
    for (const o of worked) expect(o).toEqual({ done: true, units: 2, lost: 0, ready: false });
    for (const o of failed) expect(o).toEqual({ done: false, units: 0, lost: 30, ready: false });
  });

  it('with nothing in progress there is nothing to sort out, and no cooldown', () => {
    const world = fourWay();
    world.issue({ type: 'ability', faction: 'tara' });
    world.step();
    expect(world.abilityReady('tara')).toBe(true);
  });

  it('„Hai la mare” sends enemy soldiers at the gates to the beach, for a fee', () => {
    const world = fourWay();
    const near = world.spawnUnit('ardeal', 33, 10, 'ostas');
    const peasant = world.spawnUnit('ardeal', 33, 12);
    const far = world.spawnUnit('ardeal', 10, 5, 'ostas');
    const before = world.stock.dobrogea.prune;
    world.issue({ type: 'ability', faction: 'dobrogea' });
    world.step();
    expect(near.stun).toBeGreaterThan(0);
    expect(peasant.stun).toBe(0);
    expect(far.stun).toBe(0);
    expect(world.stock.dobrogea.prune).toBe(before + 5);
    expect(world.abilityReady('dobrogea')).toBe(false);
  });

  it('the Porte asks for tribute — but not from Dobrogea, and not after independence', () => {
    const world = fourWay({ haraci: true });
    world.era.moldova = 2;
    run(world, HARACI_EVERY);
    const asked = world.drainEvents().filter((e) => e.type === 'haraci');
    expect(asked).toEqual([
      { type: 'haraci', faction: 'ardeal', amount: 30 },
      { type: 'haraci', faction: 'tara', amount: 30 },
    ]);
    expect(world.haraci.ardeal.due).toBe(HARACI_DEADLINE);
    expect(world.haraci.dobrogea.due).toBe(0);
    expect(world.haraci.moldova.due).toBe(0);
  });

  it('paying keeps the janissaries at home; the next demand is bigger', () => {
    const world = fourWay({ haraci: true });
    run(world, HARACI_EVERY);
    const prune = world.stock.ardeal.prune;
    world.issue({ type: 'haraci', faction: 'ardeal', pay: true });
    run(world, HARACI_DEADLINE + 5);
    expect(world.stock.ardeal.prune).toBe(prune - 30);
    expect(world.units.some((u) => u.faction === RAIDERS && u.order.type === 'attack' && u.order.target === world.courtOf('ardeal')!.id)).toBe(false);
    run(world, HARACI_EVERY - HARACI_DEADLINE - 5);
    expect(world.haraci.ardeal.amount).toBe(45);
  });

  it('not paying — or not answering — brings a raid that goes home after a while', () => {
    const world = fourWay({ haraci: true });
    world.era.moldova = 2; // past paying tribute, so only Ardeal and Țara Românească are asked
    run(world, HARACI_EVERY);
    world.drainEvents();
    world.issue({ type: 'haraci', faction: 'ardeal', pay: false });
    world.step();
    const raiders = () => world.units.filter((u) => u.faction === RAIDERS);
    expect(raiders()).toHaveLength(3); // Ardeal said no
    run(world, HARACI_DEADLINE);
    expect(raiders()).toHaveLength(3); // the first three left, three more came for Țara Românească's silence
    const events = world.drainEvents();
    expect(events.filter((e) => e.type === 'raid').map((e) => e.type === 'raid' && e.faction)).toEqual(['ardeal', 'tara']);
    expect(events.filter((e) => e.type === 'left')).toHaveLength(3);
    const court = world.courtOf('ardeal')!;
    expect(court.hp).toBeLessThan(court.maxHp);
    expect(court.hp).toBeGreaterThan(0);
    // Next time they come in greater numbers.
    run(world, HARACI_EVERY - HARACI_DEADLINE - 1);
    world.issue({ type: 'haraci', faction: 'ardeal', pay: false });
    world.step();
    expect(world.units.filter((u) => u.faction === RAIDERS && u.order.type === 'attack' && u.order.target === court.id)).toHaveLength(5);
  });

  it('once Țara Românească reaches the present, the capital takes its cut', () => {
    const world = fourWay();
    for (const f of ['ardeal', 'moldova', 'tara'] as const) world.era[f] = LAST_ERA;
    const before = { ardeal: world.stock.ardeal.lemn, tara: world.stock.tara.lemn, dobrogea: world.stock.dobrogea.lemn };
    run(world, FUNDS_EVERY);
    expect(world.stock.ardeal.lemn).toBe(before.ardeal + FUNDS_AMOUNT - CAPITAL_TAX);
    expect(world.stock.tara.lemn).toBe(before.tara + FUNDS_AMOUNT + 2 * CAPITAL_TAX);
    expect(world.stock.dobrogea.lemn).toBe(before.dobrogea); // still in 1600: no funds, no tax
    expect(world.drainEvents().filter((e) => e.type === 'tax')).toHaveLength(2);
  });

  it('in the present, Țara Românească is stuck in its own traffic near the court', () => {
    const walked = (era: number) => {
      const world = fourWay();
      world.era.tara = era;
      const unit = world.spawnUnit('tara', 5, 13);
      world.issue({ type: 'move', faction: 'tara', unitIds: [unit.id], tx: 30, ty: 13 });
      run(world, 20);
      return unit.x;
    };
    expect(walked(LAST_ERA)).toBeLessThan(walked(0));
  });

  it('summer on the coast: Dobrogea gets paid and the place gets worn', () => {
    const world = fourWay();
    world.era.dobrogea = LAST_ERA;
    const court = world.courtOf('dobrogea')!;
    const prune = world.stock.dobrogea.prune;
    run(world, SUMMER_EVERY);
    // Three visiting principalities at 15 each, plus one round of European funds (900 > 600).
    expect(world.stock.dobrogea.prune).toBe(prune + 45 + FUNDS_AMOUNT);
    expect(court.hp).toBe(court.maxHp - 36);
    expect(world.drainEvents().some((e) => e.type === 'summer' && e.visitors === 3)).toBe(true);
  });

  it('four AIs settle in, pay their tribute and play the same match twice', () => {
    const play = () => {
      const world = new World({ seed: 1600 });
      const ais = FACTION_IDS.map((f) => new SkirmishAi(f));
      const sums: number[] = [];
      let raids = 0;
      for (let i = 0; i < 2900; i++) {
        world.step();
        if (world.tick % AI_THINK_EVERY === 0) for (const ai of ais) ai.think(world);
        raids += world.drainEvents().filter((e) => e.type === 'raid').length;
        if (i % 50 === 0) sums.push(world.checksum());
      }
      return { world, sums, raids };
    };
    const a = play();
    expect(a.raids).toBe(0);
    for (const f of FACTION_IDS) {
      const kinds = a.world.buildings.filter((b) => b.faction === f && b.done).map((b) => b.kind);
      expect(kinds, f).toContain('tabara');
    }
    expect(a.world.buildings.some((b) => b.kind === 'cherhana' && b.faction === 'dobrogea')).toBe(true);
    expect(play().sums).toEqual(a.sums);
  });
});

describe('saves, crowd fan-out and voice hook', () => {
  it('saves and restores a full Romania match with identical future checksums', () => {
    const world = new World({ seed: 1600 });
    const ais = FACTION_IDS.map((f) => new SkirmishAi(f));
    for (let i = 0; i < 2000; i++) {
      world.step();
      if (world.tick % AI_THINK_EVERY === 0) for (const ai of ais) ai.think(world);
    }

    const snap = JSON.parse(JSON.stringify(world.toSnapshot()));
    const aiSnaps = JSON.parse(JSON.stringify(ais.map((a) => a.toSnapshot())));
    const restored = World.fromSnapshot(snap);
    const restoredAis = aiSnaps.map((s: ReturnType<SkirmishAi['toSnapshot']>) => SkirmishAi.fromSnapshot(s));

    expect(restored.checksum()).toBe(world.checksum());
    for (let i = 0; i < 1000; i++) {
      world.step();
      restored.step();
      if (world.tick % AI_THINK_EVERY === 0) {
        for (const ai of ais) ai.think(world);
        for (const ai of restoredAis) ai.think(restored);
      }
      if (i % 100 === 0) expect(restored.checksum()).toBe(world.checksum());
    }
    expect(restored.checksum()).toBe(world.checksum());
  });

  it('fans out moving crowds and avoids stationary bystanders', () => {
    const map = mapFromRows(Array.from({ length: 12 }, () => '.'.repeat(12)));
    const world = new World({ seed: 1, map });
    world.spawnUnit('ardeal', 6, 6); // bystander sitting on destination
    const group = [0, 1, 2, 3].map((i) => world.spawnUnit('ardeal', 1, 4 + i).id);
    world.issue({ type: 'move', faction: 'ardeal', unitIds: group, tx: 6, ty: 6 });
    run(world, 120);
    const tiles = new Set(world.units.map((u) => world.map.index(Math.floor(u.x / SUB), Math.floor(u.y / SUB))));
    expect(tiles.size).toBe(5);
  });

  it('spreads attackers around an enemy court instead of stacking on one tile', () => {
    const world = battlefield();
    const court = world.courtOf('moldova')!;
    const attackers = [0, 1, 2, 3].map((i) => world.spawnUnit('ardeal', 25, 5 + i, 'ostas'));
    world.issue({ type: 'attack', faction: 'ardeal', unitIds: attackers.map((u) => u.id), targetId: court.id });
    run(world, 80);
    const tiles = new Set(attackers.map((u) => world.map.index(Math.floor(u.x / SUB), Math.floor(u.y / SUB))));
    expect(tiles.size).toBe(4);
  });

  it('invokes the voice-line hook at 2/4 unit chatter rate and avoids repeating clips', () => {
    const sound = new SoundEngine();
    const heard: VoiceLineContext[] = [];
    sound.setVoiceHook((ctx) => heard.push(ctx));
    sound.voice({ faction: 'ardeal', unitKind: 'taran', kind: 'select', text: 'No, ce-i?' }, () => 0.25);
    sound.voice({ faction: 'ardeal', unitKind: 'taran', kind: 'select', text: 'No, ce-i?' }, () => 0.75);
    expect(heard).toEqual([{ faction: 'ardeal', unitKind: 'taran', kind: 'select', text: 'No, ce-i?' }]);

    expect(shouldPlayVoice({ faction: 'ardeal', unitKind: 'taran', kind: 'move', text: 'x' }, () => 0.49)).toBe(true);
    expect(shouldPlayVoice({ faction: 'ardeal', unitKind: 'taran', kind: 'move', text: 'x' }, () => 0.5)).toBe(false);
    expect(shouldPlayVoice({ faction: 'moldova', unitKind: 'ostas', kind: 'taunt', text: 'x' }, () => 0.99)).toBe(true);

    const world = new World({ seed: 1600 });
    run(world, 650);
    const summary = formatSaveSummary({
      version: 1,
      savedAt: 0,
      player: 'moldova',
      peaceful: true,
      goalReached: false,
      lost: false,
      taxed: false,
      camera: { x: 0, y: 0, zoom: 2 },
      world: world.toSnapshot(),
      ais: [],
    });
    expect(summary).toContain('Moldova');
    expect(summary).toContain('Fără război');
    expect(loadGame()).toBeNull();

    const firstSiVrei = clipForLine({ faction: 'moldova', kind: 'select', text: 'Și vrei, wăi?' });
    expect(firstSiVrei).toMatch(/^moldova\/si-vrei-/);
    expect(
      clipForLine({ faction: 'moldova', kind: 'select', text: 'Și vrei, wăi?' }, firstSiVrei),
    ).not.toBe(firstSiVrei);
    expect(clipForLine({ faction: 'ardeal', kind: 'build', text: 'No, numai bine bem o pălincă…' })).toBe(
      'ardeal/palinca-hai.mp3',
    );
    expect(clipForLine({ faction: 'ardeal', kind: 'select', text: 'Nem tudom.' })).toBe('ardeal/nem-tudom.mp3');
    expect(clipForLine({ faction: 'ardeal', kind: 'select', text: 'Atunci ce cauți pe harta mea?!' })).toBe(
      'ardeal/ce-cauti.mp3',
    );
    expect(clipForLine({ faction: 'tara', kind: 'select', text: 'Da, boss!' })).toBe('tara/da-boss.mp3');
    expect(clipForLine({ faction: 'tara', kind: 'wood', text: 'Hai să producem ceva pentru societate!' })).toBe(
      'tara/hai-producem.mp3',
    );
    expect(clipForLine({ faction: 'moldova', kind: 'haraciRefuse', text: 'Muie Baiazid!' })).toBe(
      'common/muie-baiazid.mp3',
    );
    expect(shouldPlayVoice({ faction: 'ardeal', kind: 'haraciRefuse', text: 'Muie Baiazid!' }, () => 0.99)).toBe(true);
  });

  it('supports AI difficulty presets and preserves them in snapshots', () => {
    const easy = new SkirmishAi('moldova', { difficulty: 'usor' });
    const hard = new SkirmishAi('moldova', { difficulty: 'greu' });
    expect(SkirmishAi.fromSnapshot(easy.toSnapshot()).difficulty).toBe('usor');
    expect(SkirmishAi.fromSnapshot(hard.toSnapshot()).difficulty).toBe('greu');

    const playToFirstAttack = (diff: 'usor' | 'greu') => {
      const world = new World({ seed: 1600 });
      const ai = new SkirmishAi('moldova', { difficulty: diff });
      for (let i = 0; i < 6000; i++) {
        world.step();
        if (world.tick % AI_THINK_EVERY === 0) ai.think(world);
        if (ai.toSnapshot().wavesSent > 0) return world.tick;
      }
      return Infinity;
    };
    expect(playToFirstAttack('greu')).toBeLessThan(playToFirstAttack('usor'));
  });
});

describe('milestone 7 and extra features', () => {
  it('generates a 1.5x bigger map with 5 principalities including Oltenia', () => {
    const world = new World({ seed: 1600, mapScale: 1.5, includeOltenia: true });
    expect(world.map.width).toBe(216);
    expect(world.map.height).toBe(156);
    for (const id of PLAYABLE_FACTION_IDS) {
      const court = world.courtOf(id);
      expect(court).toBeDefined();
      expect(world.units.filter((u) => u.faction === id && u.kind === 'taran').length).toBeGreaterThanOrEqual(3);
    }

    // Oltenia is rival to everyone ("Oltenii cu toată lumea")
    for (const other of FACTION_IDS) {
      expect(isRival('oltenia', other)).toBe(true);
      expect(isRival(other, 'oltenia')).toBe(true);
    }

    // Oltenia's Iureș ability grants combat buff and goes on cooldown
    world.issue({ type: 'ability', faction: 'oltenia' });
    world.step();
    expect(world.buff.oltenia).toBeGreaterThan(0);
    expect(world.abilityCooldown.oltenia).toBeGreaterThan(0);
  });

  it('supports defensive buildings: casa, han passive healing, turn auto-fire, zid & poarta buildLine', () => {
    const map = mapFromRows([
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
    ]);
    const world = new World({ seed: 1, map });
    world.placeBuilding('curte', 'ardeal', 1, 1, true);
    world.placeBuilding('curte', 'moldova', 15, 1, true);
    const builder = world.spawnUnit('ardeal', 4, 2, 'taran');
    const enemy = world.spawnUnit('moldova', 13, 3, 'ostas');
    world.stock.ardeal.lemn = 500;
    world.era.ardeal = 1;
    const baseCap = world.unitCap('ardeal');

    // Build a casa (+4 cap) and a han (+6 cap)
    world.issue({ type: 'build', faction: 'ardeal', unitIds: [builder.id], kind: 'casa', tx: 5, ty: 1 });
    for (let i = 0; i < 120; i++) world.step();
    expect(world.unitCap('ardeal')).toBe(baseCap + 4);

    world.issue({ type: 'build', faction: 'ardeal', unitIds: [builder.id], kind: 'han', tx: 8, ty: 1 });
    for (let i = 0; i < 160; i++) world.step();
    expect(world.unitCap('ardeal')).toBe(baseCap + 10);

    // Han passively heals damaged friendly units nearby
    builder.hp = builder.maxHp - 10;
    for (let i = 0; i < 30; i++) world.step();
    expect(builder.hp).toBeGreaterThan(builder.maxHp - 10);

    // Build a line of 2 walls + 1 gate
    world.issue({
      type: 'buildLine',
      faction: 'ardeal',
      unitIds: [builder.id],
      kind: 'zid',
      tiles: [
        [5, 5],
        [6, 5],
      ],
    });
    world.issue({
      type: 'build',
      faction: 'ardeal',
      unitIds: [],
      kind: 'poarta',
      tx: 7,
      ty: 5,
    });
    for (let i = 0; i < 150; i++) world.step();
    expect(world.buildings.filter((b) => b.kind === 'zid' && b.done).length).toBe(2);

    // Friendly unit can pass through its own poarta (tx=7, ty=5), enemy cannot
    expect(world.map.isPassable(7, 5, 1)).toBe(true); // 1 = ardeal
    expect(world.map.isPassable(7, 5, 2)).toBe(false); // 2 = moldova

    // Watchtower (turn) automatically fires at nearby enemy units
    world.issue({ type: 'build', faction: 'ardeal', unitIds: [builder.id], kind: 'turn', tx: 11, ty: 2 });
    for (let i = 0; i < 200; i++) world.step();
    const freshEnemy = world.spawnUnit('moldova', 13, 3, 'ostas');
    const hpBefore = freshEnemy.hp;
    for (let i = 0; i < 30; i++) world.step();
    expect(freshEnemy.hp).toBeLessThan(hpBefore);
    expect(enemy.hp).toBeLessThanOrEqual(0);
  });

  it('implements Stegar ("Ăla-i cu steagul!") zero-damage rule, aura buff, and Iscoadă speed', () => {
    const map = mapFromRows([
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ]);
    const world = new World({ seed: 1, map });
    world.placeBuilding('curte', 'ardeal', 1, 1, true);
    world.placeBuilding('curte', 'moldova', 8, 1, true);
    const camp = world.placeBuilding('tabara', 'ardeal', 4, 1, true);
    world.stock.ardeal.lemn = 300;
    world.stock.ardeal.prune = 300;

    world.issue({ type: 'train', faction: 'ardeal', buildingId: camp.id, kind: 'stegar' });
    world.issue({ type: 'train', faction: 'ardeal', buildingId: camp.id, kind: 'iscoada' });
    for (let i = 0; i < 220; i++) world.step();
    world.issue({ type: 'train', faction: 'ardeal', buildingId: camp.id, kind: 'ostas' });
    for (let i = 0; i < 160; i++) world.step();

    const stegar = world.units.find((u) => u.faction === 'ardeal' && u.kind === 'stegar')!;
    const iscoada = world.units.find((u) => u.faction === 'ardeal' && u.kind === 'iscoada')!;
    const ostas = world.units.find((u) => u.faction === 'ardeal' && u.kind === 'ostas')!;
    expect(stegar).toBeDefined();
    expect(iscoada).toBeDefined();
    expect(iscoada.speed).toBeGreaterThan(ostas.speed);

    // Park iscoada far away so only ostas is near stegar
    iscoada.x = 1 * SUB;
    iscoada.y = 1 * SUB;

    // When friendly fighter (ostas) is nearby, stegar deals 0 damage ("Ăla-i cu steagul!")
    const enemy = world.spawnUnit('moldova', 10, 4, 'taran');
    stegar.x = enemy.x - SUB;
    stegar.y = enemy.y;
    ostas.x = stegar.x - 2 * SUB;
    ostas.y = stegar.y;
    ostas.order = { type: 'move' };
    const hpBefore = enemy.hp;
    world.issue({ type: 'attack', faction: 'ardeal', unitIds: [stegar.id], targetId: enemy.id });
    for (let i = 0; i < 12; i++) {
      ostas.x = stegar.x - 2 * SUB;
      ostas.y = stegar.y;
      ostas.order = { type: 'move' };
      iscoada.x = 1 * SUB;
      iscoada.y = 1 * SUB;
      iscoada.order = { type: 'move' };
      world.step();
    }
    expect(enemy.hp).toBe(hpBefore);

    // Move friendly fighters far away: cornered stegar swings his flagpole for 3 damage
    for (let i = 0; i < 15; i++) {
      ostas.x = 1 * SUB;
      ostas.y = 1 * SUB;
      ostas.order = { type: 'move' };
      iscoada.x = 1 * SUB;
      iscoada.y = 1 * SUB;
      iscoada.order = { type: 'move' };
      world.step();
    }
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('researches technologies and sabotage upgrades (topor, zidarie, dosar, para, pana_curent)', () => {
    const world = new World({ seed: 1600 });
    world.stock.ardeal.lemn = 500;
    world.stock.ardeal.prune = 500;
    world.era.ardeal = 1;
    const court = world.courtOf('ardeal')!;
    const maxHpBefore = court.maxHp;

    // Research zidarie (+25% building HP)
    world.issue({ type: 'research', faction: 'ardeal', buildingId: court.id, techId: 'zidarie' });
    for (let i = 0; i < 160; i++) world.step();
    expect(world.hasTech('ardeal', 'zidarie')).toBe(true);
    expect(court.maxHp).toBe(Math.floor((maxHpBefore * 125) / 100));

    // Research topor (+2 carry capacity)
    world.issue({ type: 'research', faction: 'ardeal', buildingId: court.id, techId: 'topor' });
    for (let i = 0; i < 140; i++) world.step();
    expect(world.hasTech('ardeal', 'topor')).toBe(true);

    // Advance era and test sabotage techs (para, dosar, pana_curent)
    world.era.ardeal = 4;
    world.issue({
      type: 'research',
      faction: 'ardeal',
      buildingId: court.id,
      techId: 'para',
      targetFaction: 'moldova',
    });
    for (let i = 0; i < 150; i++) world.step();
    expect(world.haraci.moldova.amount).toBeGreaterThanOrEqual(40);

    world.issue({
      type: 'research',
      faction: 'ardeal',
      buildingId: court.id,
      techId: 'dosar',
      targetFaction: 'moldova',
    });
    for (let i = 0; i < 150; i++) world.step();
    expect(world.debuffs.moldova.dosar).toBeGreaterThan(0);

    world.issue({
      type: 'research',
      faction: 'ardeal',
      buildingId: court.id,
      techId: 'pana_curent',
      targetFaction: 'moldova',
    });
    for (let i = 0; i < 150; i++) world.step();
    expect(world.debuffs.moldova.panaCurent).toBeGreaterThan(0);
  });

  it('supports rally points, cancelQueue refunds, attackMove, and peasant building repair', () => {
    const world = new World({ seed: 1600 });
    const court = world.courtOf('ardeal')!;
    world.stock.ardeal.prune = 200;
    world.stock.ardeal.lemn = 200;

    // Set rally point on court
    world.issue({ type: 'rally', faction: 'ardeal', buildingId: court.id, tx: court.tx + 4, ty: court.ty + 4 });
    world.step();
    expect(court.rally).toEqual({ tx: court.tx + 4, ty: court.ty + 4 });

    // Queue 2 peasants, then cancelQueue both and verify full refund
    const pruneBefore = world.stock.ardeal.prune;
    world.issue({ type: 'train', faction: 'ardeal', buildingId: court.id, kind: 'taran' });
    world.issue({ type: 'train', faction: 'ardeal', buildingId: court.id, kind: 'taran' });
    world.step();
    expect(court.queue.length).toBe(2);
    expect(world.stock.ardeal.prune).toBeLessThan(pruneBefore);

    world.issue({ type: 'cancelQueue', faction: 'ardeal', buildingId: court.id });
    world.issue({ type: 'cancelQueue', faction: 'ardeal', buildingId: court.id });
    world.step();
    expect(court.queue.length).toBe(0);
    expect(world.stock.ardeal.prune).toBe(pruneBefore);

    // Damage court and order peasant to repair it
    court.hp = court.maxHp - 50;
    const peasant = world.units.find((u) => u.faction === 'ardeal' && u.kind === 'taran')!;
    expect(world.describeTarget('ardeal', court.tx, court.ty)).toBe('build');
    world.issue({ type: 'act', faction: 'ardeal', unitIds: [peasant.id], tx: court.tx, ty: court.ty });
    for (let i = 0; i < 60; i++) world.step();
    expect(court.hp).toBe(court.maxHp);
  });

  it('keeps two lockstep multiplayer worlds in bit-identical sync across turns', () => {
    const worldA = new World({ seed: 1600 });
    const worldB = new World({ seed: 1600 });
    const packetsA: RelayClientMsg[] = [];
    const packetsB: RelayClientMsg[] = [];
    const sinkA = new LockstepSink((msg) => packetsA.push(msg));
    const sinkB = new LockstepSink((msg) => packetsB.push(msg));

    const courtA = worldA.courtOf('ardeal')!;
    const courtB = worldB.courtOf('moldova')!;
    sinkA.send({ type: 'train', faction: 'ardeal', buildingId: courtA.id, kind: 'taran' });
    sinkB.send({ type: 'train', faction: 'moldova', buildingId: courtB.id, kind: 'taran' });

    for (let tick = 0; tick < TURN_TICKS * 10; tick++) {
      expect(sinkA.beforeStep(worldA)).toBe(true);
      expect(sinkB.beforeStep(worldB)).toBe(true);
      // Deliver any outbound turn packets submitted during beforeStep to the relay and broadcast back
      while (packetsA.length > 0 && packetsB.length > 0) {
        const pA = packetsA.shift()!;
        const pB = packetsB.shift()!;
        if (pA.type === 'turn' && pB.type === 'turn') {
          const merged = [...pA.cmds, ...pB.cmds];
          const desync = pA.hash !== undefined && pB.hash !== undefined && pA.hash !== pB.hash;
          sinkA.receive({ type: 'turn', turn: pA.turn, cmds: merged, desync });
          sinkB.receive({ type: 'turn', turn: pB.turn, cmds: merged, desync });
        }
      }
      worldA.step();
      worldB.step();
      sinkA.afterStep();
      sinkB.afterStep();
    }
    expect(sinkA.desynced).toBe(false);
    expect(sinkB.desynced).toBe(false);
    expect(worldA.checksum()).toBe(worldB.checksum());
  });

  it('allows villagers to garrison inside defensive buildings (turn and curte), boost firepower, and ungarrison back to work', () => {
    const map = mapFromRows([
      '..............ff',
      '..............ff',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ]);
    const world = new World({ seed: 1, map });
    const court = world.placeBuilding('curte', 'ardeal', 1, 1, true);
    const tower = world.placeBuilding('turn', 'ardeal', 6, 1, true);
    const p1 = world.spawnUnit('ardeal', 5, 3, 'taran');
    const p2 = world.spawnUnit('ardeal', 6, 3, 'taran');
    const p3 = world.spawnUnit('ardeal', 2, 4, 'taran');

    // Start p1 chopping wood and give p2 a load of plums so we verify resource drop-off & job resume
    world.issue({ type: 'act', faction: 'ardeal', unitIds: [p1.id], tx: 14, ty: 0 });
    world.step();
    p2.carryKind = 'prune';
    p2.carryAmount = 5;
    const pruneBefore = world.stock.ardeal.prune;

    // Tapping a finished watchtower describes target as 'garrison'
    expect(world.describeTarget('ardeal', tower.tx, tower.ty)).toBe('garrison');
    world.issue({ type: 'act', faction: 'ardeal', unitIds: [p1.id, p2.id], tx: tower.tx, ty: tower.ty });
    // Garrison p3 inside the court (Town Bell / shelter in curte)
    world.issue({ type: 'garrison', faction: 'ardeal', unitIds: [p3.id], buildingId: court.id });

    for (let i = 0; i < 60; i++) world.step();
    expect(world.garrisonCount(tower)).toBe(2);
    expect(world.garrisonCount(court)).toBe(1);
    // Carried plums were deposited upon entering shelter
    expect(world.stock.ardeal.prune).toBe(pruneBefore + 5);
    // Garrisoned peasants still count toward faction unitCount
    expect(world.unitCount('ardeal', 'taran')).toBe(3);
    expect(world.units.filter((u) => u.faction === 'ardeal').length).toBe(0);

    // Court with a garrisoned villager now fires defensively at nearby enemies!
    const raiderNearCourt = world.spawnUnit('moldova', 2, 5, 'ostas');
    const courtTargetHp = raiderNearCourt.hp;
    for (let i = 0; i < 20; i++) world.step();
    expect(raiderNearCourt.hp).toBeLessThan(courtTargetHp);
    world.units.splice(world.units.indexOf(raiderNearCourt), 1);

    // Snapshot round-trip preserves garrisoned villagers
    const restored = World.fromSnapshot(world.toSnapshot());
    expect(restored.garrisonCount(restored.getBuilding(tower.id)!)).toBe(2);
    expect(restored.garrisonCount(restored.getBuilding(court.id)!)).toBe(1);

    // Ungarrison from tower: p1 and p2 come back out, and p1 resumes chopping wood
    world.issue({ type: 'ungarrison', faction: 'ardeal', buildingId: tower.id });
    world.step();
    expect(world.garrisonCount(tower)).toBe(0);
    expect(world.units.filter((u) => u.faction === 'ardeal').length).toBe(2);
    const restoredP1 = world.getUnit(p1.id)!;
    expect(restoredP1.order.type).toBe('gather');

    // If a defensive building with garrisoned villagers is destroyed, they survive and exit onto nearby tiles
    tower.hp = 1;
    world.issue({ type: 'garrison', faction: 'ardeal', unitIds: [p2.id], buildingId: tower.id });
    for (let i = 0; i < 30; i++) world.step();
    expect(world.garrisonCount(tower)).toBe(1);
    const attacker = world.spawnUnit('moldova', 6, 3, 'smecher');
    world.issue({ type: 'attack', faction: 'moldova', unitIds: [attacker.id], targetId: tower.id });
    for (let i = 0; i < 20; i++) world.step();
    expect(world.getBuilding(tower.id)).toBeUndefined();
    expect(world.getUnit(p2.id)).toBeDefined();
  });

  it('supports player nickname with default fallback and deleting a solo saved game', () => {
    expect(sanitizeNickname('')).toBe(DEFAULT_NICKNAME);
    expect(sanitizeNickname('   ')).toBe(DEFAULT_NICKNAME);
    expect(sanitizeNickname('  Vlad   Țepeș  ')).toBe('Vlad Țepeș');

    // Mock window.localStorage to test saveNickname, loadNickname, saveGame, loadGame, and clearSave
    const store = new Map<string, string>();
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    };
    try {
      expect(loadNickname()).toBe(DEFAULT_NICKNAME);
      expect(saveNickname('Ștefan')).toBe('Ștefan');
      expect(loadNickname()).toBe('Ștefan');
      expect(saveNickname('')).toBe(DEFAULT_NICKNAME);
      expect(loadNickname()).toBe(DEFAULT_NICKNAME);

      const world = new World({ seed: 1600, includeOltenia: true });
      const savedOk = saveGame({
        version: 1,
        savedAt: 1000,
        player: 'oltenia',
        nickname: 'Tudor',
        peaceful: false,
        difficulty: 'greu',
        goalReached: false,
        lost: false,
        taxed: false,
        camera: { x: 100, y: 100, zoom: 2 },
        world: world.toSnapshot(),
        ais: [],
      });
      expect(savedOk).toBe(true);
      const loaded = loadGame();
      expect(loaded).not.toBeNull();
      expect(loaded!.player).toBe('oltenia');
      expect(loaded!.nickname).toBe('Tudor');
      expect(formatSaveSummary(loaded!)).toContain('Tudor · Oltenia');

      // Delete solo saved game explicitly
      clearSave();
      expect(loadGame()).toBeNull();
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window: unknown }).window = prevWindow;
    }
  });
});
