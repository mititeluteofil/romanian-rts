import { armTwoTap } from './confirm';

const BUBBLE_MS = 2200;

interface Bubble {
  readonly el: HTMLDivElement;
  expiresAt: number;
}

export interface ActionButton {
  readonly id: string;
  readonly label: string;
  /** Small second line, usually the price. */
  readonly detail?: string;
  readonly enabled: boolean;
  readonly primary?: boolean;
}

export interface HaraciPrompt {
  readonly amount: number;
  readonly food: string;
  readonly secondsLeft: number;
  readonly canPay: boolean;
}

export interface HudCallbacks {
  readonly onAction: (id: string) => void;
  readonly onHaraci: (pay: boolean) => void;
  readonly onBoxSelect: () => void;
  readonly onIdlePeasant: () => void;
  readonly onPause: () => void;
  readonly onSpeed: () => void;
  readonly onSave: () => void;
  readonly onMute: () => void;
  readonly onMenu: () => void;
  readonly onAbandon?: () => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/**
 * HTML overlay on top of the game canvas. Menus and text live in the DOM
 * (crisp diacritics, easy layout); only the world itself is drawn by Phaser.
 * Every setter is cheap to call each frame: the DOM is touched only on change.
 */
export class Hud {
  readonly minimapCanvas = byId<HTMLCanvasElement>('minimap');
  private readonly title = byId<HTMLSpanElement>('hud-title');
  private readonly stock = byId<HTMLSpanElement>('hud-stock');
  private readonly objective = byId<HTMLDivElement>('hud-objective');
  private readonly selection = byId<HTMLDivElement>('hud-selection');
  private readonly toastEl = byId<HTMLDivElement>('toast');
  private readonly actions = byId<HTMLDivElement>('actions');
  private readonly debug = byId<HTMLDivElement>('debug');
  private readonly bubbleLayer = byId<HTMLDivElement>('bubbles');
  private readonly boxBtn = byId<HTMLButtonElement>('btn-box');
  private readonly idleBtn = byId<HTMLButtonElement>('btn-idle');
  private readonly pauseBtn = byId<HTMLButtonElement>('btn-pause');
  private readonly speedBtn = byId<HTMLButtonElement>('btn-speed');
  private readonly saveBtn = byId<HTMLButtonElement>('btn-save');
  private readonly muteBtn = byId<HTMLButtonElement>('btn-mute');
  private readonly menuBtn = byId<HTMLButtonElement>('btn-menu');
  private readonly pauseBanner = byId<HTMLDivElement>('pause-banner');
  private readonly resumeBtn = byId<HTMLButtonElement>('btn-resume');
  private readonly abandonBtn = document.getElementById('btn-abandon') as HTMLButtonElement | null;
  private readonly haraciBox = byId<HTMLDivElement>('haraci-box');
  private readonly haraciText = byId<HTMLDivElement>('haraci-text');
  private readonly haraciTimer = byId<HTMLDivElement>('haraci-timer');
  private readonly haraciYesBtn = byId<HTMLButtonElement>('btn-haraci-yes');
  private readonly haraciNoBtn = byId<HTMLButtonElement>('btn-haraci-no');
  private readonly bubbles = new Map<string, Bubble>();
  private readonly ac = new AbortController();
  private actionsKey = '';
  private toastUntil = Infinity;

