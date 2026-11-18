/**
 * Faction definitions. Everything faction-specific (names, colours, jokes,
 * unit stats, the signature ability, who cannot stand whom) lives in data so
 * a new faction or a new joke never needs engine changes.
 */

export type FactionId = 'ardeal' | 'moldova' | 'tara' | 'dobrogea' | 'oltenia' | 'otomani';

/** Classic four principalities (default 4-way setup). */
export const FACTION_IDS: readonly FactionId[] = ['ardeal', 'moldova', 'tara', 'dobrogea'];

/** All five playable principalities including Oltenia. */
export const PLAYABLE_FACTION_IDS: readonly FactionId[] = ['ardeal', 'moldova', 'tara', 'oltenia', 'dobrogea'];

/** Not playable: they only turn up when the tribute is late. */
export const RAIDERS: FactionId = 'otomani';

export const ALL_FACTION_IDS: readonly FactionId[] = [...PLAYABLE_FACTION_IDS, RAIDERS];

/** One fresh value per faction, for the simulation's per-faction tables. */
export function perFaction<T>(make: (faction: FactionId) => T): Record<FactionId, T> {
  return {
    ardeal: make('ardeal'),
    moldova: make('moldova'),
    tara: make('tara'),
    dobrogea: make('dobrogea'),
    oltenia: make('oltenia'),
    otomani: make('otomani'),
  };
}

export type UnitKind = 'taran' | 'ostas' | 'smecher' | 'stegar' | 'iscoada';

/** Everyone except the peasants marches with the army. */
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

export type AbilityId = 'palinca' | 'taunt' | 'rezolva' | 'plaja' | 'iures' | 'none';

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
  /** Hat colour — clop in Ardeal, căciulă in Moldova… */
  readonly hatColor: number;
  /** What the soldiers wear over the shirt. */
  readonly coatColor: number;
  readonly weapon: 'axe' | 'sabre' | 'spear';
  /** Walking speed in percent. Ardeal is in no hurry. */
  readonly speedPercent: number;
  /** Construction time in percent. Ardeal builds slowly… */
  readonly buildTimePercent: number;
  /** …but what it builds, lasts. */
  readonly buildingHpPercent: number;
  /** What the food in the storehouse is called here. */
  readonly foodName: string;
  /** Whether the Ottomans send for tribute (Dobrogea already is theirs). */
  readonly paysHaraci: boolean;
  /** The Bucharest disease: in the present, its units crawl near their own court. */
  readonly traffic: boolean;
  /** The faction it cannot stand: +20% damage against it, and the AI's favourite target. */
  readonly rival: FactionId | null;
  /** What is said when marching on each of the others. */
  readonly quips: Readonly<Partial<Record<FactionId, string>>>;
  readonly units: Readonly<Record<UnitKind, UnitDef>>;
  readonly ability: AbilityDef;
  /** One line shown on the faction picker. */
  readonly motto: string;
  readonly builtLine: string;
  readonly winLine: string;
  readonly loseLine: string;
  readonly lines: Readonly<Record<LineKind, readonly string[]>>;
}

const SMECHER: UnitDef = {
  name: 'Băiat de băiat',
  hp: 60,
  damage: 12,
  cooldown: 9,
  costPrune: 120,
  costLemn: 0,
  trainTicks: 150,
  speedPercent: 130,
};

export const STEGAR: UnitDef = {
  name: 'Stegar (Auraș)',
  hp: 45,
  damage: 0,
  cooldown: 12,
  costPrune: 20,
  costLemn: 10,
  trainTicks: 80,
  speedPercent: 115,
};

export const ISCOADA: UnitDef = {
  name: 'Iscoadă',
  hp: 30,
  damage: 3,
  cooldown: 9,
  costPrune: 12,
  costLemn: 0,
  trainTicks: 50,
  speedPercent: 145,
};

