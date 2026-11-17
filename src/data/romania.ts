/**
 * The map of Romania as geography data: [longitude, latitude] points.
 * The generator in sim/map.ts rasterises this onto the tile grid.
 *
 * This is a caricature for a joke game, not a survey: borders, the
 * Carpathian arc, the big rivers and the passes are placed so the country is
 * recognisable and so the terrain plays well (passes and fords are the
 * chokepoints between the principalities).
 */

export type LonLat = readonly [number, number];

// --- Projection (equirectangular, squeezed for latitude 46°N) ---
export const MAP_WIDTH = 144;
export const MAP_HEIGHT = 104;
export const LON_WEST = 19.85;
export const LAT_NORTH = 48.55;
/** Tiles per degree of latitude; one tile is about 5.5 km. */
export const TILES_PER_LAT = 20;
/** Tiles per degree of longitude = 20 × cos(46°). */
export const TILES_PER_LON = 13.894;

// --- Regions (the principalities around 1600) ---
export const Region = {
  None: 0,
  Ardeal: 1,
  Moldova: 2,
  TaraRomaneasca: 3,
  Dobrogea: 4,
} as const;
export type Region = (typeof Region)[keyof typeof Region];

export const REGION_NAMES: readonly string[] = [
  'Străinătate',
  'Ardeal',
  'Moldova',
  'Țara Românească',
  'Dobrogea',
];

// --- Border, clockwise from the westernmost point (Beba Veche) ---

const BORDER_HUNGARY: readonly LonLat[] = [
  [20.26, 46.13], [20.72, 46.19], [21.05, 46.24], [21.18, 46.4], [21.3, 46.62], [21.5, 46.75],
  [21.52, 46.95], [21.65, 47.03], [21.8, 47.15], [22.02, 47.52], [22.3, 47.72], [22.6, 47.78],
  [22.89, 47.95],
];

const BORDER_NORTH: readonly LonLat[] = [
  [23.1, 48.08], [23.5, 48.0], [23.9, 47.96], [24.25, 47.92], [24.6, 47.95], [24.9, 47.73],
  [25.25, 47.9], [25.8, 47.95], [26.2, 48.0], [26.45, 48.22],
];

/** The Prut, north to south, down to the Danube at Galați. */
export const PRUT: readonly LonLat[] = [
  [26.63, 48.26], [26.85, 48.2], [27.05, 48.0], [27.22, 47.8], [27.45, 47.5], [27.65, 47.32],
  [27.8, 47.15], [28.08, 46.98], [28.12, 46.8], [28.25, 46.55], [28.2, 46.3], [28.1, 46.05],
  [28.12, 45.8], [28.17, 45.6], [28.2, 45.47],
];

/** The Chilia arm of the Danube, west to east, out to the sea. */
export const DANUBE_CHILIA: readonly LonLat[] = [
  [28.2, 45.47], [28.35, 45.32], [28.7, 45.23], [28.85, 45.33], [29.3, 45.43], [29.6, 45.42],
  [29.72, 45.24],
];

const COAST: readonly LonLat[] = [
  [29.68, 45.15], [29.62, 44.85], [29.15, 44.78], [28.98, 44.66], [28.75, 44.42], [28.66, 44.17],
  [28.62, 43.95], [28.58, 43.74],
];

const BORDER_SOUTH_DOBROGEA: readonly LonLat[] = [
  [28.2, 43.76], [27.95, 43.85], [27.65, 43.97],
];

/** The Danube as the southern border, east (Silistra) to west (Baziaș). */
export const DANUBE_BORDER: readonly LonLat[] = [
  [27.27, 44.12], [26.63, 44.07], [25.97, 43.87], [25.37, 43.63], [24.87, 43.72], [24.5, 43.77],
  [23.95, 43.78], [23.25, 43.83], [22.9, 43.98], [22.68, 44.21], [22.55, 44.48], [22.7, 44.6],
  [22.45, 44.72], [22.15, 44.6], [22.0, 44.5], [21.67, 44.7], [21.39, 44.81],
];

