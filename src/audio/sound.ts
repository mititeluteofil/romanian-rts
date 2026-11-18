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

export type VoiceEventKind = LineKind | 'built' | 'bribe' | 'era' | 'win' | 'lose';

export interface VoiceLineContext {
  readonly faction: FactionId;
  readonly unitKind?: UnitKind;
  readonly kind: VoiceEventKind;
  readonly text: string;
}

/**
 * External voice-line hook: replace or augment the built-in voice pack / chirp
 * with custom audio clips or SpeechSynthesis.
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

/** Pre-cut voice clips under `public/voices/` mapped by faction and line kind. */
const VOICE_CLIPS: Readonly<Partial<Record<FactionId, Readonly<Partial<Record<VoiceEventKind, readonly string[]>>>>>> = {
  moldova: {
    select: ['moldova/si-vrei-1.mp3', 'moldova/si-vrei-2.mp3', 'moldova/si-vrei-3.mp3'],
    taunt: ['moldova/si-vrei-3.mp3', 'moldova/si-vrei-2.mp3'],
    scandal: ['moldova/si-vrei-1.mp3', 'moldova/si-vrei-3.mp3'],
    build: ['moldova/cocioaba.mp3', 'moldova/munca-hai.mp3'],
    built: ['moldova/cocioaba.mp3'],
    move: ['moldova/veniti.mp3', 'moldova/munca-hai.mp3', 'moldova/italia.mp3'],
    wood: ['moldova/munca-hai.mp3'],
    plums: ['moldova/munca-hai.mp3'],
    attack: ['moldova/cap-de-bour.mp3', 'moldova/metal-stefan.mp3', 'moldova/metal-au.mp3'],
    die: ['moldova/alergic.mp3', 'moldova/metal-stefan.mp3'],
  },
  ardeal: {
    select: ['ardeal/neamtu.mp3'],
    scandal: ['ardeal/neamtu.mp3'],
    drink: ['ardeal/palinca-hai.mp3'],
    build: ['ardeal/palinca-hai.mp3', 'ardeal/maine-cafa.mp3'],
    move: ['ardeal/maine-cafa.mp3'],
    wood: ['ardeal/maine-cafa.mp3'],
    plums: ['ardeal/palinca-hai.mp3'],
  },
  tara: {
    select: ['tara/da-boss.mp3'],
    move: ['tara/da-boss.mp3'],
    wood: ['tara/da-boss.mp3'],
    plums: ['tara/da-boss.mp3'],
    build: ['tara/facem-janica.mp3'],
    built: ['tara/facem-janica.mp3'],
    bribe: ['tara/facem-janica.mp3'],
    attack: ['tara/baga-sabia.mp3'],
    taunt: ['tara/baga-sabia.mp3'],
  },
};

/** Match speech-bubble text directly to its matching clip when possible. */
export function clipForLine(ctx: VoiceLineContext): string | undefined {
  const lower = ctx.text.toLowerCase();
  if (ctx.faction === 'moldova') {
    if (lower.includes('și vrei')) return ['moldova/si-vrei-1.mp3', 'moldova/si-vrei-2.mp3', 'moldova/si-vrei-3.mp3'][ctx.text.length % 3];
    if (lower.includes('cocioab')) return 'moldova/cocioaba.mp3';
    if (lower.includes('italia')) return 'moldova/italia.mp3';
    if (lower.includes('ardeal')) return 'moldova/veniti.mp3';
    if (lower.includes('cap de bour')) return 'moldova/cap-de-bour.mp3';
    if (lower.includes('metal')) return lower.includes('ștefan') ? 'moldova/metal-stefan.mp3' : 'moldova/metal-au.mp3';
    if (lower.includes('alergic')) return 'moldova/alergic.mp3';
    if (lower.includes('munc')) return 'moldova/munca-hai.mp3';
  } else if (ctx.faction === 'ardeal') {
    if (lower.includes('neamtu')) return 'ardeal/neamtu.mp3';
    if (lower.includes('pălinc') || lower.includes('cunoaștem')) return 'ardeal/palinca-hai.mp3';
    if (lower.includes('cafă') || lower.includes('mâine')) return 'ardeal/maine-cafa.mp3';
  } else if (ctx.faction === 'tara') {
    if (lower.includes('boss')) return 'tara/da-boss.mp3';
    if (lower.includes('facem')) return 'tara/facem-janica.mp3';
    if (lower.includes('sabia')) return 'tara/baga-sabia.mp3';
  }
  const pool = VOICE_CLIPS[ctx.faction]?.[ctx.kind];
  if (!pool || pool.length === 0) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}

type Wave = OscillatorType;

/**
 * Procedural Web Audio sound effects plus recorded Romanian voice clips and a
 * pluggable voice-line hook. Falls back cleanly to chirps when offline or uncached.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private voiceHook: VoiceLineHook | null = null;
  private readonly lastPlayed = new Map<string, number>();
  private readonly bufferCache = new Map<string, AudioBuffer | 'loading' | 'failed'>();
  private activeVoice: AudioBufferSourceNode | null = null;

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
    if (this.muted && this.activeVoice) {
      try {
        this.activeVoice.stop();
      } catch {
        // already stopped
      }
      this.activeVoice = null;
    }
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

  private playClip(ctx: AudioContext, relPath: string): boolean {
    if (typeof fetch === 'undefined') return false;
    const cached = this.bufferCache.get(relPath);
    if (cached === 'failed') return false;
    if (cached && cached !== 'loading') {
      this.startBuffer(ctx, cached);
      return true;
    }
    if (cached !== 'loading') {
      this.bufferCache.set(relPath, 'loading');
      void fetch(`./voices/${relPath}`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('HTTP ' + res.status))))
        .then((arr) => ctx.decodeAudioData(arr))
        .then((buf) => {
          this.bufferCache.set(relPath, buf);
          if (!this.muted && ctx.state === 'running' && !this.activeVoice) {
            this.startBuffer(ctx, buf);
          }
        })
        .catch(() => {
          this.bufferCache.set(relPath, 'failed');
        });
    }
    return true;
  }

  private startBuffer(ctx: AudioContext, buf: AudioBuffer): void {
    if (this.activeVoice) {
      try {
        this.activeVoice.stop();
      } catch {
        // ignore if already ended
      }
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.55;
    src.buffer = buf;
    src.connect(gain).connect(ctx.destination);
    src.onended = () => {
      if (this.activeVoice === src) this.activeVoice = null;
    };
    this.activeVoice = src;
    src.start();
  }

  /**
   * Called whenever a unit or building utters a line. Routes to `voiceHook`
   * if registered, otherwise plays a matched voice clip or falls back to a chirp.
   */
  voice(context: VoiceLineContext): void {
    if (this.muted) return;
    if (this.voiceHook) {
      this.voiceHook(context);
      return;
    }
    const clip = context.unitKind === 'smecher' ? undefined : clipForLine(context);
    const ctx = this.ready('voice', clip ? 750 : 220);
    if (!ctx) return;
    if (clip && this.playClip(ctx, clip)) return;

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
