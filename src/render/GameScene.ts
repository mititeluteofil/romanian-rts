import Phaser from 'phaser';
import { AI_THINK_EVERY, SkirmishAi } from '../ai/skirmish';
import { BUILD_MENU, BUILDINGS, ORCHARD_CAPACITY, type BuildingKind } from '../data/buildings';
import { BRIBE_ERA, COURT_NAMES, ERAS, LAST_ERA } from '../data/eras';
import {
  enemyOf,
  FACTIONS,
  SMECHER_LINES,
  type FactionId,
  type LineKind,
  type UnitKind,
} from '../data/factions';
import { REGION_NAMES } from '../data/romania';
import { CameraControls } from '../input/CameraControls';
import { nearestTile } from '../sim/pathfinding';
import { hash2 } from '../sim/rng';
import {
  BRIBE_PRUNE,
  FUNDS_AMOUNT,
  SUB,
  TICK_MS,
  TICK_RATE,
  World,
  type Building,
  type SimEvent,
  type Unit,
} from '../sim/world';
import { Hud, type ActionButton } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import {
  buildBuildingTexture,
  buildTileset,
  buildUnitSheet,
  COURT_LOOK_COUNT,
  COURT_LOOKS,
  TILE,
  tileIndex,
  UNIT_FRAMES,
} from './textures';

const SUB_TO_PX = TILE / SUB;
const MARKER_MS = 700;
const SPARK_MS = 160;
/** Never simulate more than this much catch-up after a pause (tab hidden). */
const MAX_FRAME_MS = 250;
const CARRY_COLORS = { lemn: 0x8a5a2b, prune: 0x6a3fa0 } as const;
const OWN_HP = 0x7ee081;
const ENEMY_HP = 0xe05a4a;
const UNIT_KINDS: readonly UnitKind[] = ['taran', 'ostas', 'smecher'];

export interface GameOptions {
  /** The faction the person at this device plays; the AI takes the other. */
  readonly player: FactionId;
  /** Quiet neighbour: no war, the goal is to reach the present and open a mall. */
  readonly peaceful: boolean;
}

interface Mark {
  readonly x: number;
  readonly y: number;
  readonly bornAt: number;
}

interface Placement {
  readonly kind: BuildingKind;
  tx: number;
  ty: number;
}

