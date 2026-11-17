import Phaser from 'phaser';

const DRAG_THRESHOLD_PX = 10;
const TAP_MAX_MS = 500;
const MAX_ZOOM = 6;
const KEY_PAN_SPEED = 520; // screen px per second

interface ActivePointer {
  x: number;
  y: number;
}

/**
 * One input scheme for touch and mouse:
 *   drag = pan, pinch / wheel = zoom, short tap = `onTap(worldX, worldY)`.
 * Arrow keys and WASD also pan on desktop.
 */
export class CameraControls {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly active = new Map<number, ActivePointer>();
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key> | undefined;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private dragging = false;
  private multiTouch = false;
  private pinchDistance = 0;
  /** World point at the middle of the view; kept stable when the window resizes. */
  private centerX = 0;
  private centerY = 0;
  /** True once the player has moved or zoomed the camera themselves. */
  touched = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldWidth: number,
    private readonly worldHeight: number,
    private readonly onTap: (worldX: number, worldY: number) => void,
  ) {
    this.cam = scene.cameras.main;
    const input = scene.input;
    input.mouse?.disableContextMenu();
    input.on('pointerdown', this.onDown, this);
    input.on('pointermove', this.onMove, this);
    input.on('pointerup', this.onUp, this);
    input.on('pointerupoutside', this.onUp, this);
    input.on('wheel', this.onWheel, this);
    scene.game.events.on('blur', this.reset, this);
    scene.scale.on('resize', this.onResize, this);
    this.keys = input.keyboard?.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT') as
      | Record<string, Phaser.Input.Keyboard.Key>
      | undefined;
  }

  get zoom(): number {
    return this.cam.zoom;
  }

  /** Smallest zoom that still keeps the view inside the map. */
  private get minZoom(): number {
    return Math.max(1, this.cam.width / this.worldWidth, this.cam.height / this.worldHeight);
  }

  // The camera zooms around its centre:
  //   screen = (world - scroll - centre) * zoom + centre
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cx = this.cam.width / 2;
    const cy = this.cam.height / 2;
    return {
      x: (sx - cx) / this.cam.zoom + cx + this.cam.scrollX,
      y: (sy - cy) / this.cam.zoom + cy + this.cam.scrollY,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const cx = this.cam.width / 2;
    const cy = this.cam.height / 2;
    return {
      x: (wx - this.cam.scrollX - cx) * this.cam.zoom + cx,
      y: (wy - this.cam.scrollY - cy) * this.cam.zoom + cy,
    };
  }

  centerOn(wx: number, wy: number): void {
    this.cam.scrollX = wx - this.cam.width / 2;
    this.cam.scrollY = wy - this.cam.height / 2;
    this.clamp();
  }

  /** Player-driven jump (minimap): centre on a world point and keep it there. */
  jumpTo(wx: number, wy: number): void {
    this.touched = true;
    this.centerOn(wx, wy);
  }

  /** The part of the world on screen, in world pixels. */
  viewRect(): { x: number; y: number; width: number; height: number } {
    const topLeft = this.screenToWorld(0, 0);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: this.cam.width / this.cam.zoom,
      height: this.cam.height / this.cam.zoom,
    };
  }

  setZoom(zoom: number): void {
    this.zoomAt(this.cam.width / 2, this.cam.height / 2, zoom);
  }

  /** Zoom while keeping the world point under (sx, sy) fixed on screen. */
  private zoomAt(sx: number, sy: number, zoom: number): void {
    const before = this.screenToWorld(sx, sy);
    this.cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom, MAX_ZOOM));
    const after = this.screenToWorld(sx, sy);
    this.cam.scrollX += before.x - after.x;
    this.cam.scrollY += before.y - after.y;
    this.clamp();
  }

  private clamp(): void {
    const cam = this.cam;
    if (cam.zoom < this.minZoom) cam.setZoom(this.minZoom);
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    // scroll value at which the left/top edge of the view sits at world 0
    const offX = cam.width / 2 - viewW / 2;
    const offY = cam.height / 2 - viewH / 2;
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, -offX, Math.max(-offX, this.worldWidth - viewW - offX));
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, -offY, Math.max(-offY, this.worldHeight - viewH - offY));
    this.centerX = cam.scrollX + cam.width / 2;
    this.centerY = cam.scrollY + cam.height / 2;
  }

  /** Rotation / window resize: keep looking at the same spot. */
  private onResize(): void {
    this.centerOn(this.centerX, this.centerY);
  }

  private reset(): void {
    this.active.clear();
    this.dragging = false;
    this.multiTouch = false;
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    this.touched = true;
    this.active.set(pointer.id, { x: pointer.x, y: pointer.y });
    if (this.active.size === 1) {
      this.startX = pointer.x;
      this.startY = pointer.y;
      this.startTime = this.scene.time.now;
      this.dragging = false;
      this.multiTouch = false;
    } else {
      this.multiTouch = true;
      this.pinchDistance = this.currentPinchDistance();
    }
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const tracked = this.active.get(pointer.id);
    if (!tracked) return; // mouse hovering without a button held
    const dx = pointer.x - tracked.x;
    const dy = pointer.y - tracked.y;
    tracked.x = pointer.x;
    tracked.y = pointer.y;

    if (this.active.size >= 2) {
      const distance = this.currentPinchDistance();
      const mid = this.pinchMidpoint();
      if (this.pinchDistance > 0 && distance > 0) {
        this.zoomAt(mid.x, mid.y, this.cam.zoom * (distance / this.pinchDistance));
      }
      this.pinchDistance = distance;
      // Two-finger drag also pans; each finger contributes half the motion.
      this.cam.scrollX -= dx / 2 / this.cam.zoom;
      this.cam.scrollY -= dy / 2 / this.cam.zoom;
      this.clamp();
      return;
    }

    if (!this.dragging) {
      const moved = Math.hypot(pointer.x - this.startX, pointer.y - this.startY);
      if (moved < DRAG_THRESHOLD_PX) return;
      this.dragging = true;
    }
    this.cam.scrollX -= dx / this.cam.zoom;
    this.cam.scrollY -= dy / this.cam.zoom;
    this.clamp();
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (!this.active.has(pointer.id)) return;
    const wasOnlyPointer = this.active.size === 1;
    this.active.delete(pointer.id);
    const quick = this.scene.time.now - this.startTime <= TAP_MAX_MS;
    if (wasOnlyPointer && !this.dragging && !this.multiTouch && quick) {
      const world = this.screenToWorld(pointer.x, pointer.y);
      this.onTap(world.x, world.y);
    }
    if (this.active.size === 0) {
      this.dragging = false;
      this.multiTouch = false;
    } else {
      // Lifting one of two fingers must not turn the other into a tap or a jump.
      this.dragging = true;
    }
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (dy === 0) return;
    this.touched = true;
    this.zoomAt(pointer.x, pointer.y, this.cam.zoom * (dy > 0 ? 1 / 1.15 : 1.15));
  }

  private twoPointers(): [ActivePointer, ActivePointer] | undefined {
    const [a, b] = [...this.active.values()];
    return a && b ? [a, b] : undefined;
  }

  private currentPinchDistance(): number {
    const pair = this.twoPointers();
    return pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
  }

  private pinchMidpoint(): { x: number; y: number } {
    const pair = this.twoPointers();
    if (!pair) return { x: this.cam.width / 2, y: this.cam.height / 2 };
    return { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
  }

  /** Keyboard panning; call once per frame. */
  update(deltaMs: number): void {
    const k = this.keys;
    if (!k) return;
    const step = (KEY_PAN_SPEED * deltaMs) / 1000 / this.cam.zoom;
    let dx = 0;
    let dy = 0;
    if (k.A?.isDown || k.LEFT?.isDown) dx -= step;
    if (k.D?.isDown || k.RIGHT?.isDown) dx += step;
    if (k.W?.isDown || k.UP?.isDown) dy -= step;
    if (k.S?.isDown || k.DOWN?.isDown) dy += step;
    if (dx === 0 && dy === 0) return;
    this.touched = true;
    this.cam.scrollX += dx;
    this.cam.scrollY += dy;
    this.clamp();
  }
}
