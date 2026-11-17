import type { BuildingKind } from '../data/buildings';
import type { FactionDef, UnitKind } from '../data/factions';
import { Terrain } from '../sim/map';
import { Rng } from '../sim/rng';

/**
 * Placeholder pixel art, drawn in code so there is no asset pipeline yet.
 * Real sprite sheets replace these later without touching the scene code:
 * the tileset layout (one row per terrain × VARIANTS columns), the unit
 * frame names ('idle', 'walk', 'work') and the building sizes are the contract.
 */

export const TILE = 16;
export const VARIANTS = 4;
const TERRAINS = [
  Terrain.Grass,
  Terrain.Forest,
  Terrain.Water,
  Terrain.Mountain,
  Terrain.Abroad,
  Terrain.Ford,
] as const;

type Ctx = CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return { canvas, ctx };
}

function px(ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function speckle(ctx: Ctx, ox: number, oy: number, rng: Rng, colors: string[], count: number, size = TILE): void {
  for (let i = 0; i < count; i++) {
    px(ctx, ox + rng.int(size), oy + rng.int(size), colors[rng.int(colors.length)]!);
  }
}

function drawGrass(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#5a9e3d', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#4f8f35', '#68ad48', '#74b852'], 22);
  if (rng.int(3) === 0) {
    const fx = ox + 2 + rng.int(12);
    const fy = oy + 2 + rng.int(12);
    px(ctx, fx, fy, rng.int(2) === 0 ? '#f2d94e' : '#e8e8e8');
  }
}

function drawFir(ctx: Ctx, tx: number, ty: number): void {
  px(ctx, tx + 2, ty, '#1f5a2a', 2, 2);
  px(ctx, tx + 1, ty + 2, '#1f5a2a', 4, 2);
  px(ctx, tx, ty + 4, '#17461f', 6, 2);
  px(ctx, tx + 2, ty + 1, '#2f7a3a');
  px(ctx, tx + 1, ty + 3, '#2f7a3a');
  px(ctx, tx + 2, ty + 6, '#5b3a1e', 2, 2);
}

function drawForest(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#4a8a36', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#3f7a2e', '#55963f'], 14);
  const trees = 2 + rng.int(2);
  for (let i = 0; i < trees; i++) drawFir(ctx, ox + 1 + rng.int(9), oy + 1 + rng.int(6));
}

function drawWater(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#2f6fb0', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#2a65a3', '#3579bb'], 16);
  for (let i = 0; i < 3; i++) {
    px(ctx, ox + 1 + rng.int(11), oy + 1 + rng.int(14), '#8fc3ea', 3, 1);
  }
}

function drawMountain(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#6f7d5c', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#667355', '#7a8866'], 14);
  const lean = rng.int(3) - 1;
  for (let row = 0; row < 12; row++) {
    const half = Math.floor(row * 0.6) + 1;
    const cx = ox + 8 + lean;
    const y = oy + 2 + row;
    px(ctx, cx - half, y, '#9a9a94', half, 1);
    px(ctx, cx, y, '#6e6e6a', half, 1);
    if (row < 3) px(ctx, cx - half, y, '#f1f1ee', half * 2, 1);
  }
}

/** Beyond the border: an old map's blank parchment, cross-hatched. */
function drawAbroad(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#3f3d33', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#39372e', '#464438'], 20);
  const shift = rng.int(8);
  for (let i = 0; i < TILE; i += 2) px(ctx, ox + ((i + shift) % TILE), oy + i, '#4d4a3c');
}

/** Ford: shallow, lighter water with stepping stones. */
function drawFord(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#5d9fd3', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#6fb0e0', '#4f8fc4'], 18);
  for (let i = 0; i < 5; i++) {
    const sx = ox + 1 + rng.int(12);
    const sy = oy + 1 + rng.int(13);
    px(ctx, sx, sy, '#b9b4a4', 2, 1);
    px(ctx, sx, sy + 1, '#8f8a7c', 2, 1);
  }
}

/** Tileset image: one row per terrain, VARIANTS columns to break repetition. */
export function buildTileset(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(TILE * VARIANTS, TILE * TERRAINS.length);
  const painters: Record<Terrain, (c: Ctx, x: number, y: number, r: Rng) => void> = {
    [Terrain.Grass]: drawGrass,
    [Terrain.Forest]: drawForest,
    [Terrain.Water]: drawWater,
    [Terrain.Mountain]: drawMountain,
    [Terrain.Abroad]: drawAbroad,
    [Terrain.Ford]: drawFord,
  };
  const rng = new Rng(1600);
  for (const terrain of TERRAINS) {
    for (let v = 0; v < VARIANTS; v++) painters[terrain](ctx, v * TILE, terrain * TILE, rng);
  }
  return canvas;
}

/** Index of a tile image inside the tileset. */
export function tileIndex(terrain: Terrain, variant: number): number {
  return terrain * VARIANTS + (variant % VARIANTS);
}

// --- Peasants ---------------------------------------------------------------

// 16×16 peasant. h hat, s skin, e eye, m moustache, w shirt, f faction belt,
// p trousers, b opinci. '.' is transparent.
const PEASANT_HEAD = [
  '................',
  '......hhhh......',
  '.....hhhhhh.....',
  '...hhhhhhhhhh...',
  '.....ssssss.....',
  '.....sesses.....',
  '.....smmmms.....',
  '......ssss......',
];
// Băiat de băiat: gelled hair, sunglasses (g), no hat.
const SMECHER_HEAD = [
  '................',
  '................',
  '......hhhh......',
  '.....hhhhhh.....',
  '.....ssssss.....',
  '....gggggggg....',
  '.....ssssss.....',
  '......ssss......',
];
const BODY_IDLE = ['....wwwwwwww....', '...swwwwwwwws...', '...swwwwwwwws...', '....ffffffff....', '....pppppppp....'];
// Arms up, as if swinging an axe or reaching for a plum.
const BODY_WORK = ['..s.wwwwwwww.s..', '...swwwwwwwws...', '....wwwwwwww....', '....ffffffff....', '....pppppppp....'];
const LEGS_IDLE = ['....ppp..ppp....', '....ppp..ppp....', '....bbb..bbb....'];
const LEGS_WALK = ['...ppp....ppp...', '..ppp......ppp..', '..bbb......bbb..'];

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function drawSprite(ctx: Ctx, ox: number, rows: string[], palette: Record<string, string>): void {
  rows.forEach((row, y) => {
    if (row.length !== TILE) throw new Error(`Sprite row ${y} is ${row.length} wide, expected ${TILE}`);
    [...row].forEach((ch, x) => {
      const color = palette[ch];
      if (color) px(ctx, ox + x, y, color);
    });
  });
}

export const UNIT_FRAMES = ['idle', 'walk', 'work'] as const;

/** Ardeal carries an axe, Moldova a sabre; held low, or raised to strike. */
function drawWeapon(ctx: Ctx, ox: number, faction: FactionDef, raised: boolean): void {
  const axe = faction.id === 'ardeal';
  const wood = '#5b3a1e';
  const steel = '#d6d6d6';
  if (raised) {
    for (let i = 0; i < 5; i++) px(ctx, ox + 12 + (i >> 1), 7 - i, axe ? wood : steel);
    if (axe) px(ctx, ox + 14, 2, steel, 2, 2);
    else px(ctx, ox + 12, 8, wood);
  } else {
    for (let i = 0; i < 6; i++) px(ctx, ox + 14, 12 - i, axe ? wood : steel);
    if (axe) px(ctx, ox + 14, 5, steel, 2, 2);
    else px(ctx, ox + 14, 12, wood);
  }
}

/** Unit sheet for a faction: frames side by side in UNIT_FRAMES order. */
export function buildUnitSheet(faction: FactionDef, kind: UnitKind): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(TILE * UNIT_FRAMES.length, TILE);
  const soldier = kind === 'ostas';
  const smecher = kind === 'smecher';
  const palette: Record<string, string> = smecher
    ? {
        // Tracksuit, white trainers; only the belt still says where he is from.
        h: '#16161a',
        s: '#e8b88a',
        g: '#0a0a0c',
        w: '#26262e',
        f: hex(faction.color),
        p: '#30303a',
        b: '#f2f2f2',
      }
    : {
        h: hex(faction.hatColor),
        s: '#e8b88a',
        e: '#1b1b1b',
        m: '#4a2f1a',
        // Peasants wear the white shirt; soldiers a suman over it.
        w: soldier ? (faction.id === 'ardeal' ? '#56613f' : '#7a3b2b') : '#f4f1e6',
        f: hex(faction.color),
        p: '#e2ddcc',
        b: '#4a2f1a',
      };
  const head = smecher ? SMECHER_HEAD : PEASANT_HEAD;
  const frames = [
    [...head, ...BODY_IDLE, ...LEGS_IDLE],
    [...head, ...BODY_IDLE, ...LEGS_WALK],
    [...head, ...BODY_WORK, ...LEGS_IDLE],
  ];
  frames.forEach((rows, i) => {
    drawSprite(ctx, i * TILE, rows, palette);
    if (soldier) drawWeapon(ctx, i * TILE, faction, i === 2);
    if (smecher) {
      // Gold chain, and white stripes down the sleeves.
      px(ctx, i * TILE + 7, 8, '#f2c230', 2, 1);
      px(ctx, i * TILE + 6, 9, '#f2c230');
      px(ctx, i * TILE + 9, 9, '#f2c230');
      px(ctx, i * TILE + 4, 9, '#f2f2f2', 1, 2);
      px(ctx, i * TILE + 11, 9, '#f2f2f2', 1, 2);
    }
  });
  return canvas;
}

