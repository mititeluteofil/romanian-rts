import Phaser from 'phaser';
import { FACTIONS, type FactionId } from '../data/factions';
import { CameraControls } from '../input/CameraControls';
import { spawnPoint } from '../sim/map';
import { hash2 } from '../sim/rng';
import { SUB, TICK_MS, World, type Unit } from '../sim/world';
import { Hud } from '../ui/hud';
import { buildPeasantSheet, buildTileset, TILE, tileIndex } from './textures';

const SUB_TO_PX = TILE / SUB;
const MARKER_MS = 700;
/** Never simulate more than this much catch-up after a pause (tab hidden). */
const MAX_FRAME_MS = 250;

interface MoveMarker {
  readonly x: number;
  readonly y: number;
  readonly bornAt: number;
}

function pick<T>(items: readonly T[]): T {
  // Presentation only — the simulation never uses Math.random().
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Draws the world and turns taps into simulation commands. */
export class GameScene extends Phaser.Scene {
  private world!: World;
  private controls!: CameraControls;
  private hud!: Hud;
  private overlay!: Phaser.GameObjects.Graphics;
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly selected = new Set<number>();
  private markers: MoveMarker[] = [];
  private accumulator = 0;

  constructor() {
    super('game');
  }

  create(): void {
    this.world = new World({ seed: 1600 });
    this.hud = new Hud();
    const map = this.world.map;

    // Terrain
    this.textures.addCanvas('tiles', buildTileset());
    const data: number[][] = [];
    for (let y = 0; y < map.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < map.width; x++) {
        row.push(tileIndex(map.terrainAt(x, y), hash2(7, x, y)));
      }
      data.push(row);
    }
    const tilemap = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tileset = tilemap.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
    if (!tileset) throw new Error('Tileset failed to load');
    tilemap.createLayer(0, tileset, 0, 0)?.setDepth(0);

    // Units
    for (const faction of Object.values(FACTIONS)) {
      const texture = this.textures.addCanvas(`peasant-${faction.id}`, buildPeasantSheet(faction));
      texture?.add('idle', 0, 0, 0, TILE, TILE);
      texture?.add('walk', 0, TILE, 0, TILE, TILE);
    }
    for (const unit of this.world.units) {
      const sprite = this.add.image(0, 0, `peasant-${unit.faction}`, 'idle').setOrigin(0.5, 0.75);
      this.sprites.set(unit.id, sprite);
    }
    this.overlay = this.add.graphics().setDepth(5);

    // Camera
    this.controls = new CameraControls(this, map.width * TILE, map.height * TILE, (x, y) =>
      this.handleTap(x, y),
    );
    this.frameSpawn();
    // Until the player takes over the camera, re-frame when the window settles
    // on its real size (WebViews often report a tiny size for the first frame).
    this.scale.on('resize', () => {
      if (!this.controls.touched) this.frameSpawn();
    });

    this.refreshSelectionText();
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__unirea = {
        world: this.world,
        controls: this.controls,
        scene: this,
      };
    }
  }

  /** Opening shot: the spawn meadow, at a zoom that suits the screen. */
  private frameSpawn(): void {
    const shortSide = Math.min(this.scale.width, this.scale.height);
    this.controls.setZoom(Phaser.Math.Clamp(Math.round(shortSide / (TILE * 9)), 2, 4));
    const spawn = spawnPoint(this.world.map);
    this.controls.centerOn((spawn.x + 0.5) * TILE, (spawn.y + 0.5) * TILE);
  }

  override update(time: number, delta: number): void {
    this.controls.update(delta);

    // Fixed-step simulation, decoupled from the display's frame rate.
    this.accumulator += Math.min(delta, MAX_FRAME_MS);
    while (this.accumulator >= TICK_MS) {
      this.world.step();
      this.accumulator -= TICK_MS;
    }
    const alpha = this.accumulator / TICK_MS;

    this.overlay.clear();
    this.drawMarkers(time);
    for (const unit of this.world.units) this.drawUnit(unit, alpha, time);

    this.hud.updateBubbles(time, (id) => {
      const sprite = this.sprites.get(id);
      return sprite ? this.controls.worldToScreen(sprite.x, sprite.y - TILE * 0.8) : undefined;
    });
    this.hud.setDebug(`tick ${this.world.tick} · ${this.world.checksum().toString(16)}`);
  }

  private drawUnit(unit: Unit, alpha: number, time: number): void {
    const sprite = this.sprites.get(unit.id);
    if (!sprite) return;
    const x = (unit.prevX + (unit.x - unit.prevX) * alpha) * SUB_TO_PX;
    const y = (unit.prevY + (unit.y - unit.prevY) * alpha) * SUB_TO_PX;
    sprite.setPosition(x, y);
    sprite.setDepth(10 + y / 100000);
    sprite.setFlipX(unit.facing === -1);
    const stepping = this.world.isMoving(unit) && Math.floor(time / 160) % 2 === 0;
    sprite.setFrame(stepping ? 'walk' : 'idle');

    if (this.selected.has(unit.id)) {
      this.overlay.lineStyle(1, 0xfff176, 1);
      this.overlay.strokeEllipse(x, y + 3, 15, 7);
    }
  }

  private drawMarkers(time: number): void {
    this.markers = this.markers.filter((m) => time - m.bornAt < MARKER_MS);
    for (const marker of this.markers) {
      const t = (time - marker.bornAt) / MARKER_MS;
      this.overlay.lineStyle(1, 0xfff176, 1 - t);
      this.overlay.strokeEllipse(marker.x, marker.y, 4 + t * 12, 2 + t * 6);
    }
  }

  private handleTap(worldX: number, worldY: number): void {
    const now = this.time.now;
    const unit = this.unitNear(worldX, worldY);
    if (unit) {
      const tappedAgain = this.selected.size === 1 && this.selected.has(unit.id);
      this.selected.clear();
      if (tappedAgain) {
        // Second tap on the same peasant: select everyone from his faction.
        for (const u of this.world.units) if (u.faction === unit.faction) this.selected.add(u.id);
      } else {
        this.selected.add(unit.id);
      }
      this.hud.say(unit.id, pick(FACTIONS[unit.faction].lines.select), now);
      this.refreshSelectionText();
      return;
    }

    if (this.selected.size === 0) return;
    const tx = Math.floor(worldX / TILE);
    const ty = Math.floor(worldY / TILE);
    if (!this.world.map.inBounds(tx, ty)) return;
    const unitIds = [...this.selected];
    this.world.issue({ type: 'move', unitIds, tx, ty });
    this.markers.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, bornAt: now });
    const speaker = this.world.getUnit(unitIds[0]!);
    if (speaker) this.hud.say(speaker.id, pick(FACTIONS[speaker.faction].lines.move), now);
    this.hud.hideHint();
  }

  /** The unit under a tap, with a finger-sized tolerance. */
  private unitNear(worldX: number, worldY: number): Unit | undefined {
    const radius = Math.max(9, 26 / this.controls.zoom);
    let best: Unit | undefined;
    let bestDistance = radius;
    for (const unit of this.world.units) {
      const sprite = this.sprites.get(unit.id);
      if (!sprite) continue;
      const distance = Math.hypot(sprite.x - worldX, sprite.y - TILE * 0.25 - worldY);
      if (distance < bestDistance) {
        best = unit;
        bestDistance = distance;
      }
    }
    return best;
  }

  private refreshSelectionText(): void {
    const counts = new Map<FactionId, number>();
    for (const id of this.selected) {
      const unit = this.world.getUnit(id);
      if (unit) counts.set(unit.faction, (counts.get(unit.faction) ?? 0) + 1);
    }
    if (counts.size === 0) {
      this.hud.setSelection('Niciun țăran ales');
      return;
    }
    const parts = [...counts].map(
      ([faction, n]) => `${FACTIONS[faction].name}: ${n} ${n === 1 ? 'țăran' : 'țărani'}`,
    );
    this.hud.setSelection(parts.join(' · '));
  }
}
