import type { CurrencyCode } from './types';

/** Indicative rates used by the simulated ledger. On Stellar these come from the DEX path quote. */
export const CURRENCIES: Record<CurrencyCode, { name: string; symbol: string; rate: number; decimals: number }> = {
  USD: { name: 'US dollars', symbol: '$', rate: 1.16, decimals: 2 },
  GBP: { name: 'British pounds', symbol: '£', rate: 0.87, decimals: 2 },
  BRL: { name: 'Brazilian reais', symbol: 'R$', rate: 6.3, decimals: 2 },
  JPY: { name: 'Japanese yen', symbol: '¥', rate: 176, decimals: 0 },
  CNY: { name: 'Chinese yuan', symbol: '¥', rate: 8.3, decimals: 2 },
  CHF: { name: 'Swiss francs', symbol: 'CHF ', rate: 0.93, decimals: 2 },
};

export const FLAT_FEE_CENTS = 50;
export const MIN_PURCHASE_CENTS = 5000; // Portugal: €50 per shop per day

export const VAT_RATES = [
  { rate: 23, label: '23%, standard rate (mainland)' },
  { rate: 13, label: '13%, intermediate rate' },
  { rate: 6, label: '6%, reduced rate' },
];

/** VAT included in a price: price × rate / (100 + rate), rounded to the cent. */
export function vatFromGross(grossCents: number, rate: number): number {
  return Math.round((grossCents * rate) / (100 + rate));
}

export function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

export function eurPlain(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

export function money(minor: number, currency: CurrencyCode): string {
  const c = CURRENCIES[currency];
  const value = c.decimals === 0 ? Math.round(minor / 100).toString() : (minor / 100).toFixed(2);
  return `${c.symbol}${value}`;
}

/** Convert euro cents (after fee) into the payout currency's minor units (×100). */
export function convert(netCents: number, currency: CurrencyCode): number {
  return Math.round(netCents * CURRENCIES[currency].rate);
}

/** End of the third month after the month of purchase (EU rule for export). */
export function exportDeadline(from: Date): number {
  const d = new Date(from.getFullYear(), from.getMonth() + 4, 0, 23, 59, 59);
  return d.getTime();
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

/** Parse "400", "400.5", "400,50", "€400.00" into cents. Returns null when not a positive amount. */
export function parseEuros(input: string): number | null {
  const cleaned = input.replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 ? cents : null;
}