function pick<T>(items: readonly T[]): T {
  // Presentation only — the simulation never uses Math.random().
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Draws the world and turns taps and button presses into simulation commands. */
export class GameScene extends Phaser.Scene {
  private readonly player: FactionId;
  private readonly enemy: FactionId;
  private readonly peaceful: boolean;
  /** Whether pălincă is of any use to the player's faction. */
  private readonly drinks: boolean;
  private world!: World;
  private ai!: SkirmishAi;
  private controls!: CameraControls;
  private hud!: Hud;
  private minimap!: Minimap;
  private layer!: Phaser.Tilemaps.TilemapLayer;
  /** Ground-level drawings: selection rings, move markers. */
  private ground!: Phaser.GameObjects.Graphics;
  /** Drawings above everything: bars, loads, sparks, the placement ghost. */
  private top!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Image;
  private readonly unitSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly buildingSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly selectedUnits = new Set<number>();
  private selectedBuilding: number | null = null;
  private placing: Placement | null = null;
  /** Whether the action bar is showing the list of things to build. */
  private buildMenuOpen = false;
  /** Peaceful mode: the mall has been opened and celebrated. */
  private goalReached = false;
  private markers: Mark[] = [];
  private sparks: Mark[] = [];
  private accumulator = 0;
  private frame = 0;

  constructor(options: GameOptions) {
    super('game');
    this.player = options.player;
    this.enemy = enemyOf(options.player);
    this.peaceful = options.peaceful;
    this.drinks = FACTIONS[options.player].ability.id === 'palinca';
  }

  create(): void {
    this.world = new World({ seed: 1600 });
    this.ai = new SkirmishAi(this.enemy, { attacks: !this.peaceful });
    this.hud = new Hud((id) => this.handleAction(id));
    const map = this.world.map;

    // Terrain
    this.textures.addCanvas('tiles', buildTileset());
    const data: number[][] = [];
    for (let y = 0; y < map.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < map.width; x++) row.push(tileIndex(map.terrainAt(x, y), hash2(7, x, y)));
      data.push(row);
    }
    const tilemap = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tileset = tilemap.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
    if (!tileset) throw new Error('Tileset failed to load');
    this.layer = tilemap.createLayer(0, tileset, 0, 0, false) as Phaser.Tilemaps.TilemapLayer;
    this.layer.setDepth(0);

    // Unit and building art, per faction
    for (const faction of Object.values(FACTIONS)) {
      for (const kind of UNIT_KINDS) {
        const sheet = this.textures.addCanvas(`${kind}-${faction.id}`, buildUnitSheet(faction, kind));
        UNIT_FRAMES.forEach((name, i) => sheet?.add(name, 0, i * TILE, 0, TILE, TILE));
      }
      for (const def of Object.values(BUILDINGS)) {
        if (def.kind === 'curte') continue;
        this.textures.addCanvas(`${def.kind}-${faction.id}`, buildBuildingTexture(def.kind, def.size, faction));
      }
      // The court changes its face with the times.
      for (let look = 0; look < COURT_LOOK_COUNT; look++) {
        const canvas = buildBuildingTexture('curte', BUILDINGS.curte.size, faction, look);
        this.textures.addCanvas(`curte-${faction.id}-${look}`, canvas);
      }
    }
    this.ground = this.add.graphics().setDepth(5);
    this.top = this.add.graphics().setDepth(100);
    this.ghost = this.add.image(0, 0, `livada-${this.player}`).setOrigin(0, 0).setDepth(99).setVisible(false);

    // Camera and minimap
    this.controls = new CameraControls(this, map.width * TILE, map.height * TILE, (x, y) =>
      this.handleTap(x, y),
    );
    this.frameStart();
    // Until the player takes over the camera, re-frame when the window settles
    // on its real size (WebViews often report a tiny size for the first frame).
    this.scale.on('resize', () => {
      if (!this.controls.touched) this.frameStart();
    });
    this.minimap = new Minimap(this.hud.minimapCanvas, this.world, (tx, ty) =>
      this.controls.jumpTo(tx * TILE, ty * TILE),
    );

    this.hud.toast('Atinge un țăran, apoi o pădure, ca să taie lemne.', this.time.now);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__unirea = {
        world: this.world,
        controls: this.controls,
        scene: this,
      };
    }
  }

  /** Opening shot: the player's court, at a zoom that suits the screen. */
  private frameStart(): void {
    const shortSide = Math.min(this.scale.width, this.scale.height);
    this.controls.setZoom(Phaser.Math.Clamp(Math.round(shortSide / (TILE * 8)), 2, 4));
    const court = this.world.courtOf(this.player);
    if (!court) return;
    const half = (BUILDINGS.curte.size * TILE) / 2;
    this.controls.centerOn(court.tx * TILE + half, court.ty * TILE + half + TILE);
  }

  // --- Frame loop ---------------------------------------------------------------

  override update(time: number, delta: number): void {
    this.controls.update(delta);

    // Fixed-step simulation, decoupled from the display's frame rate.
    this.accumulator += Math.min(delta, MAX_FRAME_MS);
    while (this.accumulator >= TICK_MS) {
      this.world.step();
      if (this.world.tick % AI_THINK_EVERY === 0) this.ai.think(this.world);
      this.accumulator -= TICK_MS;
    }
    const alpha = this.accumulator / TICK_MS;
    for (const event of this.world.drainEvents()) this.handleEvent(event, time);

    this.ground.clear();
    this.top.clear();
    this.drawMarkers(time);
    for (const building of this.world.buildings) this.drawBuilding(building);
    for (const unit of this.world.units) this.drawUnit(unit, alpha, time);
    this.drawSparks(time);
    this.drawPlacement();

    this.refreshHud(time);
    if (this.frame++ % 4 === 0) {
      const view = this.controls.viewRect();
      this.minimap.render({
        x: view.x / TILE,
        y: view.y / TILE,
        width: view.width / TILE,
        height: view.height / TILE,
      });
    }
  }

  private handleEvent(event: SimEvent, time: number): void {
    switch (event.type) {
      case 'tile': {
        const w = this.world.map.width;
        const tx = event.index % w;
        const ty = (event.index - tx) / w;
        this.layer.putTileAt(tileIndex(this.world.map.terrainAt(tx, ty), hash2(7, tx, ty)), tx, ty);
        this.minimap.refreshBase();
        break;
      }
      case 'built': {
        const building = this.world.getBuilding(event.buildingId);
        if (building?.faction === this.player) {
          const line = this.player === 'ardeal' ? 'No, vezi că s-o făcut.' : 'Gata-i, wăi!';
          this.hud.say(`b${event.buildingId}`, line, time);
        }
        break;
      }
      case 'distilled':
        if (this.world.getBuilding(event.buildingId)?.faction === this.player) {
          this.hud.say(`b${event.buildingId}`, '+1 pălincă', time);
        }
        break;
      case 'trained': {
        const unit = this.world.getUnit(event.unitId);
        if (unit?.faction === this.player) this.speak(unit, 'select', time);
        break;
      }
      case 'full':
        this.speak(this.world.getUnit(event.unitId), 'full', time);
        break;
      case 'ability':
        if (event.ability === 'taunt') {
          this.speak(this.world.getUnit(event.unitId), 'taunt', time);
        } else {
          // Everybody with a glass in hand says something, friend or foe.
          for (const unit of this.world.units.filter((u) => u.drink > 0).slice(0, 8)) {
            this.speak(unit, 'drink', time);
          }
        }
        break;
      case 'era': {
        const era = ERAS[event.era]!;
        if (event.faction === this.player) this.hud.toast(era.announcement, time, 9000);
        else this.hud.toast(`${FACTIONS[event.faction].name} a trecut în ${era.name}.`, time, 4000);
        break;
      }
      case 'bribe':
        if (event.faction === this.player) {
          const line = event.worked ? 'S-o rezolvat.' : 'O luat prunele și n-o făcut nimic.';
          this.hud.say(`b${event.buildingId}`, line, time);
        }
        break;
      case 'funds':
        if (event.faction === this.player) {
          this.hud.toast(`Au intrat fondurile europene: +${FUNDS_AMOUNT} lemn, +${FUNDS_AMOUNT} prune.`, time, 4000);
        }
        break;
      case 'scandal':
        this.speak(this.world.getUnit(event.unitId), 'scandal', time);
        for (const id of event.onlookers.slice(0, 3)) this.speak(this.world.getUnit(id), 'scandal', time);
        break;
      case 'hit':
        this.sparks.push({ x: event.x * SUB_TO_PX, y: event.y * SUB_TO_PX - 4, bornAt: time });
        break;
      case 'died': {
        this.unitSprites.get(event.unitId)?.destroy();
        this.unitSprites.delete(event.unitId);
        this.selectedUnits.delete(event.unitId);
        const px = Math.round(event.x * SUB_TO_PX);
        const py = Math.round(event.y * SUB_TO_PX);
        this.hud.say(`p${px},${py}`, pick(FACTIONS[event.faction].lines.die), time);
        break;
      }
      case 'destroyed':
        this.buildingSprites.get(event.buildingId)?.destroy();
        this.buildingSprites.delete(event.buildingId);
        if (this.selectedBuilding === event.buildingId) this.selectedBuilding = null;
        break;
      case 'won':
        this.placing = null;
        this.selectedUnits.clear();
        this.selectedBuilding = null;
        this.hud.toast(this.endLine(event.faction === this.player), time);
        break;
    }
  }

  private endLine(won: boolean): string {
    if (this.player === 'ardeal') {
      return won
        ? 'No, vezi că s-o putut. Curtea Moldovei îi jos. Amu’ putem sta.'
        : 'No, asta-i: ne-or luat curtea. Om face alta, da’ mai încet.';
    }
    return won
      ? 'Și mai vrei, wăi? Nimica nu mai vrei! Curtea Ardealului îi a noastră.'
      : 'Of, wăi… ne-o luat curtea ardelenii. Și nici nu s-or grăbit.';
  }

  private speak(unit: Unit | undefined, kind: LineKind, time: number): void {
    if (!unit) return;
    // The mall crowd has its own way of talking, wherever it was raised.
    const lines = unit.kind === 'smecher' ? SMECHER_LINES : FACTIONS[unit.faction].lines;
    this.hud.say(`u${unit.id}`, pick(lines[kind]), time);
  }

  // --- Drawing ------------------------------------------------------------------

  private drawBar(x: number, y: number, width: number, fraction: number, color: number): void {
    this.top.fillStyle(0x1b1b1b, 1);
    this.top.fillRect(x, y, width, 3);
    this.top.fillStyle(color, 1);
    this.top.fillRect(x + 1, y + 1, Math.max(0, Math.round((width - 2) * fraction)), 1);
  }

  private drawUnit(unit: Unit, alpha: number, time: number): void {
    let sprite = this.unitSprites.get(unit.id);
    if (!sprite) {
      sprite = this.add.image(0, 0, `${unit.kind}-${unit.faction}`, 'idle').setOrigin(0.5, 0.75);
      this.unitSprites.set(unit.id, sprite);
    }
    const x = (unit.prevX + (unit.x - unit.prevX) * alpha) * SUB_TO_PX;
    const y = (unit.prevY + (unit.y - unit.prevY) * alpha) * SUB_TO_PX;
    sprite.setPosition(x, y);
    sprite.setDepth(10 + y / 100000);
    sprite.setFlipX(unit.facing === -1);

    let frame: (typeof UNIT_FRAMES)[number] = 'idle';
    if (unit.drink > 0) frame = 'work';
    else if (unit.stun > 0) frame = 'idle';
    else if (this.world.isWorking(unit)) frame = Math.floor(time / 260) % 2 === 0 ? 'work' : 'idle';
    else if (this.world.isMoving(unit) && Math.floor(time / 160) % 2 === 0) frame = 'walk';
    sprite.setFrame(frame);

    const selected = this.selectedUnits.has(unit.id);
    if (selected) {
      this.ground.lineStyle(1, 0xfff176, 1);
      this.ground.strokeEllipse(x, y + 3, 15, 7);
    }
    if (unit.shield > 0) {
      // The taunter, braced for what is coming.
      this.ground.lineStyle(1, 0xffffff, 0.9);
      this.ground.strokeEllipse(x, y + 3, 19, 9);
    }
    if (selected || unit.hp < unit.maxHp) {
      this.drawBar(x - 6, y - 15, 12, unit.hp / unit.maxHp, unit.faction === this.player ? OWN_HP : ENEMY_HP);
    }
    if (unit.stun > 0 && unit.drink === 0) {
      // "!" over the head of anyone watching a scandal.
      this.top.fillStyle(0x1b1b1b, 1);
      this.top.fillRect(x - 1, y - 22, 3, 7);
      this.top.fillStyle(0xfff176, 1);
      this.top.fillRect(x, y - 21, 1, 3);
      this.top.fillRect(x, y - 17, 1, 1);
    }
    if (unit.carryAmount > 0) {
      // The load on his back.
      this.top.fillStyle(0x1b1b1b, 1);
      this.top.fillRect(x - unit.facing * 6 - 2, y - 7, 5, 5);
      this.top.fillStyle(CARRY_COLORS[unit.carryKind], 1);
      this.top.fillRect(x - unit.facing * 6 - 1, y - 6, 3, 3);
    }
  }

  private buildingTexture(building: Building): string {
    if (building.kind !== 'curte') return `${building.kind}-${building.faction}`;
    return `curte-${building.faction}-${COURT_LOOKS[this.world.era[building.faction]] ?? 0}`;
  }

  private drawBuilding(building: Building): void {
    const def = BUILDINGS[building.kind];
    const x = building.tx * TILE;
    const y = building.ty * TILE;
    const side = def.size * TILE;
    const texture = this.buildingTexture(building);
    let sprite = this.buildingSprites.get(building.id);
    if (!sprite) {
      sprite = this.add.image(x, y, texture).setOrigin(0, 0);
      // Walkable buildings lie on the ground; the rest sort against units by their base line.
      sprite.setDepth(def.blocks ? 10 + (y + side - 6) / 100000 : 1);
      this.buildingSprites.set(building.id, sprite);
    } else if (sprite.texture.key !== texture) {
      sprite.setTexture(texture);
    }
    sprite.setAlpha(building.done ? 1 : 0.45);

    const selected = this.selectedBuilding === building.id;
    if (!building.done) {
      const total = Math.floor((def.buildTicks * FACTIONS[building.faction].buildTimePercent) / 100);
      this.drawBar(x + 2, y - 5, side - 4, total > 0 ? 1 - building.buildLeft / total : 1, 0xfff176);
    }
    if (selected || building.hp < building.maxHp) {
      const color = building.faction === this.player ? OWN_HP : ENEMY_HP;
      this.drawBar(x + 2, y - 9, side - 4, building.hp / building.maxHp, color);
    }
    if (selected) {
      this.top.lineStyle(1, 0xfff176, 1);
      this.top.strokeRect(x - 1, y - 1, side + 2, side + 2);
    }
  }

  private drawMarkers(time: number): void {
    this.markers = this.markers.filter((m) => time - m.bornAt < MARKER_MS);
    for (const marker of this.markers) {
      const t = (time - marker.bornAt) / MARKER_MS;
      this.ground.lineStyle(1, 0xfff176, 1 - t);
      this.ground.strokeEllipse(marker.x, marker.y, 4 + t * 12, 2 + t * 6);
    }
  }

  private drawSparks(time: number): void {
    this.sparks = this.sparks.filter((s) => time - s.bornAt < SPARK_MS);
    this.top.fillStyle(0xffffff, 1);
    for (const spark of this.sparks) {
      const r = 1 + Math.floor(((time - spark.bornAt) / SPARK_MS) * 3);
      this.top.fillRect(spark.x - r, spark.y, r * 2 + 1, 1);
      this.top.fillRect(spark.x, spark.y - r, 1, r * 2 + 1);
    }
  }

  private drawPlacement(): void {
    const placing = this.placing;
    this.ghost.setVisible(placing !== null);
    if (!placing) return;
    const side = BUILDINGS[placing.kind].size * TILE;
    const ok = this.world.canPlace(placing.kind, placing.tx, placing.ty);
    this.ghost.setTexture(`${placing.kind}-${this.player}`);
    this.ghost.setPosition(placing.tx * TILE, placing.ty * TILE);
    this.ghost.setAlpha(0.7);
    this.top.fillStyle(ok ? OWN_HP : ENEMY_HP, 0.35);
    this.top.fillRect(placing.tx * TILE, placing.ty * TILE, side, side);
    this.top.lineStyle(1, ok ? OWN_HP : ENEMY_HP, 1);
    this.top.strokeRect(placing.tx * TILE, placing.ty * TILE, side, side);
  }

  // --- HUD ----------------------------------------------------------------------

  private refreshHud(time: number): void {
    const world = this.world;
    const player = this.player;
    const stock = world.stock[player];
    const view = this.controls.viewRect();
    const region = world.map.regionAt(
      Math.floor((view.x + view.width / 2) / TILE),
      Math.floor((view.y + view.height / 2) / TILE),
    );
    const era = ERAS[world.era[player]]!;
    this.hud.setTitle(`${REGION_NAMES[region]} · ${era.name}, ${era.year}`);
    this.hud.setStock(
      `Lemn ${stock.lemn} · Prune ${stock.prune} · ` +
        (this.drinks ? `Pălincă ${stock.palinca} · ` : '') +
        `Țărani ${world.unitCount(player, 'taran')} · Oșteni ${world.fighterCount(player)} ` +
        `(loc: ${world.unitCap(player)})`,
    );
    this.hud.setObjective(this.objectiveText(time));
    this.hud.setSelection(this.selectionText());
    this.hud.setActions(this.actionButtons());
    this.hud.setDebug(`tick ${world.tick} · ${world.checksum().toString(16)}`);
    this.hud.update(time, (key) => this.bubbleAnchor(key));
  }

  private objectiveText(time: number): string {
    const world = this.world;
    if (world.winner !== null) return world.winner === this.player ? 'Ai câștigat.' : 'Ai pierdut.';
    if (this.peaceful) {
      const hasMall = world.buildings.some((b) => b.faction === this.player && b.kind === 'mall' && b.done);
      if (hasMall && !this.goalReached) {
        this.goalReached = true;
        const line =
          this.player === 'ardeal'
            ? 'No, amu’ avem și mall. O ținut patru sute de ani, da’ nu ne-am grăbit.'
            : 'Avem mall, wăi! De la Ștefan încoace n-o fost așa ceva.';
        this.hud.toast(line, time, 10000);
      }
      return hasMall ? 'Țel atins: ai ajuns în prezent și ai mall.' : 'Țel: ajungi în Prezent și faci un mall.';
    }
    const mine = world.courtOf(this.player);
    const theirs = world.courtOf(this.enemy);
    const hp = (b: Building | undefined) => (b ? `${b.hp}/${b.maxHp}` : '—');
    return `Țel: dărâmă curtea din ${FACTIONS[this.enemy].name}. A ta ${hp(mine)} · a lor ${hp(theirs)}`;
  }

  private bubbleAnchor(key: string): { x: number; y: number } | undefined {
    if (key.startsWith('p')) {
      // A fixed spot on the map (someone's last words).
      const [x, y] = key.slice(1).split(',').map(Number);
      return this.controls.worldToScreen(x ?? 0, (y ?? 0) - TILE * 0.8);
    }
    const id = Number(key.slice(1));
    if (key.startsWith('u')) {
      const sprite = this.unitSprites.get(id);
      return sprite ? this.controls.worldToScreen(sprite.x, sprite.y - TILE * 0.8) : undefined;
    }
    const building = this.world.getBuilding(id);
    if (!building) return undefined;
    const side = BUILDINGS[building.kind].size * TILE;
    return this.controls.worldToScreen(building.tx * TILE + side / 2, building.ty * TILE);
  }

  private selected(): Unit[] {
    return this.world.units.filter((u) => this.selectedUnits.has(u.id));
  }

  private buildingName(building: Building): string {
    if (building.kind !== 'curte') return BUILDINGS[building.kind].name;
    return COURT_NAMES[this.world.era[building.faction]] ?? BUILDINGS.curte.name;
  }

  private selectionText(): string {
    const world = this.world;
    if (this.placing) {
      const def = BUILDINGS[this.placing.kind];
      const ok = world.canPlace(this.placing.kind, this.placing.tx, this.placing.ty);
      return ok ? `${def.name}: aici se poate.` : `${def.name}: aici nu se poate, atinge alt loc.`;
    }
    const units = this.selected();
    if (units.length === 1) {
      const unit = units[0]!;
      return `${FACTIONS[unit.faction].units[unit.kind].name} — viață ${unit.hp}/${unit.maxHp}`;
    }
    if (units.length > 1) {
      const peasants = units.filter((u) => u.kind === 'taran').length;
      const fighters = units.length - peasants;
      const parts: string[] = [];
      if (peasants > 0) parts.push(peasants === 1 ? '1 țăran' : `${peasants} țărani`);
      if (fighters > 0) parts.push(fighters === 1 ? '1 oștean' : `${fighters} oșteni`);
      return `${parts.join(', ')} aleși`;
    }
    const building = this.selectedBuilding === null ? undefined : world.getBuilding(this.selectedBuilding);
    if (!building) return 'Nimic ales';
    const whose = building.faction === this.player ? '' : ` (${FACTIONS[building.faction].name})`;
    const title = `${this.buildingName(building)}${whose} — ${building.hp}/${building.maxHp}`;
    if (building.faction !== this.player) return title;
    if (!building.done) return `${title} — se face`;
    if (building.advanceLeft > 0) {
      return `${title} — se schimbă vremurile (${Math.ceil(building.advanceLeft / TICK_RATE)} s)`;
    }
    if (building.queue.length > 0) return `${title} — ${building.queue.length} la rând`;
    if (building.kind === 'livada') {
      return `${title} — ${world.orchardWorkers(building.id)}/${ORCHARD_CAPACITY} la cules`;
    }
    if (building.kind === 'cazan') {
      return building.distillLeft > 0 ? `${title} — fierbe` : `${title} — stă: îi trebuie 5 prune și un lemn`;
    }
    if (building.kind === 'curte' && world.era[this.player] >= LAST_ERA) return `${title} — țăranii se fac la mall`;
    return title;
  }

  private actionButtons(): ActionButton[] {
    const world = this.world;
    const player = this.player;
    if (world.winner !== null) {
      return [{ id: 'restart', label: 'Joacă din nou', enabled: true, primary: true }];
    }
    if (this.placing) {
      const ok = world.canPlace(this.placing.kind, this.placing.tx, this.placing.ty);
      return [
        { id: 'place:ok', label: 'Construiește aici', enabled: ok, primary: true },
        { id: 'place:cancel', label: 'Renunță', enabled: true },
      ];
    }
    const units = this.selected();
    const hasPeasant = units.some((u) => u.kind === 'taran');
    if (this.buildMenuOpen && hasPeasant) {
      const list: ActionButton[] = [];
      for (const kind of BUILD_MENU) {
        // Only what this era knows — and only those who drink it bother to distil it.
        if (!world.canBuild(player, kind) || (kind === 'cazan' && !this.drinks)) continue;
        list.push({
          id: `build:${kind}`,
          label: BUILDINGS[kind].name,
          detail: `${world.buildingCost(player, kind)} lemn`,
          enabled: world.canAfford(player, kind),
        });
      }
      list.push({ id: 'menu:back', label: 'Înapoi', enabled: true });
      return list;
    }

    const buttons: ActionButton[] = [];
    if (hasPeasant) buttons.push({ id: 'menu:build', label: 'Construiește…', enabled: true, primary: true });

    const building = this.selectedBuilding === null ? undefined : world.getBuilding(this.selectedBuilding);
    if (building && building.faction === player) {
      for (const kind of world.trainable(building)) {
        const cost = world.unitCost(player, kind);
        const price = cost.lemn > 0 ? `${cost.prune} prune, ${cost.lemn} lemn` : `${cost.prune} prune`;
        buttons.push({
          id: `train:${kind}`,
          label: `${FACTIONS[player].units[kind].name} nou`,
          detail: price,
          enabled: world.canTrain(player, building, kind),
        });
      }
      const next = ERAS[world.era[player] + 1];
      if (building.kind === 'curte' && next && building.advanceLeft === 0) {
        buttons.push({
          id: 'advance',
          label: `Treci în ${next.name}`,
          detail: `${next.advanceLemn} lemn, ${next.advancePrune} prune`,
          enabled: world.canAdvance(player),
        });
      }
      const busy = !building.done || building.queue.length > 0 || building.advanceLeft > 0;
      if (world.era[player] >= BRIBE_ERA && busy) {
        buttons.push({
          id: 'bribe',
          label: 'Dă șpagă',
          detail: `${BRIBE_PRUNE} prune`,
          enabled: world.canBribe(player, building),
        });
      }
    }

    const ability = FACTIONS[player].ability;
    const hasFighter = world.fighterCount(player) > 0;
    const hasStill = world.buildings.some((b) => b.faction === player && b.kind === 'cazan' && b.done);
    if (ability.id === 'taunt' ? hasFighter : hasStill) {
      const wait = Math.ceil(world.abilityCooldown[player] / TICK_RATE);
      const detail =
        wait > 0 ? `gata în ${wait} s` : ability.costPalinca > 0 ? `${ability.costPalinca} pălinci` : 'gata';
      buttons.push({ id: 'ability', label: ability.name, detail, enabled: world.abilityReady(player) });
    }
    if (units.length > 0) buttons.push({ id: 'deselect', label: 'Lasă-i în pace', enabled: true });
    return buttons;
  }

  // --- Input --------------------------------------------------------------------

  private handleAction(id: string): void {
    const player = this.player;
    const building = this.selectedBuilding;
    if (id === 'restart') {
      location.reload();
    } else if (id === 'menu:build') {
      this.buildMenuOpen = true;
    } else if (id === 'menu:back') {
      this.buildMenuOpen = false;
    } else if (id.startsWith('build:')) {
      this.buildMenuOpen = false;
      this.startPlacing(id.slice('build:'.length) as BuildingKind);
    } else if (id === 'place:ok') {
      this.confirmPlacing();
    } else if (id === 'place:cancel') {
      this.placing = null;
      this.hud.hideToast();
    } else if (id.startsWith('train:') && building !== null) {
      const kind = id.slice('train:'.length) as UnitKind;
      this.world.issue({ type: 'train', faction: player, buildingId: building, kind });
    } else if (id === 'advance') {
      this.world.issue({ type: 'advance', faction: player });
    } else if (id === 'bribe' && building !== null) {
      this.world.issue({ type: 'bribe', faction: player, buildingId: building });
    } else if (id === 'ability') {
      this.useAbility();
    } else if (id === 'deselect') {
      this.selectedUnits.clear();
      this.buildMenuOpen = false;
    }
  }

  private useAbility(): void {
    const player = this.player;
    const now = this.time.now;
    if (FACTIONS[player].ability.id === 'palinca') {
      this.world.issue({ type: 'ability', faction: player });
      this.hud.toast('Stau cu toții la o pălincă. După aia merge treaba mai bine.', now, 4000);
      return;
    }
    // Taunt: a selected soldier does the shouting; failing that, whoever is closest to trouble.
    const soldiers = this.world.units.filter((u) => u.faction === player && u.kind !== 'taran');
    const foes = this.world.units.filter((u) => u.faction !== player);
    const trouble = (u: Unit): number =>
      foes.reduce((best, f) => Math.min(best, Math.hypot(f.x - u.x, f.y - u.y)), Infinity);
    const taunter =
      soldiers.find((u) => this.selectedUnits.has(u.id)) ??
      soldiers.sort((a, b) => trouble(a) - trouble(b) || a.id - b.id)[0];
    if (taunter) this.world.issue({ type: 'ability', faction: player, unitId: taunter.id });
  }

  private startPlacing(kind: BuildingKind): void {
    const size = BUILDINGS[kind].size;
    const view = this.controls.viewRect();
    const cx = Math.floor((view.x + view.width / 2) / TILE) - (size >> 1);
    const cy = Math.floor((view.y + view.height / 2) / TILE) - (size >> 1);
    // Start the ghost on the nearest spot where it would actually fit.
    const map = this.world.map;
    const spot = nearestTile(map, cx, cy, (_i, x, y) => this.world.canPlace(kind, x, y), 12);
    const sx = spot === -1 ? cx : spot % map.width;
    this.placing = { kind, tx: sx, ty: spot === -1 ? cy : (spot - sx) / map.width };
    this.hud.toast('Atinge harta unde s-o punem, apoi „Construiește aici”.', this.time.now);
  }

  private confirmPlacing(): void {
    const placing = this.placing;
    if (!placing || !this.world.canPlace(placing.kind, placing.tx, placing.ty)) return;
    const builders = this.selected().filter((u) => u.kind === 'taran');
    this.world.issue({
      type: 'build',
      faction: this.player,
      unitIds: builders.map((u) => u.id),
      kind: placing.kind,
      tx: placing.tx,
      ty: placing.ty,
    });
    this.speak(builders[0], 'build', this.time.now);
    this.placing = null;
    this.hud.hideToast();
  }

  private handleTap(worldX: number, worldY: number): void {
    const now = this.time.now;
    if (this.world.winner !== null) return;
    const tx = Math.floor(worldX / TILE);
    const ty = Math.floor(worldY / TILE);

    if (this.placing) {
      const size = BUILDINGS[this.placing.kind].size;
      this.placing.tx = tx - (size >> 1);
      this.placing.ty = ty - (size >> 1);
      return;
    }
    this.buildMenuOpen = false;

    const unitIds = [...this.selectedUnits];
    const unit = this.unitNear(worldX, worldY);
    if (unit && unit.faction !== this.player) {
      if (unitIds.length === 0) {
        this.speak(unit, 'select', now); // not yours — he just answers back
        return;
      }
      this.world.issue({ type: 'attack', faction: this.player, unitIds, targetId: unit.id });
      this.speak(this.world.getUnit(unitIds[0]!), 'attack', now);
      this.hud.hideToast();
      return;
    }
    if (unit) {
      this.speak(unit, 'select', now);
      const tappedAgain = this.selectedUnits.size === 1 && this.selectedUnits.has(unit.id);
      this.selectedUnits.clear();
      this.selectedBuilding = null;
      if (tappedAgain) {
        // Second tap on the same man: select all of yours of his kind.
        for (const u of this.world.units) {
          if (u.faction === this.player && u.kind === unit.kind) this.selectedUnits.add(u.id);
        }
      } else {
        this.selectedUnits.add(unit.id);
      }
      return;
    }

    if (!this.world.map.inBounds(tx, ty)) return;
    const building = this.world.buildingAt(tx, ty);

    if (unitIds.length === 0) {
      this.selectedBuilding = building ? building.id : null;
      return;
    }

    const kind = this.world.describeTarget(this.player, tx, ty);
    if (building && kind === 'move') {
      // A finished building of yours: look at it instead of walking into the wall.
      this.selectedUnits.clear();
      this.selectedBuilding = building.id;
      return;
    }
    this.world.issue({ type: 'act', faction: this.player, unitIds, tx, ty });
    this.markers.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, bornAt: now });
    this.speak(this.world.getUnit(unitIds[0]!), kind, now);
    this.hud.hideToast();
  }

  /** The unit under a tap, with a finger-sized tolerance. */
  private unitNear(worldX: number, worldY: number): Unit | undefined {
    const radius = Math.max(9, 26 / this.controls.zoom);
    let best: Unit | undefined;
    let bestDistance = radius;
    for (const unit of this.world.units) {
      const sprite = this.unitSprites.get(unit.id);
      if (!sprite) continue;
      const distance = Math.hypot(sprite.x - worldX, sprite.y - TILE * 0.25 - worldY);
      if (distance < bestDistance) {
        best = unit;
        bestDistance = distance;
      }
    }
    return best;
  }
}