// --- Buildings --------------------------------------------------------------

/** How the court looks in each era (index = era). */
export const COURT_LOOKS: readonly number[] = [0, 0, 1, 2, 3];
export const COURT_LOOK_COUNT = 4;

/** Looks 2 and 3: the concrete years, then the same block with new windows and a new flag. */
function drawTownHall(ctx: Ctx, faction: FactionDef, modern: boolean): void {
  const wall = modern ? '#ead98f' : '#b7b4ab';
  const trim = modern ? '#c9b76a' : '#8f8c84';
  px(ctx, 4, 42, '#3c5a2a', 40, 4);
  px(ctx, 4, 12, wall, 40, 30);
  px(ctx, 3, 10, '#4b4a46', 42, 3); // flat roof
  for (let y = 16; y < 36; y += 7) {
    px(ctx, 4, y + 5, trim, 40, 1);
    for (let x = 7; x < 42; x += 6) {
      px(ctx, x, y, modern ? '#f7f7f7' : '#4d5560', 4, 4);
      px(ctx, x + 1, y + 1, modern ? '#9fd0ee' : '#6b7682', 2, 2);
    }
  }
  px(ctx, 20, 35, '#3a3a3a', 8, 7); // doors
  px(ctx, 24, 35, wall, 1, 7);
  px(ctx, 18, 34, trim, 12, 1);
  if (modern) {
    // Two flags now: the principality's and the blue one with stars.
    px(ctx, 15, 2, '#3a3a3a', 1, 9);
    px(ctx, 16, 2, hex(faction.color), 6, 4);
    px(ctx, 31, 2, '#3a3a3a', 1, 9);
    px(ctx, 32, 2, '#1f3fa8', 6, 4);
    px(ctx, 34, 3, '#f2c230');
    px(ctx, 36, 4, '#f2c230');
    px(ctx, 40, 12, '#e8e8e8', 3, 2); // air conditioning
  } else {
    // One long red banner and a loudspeaker.
    px(ctx, 6, 13, '#b3221f', 36, 2);
    px(ctx, 23, 3, '#3a3a3a', 1, 8);
    px(ctx, 24, 3, '#b3221f', 6, 4);
    px(ctx, 41, 8, '#3a3a3a', 2, 2);
  }
}