/** Whether `attacker` gets the regional rivalry damage bonus against `victim` ("Oltenii cu toată lumea"). */
export function isRival(attacker: FactionId, victim: FactionId): boolean {
  if (attacker === victim || victim === RAIDERS || attacker === RAIDERS) return false;
  if (attacker === 'oltenia' || victim === 'oltenia') return true;
  return FACTIONS[attacker].rival === victim;
}

export const FACTIONS: Readonly<Record<FactionId, FactionDef>> = {
  ardeal: {
    id: 'ardeal',
    name: 'Ardeal',
    color: 0x2e7d32,
    hatColor: 0x1b1b1b,
    coatColor: 0x56613f,
    weapon: 'axe',
    speedPercent: 80,
    buildTimePercent: 130,
    buildingHpPercent: 150,
    foodName: 'Prune',
    paysHaraci: true,
    traffic: false,
    rival: 'tara',
    quips: {
      moldova: 'Voi alergați, noi ajungem.',
      tara: 'Destul am plătit io pentru voi, miticilor.',
      dobrogea: 'No, venim la mare, da’ nu la plajă.',
      oltenia: 'No, cu voi tot timpu’ îi grabă și harță.',
    },
    units: {
      taran: { name: 'Țăran', hp: 30, damage: 2, cooldown: 10, costPrune: 15, costLemn: 0, trainTicks: 80 },
      // Mountain guard with an axe: slow, dear, hard to put down.
      ostas: { name: 'Plăieș', hp: 80, damage: 10, cooldown: 12, costPrune: 25, costLemn: 10, trainTicks: 120 },
      // Not from around here: dear, and he does not slow down for anybody.
      smecher: SMECHER,
      stegar: STEGAR,
      iscoada: ISCOADA,
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
    builtLine: 'No, vezi că s-o făcut.',
    winLine: 'No, vezi că s-o putut. Am rămas numa’ noi. Amu’ putem sta.',
    loseLine: 'No, asta-i: ne-or luat curtea. Om face alta, da’ mai încet.',
    lines: {
      select: [
        'No, ce-i?',
        'Zî, mă.',
        'Amu’ ce mai vrei?',
        'No, servus.',
        'Nem tudom.',
        'Atunci ce cauți pe harta mea?!',
      ],
      move: [
        'No, mă duc… da’ încet.',
        'Las’ că ajung io.',
        'Om mere noi, nu-i grabă.',
        'Poate mâine după o cafă…',
        'Apăi înainte de muncă…',
      ],
      wood: ['No, hai la pădure.', 'Tăiem, da’ nu chiar tot azi.', 'Un lemn, două… ajunge.'],
      plums: ['Prunele-s sfinte.', 'Din asta iasă pălinca.', 'No, la prune!'],
      build: [
        'No, numai bine bem o pălincă, ne cunoaștem…',
        'Om face noi și casa aceea…',
        'Încet, că-i trainic.',
        'D-apăi mai vedem cum iasă.',
      ],
      drink: ['No, noroc!', 'Să trăiești!', 'Doamne-ajută!', 'Asta-i de-a bună.'],
      full: ['Nu mai încăpem, mă.', 'Îs destui acolo.'],
      attack: ['No, hai, da’ pe rând.', 'Îl batem, da’ fără grabă.', 'Apăi dacă trebe, trebe.'],
      die: ['No, asta-i.', 'Apăi am fost.', 'No, ni…'],
      taunt: ['No, hai, mă!', 'Atunci ce cauți pe harta mea?!'],
      scandal: [
        'No, ce-i gălăgia asta?',
        'D-apăi ăștia nu-s de-ai noști.',
        'No, mă uit și io un pic.',
        'Exact ca moldovenii, nu fac nimic!',
      ],
    },
  },

  moldova: {
    id: 'moldova',
    name: 'Moldova',
    color: 0xb71c1c,
    hatColor: 0x6d6d6d,
    coatColor: 0x7a3b2b,
    weapon: 'sabre',
    speedPercent: 115,
    buildTimePercent: 100,
    buildingHpPercent: 100,
    foodName: 'Perje',
    paysHaraci: true,
    traffic: false,
    rival: 'tara',
    quips: {
      ardeal: 'Până vă urniți voi, noi am gătat, wăi.',
      tara: 'Capitala trebuia să fie la Ieși, wăi!',
      dobrogea: 'Venim la mare, bre, cu tot cu sărmăluțe.',
      oltenia: 'Băi oltenilor, cu toată lumea vă certați?!',
    },
    units: {
      taran: { name: 'Țăran', hp: 25, damage: 2, cooldown: 10, costPrune: 15, costLemn: 0, trainTicks: 80 },
      // Free peasant with a sabre: cheap, quick, comes in numbers.
      ostas: { name: 'Răzeș', hp: 50, damage: 7, cooldown: 8, costPrune: 15, costLemn: 5, trainTicks: 70 },
      smecher: SMECHER,
      stegar: STEGAR,
      iscoada: ISCOADA,
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
    builtLine: 'Gata-i, wăi!',
    winLine: 'Și mai vrei, wăi? Nimica nu mai vrei! Am rămas numa’ noi.',
    loseLine: 'Of, wăi… ne-o luat curtea. De la Ștefan n-am mai pățit așa ceva.',
    lines: {
      select: [
        'Și vrei, wăi?',
        'Și-i, bre?',
        'Zî, wăi!',
        'Aista-s eu.',
        'Nu înțeleg nimic!',
        'De ce suntem noi astăzi aici?',
      ],
      move: [
        'Amuș, amuș!',
        'Mă duc, wăi, mă duc!',
        'Hai că-ncolo e Ardealul!',
        'În Italia nu-ți dă nimeni cu click-ul în cap!',
        'Moară mama dacă văd ceva!',
        'Când e cald ne faci și vânt!',
      ],
      wood: ['Amuș îl tai, wăi.', 'La pădure, bre!'],
      plums: ['Perje, nu prune, wăi!', 'Hai la perje.'],
      build: ['Fă o cocioabă!', 'Îl fac amuș, wăi.', 'Gata-i până mâine.'],
      drink: ['Hai noroc, bre!', 'Să fii sănătos, wăi!', 'Apăi dacă-i pe gratis…'],
      full: ['Nu-i loc, wăi.'],
      attack: [
        'Pe ei, wăi!',
        'Cap de bour!',
        'Ștefan! Ăștia au metal!',
        'Ca Ștefan la Podul Înalt!',
        'Cu pumnii ne batem noi!',
        'Serios, ne batem cu ei?!',
      ],
      die: ['Of, wăi…', 'M-o ajuns, bre.', 'Eu-s alergic la metal!'],
      taunt: [
        'Și vrei, wăi? Și vrei, wăi?!',
        'ȘI VREI, WĂI?!',
        'Mai tare, domnule!',
        'Te bag în șase saci!',
      ],
      scandal: [
        'Uăi, se bat!',
        'Ia uite, bre, scandal!',
        'Și-o fi având, wăi?',
        'Sper să nu cânte Voltaj!',
      ],
    },
  },

  tara: {
    id: 'tara',
    name: 'Țara Românească',
    color: 0xf2c230,
    hatColor: 0x2b3a67,
    coatColor: 0x2b3a67,
    weapon: 'sabre',
    speedPercent: 100,
    buildTimePercent: 100,
    buildingHpPercent: 100,
    foodName: 'Prune',
    paysHaraci: true,
    traffic: true,
    rival: 'ardeal',
    quips: {
      ardeal: 'Hai, bă, mai repede, că ne prinde seara!',
      moldova: 'Stați, bă, liniștiți acolo la voi.',
      dobrogea: 'Litoralu’ e al nostru, bă, de la Mircea.',
      oltenia: 'Tot de la Craiova veniți, bă!',
    },
    units: {
      taran: { name: 'Țăran', hp: 25, damage: 2, cooldown: 10, costPrune: 15, costLemn: 0, trainTicks: 80 },
      // Hired foot soldier: nothing special, always available.
      ostas: { name: 'Dorobanț', hp: 60, damage: 8, cooldown: 9, costPrune: 20, costLemn: 5, trainTicks: 90 },
      // At home in the malls of the capital: half the price, and quicker to turn up.
      smecher: { ...SMECHER, costPrune: 60, trainTicks: 90 },
      stegar: STEGAR,
      iscoada: ISCOADA,
    },
    ability: {
      id: 'rezolva',
      name: 'Lasă, că se rezolvă',
      costPalinca: 0,
      cooldownTicks: 600,
      description:
        'Tot ce e în lucru — șantiere, oameni la rând, schimbarea vremurilor — se termină pe loc. O dată din patru nu se rezolvă nimic și te costă 30 de prune.',
    },
    motto: '„Lasă, bă, că se rezolvă.”',
    builtLine: 'S-a rezolvat, șefu’.',
    winLine: 'Ați văzut, bă? S-a rezolvat. Toată țara-i a noastră.',
    loseLine: 'Nu s-a mai rezolvat, bă. Ne-au luat curtea.',
    lines: {
      select: ['Da, boss!', 'Zi, bă.', 'Care-i treaba?', 'Ascult, șefu’.', 'Să știe!', 'Hai, bă, băiatule!'],
      move: [
        'Mă duc, bă, mă duc.',
        'Imediat, șefu’.',
        'Da, boss!',
        'Bă, nu cred că ne batem azi!',
      ],
      wood: ['Tăiem, bă, că altfel nu se face.', 'Hai la lemne.', 'Hai să producem ceva pentru societate!'],
      plums: ['Culegem, șefu’.', 'Astea-s pentru țuică, nu?', 'Auraș, lasă steagul, hai la muncă!'],
      build: [
        'Facem, să știe!',
        'Lasă, că se rezolvă.',
        'Îl facem, bă, n-ai grijă.',
        'Faci o cocioabă cu ăștia și dai faliment!',
      ],
      drink: ['Hai noroc, bă!', 'Să ne trăiești, șefu’!', 'Asta-i tare, bă.'],
      full: ['Nu mai e loc, bă.'],
      attack: ['Pe ei, bă!', 'Bagă sabia-n teacă că te tai singur!', 'Lasă-i pe mâna mea.'],
      die: ['M-au rezolvat, bă…', 'Aoleu…'],
      taunt: ['Ce vrei, bă?!', 'Să știe!', 'Ia uite ce față are!'],
      scandal: ['Ia uite, bă, circ!', 'Iar ăștia…', 'Stai să filmez.'],
    },
  },

  dobrogea: {
    id: 'dobrogea',
    name: 'Dobrogea',
    color: 0x00838f,
    hatColor: 0xb53a2a,
    coatColor: 0x1f5a7a,
    weapon: 'spear',
    speedPercent: 100,
    buildTimePercent: 100,
    buildingHpPercent: 100,
    foodName: 'Pește',
    paysHaraci: false,
    traffic: false,
    rival: 'tara',
    quips: {
      ardeal: 'Veniți la mare o dată pe an și faceți pe deștepții.',
      moldova: 'La noi nu-i cu „wăi”, îi cu briză.',
      tara: 'Ajunge cu weekendu’ vostru la Vama!',
      oltenia: 'Lăsați prazul, că la mare-i cu pește!',
    },
    units: {
      taran: { name: 'Țăran', hp: 25, damage: 2, cooldown: 10, costPrune: 15, costLemn: 0, trainTicks: 80 },
      // A sailor with a harpoon: the weakest soldier on the map, and the cheapest.
      ostas: { name: 'Marinar', hp: 40, damage: 6, cooldown: 9, costPrune: 12, costLemn: 4, trainTicks: 70 },
      smecher: SMECHER,
      stegar: STEGAR,
      iscoada: ISCOADA,
    },
    ability: {
      id: 'plaja',
      name: 'Hai la mare',
      costPalinca: 0,
      cooldownTicks: 450,
      description:
        'Oștenii dușmani din preajma curții lasă armele și se duc la plajă. Cât stau acolo, plătesc: 5 pești de căciulă.',
    },
    motto: '„Hai la mare, că-i păcat de vreme.”',
    builtLine: 'Gata, a ieșit la țanc.',
    winLine: 'Au plecat toți acasă. A rămas marea, și noi cu ea.',
    loseLine: 'Ne-au luat curtea. Măcar marea n-o pot lua.',
    lines: {
      select: ['Zi, căpitane.', 'Aici!', 'Ce bate vântu’?', 'La ordin.'],
      move: ['Pe-acolo-i vânt bun.', 'Ridic ancora.', 'Mă duc, căpitane.'],
      wood: ['Lemn de barcă, bun.', 'Tai, da’ mi-e dor de apă.'],
      plums: ['Prune? Eu-s cu peștele.', 'Hai și la livadă.'],
      build: ['O fac ca pe-o barcă.', 'Să țină la furtună.'],
      drink: ['Hai noroc, la valuri!', 'Pentru cei de pe mare!'],
      full: ['Nu mai încape nici un cârlig.'],
      attack: ['La abordaj!', 'Îi dăm la fund.', 'Harponu’ sus!'],
      die: ['Mă duc la fund…', 'Spuneți-i mării…'],
      taunt: ['Hai la apă, dacă ai curaj!'],
      scandal: ['Ca-n port, la descărcat.', 'Iar s-au luat ăștia la harță.'],
    },
  },

  oltenia: {
    id: 'oltenia',
    name: 'Oltenia',
    color: 0xd84315,
    hatColor: 0x263238,
    coatColor: 0x8d3b1e,
    weapon: 'sabre',
    speedPercent: 112,
    buildTimePercent: 95,
    buildingHpPercent: 100,
    foodName: 'Praz',
    paysHaraci: true,
    traffic: false,
    rival: 'tara',
    quips: {
      ardeal: 'Până beți voi pălinca, noi v-am luat curtea, vere!',
      moldova: 'Ia uite-l și pe moldoveanul ăsta, vere!',
      tara: 'Fără Craiova nu rezolvați nimic la București!',
      dobrogea: 'Venim peste Dunăre, vere!',
    },
    units: {
      taran: { name: 'Oltean', hp: 25, damage: 3, cooldown: 9, costPrune: 15, costLemn: 0, trainTicks: 75 },
      ostas: { name: 'Pandur', hp: 55, damage: 8, cooldown: 8, costPrune: 18, costLemn: 5, trainTicks: 75 },
      smecher: { ...SMECHER, costPrune: 75, trainTicks: 100 },
      stegar: STEGAR,
      iscoada: ISCOADA,
    },
    ability: {
      id: 'iures',
      name: 'Oltenii cu toată lumea!',
      costPalinca: 0,
      cooldownTicks: 360,
      description:
        'Iureș oltenesc: toți ai tăi prind putere și iuțeală la mânie, fără să mai stea la discuții.',
    },
    motto: '„Oltenii cu toată lumea — nu stăm patru ore pe câmp!”',
    builtLine: 'Făcurăm și asta, vere!',
    winLine: 'Băturăm pe toată lumea, vere! De la Craiova până la mare!',
    loseLine: 'Ne luară curtea, vere… da’ ne întoarcem noi!',
    lines: {
      select: ['Zi, vere!', 'Ce fuse?', 'Aici sunt, mânca-ți-aș!', 'Gata de harță!'],
      move: ['Fugă, vere!', 'Nu stăm patru ore pe câmp!', 'Mergem la Craiova!'],
      wood: ['Tăiarăm pădurea, vere!', 'Dă toporu’ încoa’!'],
      plums: ['Praz și prune, forță!', 'Culeserăm tot!'],
      build: ['O ridicăm acuma, vere!', 'Nu stăm pe gânduri!'],
      drink: ['Hai noroc, vere!', 'Zaibăr de-ăl bun!'],
      full: ['Nu mai încăpem, vere!'],
      attack: ['Pe ei, cu toată lumea!', 'Bagă sabia-n teacă că te tai singur!', 'Din Craiova, fără frică!'],
      die: ['Aoleu, mânca-ți-aș…', 'Mă dovediră…'],
      taunt: ['Cu toată lumea ne batem, vere!', 'Bagă sabia-n teacă!'],
      scandal: ['Ia uite-i, vere, se luară!', 'Stai că mă bag și eu!'],
    },
  },

  otomani: {
    id: 'otomani',
    name: 'Poarta',
    color: 0xc62828,
    hatColor: 0xf2f2f2,
    coatColor: 0x9a1f1f,
    weapon: 'sabre',
    speedPercent: 100,
    buildTimePercent: 100,
    buildingHpPercent: 100,
    foodName: 'Peșcheș',
    paysHaraci: false,
    traffic: false,
    rival: null,
    quips: {},
    units: {
      taran: { name: 'Hamal', hp: 25, damage: 2, cooldown: 10, costPrune: 0, costLemn: 0, trainTicks: 1 },
      // Come to collect: as tough as a plăieș, and there is always more than one.
      ostas: { name: 'Ienicer', hp: 70, damage: 9, cooldown: 10, costPrune: 0, costLemn: 0, trainTicks: 1 },
      smecher: SMECHER,
      stegar: STEGAR,
      iscoada: ISCOADA,
    },
    ability: { id: 'none', name: '', costPalinca: 0, cooldownTicks: 0, description: '' },
    motto: '',
    builtLine: '',
    winLine: '',
    loseLine: '',
    lines: {
      select: ['Unde-i haraciul?', 'Peșcheș, efendi!'],
      move: ['Haide, haide!'],
      wood: ['Haide!'],
      plums: ['Haide!'],
      build: ['Haide!'],
      drink: ['Asta nu-i șerbet…', 'Numai un pic, să nu afle aga.'],
      full: ['Yok.'],
      attack: ['Haraciul, bre!', 'Plata la Poartă!'],
      die: ['Aman…', 'Vai de zilele mele, efendi…'],
      taunt: ['Haide!'],
      scandal: ['Ce-i zarva asta, bre?', 'La Stambul nu-i așa ceva.'],
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

export const STEGAR_LINES: Readonly<Record<LineKind, readonly string[]>> = {
  select: ['Pentru că sunt alergic la metal!', 'Eu am băț și pânză!', 'E o onoare să fii stegar!'],
  move: ['Cap de bour!', 'Când e cald vă fac și vânt!', 'Plec primul, cu fața de supărat!'],
  wood: ['Eu țin steagul, nu toporul!'],
  plums: ['Stegarul nu culege!'],
  build: ['Vă fac vânt cât munciți!'],
  drink: ['Doar o gură, să nu ruginească bățul!'],
  full: ['Nu încape steagul acolo!'],
  attack: ['Cap de bour!', 'Ștefan! Ăștia au metal!', 'Cu băț și pânză înainte!'],
  die: ['Eu-s alergic la metal!', 'Țineți steagul sus…'],
  taunt: ['Cap de bour!', 'Când e cald vă fac și vânt!'],
  scandal: ['Băi jderilor, gata cu caterinca!'],
};

export const ISCOADA_LINES: Readonly<Record<LineKind, readonly string[]>> = {
  select: ['Șșșt! Sunt iscoadă!', 'Am ochelarii la mine!', 'Spune, încotro?'],
  move: ['Pe furiș…', 'Nu mă vede nimeni!', 'Mă strecor prin pădure.'],
  wood: ['Eu doar număr copacii.'],
  plums: ['Iau doar două pentru drum.'],
  build: ['Stau de șase!'],
  drink: ['Una mică, pentru curaj!'],
  full: ['Prea multă lume acolo.'],
  attack: ['Te-am văzut primul!', 'Din umbră!'],
  die: ['M-au dibuit…', 'Au văzut iscoada…'],
  taunt: ['Nici nu știi de unde vin!'],
  scandal: ['Stau în tufiș și iau notițe.'],
};
