/** Every country, grouped by continent, for browsing. Names come from the platform's own locale data. */

const REGIONS: ReadonlyArray<readonly [region: string, codes: string]> = [
  [
    'Asia',
    'AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE',
  ],
  [
    'Europe',
    'AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA',
  ],
  [
    'Africa',
    'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW',
  ],
  [
    'North America',
    'AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI',
  ],
  ['South America', 'AR BO BR CL CO EC FK GF GY PY PE SR UY VE'],
  ['Oceania', 'AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF'],
];

export interface Country {
  code: string;
  name: string;
}

export interface Region {
  name: string;
  countries: Country[];
}

const names = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string): string {
  try {
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const WORLD: readonly Region[] = REGIONS.map(([name, codes]) => ({
  name,
  countries: codes
    .split(' ')
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
}));

/** Genres offered as one-tap choices; anything else can be typed. */
export const GENRES: readonly string[] = [
  'pop',
  'rock',
  'news',
  'talk',
  'jazz',
  'classical',
  'hip hop',
  'electronic',
  'dance',
  'house',
  'ambient',
  'lofi',
  'indie',
  'alternative',
  'metal',
  'country',
  'folk',
  'blues',
  'soul',
  'funk',
  'reggae',
  'latin',
  'world',
  'oldies',
  '80s',
  '90s',
  'sports',
  'christian',
  'kids',
  'culture',
];
