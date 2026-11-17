import type { FactionId, LineKind, UnitKind } from '../data/factions';

export type SfxKind =
  | 'select'
  | 'order'
  | 'hit'
  | 'die'
  | 'built'
  | 'train'
  | 'distill'
  | 'era'
  | 'bribeOk'
  | 'bribeFail'
  | 'haraci'
  | 'raid'
  | 'palinca'
  | 'taunt'
  | 'rezolvaOk'
  | 'rezolvaFail'
  | 'plaja'
  | 'scandal'
  | 'win'
  | 'lose'
  | 'save';

export interface VoiceLineContext {
  readonly faction: FactionId;
  readonly unitKind?: UnitKind;
  readonly kind: LineKind | 'built' | 'bribe' | 'era' | 'win' | 'lose';
  readonly text: string;
}

/**
 * External voice-line hook: replace or augment the built-in retro voice chirp
 * with pre-recorded Romanian voice clips or SpeechSynthesis.
 */
export type VoiceLineHook = (ctx: VoiceLineContext) => void;

const MUTE_KEY = 'unirea.muted';

const FACTION_BASE_HZ: Readonly<Record<FactionId, number>> = {
  ardeal: 210,
  moldova: 270,
  tara: 245,
  dobrogea: 255,
  otomani: 195,
};

type Wave = OscillatorType;

/**
 * Procedural Web Audio sound effects plus a pluggable voice-line hook.
 * Requires no external audio assets and works offline in browsers and WebViews.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private voiceHook: VoiceLineHook | null = null;
  private readonly lastPlayed = new Map<string, number>();

  constructor() {
    this.muted = this.readMutePref();
  }

  private readMutePref(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
      } catch {
        // ignore storage errors in restricted WebViews
      }
    }
    if (!this.muted) this.unlock();
    return this.muted;
  }

  setVoiceHook(hook: VoiceLineHook | null): void {
    this.voiceHook = hook;
  }

  /** Call from a user gesture to satisfy browser / WebView autoplay policies. */
  unlock(): void {
    if (this.muted || typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  private ready(key: string, cooldownMs: number): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) this.unlock();
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const now = performance.now();
    const prev = this.lastPlayed.get(key) ?? -Infinity;
    if (now - prev < cooldownMs) return null;
    this.lastPlayed.set(key, now);
    return this.ctx;
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    endFreq: number,
    duration: number,
    type: Wave,
    gain: number,
    delay = 0,
  ): void {
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(gain, start + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  play(kind: SfxKind): void {
    const cooldown = kind === 'hit' ? 90 : kind === 'die' ? 120 : 40;
    const ctx = this.ready(kind, cooldown);
    if (!ctx) return;

    switch (kind) {
      case 'select':
        this.tone(ctx, 520, 620, 0.05, 'triangle', 0.06);
        break;
      case 'order':
        this.tone(ctx, 380, 460, 0.06, 'triangle', 0.06);
        break;
      case 'hit':
        this.tone(ctx, 180, 75, 0.07, 'square', 0.05);
        break;
      case 'die':
        this.tone(ctx, 260, 95, 0.18, 'sawtooth', 0.05);
        break;
      case 'built':
        this.tone(ctx, 392, 392, 0.08, 'triangle', 0.07, 0);
        this.tone(ctx, 523, 523, 0.14, 'triangle', 0.07, 0.07);
        break;
      case 'train':
        this.tone(ctx, 440, 587, 0.09, 'triangle', 0.06);
        break;
      case 'distill':
        this.tone(ctx, 300, 620, 0.09, 'sine', 0.06);
        break;
      case 'era':
        this.tone(ctx, 392, 392, 0.1, 'triangle', 0.08, 0);
        this.tone(ctx, 494, 494, 0.1, 'triangle', 0.08, 0.09);
        this.tone(ctx, 587, 587, 0.1, 'triangle', 0.08, 0.18);
        this.tone(ctx, 784, 784, 0.24, 'triangle', 0.09, 0.27);
        break;
      case 'bribeOk':
        this.tone(ctx, 880, 1175, 0.08, 'sine', 0.07, 0);
        this.tone(ctx, 1175, 1318, 0.1, 'sine', 0.06, 0.07);
        break;
      case 'bribeFail':
        this.tone(ctx, 220, 140, 0.16, 'sawtooth', 0.06);
        break;
      case 'haraci':
        this.tone(ctx, 220, 220, 0.14, 'sawtooth', 0.06, 0);
        this.tone(ctx, 208, 196, 0.22, 'sawtooth', 0.06, 0.15);
        break;
      case 'raid':
        this.tone(ctx, 165, 165, 0.14, 'sawtooth', 0.08, 0);
        this.tone(ctx, 220, 196, 0.25, 'sawtooth', 0.08, 0.14);
        break;
      case 'palinca':
        this.tone(ctx, 330, 494, 0.09, 'sine', 0.07, 0);
        this.tone(ctx, 494, 660, 0.12, 'sine', 0.07, 0.08);
        break;
      case 'taunt':
        this.tone(ctx, 294, 440, 0.12, 'square', 0.06, 0);
        this.tone(ctx, 440, 392, 0.12, 'square', 0.05, 0.1);
        break;
      case 'rezolvaOk':
        this.tone(ctx, 523, 784, 0.14, 'triangle', 0.07);
        break;
      case 'rezolvaFail':
        this.tone(ctx, 311, 185, 0.2, 'sawtooth', 0.06);
        break;
      case 'plaja':
        this.tone(ctx, 440, 554, 0.12, 'sine', 0.06, 0);
        this.tone(ctx, 554, 659, 0.16, 'sine', 0.06, 0.1);
        break;
      case 'scandal':
        this.tone(ctx, 640, 410, 0.08, 'square', 0.045, 0);
        this.tone(ctx, 480, 720, 0.08, 'square', 0.045, 0.07);
        break;
      case 'win':
        this.tone(ctx, 523, 523, 0.12, 'triangle', 0.09, 0);
        this.tone(ctx, 659, 659, 0.12, 'triangle', 0.09, 0.11);
        this.tone(ctx, 784, 784, 0.14, 'triangle', 0.09, 0.22);
        this.tone(ctx, 1046, 1046, 0.35, 'triangle', 0.1, 0.34);
        break;
      case 'lose':
        this.tone(ctx, 330, 311, 0.18, 'sawtooth', 0.07, 0);
        this.tone(ctx, 294, 247, 0.22, 'sawtooth', 0.07, 0.18);
        this.tone(ctx, 220, 165, 0.38, 'sawtooth', 0.07, 0.38);
        break;
      case 'save':
        this.tone(ctx, 587, 880, 0.09, 'sine', 0.06);
        break;
    }
  }

  /**
   * Called whenever a unit or building utters a line. Routes to `voiceHook`
   * if registered, otherwise plays a short faction-pitched vocal chirp.
   */
  voice(context: VoiceLineContext): void {
    if (this.muted) return;
    if (this.voiceHook) {
      this.voiceHook(context);
      return;
    }
    const ctx = this.ready('voice', 220);
    if (!ctx) return;
    const base = FACTION_BASE_HZ[context.faction] + (context.unitKind === 'smecher' ? 75 : 0);
    const jitter = (context.text.length % 5) * 14;
    const f1 = base + jitter;
    const f2 = context.kind === 'die' ? f1 * 0.72 : f1 * 1.18;
    this.tone(ctx, f1, f2, 0.065, 'triangle', 0.04, 0);
    if (context.text.length > 14) {
      this.tone(ctx, f2, f1 * 1.05, 0.055, 'triangle', 0.035, 0.065);
    }
  }
}
