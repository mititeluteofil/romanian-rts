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

export type RelayClientMsg =
  | { readonly type: 'join'; readonly roomId: string; readonly player: string }
  | { readonly type: 'turn'; readonly turn: number; readonly cmds: readonly Command[]; readonly hash?: number };

export type RelayServerMsg =
  | { readonly type: 'joined'; readonly roomId: string; readonly seed: number; readonly players: readonly string[] }
  | { readonly type: 'turn'; readonly turn: number; readonly cmds: readonly Command[]; readonly desync?: boolean };

/**
 * Deterministic lockstep client over WebSocket:
 * queues local commands for turn `currentTurn + 1`, waits for the relay's merged
 * turn packet at each turn boundary, and verifies `world.checksum()` every 50 ticks.
 */
export class LockstepSink implements CommandSink {
  private readonly outbox: Command[] = [];
  private readonly turns = new Map<number, readonly Command[]>();
  private sentTurn = -1;
  public desynced = false;

  constructor(
    private readonly sendPacket: (msg: RelayClientMsg) => void,
    initialTurns = 2,
  ) {
    // Seed empty turns 0..(initialTurns-1) so lockstep can start immediately without stall.
    for (let t = 0; t < initialTurns; t++) {
      this.turns.set(t, []);
    }
  }

  send(cmd: Command): void {
    this.outbox.push(cmd);
  }

  /** Feed an incoming turn packet from the WebSocket relay. */
  receive(msg: RelayServerMsg): void {
    if (msg.type === 'turn') {
      this.turns.set(msg.turn, msg.cmds);
      if (msg.desync) this.desynced = true;
    }
  }

  beforeStep(world: World): boolean {
    if (world.tick % TURN_TICKS !== 0) return true;
    const turn = Math.floor(world.tick / TURN_TICKS);

    // Send our commands for (turn + 1) once at the start of `turn`.
    if (this.sentTurn < turn + 1) {
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
