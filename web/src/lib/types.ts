export type CurrencyCode = 'USD' | 'GBP' | 'BRL' | 'JPY' | 'CNY' | 'CHF';

export type ClaimStatus =
  | 'locked' // VAT sits in escrow, waiting for the traveller to leave the EU
  | 'refunded' // customs cleared it and the traveller was paid
  | 'rejected' // customs refused it: VAT goes back to the shop
  | 'reclaimed'; // export deadline passed: VAT went back to the shop

export interface Shop {
  id: string;
  name: string;
  area: string;
  domain: string; // verified via stellar.toml (SEP-1)
}

export interface Claim {
  id: string;
  code: string; // short code printed under the shop QR
  shopId: string;
  item: string;
  paidCents: number; // VAT included, in euro cents
  vatRate: number; // e.g. 23
  vatCents: number;
  createdAt: number; // ms
  deadline: number; // ms, end of the 3rd month after the month of purchase
  status: ClaimStatus;
  travellerId?: string;
  payout?: Payout;
}

export interface Payout {
  currency: CurrencyCode;
  rate: number; // 1 EUR = rate × currency
  feeCents: number;
  amountMinor: number; // in the payout currency, 2 decimals (JPY shown without)
  seconds: number;
  at: number;
}

export interface Traveller {
  id: string;
  name: string;
  from: string; // IATA of departure airport
  to: string; // IATA of home airport
  toCity: string;
  flight: string;
  departs: string;
  currency: CurrencyCode;
  tripCode: string;
  residency: 'non-eu-proven' | 'unproven';
}

export type ActivityKind = 'escrow' | 'join' | 'clear' | 'convert' | 'reject' | 'reclaim';

export interface Activity {
  id: string;
  at: number;
  kind: ActivityKind;
  label: string;
  amount: string;
  tx: string; // transaction hash (simulated until Stellar is wired)
}

export interface LedgerState {
  shops: Shop[];
  claims: Claim[];
  traveller: Traveller;
  activity: Activity[];
  stampedAt?: number; // last customs stamp, drives the refund moment
}
