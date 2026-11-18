# Milestone 7+ Plan: Gameplay, Android CI, Audio/Art & Multiplayer

This document captures the proposed **Milestone 7** gameplay additions alongside detailed plans for **Cloud Android APK builds**, **remaining UX polish**, **Audio/Art/Content**, and **Lockstep Multiplayer**.

---

## 1. Core Gameplay Additions (Milestone 7)

### A. Pre-Bloc Housing (Population Expansion Before 1975)
Currently `BASE_UNIT_CAP` stays `24` from **1600** until **1975** (`Epoca de Aur`), when `Bloc` unlocks (`+6` each, up to `48`).

- **Add `Casă` / `Casă țărănească`** (`era: 0`, `2×2`, ~`30 lemn`, `buildTicks: 50`):
  - Adds **`+4` unit cap** per finished house (up to a pre-Bloc cap of `36`, while `Bloc` in Era 3 adds `+6` / `+8` and lifts the ceiling to `48` or `60`).
  - *Description*: „O casă cu prispă și cuptor. Mai încap patru oameni.”
- **Optional Era 1 tier: `Han`** (`era: 1`, `2×2`, ~`55 lemn`):
  - Adds **`+6` unit cap** and slowly heals nearby friendly units resting around it.
- **Compatibility**: Keeping `BASE_UNIT_CAP = 24` and `UNITS_PER_BLOC = 6` when no houses are built preserves existing balance and unit tests in `tests/sim.test.ts`.

### B. Building Rally Points (Default Spawn Direction & Auto-Work)
Currently trained units step out below `curte`, `tabara`, or `mall` and stand `idle`.

- **Data & Simulation (`src/sim/world.ts`)**:
  - Add `rally: { tx: number; ty: number } | null` on `Building` (serialized in `WorldSnapshot`).
  - Add `Command`: `{ type: 'rally'; faction: FactionId; buildingId: number; tx: number; ty: number }`.
  - When `stepBuilding` finishes training a unit and `building.rally` is set, apply the smart order immediately:
    - **Forest tile** (wood > 0) → peasant starts **chopping wood** (`orderChop` / nearest `findForest` if depleted).
    - **Livadă** (friendly, done) → peasant starts **picking plums** (if `< ORCHARD_CAPACITY`, else looks for nearby free orchard or waits beside it).
    - **Unfinished friendly building** → peasant walks to **help build** it.
    - **Enemy unit or building** → soldier marches to **attack**.
    - **Open ground** → unit walks there via `orderMove` fan-out instead of blocking the doorway.
- **UI & Visuals (`src/render/GameScene.ts`, `src/ui/hud.ts`)**:
  - Select a training building (`Curte`, `Tabără`, `Mall`) → tap **`Punct de adunare`** (or right-click/tap target in rally mode) to set the rally tile.
  - Draw a dashed line and small faction-coloured flag from the selected building to its rally point.

### C. Research System (Faction Buffs & Cross-Faction Debuffs)
Add deterministic per-faction research state (`researched` flags + active `debuffs` / `buffs` timers in `World` & `WorldSnapshot`), queued on buildings like training or era advancement.

- **Where it lives**: Attach early/era techs to existing buildings (`Curte`, `Tabără`, `Cazan`, `Mall`) and/or add dedicated research buildings (**`Mănăstire / Școală`** in Era 0–2, **`Televiziune`** in Era 4).
- **Self Buffs (Permanent or Timed)**:
  - **Coasă și topor nou** (Era 0, `Curte`): Peasants carry `+2` per trip (`5 → 7`) or gather faster.
  - **Zidărie trainică** (Era 1, `Curte`): Buildings gain `+25%` max HP.
  - **Instrucție de oaste** (Era 0–2, `Tabără`): Soldiers gain `+2` damage or faster attack cooldown.
  - **Pălincă dublu rafinată** (Era 1, `Cazan`): Pălincă buff lasts `50%` longer; nearby enemies stay drinking longer.
  - **Pila potrivită** (Era 1+, `Curte`): `Dă șpagă` succeeds `9/10` times instead of `4/5`.
- **Enemy Debuffs (Targeted at Another Principality)**:
  - **Dosar cu șină** (Era 2–3, `Primărie`): Target faction builds and trains `35%` slower for `45s` while sorting out paperwork.
  - **Pâră la Poartă** (Era 0–1, `Curte`): Target faction's next Ottoman *haraci* demand arrives sooner or asks for `+20` extra food.
  - **Știre pe surse** (Era 4, `Mall` / `TV`): Triggers a scandal near a target faction's court, stunning nearby workers and soldiers briefly.
  - **Pană de curent** (Era 3–4): Temporarily pauses an enemy's `Gater`, `Cazan`, or `Mall` production for `30s`.

