import Phaser from 'phaser';
import type { Difficulty } from './ai/skirmish';
import { SoundEngine } from './audio/sound';
import { FACTIONS, PLAYABLE_FACTION_IDS, type FactionId } from './data/factions';
import { GameScene } from './render/GameScene';
import { formatSaveSummary, loadGame, type SaveGame } from './save';
import './ui/hud.css';

const sound = new SoundEngine();
let activeGame: Phaser.Game | null = null;
let selectedDifficulty: Difficulty = 'normal';

function launch(options: {
  player: FactionId;
  peaceful: boolean;
  difficulty?: Difficulty;
  mapScale?: number;
  includeOltenia?: boolean;
  save?: SaveGame;
}): void {
  sound.unlock();
  document.getElementById('menu')?.classList.add('hidden');
  activeGame?.destroy(true);
  const scene = new GameScene({
    ...options,
    sound,
    onReturnToMenu: () => {
      activeGame?.destroy(true);
      activeGame = null;
      document.getElementById('menu')?.classList.remove('hidden');
      showMenu();
    },
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

/** Faction picker (plus Continue if a saved match exists). */
function showMenu(): void {
  wireDifficultyButtons();

  const cont = document.getElementById('menu-continue');
  const saved = loadGame();
  if (cont) {
    cont.replaceChildren();
    if (saved) {
      cont.classList.remove('hidden');
      const button = document.createElement('button');
      button.type = 'button';
      const title = document.createElement('strong');
      title.textContent = 'Continuă partida';
      const detail = document.createElement('span');
      detail.textContent = formatSaveSummary(saved);
      button.append(title, detail);
      button.addEventListener('click', () =>
        launch({ player: saved.player, peaceful: saved.peaceful, save: saved }),
      );
      cont.appendChild(button);
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
      launch({
        player: id,
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
} else showMenu();
