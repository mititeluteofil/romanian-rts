import { DIFFICULTY_LABELS, type AiSnapshot, type Difficulty } from './ai/skirmish';
import { ERAS } from './data/eras';
import { FACTIONS, PLAYABLE_FACTION_IDS, type FactionId } from './data/factions';
import { TICK_RATE, type WorldSnapshot } from './sim/world';

export const SAVE_KEY = 'unirea.save.v1';

export interface SaveGame {
  readonly version: 1;
  readonly savedAt: number;
  readonly player: FactionId;
  readonly peaceful: boolean;
  readonly difficulty?: Difficulty;
  readonly goalReached: boolean;
  readonly lost: boolean;
  readonly taxed: boolean;
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly world: WorldSnapshot;
  readonly ais: readonly AiSnapshot[];
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
  const faction = FACTIONS[save.player].name;
  const era = ERAS[save.world.era[save.player]] ?? ERAS[0]!;
  const mins = Math.floor(save.world.tick / TICK_RATE / 60);
  const secs = Math.floor(save.world.tick / TICK_RATE) % 60;
  const time = mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;
  const mode = save.peaceful ? ' · Fără război' : ` · ${DIFFICULTY_LABELS[save.difficulty ?? 'normal']}`;
  return `${faction} · ${era.name} (${era.year})${mode} · ${time}`;
}