  constructor(callbacks: HudCallbacks) {
    const signal = this.ac.signal;
    this.actions.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest('button');
        if (button && !button.disabled && button.dataset.action) callbacks.onAction(button.dataset.action);
      },
      { signal },
    );
    this.boxBtn.addEventListener('click', () => callbacks.onBoxSelect(), { signal });
    this.idleBtn.addEventListener('click', () => callbacks.onIdlePeasant(), { signal });
    this.pauseBtn.addEventListener('click', () => callbacks.onPause(), { signal });
    this.resumeBtn.addEventListener('click', () => callbacks.onPause(), { signal });
    if (this.abandonBtn) {
      armTwoTap(this.abandonBtn, 'Sigur? Atinge iar ca să ștergi', () => callbacks.onAbandon?.(), signal);
    }
    this.speedBtn.addEventListener('click', () => callbacks.onSpeed(), { signal });
    this.saveBtn.addEventListener('click', () => callbacks.onSave(), { signal });
    this.muteBtn.addEventListener('click', () => callbacks.onMute(), { signal });
    this.menuBtn.addEventListener('click', () => callbacks.onMenu(), { signal });
    this.haraciYesBtn.addEventListener('click', () => callbacks.onHaraci(true), { signal });
    this.haraciNoBtn.addEventListener('click', () => callbacks.onHaraci(false), { signal });
  }

  destroy(): void {
    this.ac.abort();
    for (const b of this.bubbles.values()) b.el.remove();
    this.bubbles.clear();
    this.actions.replaceChildren();
    this.pauseBanner.classList.add('hidden');
    this.setOnline(false);
    this.haraciBox.classList.add('hidden');
    this.hideToast();
  }

  private static set(el: HTMLElement, text: string): void {
    if (el.textContent !== text) el.textContent = text;
  }

  setTitle(text: string): void {
    Hud.set(this.title, text);
  }

  setStock(text: string): void {
    Hud.set(this.stock, text);
  }

  setObjective(text: string): void {
    Hud.set(this.objective, text);
  }

  setSelection(text: string): void {
    Hud.set(this.selection, text);
  }

  setDebug(text: string): void {
    Hud.set(this.debug, text);
  }

  setBoxSelect(active: boolean): void {
    this.boxBtn.classList.toggle('active', active);
  }

  setIdleCount(count: number): void {
    Hud.set(this.idleBtn, `Liberi: ${count}`);
    this.idleBtn.disabled = count === 0;
  }

  setPaused(paused: boolean): void {
    Hud.set(this.pauseBtn, paused ? 'Continuă' : 'Pauză');
    this.pauseBtn.classList.toggle('active', paused);
    this.pauseBanner.classList.toggle('hidden', !paused);
  }

  /** Online matches share one clock and are not saved: hide pause, speed and save. */
  setOnline(online: boolean): void {
    for (const btn of [this.pauseBtn, this.speedBtn, this.saveBtn]) btn.classList.toggle('hidden', online);
  }

  setSpeed(speed: number): void {
    Hud.set(this.speedBtn, `${speed}×`);
    this.speedBtn.classList.toggle('active', speed > 1);
  }

  setMuted(muted: boolean): void {
    Hud.set(this.muteBtn, muted ? 'Mut' : 'Sonor');
    this.muteBtn.classList.toggle('muted', muted);
  }

  /** Persistent corner prompt with live countdown and Yes / No tribute buttons. */
  setHaraci(prompt: HaraciPrompt | null): void {
    if (!prompt) {
      this.haraciBox.classList.add('hidden');
      this.haraciBox.classList.remove('urgent');
      return;
    }
    this.haraciBox.classList.remove('hidden');
    this.haraciBox.classList.toggle('urgent', prompt.secondsLeft <= 10);
    Hud.set(this.haraciText, `Haraci Poartă: ${prompt.amount} ${prompt.food}`);
    Hud.set(this.haraciTimer, `Timp rămas: ${prompt.secondsLeft} s`);
    Hud.set(this.haraciYesBtn, 'Da, plătesc');
    this.haraciYesBtn.disabled = !prompt.canPay;
    Hud.set(this.haraciNoBtn, 'Nu plătesc');
  }

  /** Replace the action bar; rebuilt only when something actually changed. */
  setActions(buttons: readonly ActionButton[]): void {
    const key = JSON.stringify(buttons);
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    this.actions.replaceChildren(
      ...buttons.map((b) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = b.id;
        button.disabled = !b.enabled;
        if (b.primary) button.className = 'primary';
        button.textContent = b.label;
        if (b.detail) {
          const small = document.createElement('small');
          small.textContent = b.detail;
          button.appendChild(small);
        }
        return button;
      }),
    );
  }

  /** Show a message above the action bar. `ms` omitted = until replaced. */
  toast(text: string, now: number, ms?: number): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastUntil = ms === undefined ? Infinity : now + ms;
  }

  hideToast(): void {
    this.toastEl.classList.add('hidden');
    this.toastUntil = Infinity;
  }

  /** Speech bubble anchored to a key ("u12" for a unit, "b3" for a building). */
  say(key: string, text: string, now: number): void {
    let bubble = this.bubbles.get(key);
    if (!bubble) {
      const el = document.createElement('div');
      el.className = 'bubble';
      this.bubbleLayer.appendChild(el);
      bubble = { el, expiresAt: 0 };
      this.bubbles.set(key, bubble);
    }
    bubble.el.textContent = text;
    bubble.expiresAt = now + BUBBLE_MS;
  }

  /** Reposition bubbles, expire old ones and the toast; call once per frame. */
  update(now: number, screenPosition: (key: string) => { x: number; y: number } | undefined): void {
    if (now > this.toastUntil) this.hideToast();
    for (const [key, bubble] of this.bubbles) {
      const pos = now < bubble.expiresAt ? screenPosition(key) : undefined;
      if (!pos) {
        bubble.el.remove();
        this.bubbles.delete(key);
        continue;
      }
      bubble.el.style.transform = `translate(calc(${pos.x.toFixed(1)}px - 50%), calc(${pos.y.toFixed(1)}px - 100% - 10px))`;
    }
  }
}
