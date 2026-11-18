import type { FactionId, UnitKind } from './factions';

/** Building definitions. `era` is the first era in which it can be built. */

export type BuildingKind =
  | 'curte'
  | 'livada'
  | 'casa'
  | 'han'
  | 'cazan'
  | 'tabara'
  | 'turn'
  | 'zid'
  | 'poarta'
  | 'cherhana'
  | 'gater'
  | 'bloc'
  | 'mall';

export interface BuildingDef {
  readonly kind: BuildingKind;
  readonly name: string;
  /** Footprint is size × size tiles. */
  readonly size: number;
  /** Cost in wood, before the era's prices. */
  readonly costLemn: number;
  /** Builder-ticks of work at 100% build speed. */
  readonly buildTicks: number;
  /** Hit points at 100% (factions scale this). */
  readonly hp: number;
  /** Whether units have to walk around it. */
  readonly blocks: boolean;
  /** What it trains, in button order. */
  readonly trains: readonly UnitKind[];
  /** Index into ERAS: the first era that knows how to build it. */
  readonly era: number;
  /** If set, only this faction knows how to build it. */
  readonly only?: FactionId;
  /** Has to stand next to water. */
  readonly needsWater?: boolean;
  readonly description: string;
}

export const BUILDINGS: Readonly<Record<BuildingKind, BuildingDef>> = {
  curte: {
    kind: 'curte',
    name: 'Curte',
    size: 3,
    costLemn: 0,
    buildTicks: 0,
    hp: 1200,
    blocks: true,
    trains: ['taran', 'iscoada'],
    era: 0,
    description: 'Aici se aduc lemnele și prunele, de aici vin țăranii și tot aici se schimbă vremurile. Dacă pică, ai pierdut.',
  },
  livada: {
    kind: 'livada',
    name: 'Livadă de pruni',
    size: 2,
    costLemn: 30,
    buildTicks: 60,
    hp: 250,
    blocks: false,
    trains: [],
    era: 0,
    description: 'Țăranii culeg prune. Încap cel mult trei.',
  },
  casa: {
    kind: 'casa',
    name: 'Casă țărănească',
    size: 2,
    costLemn: 30,
    buildTicks: 50,
    hp: 280,
    blocks: true,
    trains: [],
    era: 0,
    description: 'O casă cu prispă și cuptor. Mai încap patru oameni.',
  },
  han: {
    kind: 'han',
    name: 'Han',
    size: 2,
    costLemn: 55,
    buildTicks: 90,
    hp: 420,
    blocks: true,
    trains: [],
    era: 1,
    description: 'Mai încap șase oameni, iar ai tăi își trag sufletul și se vindecă pe lângă el.',
  },
  cazan: {
    kind: 'cazan',
    name: 'Cazan de pălincă',
    size: 2,
    costLemn: 50,
    buildTicks: 100,
    hp: 300,
    blocks: true,
    trains: [],
    era: 0,
    description: 'Face din 5 prune și un lemn o pălincă. Singur, fără grabă.',
  },
  tabara: {
    kind: 'tabara',
    name: 'Tabără de oaste',
    size: 2,
    costLemn: 60,
    buildTicks: 120,
    hp: 500,
    blocks: true,
    trains: ['ostas', 'stegar', 'iscoada'],
    era: 0,
    description: 'De aici vin oștenii, stegarul Auraș și iscoadele.',
  },
  turn: {
    kind: 'turn',
    name: 'Turn de veghe',
    size: 2,
    costLemn: 50,
    buildTicks: 80,
    hp: 450,
    blocks: true,
    trains: [],
    era: 0,
    description: 'Trage singur în dușmanii și ienicerii care se apropie.',
  },
  zid: {
    kind: 'zid',
    name: 'Palisadă / Zid',
    size: 1,
    costLemn: 8,
    buildTicks: 20,
    hp: 320,
    blocks: true,
    trains: [],
    era: 0,
    description: 'Zid de apărare: oprește dușmanul la trecători.',
  },
  poarta: {
    kind: 'poarta',
    name: 'Poartă',
    size: 1,
    costLemn: 15,
    buildTicks: 25,
    hp: 360,
    blocks: false,
    trains: [],
    era: 0,
    description: 'Lasă ai tăi să treacă, dar ține dușmanii afară.',
  },
  cherhana: {
    kind: 'cherhana',
    name: 'Cherhana',
    size: 2,
    costLemn: 40,
    buildTicks: 80,
    hp: 300,
    blocks: true,
    trains: [],
    era: 0,
    only: 'dobrogea',
    needsWater: true,
    description: 'Pescărie la malul apei: aduce pește singură, fără țărani.',
  },
  gater: {
    kind: 'gater',
    name: 'Gater',
    size: 2,
    costLemn: 80,
    buildTicks: 120,
    hp: 350,
    blocks: true,
    trains: [],
    era: 2,
    description: 'Industrie: scoate lemne singur, fără țărani și fără pădure. Nu întreba de unde.',
  },
  bloc: {
    kind: 'bloc',
    name: 'Bloc',
    size: 2,
    costLemn: 100,
    buildTicks: 140,
    hp: 600,
    blocks: true,
    trains: [],
    era: 3,
    description: 'Mai încap șase oameni. Apa caldă, după program.',
  },
  mall: {
    kind: 'mall',
    name: 'Mall',
    size: 3,
    costLemn: 140,
    buildTicks: 200,
    hp: 900,
    blocks: true,
    trains: ['taran', 'smecher'],
    era: 4,
    description: 'Aici se fac țăranii de azi. Și băieții de băieți, care fac scandal.',
  },
};

