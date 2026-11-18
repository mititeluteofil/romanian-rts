import Phaser from 'phaser';
import type { Difficulty } from './ai/skirmish';
import { SoundEngine } from './audio/sound';
import { FACTIONS, PLAYABLE_FACTION_IDS, type FactionId } from './data/factions';
import type { CommandSink } from './net/lockstep';
import { GameScene } from './render/GameScene';
import {
  clearSave,
  DEFAULT_NICKNAME,
  formatSaveSummary,
  loadGame,
  loadNickname,
  NICKNAME_KEY,
  saveNickname,
  type SaveGame,
} from './save';
import { armTwoTap } from './ui/confirm';
import { initMultiplayer } from './ui/multiplayer';
import './ui/hud.css';

const sound = new SoundEngine();
let activeGame: Phaser.Game | null = null;
let activeExit: (() => void) | null = null;
let selectedDifficulty: Difficulty = 'normal';

function launch(options: {
  player: FactionId;
  nickname?: string;
  peaceful: boolean;
  difficulty?: Difficulty;
  mapScale?: number;
  includeOltenia?: boolean;
  save?: SaveGame;
  commandSink?: CommandSink;
  online?: { seed: number; humanFactions: readonly FactionId[] };
  /** Called once when this game is left for the menu. */
  onExit?: () => void;
}): GameScene {
  sound.unlock();
  document.getElementById('menu')?.classList.add('hidden');
  exitGame();
  const { onExit, ...sceneOptions } = options;
  activeExit = onExit ?? null;
  const scene = new GameScene({
    ...sceneOptions,
    sound,
    onReturnToMenu: returnToMenu,
  });
  activeGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1b2a1b',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    input: {
      // Mouse plus enough touch points for pinch-zoom.
      activePointers: 3,
    },
    scene: [scene],
  });
  return scene;
}

/** Destroy the running game (if any) and run its exit hook. */
function exitGame(): void {
  activeGame?.destroy(true);
  activeGame = null;
  const exit = activeExit;
  activeExit = null;
  exit?.();
}

function returnToMenu(): void {
  exitGame();
  document.getElementById('menu')?.classList.remove('hidden');
  showMenu();
}

function wireDifficultyButtons(): void {
  const group = document.getElementById('menu-difficulty');
  if (!group) return;
  const buttons = group.querySelectorAll<HTMLButtonElement>('button[data-difficulty]');
  const sync = () => {
    buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.difficulty === selectedDifficulty));
  };
  sync();
  if (group.dataset.wired) return;
  group.dataset.wired = '1';
  group.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-difficulty]');
    const diff = btn?.dataset.difficulty as Difficulty | undefined;
    if (!diff) return;
    selectedDifficulty = diff;
    sync();
  });
}

function wireNicknameInput(): HTMLInputElement | null {
  const input = document.getElementById('menu-nickname') as HTMLInputElement | null;
  if (!input) return null;
  input.placeholder = `${DEFAULT_NICKNAME} (implicit)`;
  let stored = '';
  try {
    stored = window.localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    // ignore storage errors
  }
  input.value = stored;
  // `defaultValue` marks what was prefilled, so Continue can tell an edit (even a clear) from no edit.
  input.defaultValue = stored;
  if (!input.dataset.wired) {
    input.dataset.wired = '1';
    input.addEventListener('change', () => {
      saveNickname(input.value);
    });
  }
  return input;
}

/** Faction picker (plus Continue / Delete if a saved match exists). */
function showMenu(): void {
  wireDifficultyButtons();
  const nickInput = wireNicknameInput();

  const cont = document.getElementById('menu-continue');
  const saved = loadGame();
  if (cont) {
    cont.replaceChildren();
    if (saved) {
      cont.classList.remove('hidden');
      const resumeBtn = document.createElement('button');
      resumeBtn.type = 'button';
      resumeBtn.id = 'btn-continue-save';
      resumeBtn.className = 'continue-btn';
      const title = document.createElement('strong');
      title.textContent = 'Continuă partida';
      const detail = document.createElement('span');
      detail.textContent = formatSaveSummary(saved);
      resumeBtn.append(title, detail);
      resumeBtn.addEventListener('click', () => {
        const edited = nickInput !== null && nickInput.value !== nickInput.defaultValue;
        const nick = edited ? saveNickname(nickInput.value) : (saved.nickname ?? loadNickname());
        launch({ player: saved.player, nickname: nick, peaceful: saved.peaceful, save: saved });
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.id = 'btn-delete-save';
      deleteBtn.className = 'delete-save-btn';
      deleteBtn.textContent = 'Închide / Șterge partida';
      armTwoTap(deleteBtn, 'Sigur? Atinge iar ca să ștergi', () => {
        sound.unlock();
        sound.play('select');
        clearSave();
        cont.replaceChildren();
        cont.classList.add('hidden');
      });

      const note = document.createElement('p');
      note.className = 'continue-note';
      note.textContent = 'O partidă nouă o înlocuiește pe asta la prima salvare.';

      cont.append(resumeBtn, deleteBtn, note);
    } else {
      cont.classList.add('hidden');
    }
  }

  const list = document.getElementById('menu-factions');
  const peace = document.getElementById('menu-peace') as HTMLInputElement | null;
  const mapLarge = document.getElementById('menu-map-large') as HTMLInputElement | null;
  if (!list) return;
  list.replaceChildren();
  for (const id of PLAYABLE_FACTION_IDS) {
    const faction = FACTIONS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.style.setProperty('--faction', `#${faction.color.toString(16).padStart(6, '0')}`);
    const add = (tag: string, text: string): void => {
      const el = document.createElement(tag);
      el.textContent = text;
      button.appendChild(el);
    };
    add('strong', faction.name);
    add('em', faction.motto);
    add('span', `${faction.ability.name}: ${faction.ability.description}`);
    button.addEventListener('click', () => {
      const isLarge = Boolean(mapLarge?.checked);
      const nickname = saveNickname(nickInput?.value);
      launch({
        player: id,
        nickname,
        peaceful: peace?.checked ?? false,
        difficulty: selectedDifficulty,
        mapScale: isLarge ? 1.5 : 1,
        includeOltenia: id === 'oltenia' || isLarge,
      });
    });
    list.appendChild(button);
  }
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

const multiplayer = initMultiplayer({
  nickname: () => saveNickname((document.getElementById('menu-nickname') as HTMLInputElement | null)?.value),
  hostSettings: () => ({
    peaceful: (document.getElementById('menu-peace') as HTMLInputElement | null)?.checked ?? false,
    large: (document.getElementById('menu-map-large') as HTMLInputElement | null)?.checked ?? false,
    difficulty: selectedDifficulty,
  }),
  launch: (options) => launch(options),
  returnToMenu,
});

// "?faction=moldova" skips the menu and "&peace=1" keeps the neighbour quiet
// (handy while developing).
const params = new URLSearchParams(location.search);
const preset = PLAYABLE_FACTION_IDS.find((id) => id === params.get('faction'));
const diffParam = params.get('difficulty');
const diff: Difficulty = diffParam === 'usor' || diffParam === 'greu' ? diffParam : 'normal';
if (preset) {
  const isLarge = params.get('large') === '1';
  launch({
    player: preset,
    peaceful: params.get('peace') === '1',
    difficulty: diff,
    mapScale: isLarge ? 1.5 : 1,
    includeOltenia: preset === 'oltenia' || isLarge,
  });
} else {
  showMenu();
  // "?room=ABCDE" opens the multiplayer panel with the code filled in.
  const room = params.get('room');
  if (room) multiplayer.open(room);
}
