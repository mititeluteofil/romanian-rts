import type { Difficulty } from '../ai/skirmish';
import type { FactionId } from '../data/factions';
import type { Command, World } from '../sim/world';

/** Lockstep turn size in simulation ticks (3 ticks = 300 ms at 10 Hz). */
export const TURN_TICKS = 3;

export interface CommandSink {
  send(cmd: Command): void;
  /** Returns true if the world is allowed to advance this tick. */
  beforeStep(world: World): boolean;
  /** Called right after world.step() completes. */
  afterStep(world: World): void;
}

/** Default single-player sink: commands go straight into world.issue(). */
export class LocalSink implements CommandSink {
  constructor(private readonly world: World) {}

  send(cmd: Command): void {
    this.world.issue(cmd);
  }

  beforeStep(): boolean {
    return true;
  }

  afterStep(): void {}
}

/** What the host fixes for everyone when starting an online match. */
export interface MatchSettings {
  readonly peaceful: boolean;
  readonly difficulty: Difficulty;
  readonly mapScale: number;
  readonly includeOltenia: boolean;
  /** Relay player name → the principality that player commands. */
  readonly factions: Readonly<Record<string, FactionId>>;
}

export type RelayClientMsg =
  | {
      readonly type: 'join';
      readonly roomId: string;
      readonly player: string;
      /** Host only: the match seed. */
      readonly seed?: number;
      /** false = only join an existing lobby (the relay answers `no-room` otherwise). */
      readonly create?: boolean;
    }
  | { readonly type: 'start'; readonly settings: MatchSettings }
  | { readonly type: 'turn'; readonly turn: number; readonly cmds: readonly Command[]; readonly hash?: number };

export type RelayErrorReason = 'started' | 'full' | 'no-room';

export type RelayServerMsg =
  /** Sent only to the peer that just joined: the name the relay knows it by. */
  | { readonly type: 'welcome'; readonly you: string }
  /** Lobby roster; `players[0]` is the host. */
  | { readonly type: 'joined'; readonly roomId?: string; readonly seed: number; readonly players: readonly string[] }
  | { readonly type: 'left'; readonly player: string; readonly players: readonly string[] }
  | { readonly type: 'start'; readonly seed: number; readonly players: readonly string[]; readonly settings: MatchSettings }
  | { readonly type: 'error'; readonly reason: RelayErrorReason }
  | { readonly type: 'turn'; readonly turn: number; readonly cmds: readonly Command[]; readonly desync?: boolean };

/**
 * Deterministic lockstep client over WebSocket:
 * queues local commands for turn `currentTurn + 1`, waits for the relay's merged
 * turn packet at each turn boundary, and verifies `world.checksum()` every 50 ticks.
 *
 * The first `initialTurns` turns are pre-agreed empty on every peer, so commands
 * issued before then wait for the first turn that actually goes through the relay
 * (otherwise a late packet could land on one peer and not another).
 */
export class LockstepSink implements CommandSink {
  private readonly outbox: Command[] = [];
  private readonly turns = new Map<number, readonly Command[]>();
  private sentTurn = -1;
  public desynced = false;

  constructor(
    private readonly sendPacket: (msg: RelayClientMsg) => void,
    private readonly initialTurns = 2,
  ) {
    for (let t = 0; t < initialTurns; t++) {
      this.turns.set(t, []);
    }
  }

  send(cmd: Command): void {
    this.outbox.push(cmd);
  }

  /** Feed an incoming turn packet from the WebSocket relay. */
  receive(msg: RelayServerMsg): void {
    if (msg.type !== 'turn' || msg.turn < this.initialTurns) return;
    this.turns.set(msg.turn, msg.cmds);
    if (msg.desync) this.desynced = true;
  }

  beforeStep(world: World): boolean {
    if (world.tick % TURN_TICKS !== 0) return true;
    const turn = Math.floor(world.tick / TURN_TICKS);

    // Send our commands for (turn + 1) once at the start of `turn`.
    if (this.sentTurn < turn + 1 && turn + 1 >= this.initialTurns) {
      const hash = world.tick > 0 && world.tick % 50 === 0 ? world.checksum() : undefined;
      this.sendPacket({
        type: 'turn',
        turn: turn + 1,
        cmds: this.outbox.splice(0, this.outbox.length),
        hash,
      });
      this.sentTurn = turn + 1;
    }

    const ready = this.turns.get(turn);
    if (!ready) return false; // Wait for relay turn packet
    for (const cmd of ready) {
      world.issue(cmd);
    }
    this.turns.delete(turn);
    return true;
  }

  afterStep(): void {}
}

/** Seat order for online matches; Oltenia only joins when a fifth player needs it. */
const ONLINE_SEATS: readonly FactionId[] = ['ardeal', 'moldova', 'tara', 'dobrogea', 'oltenia'];

/** Give each player (in join order) a principality. Extra players beyond the seats get none. */
export function assignFactions(players: readonly string[]): Record<string, FactionId> {
  const out: Record<string, FactionId> = {};
  players.forEach((name, i) => {
    const seat = ONLINE_SEATS[i];
    if (seat) out[name] = seat;
  });
  return out;
}
