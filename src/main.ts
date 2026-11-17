import Phaser from 'phaser';
import { FACTION_IDS, FACTIONS, type FactionId } from './data/factions';
import { GameScene } from './render/GameScene';
import './ui/hud.css';

function startGame(player: FactionId, peaceful: boolean): void {
  document.getElementById('menu')?.classList.add('hidden');
  new Phaser.Game({
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
    scene: [new GameScene({ player, peaceful })],
  });
}

/** Faction picker: one button per principality, built from the faction data. */
function showMenu(): void {
  const list = document.getElementById('menu-factions');
  const peace = document.getElementById('menu-peace') as HTMLInputElement | null;
  if (!list) return;
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
    button.addEventListener('click', () => startGame(id, peace?.checked ?? false));
    list.appendChild(button);
  }
}

// "?faction=moldova" skips the menu and "&peace=1" keeps the neighbour quiet
// (handy while developing).
const params = new URLSearchParams(location.search);
const preset = FACTION_IDS.find((id) => id === params.get('faction'));
if (preset) startGame(preset, params.get('peace') === '1');
else showMenu();
