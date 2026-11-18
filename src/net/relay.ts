import type { RelayClientMsg, RelayServerMsg } from './lockstep';

/** Room codes avoid look-alikes (0/O, 1/I/L) so they can be read out loud. */
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

function randomU32(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]!;
}

export function generateRoomCode(random: () => number = randomU32): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[random() % ROOM_ALPHABET.length];
  return code;
}

/** Uppercase, drop anything that cannot be in a code; '' when nothing usable is left. */
export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => ROOM_ALPHABET.includes(c))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);
}

/** A non-zero 32-bit match seed. */
export function generateSeed(random: () => number = randomU32): number {
  return random() >>> 0 || 1600;
}

/**
 * WebSocket URL of the lockstep relay for `room`.
 * `configured` (VITE_RELAY_URL) wins — the Android build is served from the
 * WebView, not the site, so it must point at the deployed host; it may be
 * http(s):// or ws(s)://, with or without a trailing /relay. Without it the
 * relay is assumed to live on the page's own origin (wss on https, ws on http).
 */
export function relayUrl(room: string, configured: string | undefined, pageOrigin: string): string {
  let base = (configured ?? '').trim() || pageOrigin;
  base = base.replace(/^http(s?):\/\//i, 'ws$1://').replace(/\/+$/, '');
  if (!/\/relay$/i.test(base)) base += '/relay';
  return `${base}?room=${encodeURIComponent(room)}`;
}

export interface RelayHandlers {
  onMessage(msg: RelayServerMsg): void;
  /** The socket closed without us asking: `opened` is false if it never connected. */
  onClose(opened: boolean): void;
}

/** Thin wrapper over the browser WebSocket speaking the relay's JSON protocol. */
export class RelayConnection {
  private readonly ws: WebSocket;
  private opened = false;
  private closing = false;
  private readonly queue: string[] = [];

  constructor(url: string, private readonly handlers: RelayHandlers) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      this.opened = true;
      for (const raw of this.queue.splice(0)) this.ws.send(raw);
    });
    this.ws.addEventListener('message', (event) => {
      let msg: RelayServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as RelayServerMsg;
      } catch {
        return;
      }
      this.handlers.onMessage(msg);
    });
    this.ws.addEventListener('close', () => {
      if (!this.closing) this.handlers.onClose(this.opened);
    });
  }

  send(msg: RelayClientMsg): void {
    if (this.closing) return;
    const raw = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(raw);
  }

  /** Leave on purpose: no onClose callback. */
  close(): void {
    this.closing = true;
    try {
      this.ws.close(1000, 'leave');
    } catch {
      // ignore
    }
  }
}
