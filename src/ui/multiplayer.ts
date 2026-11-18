import type { Difficulty } from '../ai/skirmish';
import { FACTIONS, type FactionId } from '../data/factions';
import { assignFactions, LockstepSink, type MatchSettings, type RelayServerMsg } from '../net/lockstep';
import { generateRoomCode, generateSeed, normalizeRoomCode, RelayConnection, relayUrl, ROOM_CODE_LENGTH } from '../net/relay';

/** What the menu hands over to start an online match. */
export interface OnlineLaunch {
  readonly player: FactionId;
  readonly nickname: string;
  readonly peaceful: boolean;
  readonly difficulty: Difficulty;
  readonly mapScale: number;
  readonly includeOltenia: boolean;
  readonly commandSink: LockstepSink;
  readonly online: { readonly seed: number; readonly humanFactions: readonly FactionId[] };
  /** Called when the player leaves the match (menu button or banner). */
  readonly onExit: () => void;
}

export interface GameHandle {
  notify(text: string, ms?: number): void;
}

export interface MultiplayerDeps {
  /** Current nickname from the menu (saved and sanitized). */
  nickname(): string;
  /** The menu's war/peace, map size and difficulty, used when this player hosts. */
  hostSettings(): { peaceful: boolean; large: boolean; difficulty: Difficulty };
  /** Start the game; returns something that can show in-game messages. */
  launch(options: OnlineLaunch): GameHandle;
  /** Tear the game down and show the main menu. */
  returnToMenu(): void;
}

const ERROR_TEXT: Record<string, string> = {
  started: 'Partida din camera asta a început deja.',
  full: 'Camera e plină (maxim 5 jucători).',
  'no-room': 'Nu există o cameră cu codul ăsta.',
};

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

function factionColor(faction: FactionId): string {
  return `#${FACTIONS[faction].color.toString(16).padStart(6, '0')}`;
}