const BORDER_SERBIA: readonly LonLat[] = [
  [21.37, 44.87], [21.5, 45.13], [21.26, 45.27], [21.0, 45.4], [20.8, 45.75], [20.5, 45.9],
];

export const BORDER: readonly LonLat[] = [
  ...BORDER_HUNGARY,
  ...BORDER_NORTH,
  ...PRUT,
  ...DANUBE_CHILIA.slice(1),
  ...COAST,
  ...BORDER_SOUTH_DOBROGEA,
  ...DANUBE_BORDER,
  ...BORDER_SERBIA,
];

/** Outside the border, east of this and south of the Chilia arm is the Black Sea. */
export const SEA_WEST_LON = 28.55;
export const SEA_NORTH_LAT = 45.45;

// --- Mountains: crest lines with a half-width in tiles ---

export interface Chain {
  readonly name: string;
  readonly halfWidth: number;
  readonly points: readonly LonLat[];
}

export const MOUNTAINS: readonly Chain[] = [
  {
    name: 'Carpații Orientali',
    halfWidth: 2.6,
    points: [
      [24.3, 47.8], [24.9, 47.55], [25.3, 47.15], [25.6, 46.8], [25.9, 46.4], [26.2, 46.0],
      [26.35, 45.65],
    ],
  },
  {
    name: 'Carpații de Curbură',
    halfWidth: 2.2,
    points: [[26.35, 45.65], [26.0, 45.45], [25.5, 45.42]],
  },
  {
    name: 'Carpații Meridionali',
    halfWidth: 2.4,
    points: [
      [25.5, 45.42], [25.0, 45.55], [24.6, 45.6], [24.0, 45.5], [23.6, 45.35], [23.0, 45.35],
      [22.6, 45.25],
    ],
  },
  {
    name: 'Munții Banatului',
    halfWidth: 1.8,
    points: [[22.6, 45.25], [22.3, 45.0], [22.0, 44.85], [21.9, 44.7]],
  },
  {
    name: 'Munții Apuseni',
    halfWidth: 2.6,
    points: [[22.75, 46.25], [23.0, 46.55], [22.85, 46.85]],
  },
  { name: 'Poiana Ruscă', halfWidth: 1.2, points: [[22.4, 45.7], [22.6, 45.6]] },
  { name: 'Munții Măcinului', halfWidth: 0.8, points: [[28.2, 45.15], [28.35, 45.0]] },
];

/** Passes cut through the mountains: wooded corridors a peasant can walk. */
export const PASSES: readonly { readonly name: string; readonly line: readonly [LonLat, LonLat] }[] = [
  { name: 'Pasul Tihuța', line: [[24.75, 47.15], [25.55, 47.5]] },
  { name: 'Pasul Ghimeș', line: [[25.3, 46.55], [26.3, 46.75]] },
  { name: 'Pasul Oituz', line: [[25.75, 46.05], [26.7, 46.25]] },
  { name: 'Pasul Buzău', line: [[25.95, 45.85], [26.55, 45.3]] },
  { name: 'Pasul Predeal', line: [[25.6, 45.8], [25.6, 45.1]] },
  { name: 'Pasul Turnu Roșu', line: [[24.3, 45.9], [24.35, 45.2]] },
  { name: 'Pasul Lainici', line: [[23.37, 45.65], [23.35, 45.05]] },
  { name: 'Poarta Orientală', line: [[22.25, 45.36], [22.65, 44.88]] },
];
export const PASS_HALF_WIDTH = 0.9;

// --- Rivers inside the country ---

export interface River {
  readonly name: string;
  readonly halfWidth: number;
  readonly points: readonly LonLat[];
  /** Fords: shallow crossings, slow but passable. */
  readonly fords: readonly LonLat[];
}

