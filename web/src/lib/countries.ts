/**
 * Tax-free rules by country. A shop belongs to one country, so its VAT rates,
 * minimum purchase, local currency and export window all come from here.
 *
 * Standard rates and minimums: checked October 2026 against public refund guides
 * (withprive.com country table, Wise, Japan NTA reform notes). Indicative: confirm
 * with each tax authority before production.
 */

export type LocalCurrency = 'EUR' | 'CHF' | 'JPY' | 'SGD' | 'KRW';

export type ExportRule =
  | { kind: 'months-end'; months: number } // EU: end of the Nth month after the month of purchase
  | { kind: 'days'; days: number }; // e.g. Japan: 90 days to confirm export

export interface VatRate {
  rate: number;
  label: string;
}

export interface Country {
  code: string;
  name: string;
  flag: string; // regional indicator pair, decorative only
  currency: LocalCurrency;
  rates: VatRate[]; // first one is the standard rate
  minPurchase: number; // in local minor units (×100), 0 = no minimum
  exportRule: ExportRule;
  zone: string; // who counts as a foreign resident
  stamp: string; // text around the customs stamp, in the local language
  airport: string; // main departure airport, printed in the stamp
  timezones: string[]; // used to guess the shop's country on first launch
}

const EU = 'outside the EU';
const EU_3M: ExportRule = { kind: 'months-end', months: 3 };