/** What a peasant can put up, in menu order. */
export const BUILD_MENU: readonly BuildingKind[] = [
  'livada',
  'casa',
  'han',
  'cherhana',
  'cazan',
  'tabara',
  'turn',
  'zid',
  'poarta',
  'gater',
  'bloc',
  'mall',
];

/** How many peasants can pick plums in one orchard. */
export const ORCHARD_CAPACITY = 3;

// --- Research & Cross-Faction Debuffs --------------------------------------

export type TechId =
  | 'topor'
  | 'zidarie'
  | 'instructie'
  | 'palinca_dubla'
  | 'pila'
  | 'dosar'
  | 'para'
  | 'pana_curent';

export interface TechDef {
  readonly id: TechId;
  readonly name: string;
  readonly building: BuildingKind;
  readonly era: number;
  readonly costLemn: number;
  readonly costPrune: number;
  readonly researchTicks: number;
  /** True if this research applies a timed debuff / sabotage to a rival faction. */
  readonly isDebuff?: boolean;
  readonly description: string;
}

export const TECHS: Readonly<Record<TechId, TechDef>> = {
  topor: {
    id: 'topor',
    name: 'Coasă și topor nou',
    building: 'curte',
    era: 0,
    costLemn: 25,
    costPrune: 25,
    researchTicks: 80,
    description: 'Țăranii duc cu 2 lemne sau prune mai mult la fiecare drum.',
  },
  zidarie: {
    id: 'zidarie',
    name: 'Zidărie trainică',
    building: 'curte',
    era: 1,
    costLemn: 40,
    costPrune: 30,
    researchTicks: 100,
    description: 'Toate clădirile tale primesc +25% trăinicie (HP).',
  },
  instructie: {
    id: 'instructie',
    name: 'Instrucție de oaste',
    building: 'tabara',
    era: 0,
    costLemn: 30,
    costPrune: 40,
    researchTicks: 90,
    description: 'Oștenii tăi lovesc cu +2 mai tare.',
  },
  palinca_dubla: {
    id: 'palinca_dubla',
    name: 'Pălincă dublu rafinată',
    building: 'cazan',
    era: 1,
    costLemn: 25,
    costPrune: 35,
    researchTicks: 90,
    description: 'Pălinca ține cu 50% mai mult, iar dușmanii stau mai mult la pahar.',
  },
  pila: {
    id: 'pila',
    name: 'Pila potrivită',
    building: 'curte',
    era: 1,
    costLemn: 15,
    costPrune: 30,
    researchTicks: 70,
    description: 'Șpaga reușește 9 dăți din 10 în loc de 4 din 5.',
  },
  dosar: {
    id: 'dosar',
    name: 'Dosar cu șină',
    building: 'curte',
    era: 2,
    costLemn: 35,
    costPrune: 35,
    researchTicks: 80,
    isDebuff: true,
    description: 'Sabotaj birocratic: rivalul construiește și antrenează mai greu timp de 45s.',
  },
  para: {
    id: 'para',
    name: 'Pâră la Poartă',
    building: 'curte',
    era: 0,
    costLemn: 15,
    costPrune: 35,
    researchTicks: 70,
    isDebuff: true,
    description: 'Pârăști rivalul la Stambul: Poarta îi cere haraci cu +20 mai scump.',
  },
  pana_curent: {
    id: 'pana_curent',
    name: 'Pană de curent',
    building: 'curte',
    era: 3,
    costLemn: 40,
    costPrune: 40,
    researchTicks: 90,
    isDebuff: true,
    description: 'Oprește gaterul și cazanul rivalului timp de 30s.',
  },
};

export const TECH_IDS: readonly TechId[] = Object.keys(TECHS) as TechId[];
