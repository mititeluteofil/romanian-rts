# Unirea: no, las' că vedem

A tongue-in-cheek Romanian historical RTS running from **1600** to **the present**. Pick one of four principalities, gather wood and plums (or pears, or fish), weather Ottoman tribute demands, advance through five historical eras, and either outlast your neighbours or — in peaceful mode — reach 2024 and open a mall.

## Principalities

- **Ardeal** (Alba Iulia) — Tougher walls, slow movement and construction, **Pălincă** still (`Cazan de pălincă`), and *Stai să bem o pălincă* (everyone pauses for a glass; yours work and hit harder afterwards).
- **Moldova** (Iași) — Fast **Răzeși** in numbers, and *Și vrei, wăi?* (draws nearby enemy soldiers onto one taunter who takes half damage).
- **Țara Românească** (Târgoviște) — Balanced **Dorobanți**, cheaper *Băieți de băieți*, Bucharest traffic near its court in the present, a capital cut of everyone else's EU funds, and *Lasă, că se rezolvă* (finishes everything in progress at once — except 1 time in 4 when it fails and costs 30 plums).
- **Dobrogea** (Constanța) — Shore-side **Cherhana** that catches fish automatically, exempt from Ottoman *haraci*, paid summer seasons in the present, and *Hai la mare* (sends enemy soldiers near the court to the beach for a fee).

## Eras

1. **Voievodat (1600)** — Courts, plum orchards, army camps, and Ottoman *haraci* demands.
2. **Epoca fanariotă (1750)** — Unlocks *Dă șpagă* (hurries a building or queue — unless the bribe is pocketed).
3. **România Mare (1918)** — Unlocks the sawmill (**Gater**), producing wood automatically.
4. **Epoca de Aur (1975)** — Everything costs half, training takes twice as long, unlocks apartment blocks (**Bloc**).
5. **Prezent (2024)** — Everything gets dearer, EU funds arrive periodically, and peasants plus *Băieți de băieți* (who start scandals that stun onlookers) are trained at the **Mall**.

## Controls

- **Select**: Tap/click a unit or building. Double-tap a unit to select all of your units of that kind.
- **Command**: With units selected, tap ground to move (groups fan out automatically), forest to chop wood, orchard to pick plums, unfinished friendly building to help build, or enemy to attack.
- **Camera**: Drag to pan, pinch (touch) or mouse wheel to zoom, `WASD` / arrow keys to pan, or tap/drag the minimap.
- **Match controls**:
  - `Pauză` (`Space` / `P`) pauses simulation while keeping camera pan/zoom active.
  - `1×` / `2×` / `4×` cycles simulation speed.
  - `Salvează` saves to `localStorage` (also autosaves every 15s of game time and when hiding/leaving the page); use **Continuă partida** on the main menu to resume.
  - `Sonor` / `Mut` toggles procedural Web Audio sound effects and the voice-line hook.

## Voice-Line Hook

All spoken unit/building lines route through `SoundEngine.voice(...)` in `src/audio/sound.ts`. You can register a custom handler (`sound.setVoiceHook(fn)` or `window.__unireaVoiceHook = (ctx) => { ... }`) receiving `{ faction, unitKind, kind, text }` to plug in recorded Romanian voice clips or Web Speech synthesis without modifying scene or simulation code.

## Development

```bash
npm install
npm run dev         # Start Vite dev server on http://localhost:5273
npm test            # Run Vitest simulation, AI, save, and fan-out suite
npm run typecheck   # Run tsc --noEmit
npm run build       # Typecheck + production Vite bundle in dist/
```

URL shortcuts for testing: `?faction=moldova` skips the menu; `&peace=1` starts in no-war mode;
`?room=ABCDE` opens the multiplayer panel with that room code filled in.

## Online multiplayer

Menu → **Multiplayer online** → *Creează cameră* gives a 5-character room code; friends enter it under
*Intră*. Players get principalities in join order (Ardeal, Moldova, Țara Românească, Dobrogea, then
Oltenia); the host's war/peace, map size and difficulty apply, and the AI plays the free principalities.
Online matches have no pause, speed-up or saves.

The client connects to the lockstep relay at `/relay?room=<code>` on the page's own origin. Builds that
are not served from the site (the Android app) need the deployed host baked in:

```bash
VITE_RELAY_URL=https://<your-worker-host> npm run android:sync
```

Local test: `npm run build`, then `npx wrangler@4 dev` and open two tabs on http://localhost:8787.

## Android (Capacitor)

The web bundle syncs into the Android Capacitor project cleanly:

```bash
npm run android:sync   # Builds dist/ and syncs to android/app/src/main/assets/public
```

Building a native APK via `./android/gradlew assembleDebug` requires:
- **JDK 17 or JDK 21** (Gradle 8.14 / AGP 8.13 does not support JDK 26+ class file version 70).
- **Android SDK** with Platform 36 installed (`ANDROID_HOME` / `ANDROID_SDK_ROOT` or `android/local.properties`).

## Architecture

- `src/sim/` — Deterministic integer simulation (`World`, `GameMap`, A* `pathfinding`, `Rng` mulberry32 + FNV-1a checksums). No `Math.random()`, `Date`, or rendering imports.
- `src/ai/` — Scripted `SkirmishAi` issuing commands through the same `World.issue()` interface as the player.
- `src/data/` — Principality definitions, buildings, eras, and Romania map geometry.
- `src/render/` — Phaser 4 scene (`GameScene`) and procedural pixel-art canvas textures (`textures.ts`).
- `src/input/` — Unified pointer/touch/keyboard `CameraControls` with pinch-zoom.
- `src/ui/` — DOM HUD overlay (`Hud`) and live `Minimap`.
- `src/audio/` — Procedural Web Audio `SoundEngine` and `VoiceLineHook`.
- `src/save.ts` — `localStorage` persistence (`SaveGame`).
