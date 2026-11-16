/**
 * Faction definitions. Everything faction-specific (names, colours, jokes,
 * later: units, buildings, bonuses) lives in data so a new faction or a new
 * joke never needs engine changes.
 */

export type FactionId = 'ardeal' | 'moldova';

export interface FactionDef {
  readonly id: FactionId;
  readonly name: string;
  /** Belt / banner colour, 0xRRGGBB. */
  readonly color: number;
  /** Hat colour — clop in Ardeal, căciulă in Moldova. */
  readonly hatColor: number;
  /** Speed multiplier in percent. Ardeal is in no hurry. */
  readonly speedPercent: number;
  readonly lines: {
    readonly select: readonly string[];
    readonly move: readonly string[];
  };
}

export const FACTIONS: Readonly<Record<FactionId, FactionDef>> = {
  ardeal: {
    id: 'ardeal',
    name: 'Ardeal',
    color: 0x2e7d32,
    hatColor: 0x1b1b1b,
    speedPercent: 80,
    lines: {
      select: ['No, ce-i?', 'Zî, mă.', 'Amu’ ce mai vrei?', 'No, servus.'],
      move: [
        'No, mă duc… da’ încet.',
        'Las’ că ajung io.',
        'Stai să beau întâi o pălincă.',
        'Om mere noi, nu-i grabă.',
        'No, d-apăi mai vedem.',
      ],
    },
  },
  moldova: {
    id: 'moldova',
    name: 'Moldova',
    color: 0xb71c1c,
    hatColor: 0x6d6d6d,
    speedPercent: 115,
    lines: {
      select: ['Și vrei, wăi?', 'Și vrei, wăi? Și vrei, wăi?', 'Și-i, bre?', 'Zî, wăi!'],
      move: [
        'Amuș, amuș!',
        'Mă duc, wăi, mă duc!',
        'Hai că-s gata.',
        'Pi cuvântu’ meu că mă duc.',
        'Ca pe vremea lu’ Ștefan!',
      ],
    },
  },
};
