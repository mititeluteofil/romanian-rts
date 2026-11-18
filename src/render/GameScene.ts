import Phaser from 'phaser';
import { AI_THINK_EVERY, SkirmishAi, type Difficulty } from '../ai/skirmish';
import { SoundEngine, type VoiceLineHook } from '../audio/sound';
import { BUILD_MENU, BUILDINGS, ORCHARD_CAPACITY, TECHS, type BuildingKind, type TechId } from '../data/buildings';
import { BRIBE_ERA, COURT_NAMES, ERAS, LAST_ERA } from '../data/eras';
import {
  FACTION_IDS,
  FACTIONS,
  ISCOADA_LINES,
  isFighter,
  PLAYABLE_FACTION_IDS,
  SMECHER_LINES,
  STEGAR_LINES,
  type FactionId,
  type LineKind,
  type UnitKind,
} from '../data/factions';
import { REGION_NAMES } from '../data/romania';
import { CameraControls, type WorldRect } from '../input/CameraControls';
import type { CommandSink } from '../net/lockstep';
import { clearSave, loadNickname, sanitizeNickname, saveGame, type SaveGame } from '../save';
import { nearestTile } from '../sim/pathfinding';
import { hash2 } from '../sim/rng';
import {
  BRIBE_PRUNE,
  CAPITAL_TAX,
  FUNDS_AMOUNT,
  SUB,
  TICK_MS,
  TICK_RATE,
  World,
  type Building,
  type Command,
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
const AUTOSAVE_TICKS = 150;
const SPEEDS = [1, 2, 4] as const;
const CARRY_COLORS = { lemn: 0x8a5a2b, prune: 0x6a3fa0 } as const;
const OWN_HP = 0x7ee081;
const ENEMY_HP = 0xe05a4a;
const UNIT_KINDS: readonly UnitKind[] = ['taran', 'ostas', 'smecher', 'stegar', 'iscoada'];

export interface GameOptions {
  /** The faction the person at this device plays; the AI takes the others. */
  readonly player: FactionId;
  /** Optional player nickname (falls back to saved nickname or "Voievod"). */
  readonly nickname?: string;
  /** Quiet neighbour: no war, the goal is to reach the present and open a mall. */
  readonly peaceful: boolean;
  readonly difficulty?: Difficulty;
  /** Optional map scale (1 = 144×104 normal, 1.5 = 216×156 large). */
  readonly mapScale?: number;
  /** Whether Oltenia joins the match as a 5th principality. */
  readonly includeOltenia?: boolean;
  /** Optional lockstep command sink for multiplayer matches. */
  readonly commandSink?: CommandSink;
  /** Optional saved game to resume instead of starting from 1600. */
  readonly save?: SaveGame;
  readonly sound?: SoundEngine;
  readonly onReturnToMenu?: () => void;
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
  startTx?: number;
  startTy?: number;
}

function pick<T>(items: readonly T[]): T {
  // Presentation only — the simulation never uses Math.random().
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Draws the world and turns taps and button presses into simulation commands. */
export class GameScene extends Phaser.Scene {
  private readonly player: FactionId;
  private readonly nickname: string;
  private readonly peaceful: boolean;
  private readonly difficulty: Difficulty;
  private readonly mapScale: number;
  private readonly includeOltenia: boolean;
  private readonly commandSink?: CommandSink;
  /** What the food is called here, in lower case: "prune", "perje", "pește". */
  private readonly food: string;
  /** Whether pălincă is of any use to the player's faction. */
  private readonly drinks: boolean;
  private readonly initialSave?: SaveGame;
  private readonly sfx: SoundEngine;
  private readonly onReturnToMenu?: () => void;
  private world!: World;
  private ais: SkirmishAi[] = [];
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
  private readonly controlGroups = new Map<number, number[]>();
  private selectedBuilding: number | null = null;
  private idleCursor = 0;
  private placing: Placement | null = null;
  private rallyMode = false;
  private attackMoveMode = false;
  /** Whether the action bar is showing the list of things to build. */
  private buildMenuOpen = false;
  /** Peaceful mode: the mall has been opened and celebrated. */
  private goalReached = false;
  /** The player's court has fallen; the others may still be at it. */
  private lost = false;
  /** The capital took its cut of the funds that are about to be announced. */
  private taxed = false;
  private paused = false;
  private speedIndex = 0;
  private markers: Mark[] = [];
  private sparks: Mark[] = [];
  private accumulator = 0;
  private frame = 0;
  private readonly lifecycleAc = new AbortController();

  constructor(options: GameOptions) {
    super('game');
    this.player = options.player;
    this.nickname = sanitizeNickname(options.nickname ?? options.save?.nickname ?? loadNickname());
    this.peaceful = options.peaceful;
    this.difficulty = options.save?.difficulty ?? options.difficulty ?? 'normal';
    this.mapScale = options.mapScale ?? 1;
    this.includeOltenia = options.includeOltenia ?? (options.player === 'oltenia' || this.mapScale > 1);
    this.commandSink = options.commandSink;
    this.initialSave = options.save;
    this.sfx = options.sound ?? new SoundEngine();
    this.onReturnToMenu = options.onReturnToMenu;
    this.food = FACTIONS[options.player].foodName.toLowerCase();
    this.drinks = FACTIONS[options.player].ability.id === 'palinca';
  }

  private issue(cmd: Command): void {
    if (this.commandSink) this.commandSink.send(cmd);
    else this.world.issue(cmd);
  }

  private get speed(): number {
    return SPEEDS[this.speedIndex]!;
  }

  create(): void {
    const save = this.initialSave;
    if (save) {
      this.world = World.fromSnapshot(save.world);
      this.ais = save.ais.map((s) => SkirmishAi.fromSnapshot(s));
      this.goalReached = save.goalReached;
      this.lost = save.lost;
      this.taxed = save.taxed;
    } else {
      this.world = new World({
        seed: 1600,
        mapScale: this.mapScale,
        includeOltenia: this.includeOltenia,
      });
      const activeFactions = this.world.includeOltenia ? PLAYABLE_FACTION_IDS : FACTION_IDS;
      this.ais = activeFactions
        .filter((f) => f !== this.player)
        .map((f) => new SkirmishAi(f, { attacks: !this.peaceful, difficulty: this.difficulty }));
    }

    const hook = (globalThis as { __unireaVoiceHook?: VoiceLineHook }).__unireaVoiceHook;
    if (hook) this.sfx.setVoiceHook(hook);

    this.hud = new Hud({
      onAction: (id) => {
        this.sfx.unlock();
        this.handleAction(id);
      },
      onHaraci: (pay) => {
        this.sfx.unlock();
        this.answerHaraci(pay);
      },
      onBoxSelect: () => {
        this.sfx.unlock();
        this.toggleBoxSelect();
      },
      onIdlePeasant: () => {
        this.sfx.unlock();
        this.cycleIdlePeasant();
      },
      onPause: () => {
        this.sfx.unlock();
        this.togglePause();
      },
      onSpeed: () => {
        this.sfx.unlock();
        this.cycleSpeed();
      },
      onSave: () => {
        this.sfx.unlock();
        this.manualSave();
      },
      onMute: () => {
        const muted = this.sfx.toggleMute();
        this.hud.setMuted(muted);
      },
      onMenu: () => {
        this.sfx.unlock();
        if (!this.lost && this.world.winner === null) this.persistSave();
        this.onReturnToMenu?.();
      },
      onAbandon: () => {
        this.sfx.unlock();
        clearSave();
        this.onReturnToMenu?.();
      },
    });
    this.hud.setPaused(this.paused);
    this.hud.setSpeed(this.speed);
    this.hud.setMuted(this.sfx.isMuted());

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
        const key = `${kind}-${faction.id}`;
        if (!this.textures.exists(key)) {
          const sheet = this.textures.addCanvas(key, buildUnitSheet(faction, kind));
          UNIT_FRAMES.forEach((name, i) => sheet?.add(name, 0, i * TILE, 0, TILE, TILE));
        }
      }
      for (const def of Object.values(BUILDINGS)) {
        if (def.kind === 'curte') continue;
        const key = `${def.kind}-${faction.id}`;
        if (!this.textures.exists(key)) {
          this.textures.addCanvas(key, buildBuildingTexture(def.kind, def.size, faction));
        }
      }
      // The court changes its face with the times.
      for (let look = 0; look < COURT_LOOK_COUNT; look++) {
        const key = `curte-${faction.id}-${look}`;
        if (!this.textures.exists(key)) {
          const canvas = buildBuildingTexture('curte', BUILDINGS.curte.size, faction, look);
          this.textures.addCanvas(key, canvas);
        }
      }
    }
    this.ground = this.add.graphics().setDepth(5);
    this.top = this.add.graphics().setDepth(100);
    this.ghost = this.add.image(0, 0, `livada-${this.player}`).setOrigin(0, 0).setDepth(99).setVisible(false);

    // Camera and minimap
    this.controls = new CameraControls(
      this,
      map.width * TILE,
      map.height * TILE,
      (x, y) => {
        this.sfx.unlock();
        this.handleTap(x, y);
      },
      (rect, additive) => {
        this.sfx.unlock();
        this.handleBoxSelect(rect, additive);
      },
      (active) => this.hud.setBoxSelect(active),
    );
    this.hud.setBoxSelect(false);
    if (save) {
      this.controls.setZoom(save.camera.zoom);
      this.controls.jumpTo(save.camera.x, save.camera.y);
    } else {
      this.frameStart();
      // Until the player takes over the camera, re-frame when the window settles
      // on its real size (WebViews often report a tiny size for the first frame).
      this.scale.on('resize', () => {
        if (!this.controls.touched) this.frameStart();
      });
    }
    this.minimap = new Minimap(this.hud.minimapCanvas, this.world, (tx, ty) => {
      this.sfx.unlock();
      this.controls.jumpTo(tx * TILE, ty * TILE);
    });

    const sig = this.lifecycleAc.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Space' || e.code === 'KeyP') {
          e.preventDefault();
          this.sfx.unlock();
          this.togglePause();
        } else if (e.code === 'KeyB') {
          e.preventDefault();
          this.sfx.unlock();
          this.toggleBoxSelect();
        } else if (e.code === 'Tab' || e.code === 'KeyI') {
          e.preventDefault();
          this.sfx.unlock();
          this.cycleIdlePeasant();
        } else if (e.code === 'KeyG') {
          e.preventDefault();
          this.sfx.unlock();
          this.handleGarrisonShortcut();
        } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
          const group = Number(e.code.slice(5));
          this.sfx.unlock();
          this.handleControlGroup(group, e.ctrlKey || e.metaKey || e.shiftKey);
        }
      },
      { signal: sig },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden && !this.lost && this.world.winner === null) this.persistSave();
      },
      { signal: sig },
    );
    window.addEventListener(
      'pagehide',
      () => {
        if (!this.lost && this.world.winner === null) this.persistSave();
      },
      { signal: sig },
    );
    this.events.once('shutdown', () => {
      this.lifecycleAc.abort();
      this.hud.destroy();
      this.minimap.destroy();
    });
    this.events.once('destroy', () => {
      this.lifecycleAc.abort();
      this.hud.destroy();
      this.minimap.destroy();
    });

    this.hud.toast(
      save ? 'Partidă reluată.' : 'Atinge un țăran, apoi o pădure, ca să taie lemne.',
      this.time.now,
      save ? 3000 : undefined,
    );
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__unirea = {
        world: this.world,
        controls: this.controls,
        scene: this,
        sound: this.sfx,
      };
    }
  }

  private toggleBoxSelect(): void {
    this.controls.setBoxSelectMode(!this.controls.isBoxSelectMode);
  }

  private cycleIdlePeasant(): void {
    if (this.world.winner !== null || this.lost) return;
    const idle = this.world.units
      .filter((u) => u.faction === this.player && u.kind === 'taran' && u.order.type === 'idle')
      .sort((a, b) => a.id - b.id);
    if (idle.length === 0) return;
    const next = idle[this.idleCursor % idle.length]!;
    this.idleCursor = (this.idleCursor + 1) % idle.length;
    this.selectedUnits.clear();
    this.selectedBuilding = null;
    this.buildMenuOpen = false;
    this.selectedUnits.add(next.id);
    this.controls.jumpTo(next.x * SUB_TO_PX, next.y * SUB_TO_PX);
    this.sfx.play('select');
    this.speak(next, 'select', this.time.now);
  }

  private handleControlGroup(slot: number, assign: boolean): void {
    if (assign) {
      const ids = [...this.selectedUnits];
      if (ids.length > 0) {
        this.controlGroups.set(slot, ids);
        this.hud.toast(`Grupul ${slot}: ${ids.length} ${ids.length === 1 ? 'om' : 'oameni'}.`, this.time.now, 1500);
      }
      return;
    }
    const ids = (this.controlGroups.get(slot) ?? []).filter((id) => this.world.getUnit(id)?.faction === this.player);
    if (ids.length === 0) return;
    this.selectedUnits.clear();
    this.selectedBuilding = null;
    this.buildMenuOpen = false;
    for (const id of ids) this.selectedUnits.add(id);
    this.sfx.play('select');
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.hud.setPaused(this.paused);
  }

  private cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
    this.hud.setSpeed(this.speed);
  }

  private persistSave(): boolean {
    const cam = this.controls.center;
    return saveGame({
      version: 1,
      savedAt: Date.now(),
      player: this.player,
      nickname: this.nickname,
      peaceful: this.peaceful,
      difficulty: this.difficulty,
      goalReached: this.goalReached,
      lost: this.lost,
      taxed: this.taxed,
      camera: { x: cam.x, y: cam.y, zoom: this.controls.zoom },
      world: this.world.toSnapshot(),
      ais: this.ais.map((ai) => ai.toSnapshot()),
    });
  }

  private manualSave(): void {
    const ok = this.persistSave();
    if (ok) this.sfx.play('save');
    this.hud.toast(ok ? 'Partidă salvată.' : 'Nu s-a putut salva.', this.time.now, 2500);
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

    if (!this.paused) {
      // Fixed-step simulation, decoupled from the display's frame rate.
      const stepMs = Math.min(delta, MAX_FRAME_MS) * this.speed;
      this.accumulator = Math.min(this.accumulator + stepMs, TICK_MS * 10);
      while (this.accumulator >= TICK_MS) {
        if (this.commandSink && !this.commandSink.beforeStep(this.world)) break;
        this.world.step();
        this.commandSink?.afterStep(this.world);
        if (this.world.tick % AI_THINK_EVERY === 0) for (const ai of this.ais) ai.think(this.world);
        if (this.world.tick % AUTOSAVE_TICKS === 0 && this.world.winner === null && !this.lost) {
          this.persistSave();
        }
        this.accumulator -= TICK_MS;
      }
      for (const event of this.world.drainEvents()) this.handleEvent(event, time);
    }
    const alpha = this.accumulator / TICK_MS;

    this.ground.clear();
    this.top.clear();
    this.drawMarkers(time);
    for (const building of this.world.buildings) this.drawBuilding(building);
    for (const unit of this.world.units) this.drawUnit(unit, alpha, time);
    this.drawSparks(time);
    this.drawPlacement();
    this.drawSelectionBox();

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

  private nearView(px: number, py: number): boolean {
    const v = this.controls.viewRect();
    const pad = TILE * 4;
    return px >= v.x - pad && px <= v.x + v.width + pad && py >= v.y - pad && py <= v.y + v.height + pad;
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
          const line = FACTIONS[this.player].builtLine;
          this.hud.say(`b${event.buildingId}`, line, time);
          this.sfx.play('built');
          this.sfx.voice({ faction: this.player, kind: 'built', text: line });
        }
        break;
      }
      case 'distilled':
        if (this.world.getBuilding(event.buildingId)?.faction === this.player) {
          this.hud.say(`b${event.buildingId}`, '+1 pălincă', time);
          this.sfx.play('distill');
        }
        break;
      case 'trained': {
        const unit = this.world.getUnit(event.unitId);
        if (unit?.faction === this.player) {
          this.sfx.play('train');
          this.speak(unit, 'select', time);
        }
        break;
      }
      case 'full':
        this.speak(this.world.getUnit(event.unitId), 'full', time);
        break;
      case 'garrisoned': {
        const b = this.world.getBuilding(event.buildingId);
        if (b?.faction === this.player) {
          this.hud.say(`b${b.id}`, `La adăpost! (${this.world.garrisonCount(b)}/${this.world.garrisonCap(b)})`, time);
          this.sfx.play('order');
        }
        break;
      }
      case 'ungarrisoned': {
        const b = this.world.getBuilding(event.buildingId);
        if (b?.faction === this.player) {
          this.hud.say(`b${b.id}`, 'Hai înapoi la treabă!', time);
          this.sfx.play('select');
        }
        break;
      }
      case 'ability':
        if (event.ability === 'taunt') {
          if (event.faction === this.player) this.sfx.play('taunt');
          this.speak(this.world.getUnit(event.unitId), 'taunt', time);
        } else if (event.ability === 'rezolva') {
          if (event.faction === this.player) {
            this.sfx.play(event.count > 0 ? 'rezolvaOk' : 'rezolvaFail');
            const line =
              event.count > 0
                ? `S-a rezolvat: ${event.count === 1 ? 'un lucru e gata' : `${event.count} lucruri sunt gata`}.`
                : 'Nu s-a rezolvat nimic. Și te-a mai costat și 30 de prune.';
            this.hud.toast(line, time, 5000);
          }
        } else if (event.ability === 'plaja') {
          if (event.faction === this.player) {
            this.sfx.play('plaja');
            this.hud.toast(`Au plecat ${event.count} la plajă. Ți-au lăsat ${event.count * 5} pești.`, time, 5000);
          } else if (this.world.units.some((u) => u.faction === this.player && u.stun > 0)) {
            this.sfx.play('plaja');
            this.hud.toast('Oștenii tăi au lăsat armele și s-au dus la plajă.', time, 5000);
          }
        } else if (event.ability === 'iures') {
          if (event.faction === this.player) {
            this.sfx.play('iures');
            this.hud.toast('Iureș oltenească! Cetele tale lovesc cu +50% putere!', time, 4500);
          }
        } else {
          if (event.faction === this.player) this.sfx.play('palinca');
          // Everybody with a glass in hand says something, friend or foe.
          for (const unit of this.world.units.filter((u) => u.drink > 0).slice(0, 8)) {
            this.speak(unit, 'drink', time);
          }
        }
        break;
      case 'researched': {
        const tech = TECHS[event.techId];
        if (event.faction === this.player) {
          this.sfx.play('research');
          const msg = event.targetFaction
            ? `${tech.name} trimisă către ${FACTIONS[event.targetFaction].name}!`
            : `Cercetare gata: ${tech.name} (${tech.description}).`;
          this.hud.toast(msg, time, 5000);
        } else if (event.targetFaction === this.player) {
          this.sfx.play('haraci');
          this.hud.toast(`${FACTIONS[event.faction].name} a trimis „${tech.name}” peste tine!`, time, 6000);
        }
        break;
      }
      case 'era': {
        const era = ERAS[event.era]!;
        if (event.faction === this.player) {
          this.sfx.play('era');
          this.sfx.voice({ faction: this.player, kind: 'era', text: era.announcement });
          this.hud.toast(era.announcement, time, 9000);
        } else {
          this.hud.toast(`${FACTIONS[event.faction].name} a trecut în ${era.name}.`, time, 4000);
        }
        break;
      }
      case 'bribe':
        if (event.faction === this.player) {
          const line = event.worked ? 'S-o rezolvat.' : 'O luat prunele și n-o făcut nimic.';
          this.hud.say(`b${event.buildingId}`, line, time);
          this.sfx.play(event.worked ? 'bribeOk' : 'bribeFail');
          this.sfx.voice({ faction: this.player, kind: 'bribe', text: line });
        }
        break;
      case 'tax':
        if (event.faction === this.player) this.taxed = true;
        break;
      case 'funds':
        if (event.faction === this.player) {
          const got = this.taxed ? FUNDS_AMOUNT - CAPITAL_TAX : FUNDS_AMOUNT;
          const cut = this.taxed ? ` Încă ${CAPITAL_TAX} s-au dus la București, la centru.` : '';
          this.hud.toast(`Au intrat fondurile europene: +${got} lemn, +${got} ${this.food}.${cut}`, time, 5000);
          this.sfx.play('built');
          this.taxed = false;
        }
        break;
      case 'summer':
        if (this.player === 'dobrogea') {
          this.hud.toast(
            `A venit sezonul: ${event.visitors} principate la plajă. Bani buni, da’ uite ce-au lăsat în urmă.`,
            time,
            6000,
          );
        }
        break;
      case 'haraci':
        if (event.faction === this.player) {
          this.sfx.play('haraci');
          this.hud.toast(`Poarta cere haraci: ${event.amount} ${this.food}. Plătești, sau vin ienicerii.`, time);
        }
        break;
      case 'haraciPaid':
        if (event.faction === this.player) {
          this.sfx.play('bribeOk');
          this.hud.toast('Haraciul s-a plătit. Deocamdată.', time, 4000);
        }
        break;
      case 'raid':
        if (event.faction === this.player) {
          this.sfx.play('raid');
          this.hud.toast(`Vin ienicerii: ${event.count}! Dau în curte o vreme și pleacă.`, time, 7000);
        }
        break;
      case 'left':
        this.unitSprites.get(event.unitId)?.destroy();
        this.unitSprites.delete(event.unitId);
        this.selectedUnits.delete(event.unitId);
        break;
      case 'eliminated':
        if (event.faction === this.player) {
          this.lost = true;
          this.placing = null;
          this.selectedUnits.clear();
          this.selectedBuilding = null;
          clearSave();
          const line = FACTIONS[this.player].loseLine;
          this.sfx.play('lose');
          this.sfx.voice({ faction: this.player, kind: 'lose', text: line });
          this.hud.toast(line, time);
        } else if (this.world.winner === null && !this.lost) {
          this.hud.toast(`${FACTIONS[event.faction].name} a rămas fără curte.`, time, 5000);
        }
        break;
      case 'scandal': {
        const instigator = this.world.getUnit(event.unitId);
        if (instigator && this.nearView(instigator.x * SUB_TO_PX, instigator.y * SUB_TO_PX)) {
          this.sfx.play('scandal');
        }
        this.speak(instigator, 'scandal', time);
        for (const id of event.onlookers.slice(0, 3)) this.speak(this.world.getUnit(id), 'scandal', time);
        break;
      }
      case 'hit': {
        const px = event.x * SUB_TO_PX;
        const py = event.y * SUB_TO_PX;
        this.sparks.push({ x: px, y: py - 4, bornAt: time });
        if (this.nearView(px, py)) this.sfx.play('hit');
        break;
      }
      case 'died': {
        this.unitSprites.get(event.unitId)?.destroy();
        this.unitSprites.delete(event.unitId);
        this.selectedUnits.delete(event.unitId);
        const px = Math.round(event.x * SUB_TO_PX);
        const py = Math.round(event.y * SUB_TO_PX);
        const line = pick(FACTIONS[event.faction].lines.die);
        this.hud.say(`p${px},${py}`, line, time);
        if (event.faction === this.player || this.nearView(px, py)) {
          this.sfx.play('die');
          this.sfx.voice({ faction: event.faction, kind: 'die', text: line });
        }
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
        clearSave();
        if (event.faction === this.player) {
          const line = FACTIONS[this.player].winLine;
          this.sfx.play('win');
          this.sfx.voice({ faction: this.player, kind: 'win', text: line });
          this.hud.toast(line, time);
        }
        break;
    }
  }

  private speak(unit: Unit | undefined, kind: LineKind, time: number): void {
    if (!unit) return;
    // The mall crowd, banner-bearer and scout each have their own way of talking.
    const lines =
      unit.kind === 'smecher'
        ? SMECHER_LINES
        : unit.kind === 'stegar'
          ? STEGAR_LINES
          : unit.kind === 'iscoada'
            ? ISCOADA_LINES
            : FACTIONS[unit.faction].lines;
    const text = pick(lines[kind]);
    this.hud.say(`u${unit.id}`, text, time);
    if (unit.faction === this.player || this.nearView(unit.x * SUB_TO_PX, unit.y * SUB_TO_PX)) {
      this.sfx.voice({ faction: unit.faction, unitKind: unit.kind, kind, text });
    }
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
    } else if (building.researching && (building.researchLeft ?? 0) > 0) {
      const tech = TECHS[building.researching];
      const total = Math.floor((tech.researchTicks * FACTIONS[building.faction].buildTimePercent) / 100);
      this.drawBar(x + 2, y - 5, side - 4, total > 0 ? 1 - (building.researchLeft ?? 0) / total : 1, 0x64b5f6);
    } else if (building.advanceLeft > 0) {
      const next = ERAS[this.world.era[building.faction] + 1];
      const total = next ? Math.floor((next.advanceTicks * FACTIONS[building.faction].buildTimePercent) / 100) : 1;
      this.drawBar(x + 2, y - 5, side - 4, total > 0 ? 1 - building.advanceLeft / total : 1, 0x64b5f6);
    }
    const garrisoned = this.world.garrisonCount(building);
    if (building.done && garrisoned > 0) {
      // Gold shelter pips showing how many villagers are garrisoned inside.
      for (let i = 0; i < garrisoned; i++) {
        const px = x + 3 + i * 5;
        const py = y - 14;
        this.top.fillStyle(0x1b1b1b, 1);
        this.top.fillRect(px - 1, py - 1, 5, 5);
        this.top.fillStyle(0xf2c230, 1);
        this.top.fillRect(px, py, 3, 3);
      }
    }
    if (building.done && building.kind === 'cazan' && building.distillLeft > 0) {
      // Animated firebox glow and rising steam puffs from the still.
      const phase = (this.frame % 60) / 60;
      this.top.fillStyle(0xff8a30, 0.75);
      this.top.fillRect(x + 12, y + 25, 6, 2);
      this.top.fillStyle(0xf2f2f2, 0.65 * (1 - phase));
      this.top.fillRect(x + 19, y - Math.floor(phase * 8), 3, 2);
    }
    if (building.done && building.kind === 'gater' && this.world.debuffs[building.faction].panaCurent === 0) {
      // Spinning saw blade glint.
      const glint = Math.floor(this.frame / 4) % 4;
      this.top.fillStyle(0xf7f7f7, 0.9);
      this.top.fillRect(x + 13 + (glint % 2) * 3, y + 17 + (glint >> 1) * 2, 2, 1);
    }
    if (selected || building.hp < building.maxHp) {
      const color = building.faction === this.player ? OWN_HP : ENEMY_HP;
      this.drawBar(x + 2, y - 9, side - 4, building.hp / building.maxHp, color);
    }
    if (selected) {
      this.top.lineStyle(1, 0xfff176, 1);
      this.top.strokeRect(x - 1, y - 1, side + 2, side + 2);
      if (building.rally && building.faction === this.player) {
        const sx = x + side / 2;
        const sy = y + side / 2;
        const rx = (building.rally.tx + 0.5) * TILE;
        const ry = (building.rally.ty + 0.5) * TILE;
        this.top.lineStyle(1, 0x7ee081, 0.85);
        this.top.lineBetween(sx, sy, rx, ry);
        this.top.fillStyle(0x7ee081, 1);
        this.top.fillRect(rx - 2, ry - 6, 5, 4);
        this.top.fillRect(rx - 2, ry - 6, 1, 7);
      }
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

  private wallLineTiles(placing: Placement): Array<{ tx: number; ty: number }> {
    if (placing.startTx === undefined || placing.startTy === undefined) {
      return [{ tx: placing.tx, ty: placing.ty }];
    }
    const tiles: Array<{ tx: number; ty: number }> = [];
    let x = placing.startTx;
    let y = placing.startTy;
    const dx = Math.sign(placing.tx - x);
    const dy = Math.sign(placing.ty - y);
    while (tiles.length < 32) {
      tiles.push({ tx: x, ty: y });
      if (x === placing.tx && y === placing.ty) break;
      if (Math.abs(placing.tx - x) >= Math.abs(placing.ty - y)) x += dx;
      else y += dy;
    }
    return tiles;
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
    for (const pt of this.wallLineTiles(placing)) {
      const tileOk = this.world.canPlace(placing.kind, pt.tx, pt.ty);
      this.top.fillStyle(tileOk ? OWN_HP : ENEMY_HP, 0.35);
      this.top.fillRect(pt.tx * TILE, pt.ty * TILE, side, side);
      this.top.lineStyle(1, tileOk ? OWN_HP : ENEMY_HP, 1);
      this.top.strokeRect(pt.tx * TILE, pt.ty * TILE, side, side);
    }
    if (!ok) {
      this.top.lineStyle(1, ENEMY_HP, 1);
      this.top.strokeRect(placing.tx * TILE, placing.ty * TILE, side, side);
    }
  }

  private drawSelectionBox(): void {
    const box = this.controls.selectionBox();
    if (!box) return;
    this.top.fillStyle(0xfff176, 0.16);
    this.top.fillRect(box.x, box.y, box.width, box.height);
    this.top.lineStyle(Math.max(0.5, 1 / this.controls.zoom), 0xfff176, 0.95);
    this.top.strokeRect(box.x, box.y, box.width, box.height);
  }

  // --- HUD ----------------------------------------------------------------------

  private refreshHud(time: number): void {
    const world = this.world;
    const player = this.player;
    const stock = world.stock[player];
    const idleCount = world.units.filter(
      (u) => u.faction === player && u.kind === 'taran' && u.order.type === 'idle',
    ).length;
    this.hud.setIdleCount(idleCount);
    const view = this.controls.viewRect();
    const region = world.map.regionAt(
      Math.floor((view.x + view.width / 2) / TILE),
      Math.floor((view.y + view.height / 2) / TILE),
    );
    const era = ERAS[world.era[player]]!;
    this.hud.setTitle(`${this.nickname} · ${REGION_NAMES[region]} · ${era.name}, ${era.year}`);
    this.hud.setStock(
      `Lemn ${stock.lemn} · ${FACTIONS[player].foodName} ${stock.prune} · ` +
        (this.drinks ? `Pălincă ${stock.palinca} · ` : '') +
        `Țărani ${world.unitCount(player, 'taran')} · Oșteni ${world.fighterCount(player)} ` +
        `(loc: ${world.unitCap(player)})`,
    );
    const owed = world.haraci[player];
    this.hud.setHaraci(
      owed.due > 0 && world.winner === null && !this.lost
        ? {
            amount: owed.amount,
            food: this.food,
            secondsLeft: Math.ceil(owed.due / TICK_RATE),
            canPay: stock.prune >= owed.amount,
          }
        : null,
    );
    this.hud.setObjective(this.objectiveText(time));
    this.hud.setSelection(this.selectionText());
    this.hud.setActions(this.actionButtons());
    this.hud.setDebug(`tick ${world.tick} · ${world.checksum().toString(16)}`);
    this.hud.update(time, (key) => this.bubbleAnchor(key));
  }

  private objectiveText(time: number): string {
    const world = this.world;
    if (world.winner === this.player) return 'Ai câștigat.';
    if (this.lost || world.winner !== null) return 'Ai pierdut.';
    const owed = world.haraci[this.player];
    if (owed.due > 0) {
      return `Haraci: ${owed.amount} ${this.food}, în ${Math.ceil(owed.due / TICK_RATE)} s. Altfel vin ienicerii.`;
    }
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
    const courts = world
      .alive()
      .map((f) => `${f === this.player ? `${this.nickname} (a ta)` : FACTIONS[f].name} ${world.courtOf(f)?.hp ?? 0}`)
      .join(' · ');
    return `Țel: rămâi ultimul cu curtea în picioare. Curți: ${courts}`;
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
    const cap = world.garrisonCap(building);
    const inside = world.garrisonCount(building);
    const shelterInfo = cap > 0 && (inside > 0 || building.kind === 'turn') ? ` · adăpost ${inside}/${cap}` : '';
    const title = `${this.buildingName(building)}${whose} — ${building.hp}/${building.maxHp}${shelterInfo}`;
    if (building.faction !== this.player) return title;
    if (!building.done) return `${title} — se face`;
    if (building.advanceLeft > 0) {
      return `${title} — se schimbă vremurile (${Math.ceil(building.advanceLeft / TICK_RATE)} s)`;
    }
    if (building.researching && (building.researchLeft ?? 0) > 0) {
      return `${title} — cercetează ${TECHS[building.researching].name} (${Math.ceil((building.researchLeft ?? 0) / TICK_RATE)} s)`;
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
    if (world.winner !== null || this.lost) {
      return [{ id: 'restart', label: 'Joacă din nou', enabled: true, primary: true }];
    }
    if (this.placing) {
      const isWall = this.placing.kind === 'zid' || this.placing.kind === 'poarta';
      const lineStarted = this.placing.startTx !== undefined && this.placing.startTy !== undefined;
      const tiles = this.wallLineTiles(this.placing);
      const anyOk = tiles.some((pt) => world.canPlace(this.placing!.kind, pt.tx, pt.ty));
      const buttons: ActionButton[] = [
        {
          id: 'place:ok',
          label: lineStarted ? `Construiește șirul (${tiles.length})` : 'Construiește aici',
          enabled: anyOk,
          primary: true,
        },
      ];
      if (isWall && !lineStarted) {
        buttons.push({ id: 'place:line', label: 'Trage șir de aici', enabled: anyOk });
      }
      buttons.push({ id: 'place:cancel', label: 'Renunță', enabled: true });
      return buttons;
    }
    const units = this.selected();
    const peasantsSelected = units.filter((u) => u.kind === 'taran').length;
    const fightersSelected = units.length - peasantsSelected;
    const hasPeasant = peasantsSelected > 0;
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
    if (hasPeasant) {
      buttons.push({ id: 'menu:build', label: 'Construiește…', enabled: true, primary: true });
      const hasShelter = world.buildings.some((b) => world.canGarrison(player, b));
      buttons.push({
        id: 'garrison:nearest',
        label: 'La adăpost!',
        detail: 'Turn / Curte',
        enabled: hasShelter,
      });
    }
    if (fightersSelected > 0) {
      buttons.push({
        id: 'mode:attackMove',
        label: this.attackMoveMode ? 'Atacă în drum (atinge harta)' : 'Atacă în drum',
        enabled: true,
        primary: this.attackMoveMode,
      });
    }

    const building = this.selectedBuilding === null ? undefined : world.getBuilding(this.selectedBuilding);
    if (building && building.faction === player) {
      const cap = world.garrisonCap(building);
      const inside = world.garrisonCount(building);
      if (building.done && cap > 0) {
        const freePeasants = world.units.some((u) => u.faction === player && u.kind === 'taran');
        if (inside < cap && freePeasants) {
          buttons.push({
            id: 'garrison:bell',
            label: 'Cheamă la adăpost',
            detail: `${inside}/${cap} înăuntru`,
            enabled: true,
          });
        }
        if (inside > 0) {
          buttons.push({
            id: 'ungarrison',
            label: 'Ieșiți din adăpost',
            detail: `${inside} ${inside === 1 ? 'țăran' : 'țărani'}`,
            enabled: true,
            primary: true,
          });
        }
      }
      for (const kind of world.trainable(building)) {
        const cost = world.unitCost(player, kind);
        const price = cost.lemn > 0 ? `${cost.prune} ${this.food}, ${cost.lemn} lemn` : `${cost.prune} ${this.food}`;
        buttons.push({
          id: `train:${kind}`,
          label: `${FACTIONS[player].units[kind].name} nou`,
          detail: price,
          enabled: world.canTrain(player, building, kind),
        });
      }
      if (building.done && BUILDINGS[building.kind].trains.length > 0) {
        buttons.push({
          id: 'mode:rally',
          label: this.rallyMode ? 'Alege adunarea…' : 'Punct de adunare',
          detail: building.rally ? `${building.rally.tx},${building.rally.ty}` : undefined,
          enabled: true,
          primary: this.rallyMode,
        });
      }
      if (building.queue.length > 0) {
        buttons.push({
          id: 'queue:cancel',
          label: 'Anulează rândul',
          detail: `${building.queue.length}`,
          enabled: true,
        });
      }
      for (const tech of world.availableTechs(building)) {
        const costParts: string[] = [];
        if (tech.costLemn > 0) costParts.push(`${tech.costLemn} lemn`);
        if (tech.costPrune > 0) costParts.push(`${tech.costPrune} ${this.food}`);
        buttons.push({
          id: `research:${tech.id}`,
          label: tech.name,
          detail: costParts.join(', '),
          enabled: world.canResearch(player, building, tech.id),
        });
      }
      const next = ERAS[world.era[player] + 1];
      if (building.kind === 'curte' && next && building.advanceLeft === 0) {
        buttons.push({
          id: 'advance',
          label: `Treci în ${next.name}`,
          detail: `${next.advanceLemn} lemn, ${next.advancePrune} ${this.food}`,
          enabled: world.canAdvance(player),
        });
      }
      const busy =
        !building.done ||
        building.queue.length > 0 ||
        building.advanceLeft > 0 ||
        (building.researchLeft ?? 0) > 0;
      if (world.era[player] >= BRIBE_ERA && busy) {
        buttons.push({
          id: 'bribe',
          label: 'Dă șpagă',
          detail: `${BRIBE_PRUNE} ${this.food}`,
          enabled: world.canBribe(player, building),
        });
      }
    }

    const ability = FACTIONS[player].ability;
    const hasFighter = world.fighterCount(player) > 0;
    const hasStill = world.buildings.some((b) => b.faction === player && b.kind === 'cazan' && b.done);
    const shown =
      ability.id === 'taunt' ? hasFighter : ability.id === 'palinca' ? hasStill : ability.id !== 'none';
    if (shown) {
      const wait = Math.ceil(world.abilityCooldown[player] / TICK_RATE);
      const detail =
        wait > 0 ? `gata în ${wait} s` : ability.costPalinca > 0 ? `${ability.costPalinca} pălinci` : 'gata';
      buttons.push({ id: 'ability', label: ability.name, detail, enabled: world.abilityReady(player) });
    }
    if (units.length === 0 && !building && hasFighter) {
      buttons.push({
        id: 'select:fighters',
        label: 'Alege oștenii',
        detail: `${world.fighterCount(player)}`,
        enabled: true,
      });
    }
    if (peasantsSelected > 0 && fightersSelected > 0) {
      buttons.push({ id: 'filter:taran', label: 'Doar țărani', detail: `${peasantsSelected}`, enabled: true });
      buttons.push({ id: 'filter:fighters', label: 'Doar oșteni', detail: `${fightersSelected}`, enabled: true });
    }
    if (units.length > 0) buttons.push({ id: 'deselect', label: 'Lasă-i în pace', enabled: true });
    return buttons;
  }

  // --- Input --------------------------------------------------------------------

  private handleBoxSelect(rect: WorldRect, additive: boolean): void {
    if (this.world.winner !== null || this.lost || this.placing) return;
    const pad = 6;
    const minX = rect.x - pad;
    const minY = rect.y - pad;
    const maxX = rect.x + rect.width + pad;
    const maxY = rect.y + rect.height + pad;
    const caught: Unit[] = [];
    for (const unit of this.world.units) {
      if (unit.faction !== this.player) continue;
      const px = unit.x * SUB_TO_PX;
      const py = unit.y * SUB_TO_PX;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) caught.push(unit);
    }
    if (!additive) this.selectedUnits.clear();
    if (caught.length === 0) return;
    this.selectedBuilding = null;
    this.buildMenuOpen = false;
    for (const unit of caught) this.selectedUnits.add(unit.id);
    this.sfx.play('select');
    this.speak(caught[0], 'select', this.time.now);
    this.hud.hideToast();
  }

  private handleAction(id: string): void {
    const player = this.player;
    const building = this.selectedBuilding;
    if (id === 'restart') {
      clearSave();
      location.reload();
    } else if (id === 'select:fighters') {
      this.selectedUnits.clear();
      this.selectedBuilding = null;
      this.buildMenuOpen = false;
      for (const u of this.world.units) {
        if (u.faction === player && isFighter(u.kind)) this.selectedUnits.add(u.id);
      }
      this.sfx.play('select');
    } else if (id === 'filter:taran' || id === 'filter:fighters') {
      const wantPeasant = id === 'filter:taran';
      for (const uid of [...this.selectedUnits]) {
        const u = this.world.getUnit(uid);
        if (!u || (u.kind === 'taran') !== wantPeasant) this.selectedUnits.delete(uid);
      }
      if (!wantPeasant) this.buildMenuOpen = false;
      this.sfx.play('select');
    } else if (id === 'menu:build') {
      this.buildMenuOpen = true;
    } else if (id === 'menu:back') {
      this.buildMenuOpen = false;
    } else if (id.startsWith('build:')) {
      this.buildMenuOpen = false;
      this.startPlacing(id.slice('build:'.length) as BuildingKind);
    } else if (id === 'place:line' && this.placing) {
      this.placing.startTx = this.placing.tx;
      this.placing.startTy = this.placing.ty;
      this.hud.toast('Atinge capătul șirului pe hartă, apoi „Construiește șirul”.', this.time.now);
    } else if (id === 'place:ok') {
      this.confirmPlacing();
    } else if (id === 'place:cancel') {
      this.placing = null;
      this.hud.hideToast();
    } else if (id === 'mode:attackMove') {
      this.attackMoveMode = !this.attackMoveMode;
      this.rallyMode = false;
      if (this.attackMoveMode) this.hud.toast('Atinge pe hartă unde să mărșăluiască și să atace.', this.time.now);
      else this.hud.hideToast();
    } else if (id === 'mode:rally') {
      this.rallyMode = !this.rallyMode;
      this.attackMoveMode = false;
      if (this.rallyMode) this.hud.toast('Atinge pe hartă locul de adunare.', this.time.now);
      else this.hud.hideToast();
    } else if (id === 'garrison:nearest') {
      const peasants = this.selected().filter((u) => u.kind === 'taran');
      if (peasants.length > 0) {
        this.issue({ type: 'garrison', faction: player, unitIds: peasants.map((u) => u.id) });
        this.sfx.play('order');
        this.speak(peasants[0], 'move', this.time.now);
      }
    } else if (id === 'garrison:bell' && building !== null) {
      this.ringTownBell(building);
    } else if (id === 'ungarrison' && building !== null) {
      this.issue({ type: 'ungarrison', faction: player, buildingId: building });
    } else if (id === 'queue:cancel' && building !== null) {
      this.issue({ type: 'cancelQueue', faction: player, buildingId: building });
    } else if (id.startsWith('research:') && building !== null) {
      const techId = id.slice('research:'.length) as TechId;
      const def = TECHS[techId];
      let targetFaction: FactionId | undefined;
      if (def?.isDebuff) {
        const enemies = this.world.alive().filter((f) => f !== player);
        targetFaction = enemies.find((f) => f === FACTIONS[player].rival) ?? enemies[0];
      }
      this.issue({ type: 'research', faction: player, buildingId: building, techId, targetFaction });
    } else if (id.startsWith('train:') && building !== null) {
      const kind = id.slice('train:'.length) as UnitKind;
      this.issue({ type: 'train', faction: player, buildingId: building, kind });
    } else if (id === 'advance') {
      this.issue({ type: 'advance', faction: player });
    } else if (id === 'bribe' && building !== null) {
      this.issue({ type: 'bribe', faction: player, buildingId: building });
    } else if (id === 'ability') {
      this.useAbility();
    } else if (id === 'deselect') {
      this.selectedUnits.clear();
      this.buildMenuOpen = false;
      this.attackMoveMode = false;
    }
  }

  private answerHaraci(pay: boolean): void {
    const owed = this.world.haraci[this.player];
    if (owed.due <= 0) return;
    this.issue({ type: 'haraci', faction: this.player, pay });
    this.hud.hideToast();
    if (!pay) {
      const text = 'Muie Baiazid!';
      this.sfx.voice({ faction: this.player, kind: 'haraciRefuse', text });
      const court = this.world.courtOf(this.player);
      if (court) this.hud.say(`b${court.id}`, text, this.time.now);
    }
  }

  private useAbility(): void {
    const player = this.player;
    const now = this.time.now;
    const ability = FACTIONS[player].ability.id;
    if (ability !== 'taunt') {
      this.issue({ type: 'ability', faction: player });
      if (ability === 'palinca') {
        this.hud.toast('Stau cu toții la o pălincă. După aia merge treaba mai bine.', now, 4000);
      }
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
    if (taunter) this.issue({ type: 'ability', faction: player, unitId: taunter.id });
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
    if (!placing) return;
    const tiles = this.wallLineTiles(placing).filter((pt) => this.world.canPlace(placing.kind, pt.tx, pt.ty));
    if (tiles.length === 0) return;
    const builders = this.selected().filter((u) => u.kind === 'taran');
    if (tiles.length > 1 && (placing.kind === 'zid' || placing.kind === 'poarta')) {
      this.issue({
        type: 'buildLine',
        faction: this.player,
        unitIds: builders.map((u) => u.id),
        kind: placing.kind,
        tiles: tiles.map((pt) => [pt.tx, pt.ty] as const),
      });
    } else {
      const first = tiles[0]!;
      this.issue({
        type: 'build',
        faction: this.player,
        unitIds: builders.map((u) => u.id),
        kind: placing.kind,
        tx: first.tx,
        ty: first.ty,
      });
    }
    this.speak(builders[0], 'build', this.time.now);
    this.placing = null;
    this.hud.hideToast();
  }

  private handleGarrisonShortcut(): void {
    if (this.world.winner !== null || this.lost) return;
    const peasants = this.selected().filter((u) => u.kind === 'taran');
    if (peasants.length > 0) {
      this.handleAction('garrison:nearest');
      return;
    }
    if (this.selectedBuilding !== null) {
      const b = this.world.getBuilding(this.selectedBuilding);
      if (b && b.faction === this.player && this.world.garrisonCap(b) > 0) {
        if (this.world.garrisonCount(b) > 0) this.handleAction('ungarrison');
        else this.handleAction('garrison:bell');
      }
    }
  }

  private ringTownBell(buildingId: number): void {
    const b = this.world.getBuilding(buildingId);
    if (!b || !this.world.canGarrison(this.player, b)) return;
    const room = this.world.garrisonCap(b) - this.world.garrisonCount(b);
    if (room <= 0) return;
    const size = BUILDINGS[b.kind].size;
    const cx = (b.tx + size / 2) * SUB;
    const cy = (b.ty + size / 2) * SUB;
    const peasants = this.world.units
      .filter((u) => u.faction === this.player && u.kind === 'taran')
      .sort((a, c) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(c.x - cx, c.y - cy) || a.id - c.id)
      .slice(0, room);
    if (peasants.length === 0) return;
    this.issue({
      type: 'garrison',
      faction: this.player,
      unitIds: peasants.map((u) => u.id),
      buildingId: b.id,
    });
    this.sfx.play('order');
  }

  private handleTap(worldX: number, worldY: number): void {
    const now = this.time.now;
    if (this.world.winner !== null || this.lost) return;
    const tx = Math.floor(worldX / TILE);
    const ty = Math.floor(worldY / TILE);

    if (this.placing) {
      const size = BUILDINGS[this.placing.kind].size;
      this.placing.tx = tx - (size >> 1);
      this.placing.ty = ty - (size >> 1);
      return;
    }
    this.buildMenuOpen = false;

    if (this.rallyMode && this.selectedBuilding !== null && this.world.map.inBounds(tx, ty)) {
      this.issue({ type: 'rally', faction: this.player, buildingId: this.selectedBuilding, tx, ty });
      this.rallyMode = false;
      this.sfx.play('order');
      this.markers.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, bornAt: now });
      this.hud.hideToast();
      return;
    }

    const unitIds = [...this.selectedUnits];
    if (this.attackMoveMode && unitIds.length > 0 && this.world.map.inBounds(tx, ty)) {
      this.issue({ type: 'attackMove', faction: this.player, unitIds, tx, ty });
      this.attackMoveMode = false;
      this.sfx.play('order');
      this.markers.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, bornAt: now });
      this.speak(this.world.getUnit(unitIds[0]!), 'attack', now);
      this.hud.hideToast();
      return;
    }
    const unit = this.unitNear(worldX, worldY);
    if (unit && unit.faction !== this.player) {
      if (unitIds.length === 0) {
        this.speak(unit, 'select', now); // not yours — he just answers back
        return;
      }
      this.issue({ type: 'attack', faction: this.player, unitIds, targetId: unit.id });
      this.sfx.play('order');
      this.speakAttack(this.world.getUnit(unitIds[0]!), unit.faction, now);
      this.hud.hideToast();
      return;
    }
    if (unit) {
      this.sfx.play('select');
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
      if (building) this.sfx.play('select');
      this.selectedBuilding = building ? building.id : null;
      return;
    }

    const kind = this.world.describeTarget(this.player, tx, ty);
    const hasPeasantSelected = this.selected().some((u) => u.kind === 'taran');
    if (building && (kind === 'move' || (kind === 'garrison' && !hasPeasantSelected))) {
      // A finished building of yours: look at it instead of walking into the wall.
      this.sfx.play('select');
      this.selectedUnits.clear();
      this.selectedBuilding = building.id;
      return;
    }
    this.issue({ type: 'act', faction: this.player, unitIds, tx, ty });
    this.sfx.play('order');
    this.markers.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, bornAt: now });
    if (kind === 'attack' && building) this.speakAttack(this.world.getUnit(unitIds[0]!), building.faction, now);
    else this.speak(this.world.getUnit(unitIds[0]!), kind === 'garrison' ? 'move' : kind, now);
    this.hud.hideToast();
  }

  /** Marching on another principality: half the time, say what you think of them. */
  private speakAttack(unit: Unit | undefined, target: FactionId, time: number): void {
    if (!unit) return;
    const quip = unit.kind === 'smecher' ? undefined : FACTIONS[unit.faction].quips[target];
    if (quip && Math.random() < 0.5) {
      this.hud.say(`u${unit.id}`, quip, time);
      this.sfx.voice({ faction: unit.faction, unitKind: unit.kind, kind: 'attack', text: quip });
    } else {
      this.speak(unit, 'attack', time);
    }
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