### D. Watchtowers, Walls & Gates (Base Defense & Chokepoints)
With more space on the map, players and AI can fortify mountain passes, river fords, and settlement perimeters:

- **Watchtower (`Turn de veghe`)** (`era: 0` or `1`, `2×2`, ~`50 lemn`):
  - Automatically fires arrows/bolts at the nearest enemy unit or Ottoman raider within range (`~6–7` tiles) on a fixed tick cooldown (`~12–15` ticks, `~6–8` damage).
  - Scales look/firepower gently by era (wooden watchtower → stone bastion → concrete guardhouse with floodlight).
- **Walls (`Palisadă` / `Zid`)** (`1×1`, ~`8–10 lemn`, `blocks: true`, fast `buildTicks: 20`):
  - Era 0 starts as wooden *Palisadă*; Era 1–2 upgrades HP/appearance to stone *Zid*; Era 3–4 becomes concrete *Gard*.
  - **Line-drag placement**: In `GameScene` build placement for `1×1` walls, dragging across tiles places a contiguous line/L-shape of wall blueprints in one gesture so players don't have to tap 20 separate tiles.
- **Gate (`Poartă`)** (`1×1` or `2×1`, ~`15 lemn`):
  - Blocks enemy units (`costAt` / `findPath` treats enemy gates as blocked) while letting **friendly and allied** units walk straight through (`findPath` becomes faction-aware, or gates auto-open when a friendly unit approaches and no enemy stands inside).

### E. Bigger Map & More Space for Resources and Buildings
Currently Romania is `144 × 104` tiles (`14,976` tiles total in `src/data/romania.ts`), which feels tight once players build houses, orchards, watchtowers, walls, sawmills, blocks, and malls.

- **Scale up Romania (`src/data/romania.ts`, `src/sim/map.ts`)**:
  - Increase default dimensions from `144 × 104` to **`216 × 156` (`1.5×`, `33,696` tiles)** or **`288 × 208` (`2×`, `59,904` tiles)** — or offer a **`Hartă: Normală / Mare`** toggle on `#menu` (`scale` parameter stored in `WorldOptions` and `WorldSnapshot`).
  - Scale `TILES_PER_LAT` and `TILES_PER_LON` proportionally so borders, Carpathians, rivers, and cities keep Romania's exact silhouette.
  - Scale `MOUNTAINS.halfWidth`, `RIVERS.halfWidth`, `BORDER_RIVER_HALF_WIDTH`, `PASS_HALF_WIDTH`, and town clearing radius (`r = 5` instead of `3`) so passes and fords stay wide enough for armies while every capital has plenty of flat building space for walls, towers, houses, and orchards.
- **Richer Resource Distribution**:
  - Adjust forest noise thresholds (`generateRomania` in `src/sim/map.ts`) and add extra wooded groves on the plains (especially near Dobrogea and Bărăgan) so larger bases and wall lines have enough timber.
  - Optionally add **stone / quarry** or **rich forest** tiles (`WOOD_PER_FOREST = 60`) to support wall & watchtower construction without stripping the whole map bare.
- **Engine, Camera & UI Adjustments**:
  - **Dynamic Minimap aspect ratio**: Set `#minimap` `aspect-ratio` in `Minimap` constructor from `${map.width} / ${map.height}` instead of hardcoding `144 / 104` in `src/ui/hud.css`.
  - **AI BFS & Pathfinding**: Scale the `4000`-tile search limit in `SkirmishAi.forestByFoot` (`src/ai/skirmish.ts`) proportionally to `map.width * map.height` (and keep `findPath` fast on larger grids by reusing typed arrays or capping cross-map repaths).
  - **Camera Zoom & Speed**: Allow `CameraControls.minZoom` down to `Math.max(0.75, ...)` on larger maps so players can survey bigger borders cleanly, and verify unit walking speed keeps cross-country marches brisk.

### F. Stegarul („Auraș”) & Balanced Satirical Mechanics
Inspired directly by the stand-up bit while keeping competitive pacing fair:

- **Special Character: `Stegarul` („Auraș”)** (`era: 0`, trained at `Curte` or `Tabără`, limit 1 active or pricey support unit):
  - Carries a *„băț și pânză”* faction banner (`cap de bour` for Moldova, principality crest for others) and deals **0 attack damage**.
  - **Morale & „Ne face și vânt” Aura**: Friendly soldiers within `~4` tiles gain `+15%` attack speed and `+10%` move speed while he holds the banner aloft.
  - **„Alergic la metal” Quirk**: Runs slightly ahead of the formation when marching; if he gets hit or walks next to armored/siege units (e.g. `Tun`, late-era defenders), he yells *„Ștefan! Ăștia au metal!”* and backs up behind the nearest friendly line for a few ticks.
