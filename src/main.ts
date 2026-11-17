import Phaser from 'phaser';
import { SoundEngine } from './audio/sound';
import { FACTION_IDS, FACTIONS, type FactionId } from './data/factions';
import { GameScene } from './render/GameScene';
import { formatSaveSummary, loadGame, type SaveGame } from './save';
import './ui/hud.css';

const sound = new SoundEngine();
let activeGame: Phaser.Game | null = null;

function launch(options: { player: FactionId; peaceful: boolean; save?: SaveGame }): void {
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

/** Faction picker (plus Continue if a saved match exists). */
function showMenu(): void {
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
  if (!list) return;
  list.replaceChildren();
  for (const id of FACTION_IDS) {
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
    button.addEventListener('click', () => launch({ player: id, peaceful: peace?.checked ?? false }));
    list.appendChild(button);
  }
}

// "?faction=moldova" skips the menu and "&peace=1" keeps the neighbour quiet
// (handy while developing).
const params = new URLSearchParams(location.search);
const preset = FACTION_IDS.find((id) => id === params.get('faction'));
if (preset) launch({ player: preset, peaceful: params.get('peace') === '1' });
else showMenu();
