import type { Command } from '../src/sim/world';

interface TurnSubmission {
  readonly cmds: readonly Command[];
  readonly hash?: number;
}

type ClientMsg =
  | { type: 'join'; roomId: string; player: string; seed?: number; create?: boolean }
  | { type: 'start'; settings: unknown }
  | { type: 'turn'; turn: number; cmds: Command[]; hash?: number };

/** Most principalities on the big map; one human each. */
const MAX_PLAYERS = 5;
const MAX_NAME = 24;

/**
 * Cloudflare Durable Object relay for 2–5 player deterministic lockstep matches.
 *
 * Lobby: the first peer to join is the host and fixes the seed; everyone gets
 * `joined` with the player list, each peer gets `welcome` with the (deduplicated)
 * name the relay knows it by, and the host's `start` is broadcast once. After
 * that the room is closed to new joins.
 *
 * Match: collects each connected peer's commands for `turn`, checks optional
 * state hashes for desyncs, and broadcasts the merged deterministic command list.
 * A peer leaving is broadcast as `left`; turns it was holding up are released.
 */
export class MatchRoom {
  /** Insertion order is join order; the first entry is the host. */
  private readonly peers = new Map<WebSocket, string>();
  private readonly pending = new Map<number, Map<string, TurnSubmission>>();
  private seed = 1600;
  private started = false;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Unirea Lockstep Relay: expected WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    server.addEventListener('message', (event) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(event.data)) as ClientMsg;
      } catch {
        return; // Ignore malformed packets
      }

      if (msg.type === 'join') {
        if (this.peers.has(server)) return;
        if (this.started) return this.reject(server, 'started');
        if (this.peers.size >= MAX_PLAYERS) return this.reject(server, 'full');
        if (this.peers.size === 0 && msg.create === false) return this.reject(server, 'no-room');
        if (this.peers.size === 0 && typeof msg.seed === 'number' && msg.seed) this.seed = msg.seed >>> 0;
        const name = this.uniqueName(String(msg.player ?? ''));
        this.peers.set(server, name);
        this.sendTo(server, { type: 'welcome', you: name });
        this.broadcastLobby(msg.roomId);
        return;
      }

      const player = this.peers.get(server);
      if (!player) return;

      if (msg.type === 'start') {
        if (this.started || this.host() !== server) return;
        this.started = true;
        this.pending.clear();
        this.broadcast({ type: 'start', seed: this.seed, players: [...this.peers.values()], settings: msg.settings });
        return;
      }

      if (msg.type === 'turn') {
        if (!this.started || !Number.isInteger(msg.turn) || !Array.isArray(msg.cmds)) return;
        let bucket = this.pending.get(msg.turn);
        if (!bucket) {
          bucket = new Map();
          this.pending.set(msg.turn, bucket);
        }
        bucket.set(player, { cmds: msg.cmds, hash: msg.hash });
        this.flush(msg.turn);
      }
    });

    const drop = () => this.remove(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  private host(): WebSocket | undefined {
    return this.peers.keys().next().value;
  }

  private uniqueName(raw: string): string {
    const base = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Voievod';
    const taken = new Set(this.peers.values());
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const name = `${base} (${n})`;
      if (!taken.has(name)) return name;
    }
  }

  private broadcastLobby(roomId?: string): void {
    this.broadcast({ type: 'joined', roomId, seed: this.seed, players: [...this.peers.values()] });
  }

  /** Broadcast the merged turn once every connected peer has submitted it. */
  private flush(turn: number): void {
    const bucket = this.pending.get(turn);
    if (!bucket) return;
    const connected = new Set(this.peers.values());
    for (const p of connected) if (!bucket.has(p)) return;
    const orderedPlayers = [...bucket.keys()].sort();
    const merged: Command[] = [];
    let refHash: number | undefined;
    let desync = false;
    for (const p of orderedPlayers) {
      const sub = bucket.get(p)!;
      merged.push(...sub.cmds);
      // Only peers still in the match vote on the state hash.
      if (sub.hash !== undefined && connected.has(p)) {
        if (refHash === undefined) refHash = sub.hash;
        else if (refHash !== sub.hash) desync = true;
      }
    }
    this.pending.delete(turn);
    this.broadcast({ type: 'turn', turn, cmds: merged, desync });
  }

  private remove(ws: WebSocket): void {
    const player = this.peers.get(ws);
    if (player === undefined) return;
    this.peers.delete(ws);
    if (this.peers.size === 0) {
      // Empty room: forget the match so the code can be reused for a new lobby.
      this.started = false;
      this.pending.clear();
      this.seed = 1600;
      return;
    }
    this.broadcast({ type: 'left', player, players: [...this.peers.values()] });
    if (this.started) {
      for (const turn of [...this.pending.keys()].sort((a, b) => a - b)) this.flush(turn);
    } else {
      this.broadcastLobby();
    }
  }

  private reject(ws: WebSocket, reason: 'started' | 'full' | 'no-room'): void {
    this.sendTo(ws, { type: 'error', reason });
    try {
      ws.close(4000, reason);
    } catch {
      // already closed
    }
  }

  private sendTo(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      this.remove(ws);
    }
  }

  private broadcast(payload: unknown): void {
    const raw = JSON.stringify(payload);
    const dead: WebSocket[] = [];
    for (const ws of this.peers.keys()) {
      try {
        ws.send(raw);
      } catch {
        dead.push(ws);
      }
    }
    for (const ws of dead) this.remove(ws);
  }
}

export interface Env {
  MATCH_ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
  };
  ASSETS: { fetch(req: Request): Promise<Response> };
}

/** Path the lockstep relay listens on: wss://<host>/relay?room=<id>. */
const RELAY_PATH = '/relay';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === RELAY_PATH || url.pathname.startsWith(`${RELAY_PATH}/`)) {
      const room = (url.searchParams.get('room') ?? 'default').toUpperCase().slice(0, 32);
      const id = env.MATCH_ROOM.idFromName(room);
      return env.MATCH_ROOM.get(id).fetch(request);
    }
    // Everything else is the static game build.
    return env.ASSETS.fetch(request);
  },
};