function drawCurte(ctx: Ctx, faction: FactionDef, look: number): void {
  if (look >= 2) {
    drawTownHall(ctx, faction, look === 3);
    return;
  }
  // Look 1 (România Mare): the same house with a tile roof and a clock.
  const roofA = look === 1 ? '#8c3520' : '#5a3418';
  const roofB = look === 1 ? '#a8432a' : '#74441f';
  // 48×48 manor: stone footing, whitewashed walls, tall shingle roof, porch.
  const rng = new Rng(3);
  px(ctx, 4, 40, '#3c5a2a', 40, 6); // shadow on the grass
  px(ctx, 5, 24, '#e9e2cf', 38, 18); // walls
  px(ctx, 5, 38, '#8d8778', 38, 4); // stone footing
  speckle(ctx, 5, 38, rng, ['#7b7567', '#a09a8a'], 30, 38);
  // roof
  for (let row = 0; row < 18; row++) {
    const inset = Math.max(0, 9 - Math.floor(row / 2));
    px(ctx, 2 + inset, 6 + row, row % 3 === 0 ? roofA : roofB, 44 - inset * 2, 1);
  }
  px(ctx, 2, 23, '#4a2a12', 44, 2); // eaves
  // porch posts, door, windows
  for (const x of [9, 19, 28, 38]) px(ctx, x, 25, '#6b4a2a', 1, 13);
  px(ctx, 21, 29, '#4a2f1a', 6, 9);
  px(ctx, 25, 33, '#c9a227');
  for (const x of [11, 32]) {
    px(ctx, x, 29, '#3b4a5a', 5, 5);
    px(ctx, x + 2, 29, '#e9e2cf', 1, 5);
  }
  // banner in the faction colour
  px(ctx, 23, 0, '#3a2a1a', 1, 8);
  px(ctx, 24, 0, hex(faction.color), 6, 4);
  if (look === 1) {
    px(ctx, 21, 13, '#f4f1e6', 5, 5); // the town clock
    px(ctx, 23, 14, '#1b1b1b', 1, 2);
    px(ctx, 23, 15, '#1b1b1b', 2, 1);
  }
}

