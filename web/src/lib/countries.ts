/**
 * Countries as the interface shows them. Every legal figure (VAT rates, minimum, export
 * window, who is eligible) comes from taxFreeRules.ts; this file only adds what is
 * printed or guessed: the flag, the text around the customs stamp, the main airport and
 * the time zones used to guess a shop's country.
 */
import { TAX_FREE_RULES, type ExportDeadline, type TaxFreeRules } from './taxFreeRules';
import type { Code } from './money';

/** The 27 member states, for rules whose zone is "EU". */
export const EU27 = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

export interface VatRate {
  rate: number;
  label: string;
}

export interface Country {
  code: string;
  name: string;
  flag: string; // decorative only
  currency: Code;
  rates: VatRate[]; // from the rules; the first one is the standard rate
  zone: string; // who counts as a foreign resident, in words
  stamp: string; // text around the customs stamp, in the local language
  airport: string; // main departure airport, printed in the stamp
  timezones: string[];
  rules: TaxFreeRules;
}

const LOOK: Record<string, { flag: string; stamp: string; airport: string; timezones: string[] }> = {
  PT: { flag: '🇵🇹', airport: 'LIS', stamp: 'ALFÂNDEGA DE LISBOA ✦ SAÍDA DA UE ✦', timezones: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'] },
  ES: { flag: '🇪🇸', airport: 'MAD', stamp: 'ADUANA DE ESPAÑA ✦ SALIDA DE LA UE ✦', timezones: ['Europe/Madrid', 'Atlantic/Canary'] },
  FR: { flag: '🇫🇷', airport: 'CDG', stamp: 'DOUANE FRANÇAISE ✦ SORTIE DE L’UE ✦', timezones: ['Europe/Paris'] },
  IT: { flag: '🇮🇹', airport: 'FCO', stamp: 'AGENZIA DOGANE ✦ USCITA DALLA UE ✦', timezones: ['Europe/Rome'] },
  DE: { flag: '🇩🇪', airport: 'FRA', stamp: 'DEUTSCHER ZOLL ✦ AUSFUHR AUS DER EU ✦', timezones: ['Europe/Berlin'] },
  NL: { flag: '🇳🇱', airport: 'AMS', stamp: 'DOUANE NEDERLAND ✦ UITVOER UIT DE EU ✦', timezones: ['Europe/Amsterdam'] },
  BE: { flag: '🇧🇪', airport: 'BRU', stamp: 'DOUANE BELGE ✦ SORTIE DE L’UE ✦', timezones: ['Europe/Brussels'] },
  AT: { flag: '🇦🇹', airport: 'VIE', stamp: 'ZOLLAMT ÖSTERREICH ✦ AUSFUHR AUS DER EU ✦', timezones: ['Europe/Vienna'] },
  IE: { flag: '🇮🇪', airport: 'DUB', stamp: 'REVENUE CUSTOMS ✦ EXPORT FROM THE EU ✦', timezones: ['Europe/Dublin'] },
  GR: { flag: '🇬🇷', airport: 'ATH', stamp: 'TELONEIO ELLADAS ✦ EXODOS APO TIN EE ✦', timezones: ['Europe/Athens'] },
  FI: { flag: '🇫🇮', airport: 'HEL', stamp: 'TULLI FINLAND ✦ VIENTI EU:STA ✦', timezones: ['Europe/Helsinki'] },
  SE: { flag: '🇸🇪', airport: 'ARN', stamp: 'TULLVERKET ✦ EXPORT FRÅN EU ✦', timezones: ['Europe/Stockholm'] },
  DK: { flag: '🇩🇰', airport: 'CPH', stamp: 'TOLDSTYRELSEN ✦ UDFØRSEL FRA EU ✦', timezones: ['Europe/Copenhagen'] },
  CH: { flag: '🇨🇭', airport: 'ZRH', stamp: 'ZOLL DOUANE DOGANA ✦ AUSFUHR ✦', timezones: ['Europe/Zurich'] },
  NO: { flag: '🇳🇴', airport: 'OSL', stamp: 'TOLLETATEN ✦ UTFØRSEL ✦', timezones: ['Europe/Oslo'] },
  GB: { flag: '🇬🇧', airport: 'LHR', stamp: 'HM CUSTOMS ✦ EXPORT ✦', timezones: ['Europe/London'] },
  JP: { flag: '🇯🇵', airport: 'NRT', stamp: 'JAPAN CUSTOMS ✦ 税関 ✦ EXPORT ✦', timezones: ['Asia/Tokyo'] },
  KR: { flag: '🇰🇷', airport: 'ICN', stamp: 'KOREA CUSTOMS ✦ 관세청 ✦ EXPORT ✦', timezones: ['Asia/Seoul'] },
  SG: { flag: '🇸🇬', airport: 'SIN', stamp: 'SINGAPORE CUSTOMS ✦ GST REFUND ✦', timezones: ['Asia/Singapore'] },
  TH: { flag: '🇹🇭', airport: 'BKK', stamp: 'THAI CUSTOMS ✦ ศุลกากร ✦ VAT REFUND ✦', timezones: ['Asia/Bangkok'] },
  AU: { flag: '🇦🇺', airport: 'SYD', stamp: 'AUSTRALIAN BORDER FORCE ✦ TRS ✦', timezones: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide'] },
  TR: { flag: '🇹🇷', airport: 'IST', stamp: 'GÜMRÜK ✦ İHRACAT ✦ TAX FREE ✦', timezones: ['Europe/Istanbul'] },
};

const zoneText = (r: TaxFreeRules) => (r.eligibility.residentOutside === 'EU' ? 'outside the EU' : `outside ${r.name}`);

export const COUNTRIES: Country[] = Object.values(TAX_FREE_RULES).map((r) => {
  const look = LOOK[r.country] ?? { flag: '', stamp: `${r.name.toUpperCase()} CUSTOMS ✦ EXPORT ✦`, airport: '', timezones: [] };
  return {
    code: r.country,
    name: r.name,
    currency: r.currency as Code,
    rates: r.vatRates.map((v) => ({ rate: v.rate, label: `${v.label}, ${v.rate}%` })),
    zone: zoneText(r),
    rules: r,
    ...look,
  };
});

export function countryOf(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

/** Best guess of the shop's country from the device time zone. Falls back to Portugal. */
export function detectCountry(): Country {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return COUNTRIES.find((c) => c.timezones.includes(tz) && c.rules.scheme !== 'none') ?? COUNTRIES[0];
  } catch {
    return COUNTRIES[0];
  }
}

export function ruleText(d: ExportDeadline | null): string {
  if (!d) return 'no export window: there is no tax-free scheme';
  if (d.kind === 'days') return `${d.days} days to take the goods out`;
  if (d.kind === 'months') return `${d.months} ${d.months > 1 ? 'months' : 'month'} to take the goods out`;
  const ord = ['first', 'second', 'third'][d.months - 1] ?? `${d.months}th`;
  return `until the end of the ${ord} month after purchase`;
}

/** A country's name in English from its ISO code, for the residence list. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Residence choices: every country in the rules plus common origins of visitors, sorted by name. */
export const RESIDENCE_CODES: string[] = Array.from(
  new Set([
    ...EU27,
    ...Object.keys(TAX_FREE_RULES),
    'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'CN', 'HK', 'TW', 'IN', 'ID', 'MY', 'PH', 'VN', 'AE', 'SA', 'QA', 'IL', 'EG', 'MA', 'ZA', 'NG', 'KE', 'NZ', 'UA', 'RS', 'IS', 'AL',
  ]),
).sort((a, b) => countryName(a).localeCompare(countryName(b)));