export const COUNTRIES: Country[] = [
  {
    code: 'PT',
    airport: 'LIS',
    name: 'Portugal',
    flag: '🇵🇹',
    currency: 'EUR',
    rates: [
      { rate: 23, label: 'Standard, 23%' },
      { rate: 13, label: 'Intermediate, 13%' },
      { rate: 6, label: 'Reduced, 6%' },
    ],
    minPurchase: 5000,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'ALFÂNDEGA DE LISBOA ✦ SAÍDA DA UE ✦',
    timezones: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'],
  },
  {
    code: 'ES',
    airport: 'MAD',
    name: 'Spain',
    flag: '🇪🇸',
    currency: 'EUR',
    rates: [
      { rate: 21, label: 'Standard, 21%' },
      { rate: 10, label: 'Reduced, 10%' },
      { rate: 4, label: 'Super-reduced, 4%' },
    ],
    minPurchase: 0,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'ADUANA DE ESPAÑA ✦ SALIDA DE LA UE ✦',
    timezones: ['Europe/Madrid', 'Atlantic/Canary'],
  },
  {
    code: 'FR',
    airport: 'CDG',
    name: 'France',
    flag: '🇫🇷',
    currency: 'EUR',
    rates: [
      { rate: 20, label: 'Standard, 20%' },
      { rate: 10, label: 'Intermediate, 10%' },
      { rate: 5.5, label: 'Reduced, 5.5%' },
      { rate: 2.1, label: 'Super-reduced, 2.1%' },
    ],
    minPurchase: 10001,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'DOUANE FRANÇAISE ✦ SORTIE DE L’UE ✦',
    timezones: ['Europe/Paris'],
  },
  {
    code: 'IT',
    airport: 'FCO',
    name: 'Italy',
    flag: '🇮🇹',
    currency: 'EUR',
    rates: [
      { rate: 22, label: 'Standard, 22%' },
      { rate: 10, label: 'Reduced, 10%' },
      { rate: 5, label: 'Reduced, 5%' },
      { rate: 4, label: 'Super-reduced, 4%' },
    ],
    minPurchase: 7001,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'AGENZIA DOGANE ✦ USCITA DALLA UE ✦',
    timezones: ['Europe/Rome'],
  },
  {
    code: 'DE',
    airport: 'FRA',
    name: 'Germany',
    flag: '🇩🇪',
    currency: 'EUR',
    rates: [
      { rate: 19, label: 'Standard, 19%' },
      { rate: 7, label: 'Reduced, 7%' },
    ],
    minPurchase: 5001,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'DEUTSCHER ZOLL ✦ AUSFUHR AUS DER EU ✦',
    timezones: ['Europe/Berlin'],
  },
  {
    code: 'NL',
    airport: 'AMS',
    name: 'Netherlands',
    flag: '🇳🇱',
    currency: 'EUR',
    rates: [
      { rate: 21, label: 'Standard, 21%' },
      { rate: 9, label: 'Reduced, 9%' },
    ],
    minPurchase: 5000,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'DOUANE NEDERLAND ✦ UITVOER UIT DE EU ✦',
    timezones: ['Europe/Amsterdam'],
  },
  {
    code: 'BE',
    airport: 'BRU',
    name: 'Belgium',
    flag: '🇧🇪',
    currency: 'EUR',
    rates: [
      { rate: 21, label: 'Standard, 21%' },
      { rate: 12, label: 'Intermediate, 12%' },
      { rate: 6, label: 'Reduced, 6%' },
    ],
    minPurchase: 12500,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'DOUANE BELGE ✦ SORTIE DE L’UE ✦',
    timezones: ['Europe/Brussels'],
  },
  {
    code: 'AT',
    airport: 'VIE',
    name: 'Austria',
    flag: '🇦🇹',
    currency: 'EUR',
    rates: [
      { rate: 20, label: 'Standard, 20%' },
      { rate: 13, label: 'Reduced, 13%' },
      { rate: 10, label: 'Reduced, 10%' },
    ],
    minPurchase: 7501,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'ZOLLAMT ÖSTERREICH ✦ AUSFUHR AUS DER EU ✦',
    timezones: ['Europe/Vienna'],
  },
  {
    code: 'IE',
    airport: 'DUB',
    name: 'Ireland',
    flag: '🇮🇪',
    currency: 'EUR',
    rates: [
      { rate: 23, label: 'Standard, 23%' },
      { rate: 13.5, label: 'Reduced, 13.5%' },
      { rate: 9, label: 'Second reduced, 9%' },
    ],
    minPurchase: 0,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'REVENUE CUSTOMS ✦ EXPORT FROM THE EU ✦',
    timezones: ['Europe/Dublin'],
  },
  {
    code: 'GR',
    airport: 'ATH',
    name: 'Greece',
    flag: '🇬🇷',
    currency: 'EUR',
    rates: [
      { rate: 24, label: 'Standard, 24%' },
      { rate: 13, label: 'Reduced, 13%' },
      { rate: 6, label: 'Super-reduced, 6%' },
    ],
    minPurchase: 5000,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'TELONEIO ELLADAS ✦ EXODOS APO TIN EE ✦',
    timezones: ['Europe/Athens'],
  },
  {
    code: 'FI',
    airport: 'HEL',
    name: 'Finland',
    flag: '🇫🇮',
    currency: 'EUR',
    rates: [{ rate: 25.5, label: 'Standard, 25.5%' }],
    minPurchase: 4000,
    exportRule: EU_3M,
    zone: EU,
    stamp: 'TULLI FINLAND ✦ VIENTI EU:STA ✦',
    timezones: ['Europe/Helsinki'],
  },
  {
    code: 'CH',
    airport: 'ZRH',
    name: 'Switzerland',
    flag: '🇨🇭',
    currency: 'CHF',
    rates: [
      { rate: 8.1, label: 'Standard, 8.1%' },
      { rate: 3.8, label: 'Accommodation, 3.8%' },
      { rate: 2.6, label: 'Reduced, 2.6%' },
    ],
    minPurchase: 30000,
    exportRule: { kind: 'days', days: 30 },
    zone: 'outside Switzerland',
    stamp: 'ZOLL DOUANE DOGANA ✦ AUSFUHR ✦',
    timezones: ['Europe/Zurich'],
  },
  {
    code: 'JP',
    airport: 'NRT',
    name: 'Japan',
    flag: '🇯🇵',
    currency: 'JPY',
    rates: [
      { rate: 10, label: 'Standard, 10%' },
      { rate: 8, label: 'Reduced, 8%' },
    ],
    minPurchase: 500000,
    exportRule: { kind: 'days', days: 90 },
    zone: 'outside Japan',
    stamp: 'JAPAN CUSTOMS ✦ 税関 ✦ EXPORT ✦',
    timezones: ['Asia/Tokyo'],
  },
  {
    code: 'SG',
    airport: 'SIN',
    name: 'Singapore',
    flag: '🇸🇬',
    currency: 'SGD',
    rates: [{ rate: 9, label: 'GST, 9%' }],
    minPurchase: 10000,
    exportRule: { kind: 'months-end', months: 2 },
    zone: 'outside Singapore',
    stamp: 'SINGAPORE CUSTOMS ✦ GST REFUND ✦',
    timezones: ['Asia/Singapore'],
  },
  {
    code: 'KR',
    airport: 'ICN',
    name: 'South Korea',
    flag: '🇰🇷',
    currency: 'KRW',
    rates: [{ rate: 10, label: 'Standard, 10%' }],
    minPurchase: 1500000,
    exportRule: { kind: 'months-end', months: 3 },
    zone: 'outside Korea',
    stamp: 'KOREA CUSTOMS ✦ 관세청 ✦ EXPORT ✦',
    timezones: ['Asia/Seoul'],
  },
];

export function countryOf(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

/** Best guess of the shop's country from the device time zone. Falls back to Portugal. */
export function detectCountry(): Country {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return COUNTRIES.find((c) => c.timezones.includes(tz)) ?? COUNTRIES[0];
  } catch {
    return COUNTRIES[0];
  }
}

/** Deadline to take the goods out of the country. */
export function exportDeadline(from: Date, rule: ExportRule): number {
  if (rule.kind === 'days') return from.getTime() + rule.days * 86_400_000;
  return new Date(from.getFullYear(), from.getMonth() + rule.months + 1, 0, 23, 59, 59).getTime();
}

export function ruleText(rule: ExportRule): string {
  return rule.kind === 'days' ? `${rule.days} days to confirm export` : `until the end of the ${ordinal(rule.months)} month after purchase`;
}

function ordinal(n: number): string {
  return n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`;
}
