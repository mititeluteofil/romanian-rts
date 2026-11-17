import { BUILDINGS } from '../data/buildings';
import { FACTIONS } from '../data/factions';
import { Region } from '../data/romania';
import { Terrain, type GameMap } from '../sim/map';
import { SUB, type World } from '../sim/world';

type Rgb = readonly [number, number, number];

/** Meadow colour per principality, so the regions read at a glance. */
const REGION_GRASS: Readonly<Record<Region, Rgb>> = {
  [Region.None]: [63, 61, 51],
  [Region.Ardeal]: [102, 168, 79],
  [Region.Moldova]: [201, 176, 86],
  [Region.TaraRomaneasca]: [150, 186, 78],
  [Region.Dobrogea]: [222, 196, 132],
};

const TERRAIN_RGB: Readonly<Record<Terrain, Rgb>> = {
  [Terrain.Grass]: [102, 168, 79],
  [Terrain.Forest]: [40, 100, 52],
  [Terrain.Water]: [47, 111, 176],
  [Terrain.Mountain]: [168, 168, 160],
  [Terrain.Abroad]: [52, 50, 42],
  [Terrain.Ford]: [140, 190, 230],
};

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * Whole-country overview: one pixel per tile. Tap or drag on it to move the
 * camera. This is also where the shape of Romania is plain to see.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: ImageData;
  private readonly map: GameMap;
  private readonly ac = new AbortController();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly world: World,
    onJump: (tileX: number, tileY: number) => void,
  ) {
    this.map = world.map;
    canvas.width = this.map.width;
    canvas.height = this.map.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.base = ctx.createImageData(this.map.width, this.map.height);
    this.refreshBase();

    const jump = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      onJump(
        ((event.clientX - rect.left) / rect.width) * this.map.width,
        ((event.clientY - rect.top) / rect.height) * this.map.height,
      );
    };
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        canvas.setPointerCapture(event.pointerId);
        jump(event);
      },
      { signal: this.ac.signal },
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (canvas.hasPointerCapture(event.pointerId)) jump(event);
      },
      { signal: this.ac.signal },
    );
  }

  destroy(): void {
    this.ac.abort();
  }

  /** Rebuild the terrain layer; call when tiles change (a forest is cut down). */
  refreshBase(): void {
    const { tiles, regions } = this.map;
    const data = this.base.data;
    for (let i = 0; i < tiles.length; i++) {
      const terrain = tiles[i] as Terrain;
      const rgb = terrain === Terrain.Grass ? REGION_GRASS[regions[i] as Region] : TERRAIN_RGB[terrain];
      data[i * 4] = rgb[0];
      data[i * 4 + 1] = rgb[1];
      data[i * 4 + 2] = rgb[2];
      data[i * 4 + 3] = 255;
    }
  }

  /** Draw terrain, buildings, units and the camera frame (in tile units). */
  render(view: { x: number; y: number; width: number; height: number }): void {
    const ctx = this.ctx;
    ctx.putImageData(this.base, 0, 0);
    for (const b of this.world.buildings) {
      const size = BUILDINGS[b.kind].size;
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(b.tx - 1, b.ty - 1, size + 2, size + 2);
      ctx.fillStyle = hexColor(FACTIONS[b.faction].color);
      ctx.fillRect(b.tx, b.ty, size, size);
    }
    for (const u of this.world.units) {
      const x = Math.floor(u.x / SUB);
      const y = Math.floor(u.y / SUB);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(x - 2, y - 2, 5, 5);
      ctx.fillStyle = hexColor(FACTIONS[u.faction].color);
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.strokeStyle = '#fff176';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.floor(view.x) + 0.5,
      Math.floor(view.y) + 0.5,
      Math.max(2, Math.floor(view.width)),
      Math.max(2, Math.floor(view.height)),
    );
  }
}
