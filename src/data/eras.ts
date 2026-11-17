/**
 * The eras a settlement lives through, from the voivodes to the mall.
 * Each faction advances on its own, at its court, for wood and plums.
 * Every era brings one new building and one joke rule.
 */

export interface EraDef {
  readonly name: string;
  readonly year: number;
  /** Price of entering this era (era 0 is free: you start there). */
  readonly advanceLemn: number;
  readonly advancePrune: number;
  /** Ticks the court needs to change the times, at 100% build speed. */
  readonly advanceTicks: number;
  /** Everything bought in this era costs this much, in percent. */
  readonly costPercent: number;
  /** …and training takes this long, in percent. */
  readonly trainTimePercent: number;
  /** Shown when the era begins. */
  readonly announcement: string;
}

export const ERAS: readonly EraDef[] = [
  {
    name: 'Voievodat',
    year: 1600,
    advanceLemn: 0,
    advancePrune: 0,
    advanceTicks: 0,
    costPercent: 100,
    trainTimePercent: 100,
    announcement: 'Anul 1600. Fiecare cu curtea lui.',
  },
  {
    name: 'Epoca fanariotă',
    year: 1750,
    advanceLemn: 80,
    advancePrune: 80,
    advanceTicks: 200,
    costPercent: 100,
    trainTimePercent: 100,
    announcement: 'Epoca fanariotă: de-amu se poate da șpagă. Merge repede — dacă merge.',
  },
  {
    name: 'România Mare',
    year: 1918,
    advanceLemn: 150,
    advancePrune: 150,
    advanceTicks: 200,
    costPercent: 100,
    trainTimePercent: 100,
    announcement: 'România Mare: s-o făcut industrie. Gaterul taie lemne singur.',
  },
  {
    name: 'Epoca de Aur',
    year: 1975,
    advanceLemn: 250,
    advancePrune: 250,
    advanceTicks: 200,
    costPercent: 50,
    trainTimePercent: 200,
    announcement: 'Epoca de Aur: totu-i pe jumătate de preț, da’ se stă la coadă de două ori mai mult. Se pot face blocuri.',
  },
  {
    name: 'Prezent',
    year: 2024,
    advanceLemn: 400,
    advancePrune: 400,
    advanceTicks: 200,
    costPercent: 150,
    trainTimePercent: 100,
    announcement: 'Prezent: s-o scumpit tot, da’ vin fonduri europene. Țăranii nu se mai fac la curte, se fac la mall.',
  },
];

export const LAST_ERA = ERAS.length - 1;

/** What the court is called as the times change. */
export const COURT_NAMES: readonly string[] = [
  'Curte boierească',
  'Curte domnească',
  'Primărie',
  'Consiliu popular',
  'Primărie cu termopane',
];

/** From this era on, bribes work. */
export const BRIBE_ERA = 1;