- **Balanced Ardeal Startup (*„No, numai bine bem o pălincă, ne cunoaștem…”*)**:
  - Replace frustrating all-game sluggishness with a comic-but-balanced rhythm: when an Ardeal peasant starts a **new** assignment (build, chop, pick plums), he pauses briefly (`~15–20` ticks / `1.5–2s`) to chat and clink glasses (*„No, numai bine bem o pălincă…”*), **then works faster / carries `+2` extra load** (`5 → 7`) once underway so total throughput over a full job catches up with Moldova and Țara Românească.
- **Moldova Idle „Italia” Joke & Drunk Loop Flavor**:
  - If Moldovan peasants sit idle for >45 seconds without an order, a bubble warns *„În Italia nu-ți dă nimeni cu click-ul în cap!”* (purely satirical flavor).

---

## 2. Cloud Android APK Build (No Local SDK Needed)

Because this local environment currently has JDK 26 and no Android SDK (`ANDROID_HOME` unset), building the APK in GitHub Actions avoids installing Android Studio locally:

### GitHub Actions Android Workflow (`.github/workflows/android.yml`)
- **Triggers**: `workflow_dispatch`, tags (`v*`), or pushes to `main` touching `src/**`, `public/**`, `android/**`, or `package.json`.
- **Build Steps**:
  1. `actions/checkout@v4` + `actions/setup-node@v4` (Node `22` via `.node-version`, `cache: npm`).
  2. `actions/setup-java@v4` with **`distribution: 'temurin'`, `java-version: '21'`** (compatible with Gradle 8.14.3 and AGP 8.13.0).
  3. `android-actions/setup-android@v3` and install **`platforms;android-36`** + **`build-tools;36.0.0`** (matching `compileSdkVersion = 36` in `android/variables.gradle`).
  4. `npm ci && npm run android:sync` (typecheck + Vite bundle + `cap sync android`).
  5. `cd android && chmod +x gradlew && ./gradlew assembleDebug` (plus optional `assembleRelease` if signing keystore secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` are configured).
  6. `actions/upload-artifact@v4` uploading `android/app/build/outputs/apk/debug/app-debug.apk` (and attaching to GitHub Releases on `v*` tags).

### Custom Android Launcher Icons & Splash Screen
Replace the default Capacitor green robot icons under `android/app/src/main/res/`:
- Generate crisp nearest-neighbor PNGs from the 16×16 pixel-art crown/tricolour/plum emblem (`public/icon.svg`) for every Android density:
  - `mipmap-mdpi` (`48×48`), `mipmap-hdpi` (`72×72`), `mipmap-xhdpi` (`96×96`), `mipmap-xxhdpi` (`144×144`), `mipmap-xxxhdpi` (`192×192`) for `ic_launcher.png`, `ic_launcher_round.png`, and `ic_launcher_foreground.png` (`108dp` adaptive icon canvas with centered safe zone).
- Update `android/app/src/main/res/values/ic_launcher_background.xml` to `#1b2a1b` (matching `theme_color` and `capacitor.config.ts`).
- Optionally replace `drawable/splash.png` and `drawable-{land,port}-*/splash.png` with an *Unirea* title splash on `#1b2a1b`.

---

## 3. Gameplay & UX Polish

### Already Implemented
- **Box selection**: Desktop Left-drag (`Shift`+drag additive; Right/Middle/`Alt`-drag pan) and mobile **`Chenar`** toggle (`#btn-box` / `B`) for 1-finger touch box select (`CameraControls.ts`, `GameScene.ts`).
- **Idle-peasant & army helpers**: `Liberi: N` (`#btn-idle` / `Tab` / `I`), `Alege oștenii`, mixed-selection filters (`Doar țărani` / `Doar oșteni`), and control groups (`1`–`3`).
- **Difficulty levels & AI wood fix**: `Ușor` / `Normal` / `Greu` in `#menu-difficulty`, persisted in `SaveGame` + `AiSnapshot`; Dobrogea `SkirmishAi` pulls spare orchard pickers to wood when `cherhana` fills food (`>= 200`).
- **Offline PWA support**: Cache-first service worker in `public/sw.js` registered in `src/main.ts`.

### Further Polish to Add
- **Peasant building repair**: Select peasants → tap a damaged friendly building to repair HP gradually for a small wood cost (helps Dobrogea offset summer tourist wear and recover from raids).
- **Attack-Move (`Atacă în drum`)**: Add a toggle/command so soldiers march toward a target tile and stop to fight enemies encountered along the way instead of walking past them.
- **Queue Cancel**: Tap a queued unit icon/count on a selected `Curte`, `Tabără`, or `Mall` to cancel it and refund resources.
- **Resource Income Rates**: Display `+lemn/m` and `+prune/m` estimates in `#hud-stock` and show battle/raid alert pings on the minimap with a clickable toast (*„Sari la luptă”*) to jump straight to the trouble.

---

## 4. Audio, Art & Content

### Romanian Voice Clips & Speech Synthesis (`src/audio/sound.ts`)
- **Recorded Voice Pack**: Map `(faction, lineKind, text)` or `(faction, lineKind, index)` to lightweight `.ogg` / `.mp3` clips in `public/voices/<faction>/` loaded lazily and cached by `SoundEngine`, wired cleanly into the existing `VoiceLineHook`.
- **Web Speech API Fallback Toggle**: Add an optional **`Voce TTS`** toggle in the HUD that uses `window.speechSynthesis` with `lang = 'ro-RO'` (rate/pitch varied slightly per faction and unit kind) when no recorded clip is loaded, keeping the retro Web Audio chirp as the zero-latency default.

### Animated Buildings & Richer Pixel Art (`src/render/textures.ts`, `src/render/GameScene.ts`)
- Support multi-frame building sprite sheets (or overlay frame particles) without breaking the single-frame fallback:
  - **`Cazan de pălincă`**: Rising animated steam wisps and flickering orange firebox glow while `distillLeft > 0`.
  - **`Gater`**: Spinning circular saw blade + pulsing chimney smoke in Era 2+.
  - **`Cherhana`**: Gentle water ripples / bobbing boat along the shore.
  - **`Mall`**: Blinking neon sign / rotating parking glint in Prezent.
  - **Custom Faction Banners**: Animated waving banner frames on `Curte` and `Tabără` in each faction's colour.

### More Romanian Jokes, Modes & Map Variety
- **Alliance / Union Modes (*Mica Unire* & *Marea Unire*)**:
  - Team skirmish option (`2v2` or *Mica Unire* Moldova + Țara Românească allied vs Ardeal + Dobrogea / Porte) with shared victory and ally vision/support.
  - Optional vassalization: defeating a court turns it into a tributary vassal instead of erasing it.
- **Deterministic Era Events** (seeded from `Rng`, announced via toast + SFX):
  - *Recoltă bogată* (+50% orchard/fish output for 30s), *Secetă* (-40% plum output for 30s), *Control ANAF* (in Prezent, freezes a faction's next EU funds unless a 20-plum bribe is paid), *Cod roșu de zăpadă* (everybody slows down briefly except Ardeal).
- **Bridges (`Pod`)**: Build/upgrade bridges over river fords from Era 2 (*România Mare*) onward so units cross at full speed instead of `1/3`.
- **Skirmish Map Options**: Custom/random map seed input (`Hartă nouă`) on `#menu`, selectable opponent count (`1v1`, `3-way`, `4-way`), and optional `Blitz` starting-stock preset.

---

## 5. Lockstep Multiplayer (Cloudflare Workers + Durable Objects)

Because `World` (`src/sim/world.ts`) is already 100% deterministic (integer `SUB = 256` coordinates, mulberry32 `Rng`, FNV-1a `checksum()`, queued `Command` input via `issue()` + `step()`), it maps directly onto a **lockstep WebSocket architecture** on Cloudflare:

### Backend (`wrangler.jsonc` + Worker + Durable Object)
- Add a **`MatchRoom` Durable Object** alongside the existing static assets config in `wrangler.jsonc`:
  - `POST /api/rooms` or `WS /api/match/:roomId`: creates/joins a 2–4 player lobby, assigns each player a `FactionId` (`ardeal`, `moldova`, `tara`, `dobrogea`) and shared `seed`.
  - **Lockstep Turn Cadence**: Run in fixed **command turns** of e.g. `2` or `3` sim ticks (`200–300ms` latency buffer).
  - For each turn `T`, every connected client sends `{ type: 'cmd', turn: T, commands: Command[], checksum: number }` (empty `commands` if idle).
  - Once the Durable Object receives turn `T` from all active clients (or fills disconnected/AI slots), it broadcasts `{ type: 'step', turn: T, commandsByFaction }` to all clients.
  - **Desync Detection**: Compare `checksum` per turn in the Durable Object; if a mismatch ever happens, log the exact `tick` and `faction` and optionally send a `WorldSnapshot` resync from the host/majority.
  - **Reconnect / Drop-in**: If a player disconnects mid-match, either pause briefly for reconnect (sending the latest `WorldSnapshot` on rejoin) or hand that faction over to `SkirmishAi` so the match continues smoothly.

### Client Integration (`src/net/lockstep.ts`, `src/render/GameScene.ts`, `src/main.ts`)
- Add a **"Multiplayer (Cameră)"** section on `#menu` (Create Room → share 4-letter code/URL `?room=ABCD`, Join Room, pick faction, Ready).
- Replace direct local `this.world.issue(cmd)` calls in `GameScene` with a thin `CommandSink` interface (`LocalSink` in single-player vs `LockstepSink` in multiplayer) that buffers local commands for turn `T + 1` and only advances `world.step()` once turn `T` arrives from the Durable Object.