function drawPlumTree(ctx: Ctx, x: number, y: number, rng: Rng): void {
  px(ctx, x + 5, y + 9, '#5b3a1e', 2, 4);
  px(ctx, x + 2, y + 2, '#2f7a3a', 8, 7);
  px(ctx, x + 1, y + 4, '#2f7a3a', 10, 3);
  px(ctx, x + 3, y + 1, '#3c8f47', 6, 2);
  for (let i = 0; i < 5; i++) px(ctx, x + 2 + rng.int(8), y + 3 + rng.int(5), '#6a3fa0');
}

function drawLivada(ctx: Ctx): void {
  // 32×32 orchard: four plum trees inside a low fence. Walkable.
  const rng = new Rng(11);
  px(ctx, 0, 0, '#6aa646', 32, 32);
  speckle(ctx, 0, 0, rng, ['#5c9a3c', '#77b352'], 60, 32);
  for (let i = 0; i < 32; i += 4) {
    px(ctx, i, 0, '#7a5a34', 2, 1);
    px(ctx, i, 31, '#7a5a34', 2, 1);
    px(ctx, 0, i, '#7a5a34', 1, 2);
    px(ctx, 31, i, '#7a5a34', 1, 2);
  }
  drawPlumTree(ctx, 2, 1, rng);
  drawPlumTree(ctx, 18, 1, rng);
  drawPlumTree(ctx, 2, 17, rng);
  drawPlumTree(ctx, 18, 17, rng);
}

