import Phaser from 'phaser';
import { GameScene } from './render/GameScene';
import './ui/hud.css';

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
  scene: [GameScene],
});
