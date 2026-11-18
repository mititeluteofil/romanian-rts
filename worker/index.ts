import type { Command } from '../src/sim/world';

interface TurnSubmission {
  readonly cmds: readonly Command[];
  readonly hash?: number;
}

/**
 * Cloudflare Durable Object relay for 2–5 player deterministic lockstep matches.
 * Collects each connected peer's commands for `turn`, checks optional state hashes
 * for desyncs, and broadcasts the merged deterministic command list.
 */
export class MatchRoom {
  private readonly peers = new Map<WebSocket, string>();
  private readonly pending = new Map<number, Map<string, TurnSubmission>>();
  private seed = 1600;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Unirea Lockstep Relay: expected WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as
          | { type: 'join'; roomId: string; player: string; seed?: number }
          | { type: 'turn'; turn: number; cmds: Command[]; hash?: number };

        if (msg.type === 'join') {
          if (this.peers.size === 0 && msg.seed) this.seed = msg.seed;
          this.peers.set(server, msg.player);
          this.broadcast({
            type: 'joined',
            roomId: msg.roomId,
            seed: this.seed,
            players: [...this.peers.values()],
          });
          return;
        }

        if (msg.type === 'turn') {
          const player = this.peers.get(server);
          if (!player) return;
          let bucket = this.pending.get(msg.turn);
          if (!bucket) {
            bucket = new Map();
            this.pending.set(msg.turn, bucket);
          }
          bucket.set(player, { cmds: msg.cmds, hash: msg.hash });
          if (bucket.size >= this.peers.size) {
            const orderedPlayers = [...bucket.keys()].sort();
            const merged: Command[] = [];
            let refHash: number | undefined;
            let desync = false;
            for (const p of orderedPlayers) {
              const sub = bucket.get(p)!;
              merged.push(...sub.cmds);
              if (sub.hash !== undefined) {
                if (refHash === undefined) refHash = sub.hash;
                else if (refHash !== sub.hash) desync = true;
              }
            }
            this.pending.delete(msg.turn);
            this.broadcast({ type: 'turn', turn: msg.turn, cmds: merged, desync });
          }
        }
      } catch {
        // Ignore malformed packets
      }
    });

    server.addEventListener('close', () => {
      this.peers.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(payload: unknown): void {
    const raw = JSON.stringify(payload);
    for (const ws of this.peers.keys()) {
      try {
        ws.send(raw);
      } catch {
        this.peers.delete(ws);
      }
    }
  }
}

export interface Env {
  MATCH_ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const room = url.searchParams.get('room') ?? 'default';
    const id = env.MATCH_ROOM.idFromName(room);
    return env.MATCH_ROOM.get(id).fetch(request);
  },
};
