import { describe, expect, it } from 'vitest';
import { assignFactions, LockstepSink, TURN_TICKS, type RelayClientMsg } from '../src/net/lockstep';
import { generateRoomCode, generateSeed, normalizeRoomCode, relayUrl, ROOM_CODE_LENGTH } from '../src/net/relay';
import { World } from '../src/sim/world';

describe('relay helpers', () => {
  it('builds the relay URL from the page origin, wss on https and ws on http', () => {
    expect(relayUrl('ABCDE', undefined, 'https://unirea.example')).toBe('wss://unirea.example/relay?room=ABCDE');
    expect(relayUrl('ABCDE', '', 'http://localhost:8787')).toBe('ws://localhost:8787/relay?room=ABCDE');
  });

  it('prefers a configured relay base (Android build) in any of its spellings', () => {
    const page = 'https://localhost';
    expect(relayUrl('XY234', 'https://unirea.example', page)).toBe('wss://unirea.example/relay?room=XY234');
    expect(relayUrl('XY234', 'https://unirea.example/', page)).toBe('wss://unirea.example/relay?room=XY234');
    expect(relayUrl('XY234', 'wss://unirea.example/relay', page)).toBe('wss://unirea.example/relay?room=XY234');
  });

  it('makes short, readable room codes and normalizes typed ones', () => {
    let n = 0;
    const code = generateRoomCode(() => n++ * 7);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]+$/);
    expect(normalizeRoomCode(' ab-c d1o9xyz ')).toBe('ABCD9');
    expect(normalizeRoomCode('')).toBe('');
  });

  it('never hands out a zero seed', () => {
    expect(generateSeed(() => 0)).toBe(1600);
    expect(generateSeed(() => 0xdeadbeef)).toBe(0xdeadbeef);
  });

  it('seats players in join order and leaves extras without a principality', () => {
    expect(assignFactions(['Ana', 'Ion'])).toEqual({ Ana: 'ardeal', Ion: 'moldova' });
    const six = assignFactions(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(Object.values(six)).toEqual(['ardeal', 'moldova', 'tara', 'dobrogea', 'oltenia']);
    expect(six.f).toBeUndefined();
  });
});

describe('LockstepSink', () => {
  it('holds early commands for the first relayed turn and ignores packets for pre-agreed turns', () => {
    const world = new World({ seed: 1600 });
    const sent: RelayClientMsg[] = [];
    const sink = new LockstepSink((msg) => sent.push(msg));
    const court = world.courtOf('ardeal')!;
    sink.send({ type: 'train', faction: 'ardeal', buildingId: court.id, kind: 'taran' });

    // Turn 0 is pre-agreed: nothing goes to the relay yet, the command waits.
    expect(sink.beforeStep(world)).toBe(true);
    expect(sent).toHaveLength(0);
    // A (late or stray) packet for pre-agreed turn 1 must not inject commands on one peer only.
    sink.receive({ type: 'turn', turn: 1, cmds: [{ type: 'advance', faction: 'ardeal' }] });
    for (let i = 0; i < TURN_TICKS; i++) {
      if (i > 0) expect(sink.beforeStep(world)).toBe(true);
      world.step();
    }

    // Turn 1 boundary: the held command goes out for turn 2.
    expect(sink.beforeStep(world)).toBe(true);
    expect(sent).toEqual([
      { type: 'turn', turn: 2, cmds: [{ type: 'train', faction: 'ardeal', buildingId: court.id, kind: 'taran' }], hash: undefined },
    ]);
    for (let i = 0; i < TURN_TICKS; i++) {
      if (i > 0) expect(sink.beforeStep(world)).toBe(true);
      world.step();
    }

    // Turn 2 waits for the relay.
    expect(sink.beforeStep(world)).toBe(false);
    sink.receive({ type: 'turn', turn: 2, cmds: [], desync: true });
    expect(sink.beforeStep(world)).toBe(true);
    expect(sink.desynced).toBe(true);
  });
});