export const RIVERS: readonly River[] = [
  {
    name: 'Dunărea',
    halfWidth: 0.9,
    points: [[27.27, 44.12], [28.03, 44.34], [27.95, 44.69], [27.97, 45.27], [28.05, 45.44], [28.2, 45.47]],
    fords: [[28.03, 44.34], [27.93, 44.75], [27.97, 45.27]],
  },
  {
    name: 'Brațul Sulina',
    halfWidth: 0.55,
    points: [[28.7, 45.23], [28.8, 45.18], [29.2, 45.17], [29.66, 45.16]],
    fords: [[28.8, 45.18]],
  },
  {
    name: 'Olt',
    halfWidth: 0.55,
    points: [[24.35, 45.1], [24.37, 44.43], [24.6, 44.0], [24.87, 43.75]],
    fords: [[24.37, 44.43]],
  },
  {
    name: 'Mureș',
    halfWidth: 0.55,
    points: [
      [24.56, 46.54], [23.95, 46.3], [23.68, 46.02], [22.9, 45.9], [21.7, 46.1], [21.31, 46.18],
      [20.85, 46.2],
    ],
    fords: [[23.3, 45.96], [21.31, 46.18]],
  },
  {
    name: 'Siret',
    halfWidth: 0.55,
    points: [
      [26.07, 47.95], [26.72, 47.25], [26.92, 46.92], [26.91, 46.57], [27.18, 46.1], [27.4, 45.7],
      [28.0, 45.42],
    ],
    fords: [[26.72, 47.25], [26.92, 46.92], [27.18, 46.1]],
  },
];

/** Rivers that run along the border; drawn as water on top of the outline. */
export const BORDER_RIVERS: readonly (readonly LonLat[])[] = [PRUT, DANUBE_CHILIA, DANUBE_BORDER];
export const BORDER_RIVER_HALF_WIDTH = 0.9;

// --- Region boundaries ---

/** Ardeal (with Banat, Crișana, Maramureș): everything west of the Carpathian crest. */
export const ARDEAL_AREA: readonly LonLat[] = [
  [24.95, 48.6], [24.9, 47.55], [25.3, 47.15], [25.6, 46.8], [25.9, 46.4], [26.2, 46.0],
  [26.35, 45.65], [26.0, 45.45], [25.5, 45.42], [25.0, 45.55], [24.6, 45.6], [24.0, 45.5],
  [23.6, 45.35], [23.0, 45.35], [22.6, 45.25], [22.3, 45.0], [22.0, 44.85], [21.9, 44.7],
  [21.6, 44.3], [19.0, 44.3], [19.0, 48.6],
];

/** Dobrogea: between the lower Danube and the sea. */
export const DOBROGEA_AREA: readonly LonLat[] = [
  [27.27, 44.12], [28.03, 44.34], [27.95, 44.69], [27.97, 45.27], [28.05, 45.44], [28.2, 45.47],
  [30.5, 45.7], [30.5, 43.3], [27.27, 43.3],
];

/** North of this line (east of the mountains) is Moldova, south is Țara Românească. */
export const MOLDOVA_SOUTH_LINE: readonly LonLat[] = [[26.35, 45.65], [27.2, 45.6], [28.05, 45.44]];

// --- Places ---

export interface Place {
  readonly name: string;
  readonly at: LonLat;
}

export const PLACES = {
  albaIulia: { name: 'Alba Iulia', at: [23.5, 46.12] },
  cluj: { name: 'Cluj', at: [23.6, 46.77] },
  timisoara: { name: 'Timișoara', at: [21.23, 45.75] },
  iasi: { name: 'Iași', at: [27.55, 47.16] },
  suceava: { name: 'Suceava', at: [26.25, 47.65] },
  targoviste: { name: 'Târgoviște', at: [25.46, 44.93] },
  bucuresti: { name: 'București', at: [26.1, 44.43] },
  craiova: { name: 'Craiova', at: [23.8, 44.32] },
  constanta: { name: 'Constanța', at: [28.5, 44.18] },
} as const satisfies Record<string, Place>;
