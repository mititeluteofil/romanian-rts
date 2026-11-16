import type { FactionDef } from '../data/factions';
import { Terrain } from '../sim/map';
import { Rng } from '../sim/rng';

/**
 * Placeholder pixel art, drawn in code so the spike needs no asset pipeline.
 * Real sprite sheets replace these later without touching the scene code:
 * the tileset layout (TERRAIN_COUNT rows × VARIANTS columns) and the unit
 * frame names ('idle', 'walk') are the contract.
 */

export const TILE = 16;
export const VARIANTS = 4;
const TERRAIN_COUNT = 4;

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

function speckle(ctx: Ctx, ox: number, oy: number, rng: Rng, colors: string[], count: number): void {
  for (let i = 0; i < count; i++) {
    px(ctx, ox + rng.int(TILE), oy + rng.int(TILE), colors[rng.int(colors.length)]!);
  }
}

function drawGrass(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#5a9e3d', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#4f8f35', '#68ad48', '#74b852'], 22);
  if (rng.int(3) === 0) {
    // A little wildflower.
    const fx = ox + 2 + rng.int(12);
    const fy = oy + 2 + rng.int(12);
    px(ctx, fx, fy, rng.int(2) === 0 ? '#f2d94e' : '#e8e8e8');
  }
}

function drawForest(ctx: Ctx, ox: number, oy: number, rng: Rng): void {
  px(ctx, ox, oy, '#4a8a36', TILE, TILE);
  speckle(ctx, ox, oy, rng, ['#3f7a2e', '#55963f'], 14);
  const trees = 2 + rng.int(2);
  for (let i = 0; i < trees; i++) {
    const tx = ox + 1 + rng.int(9);
    const ty = oy + 1 + rng.int(6);
    // Fir tree: three stacked tiers and a trunk.
    px(ctx, tx + 2, ty, '#1f5a2a', 2, 2);
    px(ctx, tx + 1, ty + 2, '#1f5a2a', 4, 2);
    px(ctx, tx, ty + 4, '#17461f', 6, 2);
    px(ctx, tx + 2, ty + 1, '#2f7a3a');
    px(ctx, tx + 1, ty + 3, '#2f7a3a');
    px(ctx, tx + 2, ty + 6, '#5b3a1e', 2, 2);
  }
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
  // Peak: a stepped triangle with a lit side, a shaded side and a snow cap.
  for (let row = 0; row < 12; row++) {
    const half = Math.floor(row * 0.6) + 1;
    const cx = ox + 8 + lean;
    const y = oy + 2 + row;
    px(ctx, cx - half, y, '#9a9a94', half, 1);
    px(ctx, cx, y, '#6e6e6a', half, 1);
    if (row < 3) px(ctx, cx - half, y, '#f1f1ee', half * 2, 1);
  }
}

/** Tileset image: one row per terrain, VARIANTS columns to break repetition. */
export function buildTileset(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(TILE * VARIANTS, TILE * TERRAIN_COUNT);
  const painters: Record<Terrain, (c: Ctx, x: number, y: number, r: Rng) => void> = {
    [Terrain.Grass]: drawGrass,
    [Terrain.Forest]: drawForest,
    [Terrain.Water]: drawWater,
    [Terrain.Mountain]: drawMountain,
  };
  const rng = new Rng(1600);
  for (const terrain of [Terrain.Grass, Terrain.Forest, Terrain.Water, Terrain.Mountain] as const) {
    for (let v = 0; v < VARIANTS; v++) painters[terrain](ctx, v * TILE, terrain * TILE, rng);
  }
  return canvas;
}

/** Index of a tile image inside the tileset. */
export function tileIndex(terrain: Terrain, variant: number): number {
  return terrain * VARIANTS + (variant % VARIANTS);
}

// 16×16 peasant. h hat, s skin, e eye, m moustache, w shirt, f faction belt,
// p trousers, b opinci. '.' is transparent.
const PEASANT_BODY = [
  '................',
  '......hhhh......',
  '.....hhhhhh.....',
  '...hhhhhhhhhh...',
  '.....ssssss.....',
  '.....sesses.....',
  '.....smmmms.....',
  '......ssss......',
  '....wwwwwwww....',
  '...swwwwwwwws...',
  '...swwwwwwwws...',
  '....ffffffff....',
  '....pppppppp....',
];
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

/** Two-frame peasant sheet for a faction: 'idle' at x=0, 'walk' at x=16. */
export function buildPeasantSheet(faction: FactionDef): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(TILE * 2, TILE);
  const palette: Record<string, string> = {
    h: hex(faction.hatColor),
    s: '#e8b88a',
    e: '#1b1b1b',
    m: '#4a2f1a',
    w: '#f4f1e6',
    f: hex(faction.color),
    p: '#e2ddcc',
    b: '#4a2f1a',
  };
  drawSprite(ctx, 0, [...PEASANT_BODY, ...LEGS_IDLE], palette);
  drawSprite(ctx, TILE, [...PEASANT_BODY, ...LEGS_WALK], palette);
  return canvas;
}
