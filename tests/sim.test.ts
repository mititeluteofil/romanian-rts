import { describe, expect, it } from 'vitest';
import { GameMap, generateMap, spawnPoint, Terrain } from '../src/sim/map';
import { findPath, nearestPassable } from '../src/sim/pathfinding';
import { SUB, World } from '../src/sim/world';

function mapFromRows(rows: string[]): GameMap {
  const map = new GameMap(rows[0]!.length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      map.tiles[map.index(x, y)] =
        ch === '#' ? Terrain.Mountain : ch === '~' ? Terrain.Water : ch === 'f' ? Terrain.Forest : Terrain.Grass;
    });
  });
  return map;
}

describe('map generation', () => {
  it('is identical for the same seed and differs for another seed', () => {
    const a = generateMap(1600, 80, 80);
    const b = generateMap(1600, 80, 80);
    const c = generateMap(1859, 80, 80);
    expect([...a.tiles]).toEqual([...b.tiles]);
    expect([...a.tiles]).not.toEqual([...c.tiles]);
  });

  it('has all terrain types and an open spawn meadow', () => {
    const map = generateMap(1600, 80, 80);
    const counts = [0, 0, 0, 0];
    for (const t of map.tiles) counts[t]!++;
    for (const n of counts) expect(n).toBeGreaterThan(50);
    const spawn = spawnPoint(map);
    expect(map.terrainAt(spawn.x, spawn.y)).toBe(Terrain.Grass);
    expect(map.terrainAt(spawn.x + 3, spawn.y - 3)).toBe(Terrain.Grass);
  });
});

describe('pathfinding', () => {
  it('walks around a wall and never steps on impassable tiles', () => {
    const map = mapFromRows([
      '.......',
      '.####..',
      '....#..',
      '....#..',
      '.......',
    ]);
    const path = findPath(map, 1, 2, 5, 2);
    expect(path.length).toBeGreaterThan(4);
    expect(path[path.length - 1]).toBe(map.index(5, 2));
    for (const idx of path) {
      const x = idx % map.width;
      expect(map.isPassable(x, (idx - x) / map.width)).toBe(true);
    }
  });

  it('does not cut diagonally between two obstacles', () => {
    const map = mapFromRows([
      '.#.',
      '#..',
      '...',
    ]);
    // (0,0) is sealed in: both orthogonal neighbours are blocked.
    expect(findPath(map, 0, 0, 2, 2)).toEqual([]);
  });

  it('stops at the closest reachable tile when the goal is cut off', () => {
    const map = mapFromRows([
      '...~.',
      '...~.',
      '...~.',
    ]);
    const path = findPath(map, 0, 1, 4, 1);
    expect(path[path.length - 1]).toBe(map.index(2, 1));
  });

  it('prefers open ground over forest', () => {
    const map = mapFromRows([
      '.....',
      '.fff.',
      '.....',
    ]);
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
});

describe('world', () => {
  it('moves a unit to the tile it was sent to', () => {
    const world = new World({ seed: 1600 });
    const unit = world.units[0]!;
    const spawn = spawnPoint(world.map);
    world.issue({ type: 'move', unitIds: [unit.id], tx: spawn.x + 3, ty: spawn.y - 3 });
    for (let i = 0; i < 200; i++) world.step();
    expect(unit.path).toEqual([]);
    expect(unit.x).toBe((spawn.x + 3) * SUB + SUB / 2);
    expect(unit.y).toBe((spawn.y - 3) * SUB + SUB / 2);
  });

  it('gives each unit in a group its own tile', () => {
    const world = new World({ seed: 1600 });
    const spawn = spawnPoint(world.map);
    world.issue({ type: 'move', unitIds: world.units.map((u) => u.id), tx: spawn.x, ty: spawn.y - 4 });
    for (let i = 0; i < 300; i++) world.step();
    const spots = new Set(world.units.map((u) => `${u.x},${u.y}`));
    expect(spots.size).toBe(world.units.length);
  });

  it('is deterministic: same seed and commands give the same checksum', () => {
    const run = () => {
      const world = new World({ seed: 1600 });
      const ids = world.units.map((u) => u.id);
      const sums: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i === 5) world.issue({ type: 'move', unitIds: ids, tx: 10, ty: 12 });
        if (i === 90) world.issue({ type: 'move', unitIds: ids.slice(0, 2), tx: 70, ty: 60 });
        if (i === 91) world.issue({ type: 'move', unitIds: ids.slice(2), tx: 40, ty: 5 });
        world.step();
        sums.push(world.checksum());
      }
      return sums;
    };
    expect(run()).toEqual(run());
  });

  it('Ardeal is slower than Moldova', () => {
    const world = new World({ seed: 1600 });
    const ardeal = world.units.find((u) => u.faction === 'ardeal')!;
    const moldova = world.units.find((u) => u.faction === 'moldova')!;
    expect(ardeal.speed).toBeLessThan(moldova.speed);
  });
});
