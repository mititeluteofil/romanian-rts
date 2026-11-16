const BUBBLE_MS = 2200;

interface Bubble {
  readonly el: HTMLDivElement;
  expiresAt: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/**
 * HTML overlay on top of the game canvas. Menus and text live in the DOM
 * (crisp diacritics, easy layout); only the world itself is drawn by Phaser.
 */
export class Hud {
  private readonly selection = byId<HTMLSpanElement>('hud-selection');
  private readonly hint = byId<HTMLDivElement>('hint');
  private readonly debug = byId<HTMLDivElement>('debug');
  private readonly bubbleLayer = byId<HTMLDivElement>('bubbles');
  private readonly bubbles = new Map<number, Bubble>();

  setSelection(text: string): void {
    this.selection.textContent = text;
  }

  setDebug(text: string): void {
    this.debug.textContent = text;
  }

  hideHint(): void {
    this.hint.classList.add('hidden');
  }

  /** Show a speech bubble above a unit, replacing its previous one. */
  say(unitId: number, text: string, now: number): void {
    let bubble = this.bubbles.get(unitId);
    if (!bubble) {
      const el = document.createElement('div');
      el.className = 'bubble';
      this.bubbleLayer.appendChild(el);
      bubble = { el, expiresAt: 0 };
      this.bubbles.set(unitId, bubble);
    }
    bubble.el.textContent = text;
    bubble.expiresAt = now + BUBBLE_MS;
  }

  /** Reposition live bubbles and drop expired ones; call once per frame. */
  updateBubbles(now: number, screenPosition: (unitId: number) => { x: number; y: number } | undefined): void {
    for (const [unitId, bubble] of this.bubbles) {
      const pos = now < bubble.expiresAt ? screenPosition(unitId) : undefined;
      if (!pos) {
        bubble.el.remove();
        this.bubbles.delete(unitId);
        continue;
      }
      bubble.el.style.transform = `translate(calc(${pos.x.toFixed(1)}px - 50%), calc(${pos.y.toFixed(1)}px - 100% - 10px))`;
    }
  }
}
