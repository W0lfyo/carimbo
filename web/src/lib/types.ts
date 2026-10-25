import type { Code } from './money';

export type CurrencyCode = Code;

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
  country: string; // ISO code, drives VAT rates and rules
}

export interface Claim {
  id: string;
  code: string; // short code printed under the shop QR
  shopId: string;
  item: string;
  currency: CurrencyCode; // the shop's local currency
  paidCents: number; // VAT included, minor units (×100) of `currency`
  vatRate: number; // e.g. 23
  vatCents: number; // minor units of `currency`
  createdAt: number; // ms
  deadline: number; // ms, end of the 3rd month after the month of purchase
  status: ClaimStatus;
  travellerId?: string;
  payout?: Payout;
  balanceId?: string; // the claimable balance holding the VAT on Stellar
  escrow?: 'native' | 'trustless'; // which escrow holds the VAT (native claimable balance by default)
  contractId?: string; // the Trustless Work escrow contract, when escrow is 'trustless'
  archived?: boolean; // hidden from the traveller once she starts a new trip
  lines?: { item: string; paidMinor: number; vatRate: number; vatMinor: number }[]; // receipt lines
}

export interface Payout {
  currency: CurrencyCode;
  rate: number; // 1 unit of the claim currency = rate × payout currency
  feeCents: number; // in the claim currency
  amountMinor: number; // in the payout currency, 2 decimals (JPY shown without)
  seconds: number;
  at: number;
  tx?: string; // Stellar transaction that paid the traveller
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
  tx: string; // transaction hash
  live: boolean; // true when the hash is a real Stellar Testnet transaction
}

export interface LedgerState {
  shops: Shop[];
  claims: Claim[];
  traveller: Traveller;
  activity: Activity[];
  stampedAt?: number; // last customs stamp, drives the refund moment
}
