/**
 * Faction definitions. Everything faction-specific (names, colours, jokes,
 * unit stats, the signature ability) lives in data so a new faction or a new
 * joke never needs engine changes.
 */

export type FactionId = 'ardeal' | 'moldova';
export const FACTION_IDS: readonly FactionId[] = ['ardeal', 'moldova'];

export function enemyOf(faction: FactionId): FactionId {
  return faction === 'ardeal' ? 'moldova' : 'ardeal';
}

export type UnitKind = 'taran' | 'ostas' | 'smecher';

/** Everyone except the peasants fights without being told to. */
export function isFighter(kind: UnitKind): boolean {
  return kind !== 'taran';
}

export interface UnitDef {
  readonly name: string;
  readonly hp: number;
  readonly damage: number;
  /** Ticks between two hits. */
  readonly cooldown: number;
  readonly costPrune: number;
  readonly costLemn: number;
  readonly trainTicks: number;
  /** Walking speed in percent, if not the faction's usual. */
  readonly speedPercent?: number;
}

export type AbilityId = 'palinca' | 'taunt';

export interface AbilityDef {
  readonly id: AbilityId;
  readonly name: string;
  readonly costPalinca: number;
  /** Ticks before it can be used again. */
  readonly cooldownTicks: number;
  readonly description: string;
}

export type LineKind =
  | 'select'
  | 'move'
  | 'wood'
  | 'plums'
  | 'build'
  | 'drink'
  | 'full'
  | 'attack'
  | 'die'
  | 'taunt'
  /** What an onlooker says when a scandal breaks out next to him. */
  | 'scandal';

export interface FactionDef {
  readonly id: FactionId;
  readonly name: string;
  /** Belt / banner colour, 0xRRGGBB. */
  readonly color: number;
  /** Hat colour — clop in Ardeal, căciulă in Moldova. */
  readonly hatColor: number;
  /** Walking speed in percent. Ardeal is in no hurry. */
  readonly speedPercent: number;
  /** Construction time in percent. Ardeal builds slowly… */
  readonly buildTimePercent: number;
  /** …but what it builds, lasts. */
  readonly buildingHpPercent: number;
  readonly units: Readonly<Record<UnitKind, UnitDef>>;
  readonly ability: AbilityDef;
  /** One line shown on the faction picker. */
  readonly motto: string;
  readonly lines: Readonly<Record<LineKind, readonly string[]>>;
}