function drawCazan(ctx: Ctx): void {
  // 32×32 distillery: open shed, copper still, barrel, a wisp of steam.
  px(ctx, 2, 27, '#3c5a2a', 28, 4);
  px(ctx, 3, 12, '#8a6a42', 26, 16); // back wall
  for (let x = 3; x < 29; x += 4) px(ctx, x, 12, '#6f5232', 1, 16);
  for (let row = 0; row < 8; row++) {
    px(ctx, 1 + row, 4 + row, row % 2 === 0 ? '#5a3418' : '#74441f', 30 - row * 2, 1);
  }
  px(ctx, 1, 11, '#4a2a12', 30, 2);
  // copper still on its brick firebox
  px(ctx, 6, 22, '#8a3b22', 11, 6);
  px(ctx, 8, 25, '#f2a23a', 4, 3);
  px(ctx, 7, 15, '#c87533', 9, 8);
  px(ctx, 8, 14, '#e09a56', 7, 1);
  px(ctx, 9, 16, '#e9b27a', 2, 4);
  px(ctx, 16, 16, '#c87533', 6, 1); // pipe
  px(ctx, 21, 16, '#c87533', 1, 5);
  // barrel
  px(ctx, 20, 21, '#7a5a34', 7, 7);
  px(ctx, 20, 23, '#3a2a1a', 7, 1);
  px(ctx, 20, 26, '#3a2a1a', 7, 1);
  // steam
  px(ctx, 11, 1, '#e8e8e8', 2, 1);
  px(ctx, 13, 0, '#e8e8e8', 2, 1);
}

function drawTabara(ctx: Ctx, faction: FactionDef): void {
  // 32×32 army camp: a palisade, a tent, a banner and a rack of spears.
  px(ctx, 1, 4, '#8a7a55', 30, 26); // trodden ground
  const rng = new Rng(21);
  speckle(ctx, 1, 4, rng, ['#7c6d4a', '#978761'], 60, 30);
  for (let x = 0; x < 32; x += 3) {
    px(ctx, x, 2, '#6b4a2a', 2, 5); // back palisade
    px(ctx, x, 1, '#8a6238', 2, 1);
    px(ctx, x, 26, '#5a3d22', 2, 6); // front palisade
    px(ctx, x, 25, '#8a6238', 2, 1);
  }
  for (let y = 4; y < 28; y += 3) {
    px(ctx, 0, y, '#6b4a2a', 2, 2);
    px(ctx, 30, y, '#6b4a2a', 2, 2);
  }
  px(ctx, 13, 26, '#8a7a55', 6, 6); // gate
  // tent
  for (let row = 0; row < 12; row++) {
    const half = 1 + Math.floor(row * 0.75);
    px(ctx, 12 - half, 9 + row, '#e9e2cf', half, 1);
    px(ctx, 12, 9 + row, '#c9c0a8', half, 1);
  }
  px(ctx, 11, 16, '#3a2a1a', 2, 5);
  // banner
  px(ctx, 24, 5, '#3a2a1a', 1, 14);
  px(ctx, 25, 5, hex(faction.color), 5, 4);
  // spear rack
  px(ctx, 20, 19, '#5b3a1e', 8, 1);
  for (const x of [21, 23, 25]) {
    px(ctx, x, 14, '#5b3a1e', 1, 8);
    px(ctx, x, 13, '#d6d6d6');
  }
}

function drawGater(ctx: Ctx): void {
  // 32×32 sawmill: a shed, a big circular blade, a stack of logs and planks.
  px(ctx, 2, 27, '#3c5a2a', 28, 4);
  px(ctx, 3, 13, '#9a7a4e', 18, 15);
  for (let x = 3; x < 21; x += 3) px(ctx, x, 13, '#7d603a', 1, 15);
  for (let row = 0; row < 7; row++) px(ctx, 1 + row, 6 + row, row % 2 === 0 ? '#4b4a46' : '#5d5c57', 22 - row, 1);
  // blade
  px(ctx, 8, 17, '#c9c9c9', 8, 8);
  px(ctx, 9, 16, '#c9c9c9', 6, 10);
  px(ctx, 7, 18, '#c9c9c9', 10, 6);
  px(ctx, 11, 20, '#5d5c57', 2, 2);
  for (const [x, y] of [[7, 17], [16, 17], [7, 24], [16, 24], [11, 15], [11, 26]] as const) px(ctx, x, y, '#efefef');
  // logs and planks
  for (let i = 0; i < 3; i++) {
    px(ctx, 22, 20 + i * 3, '#6b4a2a', 8, 2);
    px(ctx, 22, 20 + i * 3, '#d9b77a', 1, 2);
  }
  px(ctx, 22, 14, '#d9b77a', 8, 1);
  px(ctx, 23, 16, '#d9b77a', 7, 1);
  px(ctx, 19, 3, '#5d5c57', 2, 4); // chimney
  px(ctx, 19, 0, '#bdbdbd', 2, 2);
}

