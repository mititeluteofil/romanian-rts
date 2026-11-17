import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { PLACES, Region } from '../src/data/romania';
import { GameMap, generateRomania, latToY, lonToX, placeTile, Terrain } from '../src/sim/map';
import { findPath, nearestPassable, nearestTile } from '../src/sim/pathfinding';
import { AI_THINK_EVERY, SkirmishAi } from '../src/ai/skirmish';
import { ERAS, LAST_ERA } from '../src/data/eras';
import { BRIBE_PRUNE, DISTILL_TICKS, FUNDS_AMOUNT, FUNDS_EVERY, SUB, World } from '../src/sim/world';

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
  it('starts with a court and three peasants at Alba Iulia and at Iași', () => {
    const world = new World({ seed: 1600 });
    const alba = placeTile(PLACES.albaIulia);
    const iasi = placeTile(PLACES.iasi);
    expect(world.buildingAt(alba.x, alba.y)?.faction).toBe('ardeal');
    expect(world.buildingAt(iasi.x, iasi.y)?.faction).toBe('moldova');
    expect(world.unitCount('ardeal')).toBe(3);
    expect(world.unitCount('moldova')).toBe(3);
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
    expect(world.era).toEqual({ ardeal: 0, moldova: 1 });
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
    const world = new World({ seed: 1600 });
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
