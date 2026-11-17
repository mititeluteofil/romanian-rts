import type { UnitKind } from './factions';

/** Building definitions. `era` is the first era in which it can be built. */

export type BuildingKind = 'curte' | 'livada' | 'cazan' | 'tabara' | 'gater' | 'bloc' | 'mall';

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
    trains: ['taran'],
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
    trains: ['ostas'],
    era: 0,
    description: 'De aici vin oștenii.',
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
    costLemn: 200,
    buildTicks: 200,
    hp: 900,
    blocks: true,
    trains: ['taran', 'smecher'],
    era: 4,
    description: 'Aici se fac țăranii de azi. Și băieții de băieți, care fac scandal.',
  },
};

/** What a peasant can put up, in menu order. */
export const BUILD_MENU: readonly BuildingKind[] = ['livada', 'cazan', 'tabara', 'gater', 'bloc', 'mall'];

/** How many peasants can pick plums in one orchard. */
export const ORCHARD_CAPACITY = 3;