/** Menu "Multiplayer online": create/join a relay room, wait in the lobby, play in lockstep. */
export function initMultiplayer(deps: MultiplayerDeps): { open(code?: string): void } {
  const box = el<HTMLDivElement>('menu-box');
  const panel = el<HTMLDivElement>('mp-panel');
  const start = el<HTMLDivElement>('mp-start');
  const lobby = el<HTMLDivElement>('mp-lobby');
  const codeInput = el<HTMLInputElement>('mp-code');
  const roomCodeEl = el<HTMLElement>('mp-room-code');
  const list = el<HTMLOListElement>('mp-players');
  const hint = el<HTMLParagraphElement>('mp-hint');
  const startBtn = el<HTMLButtonElement>('btn-mp-start');
  const status = el<HTMLParagraphElement>('mp-status');
  const nickInput = document.getElementById('menu-nickname') as HTMLInputElement | null;
  const banner = el<HTMLDivElement>('net-banner');
  const bannerText = el<HTMLParagraphElement>('net-banner-text');
  const bannerContinue = el<HTMLButtonElement>('btn-net-continue');

  let conn: RelayConnection | null = null;
  let me = '';
  let room = '';
  let players: readonly string[] = [];
  let game: GameHandle | null = null;
  let sink: LockstepSink | null = null;
  let desyncShown = false;

  const setStatus = (text: string): void => {
    status.textContent = text;
  };

  const isHost = (): boolean => me !== '' && players[0] === me;

  function showStartView(): void {
    start.classList.remove('hidden');
    lobby.classList.add('hidden');
    box.classList.remove('mp-guest');
    if (nickInput) nickInput.disabled = false;
  }

  function open(code?: string): void {
    box.classList.add('mp-mode');
    panel.classList.remove('hidden');
    showStartView();
    if (code) codeInput.value = normalizeRoomCode(code);
    setStatus('');
  }

  function closePanel(): void {
    box.classList.remove('mp-mode', 'mp-guest');
    panel.classList.add('hidden');
    setStatus('');
  }

  function disconnect(): void {
    conn?.close();
    conn = null;
    me = '';
    players = [];
    game = null;
    sink = null;
  }

  function renderLobby(): void {
    start.classList.add('hidden');
    lobby.classList.remove('hidden');
    roomCodeEl.textContent = room;
    box.classList.toggle('mp-guest', !isHost());
    const seats = assignFactions(players);
    list.replaceChildren(
      ...players.map((name, i) => {
        const li = document.createElement('li');
        const faction = seats[name];
        if (faction) li.style.setProperty('--faction', factionColor(faction));
        const who = document.createElement('strong');
        who.textContent = name + (name === me ? ' (tu)' : '');
        const what = document.createElement('span');
        what.textContent = [i === 0 ? 'gazdă' : '', faction ? FACTIONS[faction].name : 'fără loc']
          .filter(Boolean)
          .join(' · ');
        li.append(who, what);
        return li;
      }),
    );
    if (players.length === 0) {
      hint.textContent = 'Ne conectăm…';
    } else if (isHost()) {
      hint.textContent =
        players.length < 2
          ? 'Dă codul prietenilor. Războiul, harta și dificultatea de mai sus le alegi tu.'
          : 'Când sunt toți aici, începe partida.';
    } else {
      hint.textContent = `Așteptăm ca ${players[0]} să înceapă partida.`;
    }
    startBtn.classList.toggle('hidden', !isHost());
    startBtn.disabled = !isHost() || players.length < 2;
  }

  function showBanner(text: string, canContinue: boolean): void {
    bannerText.textContent = text;
    bannerContinue.classList.toggle('hidden', !canContinue);
    banner.classList.remove('hidden');
  }

  function hideBanner(): void {
    banner.classList.add('hidden');
  }

  function beginMatch(msg: Extract<RelayServerMsg, { type: 'start' }>): void {
    const settings = msg.settings;
    const mine = settings.factions[me];
    if (!mine || !conn) {
      disconnect();
      showStartView();
      setStatus('Nu mai e loc de principat pentru tine în partida asta.');
      return;
    }
    const link = conn;
    sink = new LockstepSink((packet) => link.send(packet));
    desyncShown = false;
    closePanel();
    game = deps.launch({
      player: mine,
      nickname: me,
      peaceful: settings.peaceful,
      difficulty: settings.difficulty,
      mapScale: settings.mapScale,
      includeOltenia: settings.includeOltenia,
      commandSink: sink,
      online: { seed: msg.seed, humanFactions: Object.values(settings.factions) },
      onExit: () => {
        hideBanner();
        disconnect();
      },
    });
  }

  function onMessage(msg: RelayServerMsg): void {
    switch (msg.type) {
      case 'welcome':
        me = msg.you;
        if (!game) renderLobby();
        break;
      case 'joined':
        players = msg.players;
        if (!game) renderLobby();
        break;
      case 'left':
        players = msg.players;
        if (game) game.notify(`${msg.player} a ieșit din partidă. Principatul rămâne fără stăpân.`);
        else renderLobby();
        break;
      case 'error':
        disconnect();
        showStartView();
        setStatus(ERROR_TEXT[msg.reason] ?? 'Serverul a refuzat conexiunea.');
        break;
      case 'start':
        if (!game) beginMatch(msg);
        break;
      case 'turn':
        sink?.receive(msg);
        if (msg.desync && !desyncShown) {
          desyncShown = true;
          showBanner('Desincronizare: lumea ta nu mai arată ca a celorlalți. Partida nu mai e de încredere.', true);
        }
        break;
    }
  }

  function connect(code: string, create: boolean): void {
    disconnect();
    room = code;
    const nickname = deps.nickname();
    if (nickInput) nickInput.disabled = true;
    setStatus('');
    renderLobby();
    const url = relayUrl(code, import.meta.env.VITE_RELAY_URL, window.location.origin);
    const link = new RelayConnection(url, {
      onMessage,
      onClose: (opened) => {
        if (conn !== link) return;
        const inGame = game !== null;
        disconnect();
        if (inGame) {
          showBanner('Conexiunea cu serverul s-a pierdut. Partida online s-a oprit.', false);
        } else {
          showStartView();
          setStatus(opened ? 'Conexiunea cu camera s-a pierdut.' : 'Nu ne-am putut conecta la server.');
        }
      },
    });
    conn = link;
    link.send({ type: 'join', roomId: code, player: nickname, create, seed: create ? generateSeed() : undefined });
  }

  el<HTMLButtonElement>('btn-mp-open').addEventListener('click', () => open());
  el<HTMLButtonElement>('btn-mp-back').addEventListener('click', closePanel);
  el<HTMLButtonElement>('btn-mp-create').addEventListener('click', () => connect(generateRoomCode(), true));
  el<HTMLFormElement>('mp-join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = normalizeRoomCode(codeInput.value);
    codeInput.value = code;
    if (code.length < ROOM_CODE_LENGTH) {
      setStatus(`Codul are ${ROOM_CODE_LENGTH} caractere.`);
      return;
    }
    connect(code, false);
  });
  codeInput.addEventListener('input', () => {
    const code = normalizeRoomCode(codeInput.value);
    if (code !== codeInput.value) codeInput.value = code;
  });
  el<HTMLButtonElement>('btn-mp-leave').addEventListener('click', () => {
    disconnect();
    showStartView();
    setStatus('');
  });
  startBtn.addEventListener('click', () => {
    if (!conn || !isHost() || players.length < 2) return;
    const host = deps.hostSettings();
    const settings: MatchSettings = {
      peaceful: host.peaceful,
      difficulty: host.difficulty,
      mapScale: host.large ? 1.5 : 1,
      includeOltenia: host.large || players.length > 4,
      factions: assignFactions(players),
    };
    startBtn.disabled = true;
    conn.send({ type: 'start', settings });
  });
  bannerContinue.addEventListener('click', hideBanner);
  el<HTMLButtonElement>('btn-net-menu').addEventListener('click', () => {
    hideBanner();
    disconnect();
    deps.returnToMenu();
  });

  return { open };
}
