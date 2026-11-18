import { DIFFICULTY_LABELS, type AiSnapshot, type Difficulty } from './ai/skirmish';
import { ERAS } from './data/eras';
import { FACTIONS, PLAYABLE_FACTION_IDS, type FactionId } from './data/factions';
import { TICK_RATE, type WorldSnapshot } from './sim/world';

export const SAVE_KEY = 'unirea.save.v1';
export const NICKNAME_KEY = 'unirea.nickname.v1';
export const DEFAULT_NICKNAME = 'Voievod';

export interface SaveGame {
  readonly version: 1;
  readonly savedAt: number;
  readonly player: FactionId;
  readonly nickname?: string;
  readonly peaceful: boolean;
  readonly difficulty?: Difficulty;
  readonly goalReached: boolean;
  readonly lost: boolean;
  readonly taxed: boolean;
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly world: WorldSnapshot;
  readonly ais: readonly AiSnapshot[];
}

/** Clean up a user-entered nickname, falling back to DEFAULT_NICKNAME ("Voievod") when empty. */
export function sanitizeNickname(raw?: string | null): string {
  const cleaned = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : DEFAULT_NICKNAME;
}

export function loadNickname(): string {
  if (typeof window === 'undefined') return DEFAULT_NICKNAME;
  try {
    return sanitizeNickname(window.localStorage.getItem(NICKNAME_KEY));
  } catch {
    return DEFAULT_NICKNAME;
  }
}

export function saveNickname(raw?: string | null): string {
  const nick = sanitizeNickname(raw);
  if (typeof window !== 'undefined') {
    try {
      if ((raw ?? '').trim().length === 0) window.localStorage.removeItem(NICKNAME_KEY);
      else window.localStorage.setItem(NICKNAME_KEY, nick);
    } catch {
      // ignore storage errors
    }
  }
  return nick;
}

export function saveGame(save: SaveGame): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): SaveGame | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaveGame>;
    if (
      parsed.version !== 1 ||
      !PLAYABLE_FACTION_IDS.includes(parsed.player as FactionId) ||
      !parsed.world ||
      parsed.world.version !== 1 ||
      !Array.isArray(parsed.ais) ||
      !parsed.camera
    ) {
      return null;
    }
    return parsed as SaveGame;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function formatSaveSummary(save: SaveGame): string {
  const nick = sanitizeNickname(save.nickname);
  const faction = FACTIONS[save.player].name;
  const era = ERAS[save.world.era[save.player]] ?? ERAS[0]!;
  const mins = Math.floor(save.world.tick / TICK_RATE / 60);
  const secs = Math.floor(save.world.tick / TICK_RATE) % 60;
  const time = mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;
  const mode = save.peaceful ? ' · Fără război' : ` · ${DIFFICULTY_LABELS[save.difficulty ?? 'normal']}`;
  return `${nick} · ${faction} · ${era.name} (${era.year})${mode} · ${time}`;
}
