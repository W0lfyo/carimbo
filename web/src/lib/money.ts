/**
 * Money helpers. Every amount is stored as an integer in hundredths of its currency
 * ("minor units", even for yen and won), so the arithmetic is the same everywhere.
 */

export type Code = 'EUR' | 'USD' | 'GBP' | 'BRL' | 'JPY' | 'CNY' | 'CHF' | 'SGD' | 'KRW';

/** Indicative cross rates (1 EUR = perEur × currency). On Stellar the DEX path quote replaces them. */
export const CURRENCIES: Record<Code, { name: string; symbol: string; perEur: number; decimals: number }> = {
  EUR: { name: 'Euros', symbol: '€', perEur: 1, decimals: 2 },
  USD: { name: 'US dollars', symbol: '$', perEur: 1.16, decimals: 2 },
  GBP: { name: 'British pounds', symbol: '£', perEur: 0.87, decimals: 2 },
  BRL: { name: 'Brazilian reais', symbol: 'R$', perEur: 6.3, decimals: 2 },
  JPY: { name: 'Japanese yen', symbol: '¥', perEur: 176, decimals: 0 },
  CNY: { name: 'Chinese yuan', symbol: 'CN¥', perEur: 8.3, decimals: 2 },
  CHF: { name: 'Swiss francs', symbol: 'CHF ', perEur: 0.93, decimals: 2 },
  SGD: { name: 'Singapore dollars', symbol: 'S$', perEur: 1.5, decimals: 2 },
  KRW: { name: 'Korean won', symbol: '₩', perEur: 1600, decimals: 0 },
};

/** Currencies a traveller can be refunded in. */
export const PAYOUT_CURRENCIES: Code[] = ['USD', 'GBP', 'BRL', 'CNY', 'JPY', 'CHF', 'EUR'];

/** Carimbo's fee, taken by the escrow contract on release: 0.5% (refund operators keep around 25%). */
export const FEE_BPS = 50;

export function feeOf(minor: number): number {
  return Math.floor((minor * FEE_BPS) / 10_000);
}

/** VAT included in a price: price × rate / (100 + rate), rounded to the unit the currency shows. */
export function vatFromGross(grossMinor: number, rate: number, code: Code = 'EUR'): number {
  const raw = (grossMinor * rate) / (100 + rate);
  return CURRENCIES[code].decimals === 0 ? Math.round(raw / 100) * 100 : Math.round(raw);
}

export function convert(minor: number, from: Code, to: Code): number {
  if (from === to) return minor;
  const eur = minor / CURRENCIES[from].perEur;
  const out = eur * CURRENCIES[to].perEur;
  return CURRENCIES[to].decimals === 0 ? Math.round(out / 100) * 100 : Math.round(out);
}

export function rateBetween(from: Code, to: Code): number {
  const r = CURRENCIES[to].perEur / CURRENCIES[from].perEur;
  return r >= 100 ? Math.round(r) : Math.round(r * 10_000) / 10_000;
}

function digits(minor: number, code: Code): string {
  const c = CURRENCIES[code];
  const v = minor / 100;
  return v.toLocaleString('en-US', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
}

/** "€74.80", "¥12,400" */
export function fmt(minor: number, code: Code): string {
  return `${CURRENCIES[code].symbol}${digits(minor, code)}`;
}

/** "74.80 EUR": for receipts and ledgers. */
export function fmtPlain(minor: number, code: Code): string {
  return `${digits(minor, code)} ${code}`;
}

/** Board style, no symbol: "74.80" */
export function fmtBare(minor: number, code: Code): string {
  return digits(minor, code);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function stampDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Parse "400", "400.5", "400,50", "€400.00", "12 400" into minor units. Null when not a positive amount. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const minor = Math.round(parseFloat(cleaned) * 100);
  return minor > 0 ? minor : null;
}