export const FACTIONS: Readonly<Record<FactionId, FactionDef>> = {
  ardeal: {
    id: 'ardeal',
    name: 'Ardeal',
    color: 0x2e7d32,
    hatColor: 0x1b1b1b,
    speedPercent: 80,
    buildTimePercent: 130,
    buildingHpPercent: 150,
    units: {
      taran: { name: 'Țăran', hp: 30, damage: 2, cooldown: 10, costPrune: 15, costLemn: 0, trainTicks: 80 },
      // Mountain guard with an axe: slow, dear, hard to put down.
      ostas: { name: 'Plăieș', hp: 80, damage: 10, cooldown: 12, costPrune: 25, costLemn: 10, trainTicks: 120 },
      // Not from around here: dear, and he does not slow down for anybody.
      smecher: { name: 'Băiat de băiat', hp: 60, damage: 12, cooldown: 9, costPrune: 120, costLemn: 0, trainTicks: 150, speedPercent: 130 },
    },
    ability: {
      id: 'palinca',
      name: 'Stai să bem o pălincă',
      costPalinca: 3,
      cooldownTicks: 0,
      description:
        'Toți ai tăi stau la un pahar, iar dușmanii din preajmă stau și mai mult. După aia ai tăi lucrează și dau mai tare.',
    },
    motto: '„No, om face noi și casa aceea, da’ amu’ stai să bem un pic de pălincă.”',
    lines: {
      select: ['No, ce-i?', 'Zî, mă.', 'Amu’ ce mai vrei?', 'No, servus.'],
      move: [
        'No, mă duc… da’ încet.',
        'Las’ că ajung io.',
        'Om mere noi, nu-i grabă.',
        'No, d-apăi mai vedem.',
      ],
      wood: ['No, hai la pădure.', 'Tăiem, da’ nu chiar tot azi.', 'Un lemn, două… ajunge.'],
      plums: ['Prunele-s sfinte.', 'Din asta iasă pălinca.', 'No, la prune!'],
      build: [
        'No, om face noi și casa aceea…',
        'Om face, da’ amu’ stai un pic.',
        'Încet, că-i trainic.',
        'D-apăi mai vedem cum iasă.',
      ],
      drink: ['No, noroc!', 'Să trăiești!', 'Doamne-ajută!', 'Asta-i de-a bună.'],
      full: ['Nu mai încăpem, mă.', 'Îs destui acolo.'],
      attack: ['No, hai, da’ pe rând.', 'Îl batem, da’ fără grabă.', 'Apăi dacă trebe, trebe.'],
      die: ['No, asta-i.', 'Apăi am fost.', 'No, ni…'],
      taunt: ['No, hai, mă!'],
      scandal: ['No, ce-i gălăgia asta?', 'D-apăi ăștia nu-s de-ai noști.', 'No, mă uit și io un pic.'],
    },
  },
  moldova: {
    id: 'moldova',
    name: 'Moldova',
    color: 0xb71c1c,
    hatColor: 0x6d6d6d,
    speedPercent: 115,
    buildTimePercent: 100,
    buildingHpPercent: 100,
    units: {
      taran: { name: 'Țăran', hp: 25, damage: 2, cooldown: 10, costPrune: 15, costLemn: 0, trainTicks: 80 },
      // Free peasant with a sabre: cheap, quick, comes in numbers.
      ostas: { name: 'Răzeș', hp: 50, damage: 7, cooldown: 8, costPrune: 15, costLemn: 5, trainTicks: 70 },
      smecher: { name: 'Băiat de băiat', hp: 60, damage: 12, cooldown: 9, costPrune: 120, costLemn: 0, trainTicks: 150, speedPercent: 130 },
    },
    ability: {
      id: 'taunt',
      name: 'Și vrei, wăi?',
      costPalinca: 0,
      cooldownTicks: 300,
      description:
        'Un răzeș îi ia la întrebări pe dușmanii din preajmă: toți sar pe el, iar el încasează doar pe jumătate.',
    },
    motto: '„Și vrei, wăi? Și vrei, wăi?”',
    lines: {
      select: ['Și vrei, wăi?', 'Și-i, bre?', 'Zî, wăi!', 'Aista-s eu.'],
      move: ['Amuș, amuș!', 'Mă duc, wăi, mă duc!', 'Hai că-s gata.', 'Ca pe vremea lu’ Ștefan!'],
      wood: ['Amuș îl tai, wăi.', 'La pădure, bre!'],
      plums: ['Perje, nu prune, wăi!', 'Hai la perje.'],
      build: ['Îl fac amuș, wăi.', 'Gata-i până mâine.'],
      drink: ['Hai noroc, bre!', 'Să fii sănătos, wăi!', 'Apăi dacă-i pe gratis…'],
      full: ['Nu-i loc, wăi.'],
      attack: ['Pe ei, wăi!', 'Amuș îi ard!', 'Ca Ștefan la Podul Înalt!'],
      die: ['Of, wăi…', 'M-o ajuns, bre.', 'Spuneți-i mamei…'],
      taunt: ['Și vrei, wăi? Și vrei, wăi?!', 'ȘI VREI, WĂI?!'],
      scandal: ['Uăi, se bat!', 'Ia uite, bre, scandal!', 'Și-o fi având, wăi?'],
    },
  },
};

/**
 * The mall crowd talks the same wherever it was raised. `scandal` here is
 * what he shouts when he starts one.
 */
export const SMECHER_LINES: Readonly<Record<LineKind, readonly string[]>> = {
  select: ['Zi, șefu’.', 'Care-i treaba?', 'Știi cine-s eu?'],
  move: ['Merg, da’ cu mașina.', 'Imediat, șefu’.', 'Hai că vin, nu mă stresa.'],
  wood: ['Eu, la lemne? Hai, mă…'],
  plums: ['Eu nu culeg, eu cumpăr.'],
  build: ['Am un băiat care face.'],
  drink: ['Dă și la băiatu’!', 'Asta-i pe bune, nu de la mall.'],
  full: ['Nu-i de mine acolo.'],
  attack: ['Îl fac, șefu’!', 'Ce te uiți, bă?', 'Lasă-l pe mine.'],
  die: ['Nu mă lăsa, șefu’…', 'Sună-l pe tata…'],
  taunt: ['Ce vrei, bă?!'],
  scandal: ['CE TE UIȚI, BĂ?!', 'Știi cine-i tata?!', 'Hai afară, dacă ai curaj!', 'Mie-mi zici, bă?!'],
};