function drawBloc(ctx: Ctx): void {
  // 32×32 apartment block: four floors, balconies, one satellite dish too many.
  const rng = new Rng(75);
  px(ctx, 3, 28, '#3c5a2a', 26, 3);
  px(ctx, 4, 3, '#a9a79f', 24, 26);
  px(ctx, 3, 2, '#4b4a46', 26, 2);
  for (let floor = 0; floor < 4; floor++) {
    const y = 6 + floor * 6;
    px(ctx, 4, y + 4, '#8a8881', 24, 1);
    for (let col = 0; col < 4; col++) {
      const x = 6 + col * 6;
      const lit = rng.int(3) === 0;
      px(ctx, x, y, lit ? '#f2d46a' : '#4d5560', 4, 3);
      if (rng.int(4) === 0) px(ctx, x, y + 3, '#d86a5a', 4, 1); // washing on the line
    }
  }
  px(ctx, 14, 25, '#3a3a3a', 4, 4);
  px(ctx, 25, 4, '#e8e8e8', 3, 2);
  px(ctx, 8, 0, '#e8e8e8', 3, 2);
}

// 3×5 letters for the sign on the mall.
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  M: ['101', '111', '111', '101', '101'],
  A: ['010', '101', '111', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
};

function drawMall(ctx: Ctx, faction: FactionDef): void {
  // 48×48 mall: a glass box, a loud sign, a car park.
  const rng = new Rng(2024);
  px(ctx, 2, 40, '#55585c', 44, 7); // tarmac
  for (let x = 5; x < 44; x += 6) px(ctx, x, 42, '#e8e8e8', 1, 5);
  px(ctx, 3, 8, '#dfe6ea', 42, 33);
  px(ctx, 3, 8, '#8fa2ad', 42, 2);
  for (let y = 22; y < 38; y += 5) {
    for (let x = 5; x < 43; x += 5) {
      px(ctx, x, y, rng.int(4) === 0 ? '#bfe3f5' : '#7fb6d6', 4, 4);
      px(ctx, x, y, '#c9ecfb', 1, 1);
    }
  }
  // sign
  px(ctx, 6, 11, '#1b1b1b', 36, 9);
  px(ctx, 6, 20, hex(faction.color), 36, 1);
  'MALL'.split('').forEach((letter, n) => {
    GLYPHS[letter]!.forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit === '1') px(ctx, 11 + n * 7 + x * 2, 13 + y, '#f2c230', 2, 1);
      });
    });
  });
  // doors, and somebody's car left across two places
  px(ctx, 20, 31, '#2a2f33', 8, 10);
  px(ctx, 24, 31, '#dfe6ea', 1, 10);
  px(ctx, 33, 43, '#16161a', 9, 3);
  px(ctx, 35, 42, '#16161a', 5, 1);
}

/** Image for a building; faction only matters for the banners. */
export function buildBuildingTexture(
  kind: BuildingKind,
  size: number,
  faction: FactionDef,
  look = 0,
): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(TILE * size, TILE * size);
  switch (kind) {
    case 'curte':
      drawCurte(ctx, faction, look);
      break;
    case 'livada':
      drawLivada(ctx);
      break;
    case 'cazan':
      drawCazan(ctx);
      break;
    case 'tabara':
      drawTabara(ctx, faction);
      break;
    case 'gater':
      drawGater(ctx);
      break;
    case 'bloc':
      drawBloc(ctx);
      break;
    case 'mall':
      drawMall(ctx, faction);
      break;
  }
  return canvas;
}
