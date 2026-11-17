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
  private readonly bubbles = new Map<string, Bubble>();
  private actionsKey = '';
  private toastUntil = Infinity;

  constructor(onAction: (id: string) => void) {
    this.actions.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button');
      if (button && !button.disabled && button.dataset.action) onAction(button.dataset.action);
    });
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
