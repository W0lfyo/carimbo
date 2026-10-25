import { useSyncExternalStore } from 'react';
import type { Activity, ActivityKind, Claim, CurrencyCode, LedgerState } from './types';
import { FLAT_FEE_EUR_MINOR, convert, fmt, rateBetween, vatFromGross } from './money';
import { countryOf, exportDeadline } from './countries';

/**
 * Simulated ledger. It mirrors what the Soroban escrow does on Stellar Testnet
 * (lock VAT, release on the customs signature, convert, reclaim after the deadline)
 * so the interface can be built and demoed before the chain integration lands.
 */

const STORAGE_KEY = 'carimbo.ledger.v2';
const CHANNEL = 'carimbo.ledger';
const DAY = 86_400_000;

function hex(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function code(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(7);
  crypto.getRandomValues(a);
  const s = Array.from(a, (b) => alphabet[b % alphabet.length]).join('');
  return `CRB-${s.slice(0, 4)}-${s.slice(4)}`;
}

function seed(): LedgerState {
  const now = Date.now();
  const pt = countryOf('PT');
  const june = new Date(new Date(now).getFullYear(), 5, 2, 11, 20).getTime();
  const c1Created = now - 7 * DAY;
  return {
    shops: [
      { id: 'loja-azul', name: 'Loja Azul', area: 'Chiado, Lisbon', domain: 'lojaazul.pt', country: 'PT' },
      { id: 'casa-verde', name: 'Casa Verde', area: 'Príncipe Real, Lisbon', domain: 'casaverde.pt', country: 'PT' },
    ],
    traveller: {
      id: 'maya',
      name: 'Maya Chen',
      from: 'LIS',
      to: 'JFK',
      toCity: 'New York',
      flight: 'TP 1209',
      departs: 'Today, 16:40',
      currency: 'USD',
      tripCode: code(),
      residency: 'non-eu-proven',
    },
    claims: [
      {
        id: 'c-hist-1',
        code: code(),
        shopId: 'loja-azul',
        item: 'Wool coat',
        currency: 'EUR',
        paidCents: 24600,
        vatRate: 23,
        vatCents: vatFromGross(24600, 23),
        createdAt: c1Created,
        deadline: exportDeadline(new Date(c1Created), pt.exportRule),
        status: 'refunded',
        travellerId: 'someone-else',
      },
      {
        id: 'c-hist-2',
        code: code(),
        shopId: 'loja-azul',
        item: 'Silver earrings',
        currency: 'EUR',
        paidCents: 10000,
        vatRate: 23,
        vatCents: vatFromGross(10000, 23),
        createdAt: june,
        deadline: exportDeadline(new Date(june), pt.exportRule),
        status: 'locked',
        travellerId: 'someone-else-2',
      },
    ],
    activity: [],
  };
}

function load(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LedgerState;
  } catch {
    /* storage unavailable: start fresh */
  }
  return seed();
}

let state: LedgerState = load();
const listeners = new Set<() => void>();

let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<LedgerState>) => {
    state = e.data;
    listeners.forEach((l) => l());
  };
} catch {
  channel = null;
}

function commit(next: LedgerState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  try {
    channel?.postMessage(next);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function activity(kind: ActivityKind, label: string, amount: string): Activity {
  return { id: hex(6), at: Date.now(), kind, label, amount, tx: hex() };
}

export function useLedger(): LedgerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const ledger = {
  get: () => state,

  createSale(shopId: string, item: string, paidMinor: number, vatRate: number): Claim {
    const now = Date.now();
    const shop = state.shops.find((s) => s.id === shopId)!;
    const country = countryOf(shop.country);
    const claim: Claim = {
      id: hex(8),
      code: code(),
      shopId,
      item,
      currency: country.currency,
      paidCents: paidMinor,
      vatRate,
      vatCents: vatFromGross(paidMinor, vatRate, country.currency),
      createdAt: now,
      deadline: exportDeadline(new Date(now), country.exportRule),
      status: 'locked',
    };
    commit({
      ...state,
      claims: [claim, ...state.claims],
      activity: [activity('escrow', `${shop.name} locked VAT in escrow`, fmt(claim.vatCents, claim.currency)), ...state.activity],
    });
    return claim;
  },

  setShopCountry(shopId: string, countryCode: string) {
    commit({ ...state, shops: state.shops.map((s) => (s.id === shopId ? { ...s, country: countryCode } : s)) });
  },

  /** The traveller scans the shop QR: the claim is attached to their wallet. */
  join(claimCode: string): Claim | null {
    const claim = state.claims.find((c) => c.code === claimCode.trim().toUpperCase());
    if (!claim || claim.status !== 'locked') return null;
    if (claim.travellerId === state.traveller.id) return claim;
    commit({
      ...state,
      claims: state.claims.map((c) => (c.id === claim.id ? { ...c, travellerId: state.traveller.id } : c)),
      activity: [activity('join', `${state.traveller.name} added the claim to her wallet`, fmt(claim.vatCents, claim.currency)), ...state.activity],
    });
    return claim;
  },

  setCurrency(currency: CurrencyCode) {
    commit({ ...state, traveller: { ...state.traveller, currency } });
  },

  /** Customs stamps the whole trip: every locked claim is released, converted and paid out. */
  clearTrip() {
    const t = state.traveller;
    const mine = state.claims.filter((c) => c.travellerId === t.id && c.status === 'locked');
    if (mine.length === 0) return;
    const now = Date.now();
    const seconds = 4 + Math.round(Math.random() * 2);
    // One flat fee per trip, shared across claims in proportion to their VAT (valued in euros).
    const eurOf = (c: Claim) => convert(c.vatCents, c.currency, 'EUR');
    const totalEur = mine.reduce((n, c) => n + eurOf(c), 0);
    const paid = new Map<string, Claim>();
    for (const c of mine) {
      const feeEur = Math.round((FLAT_FEE_EUR_MINOR * eurOf(c)) / totalEur);
      const fee = convert(feeEur, 'EUR', c.currency);
      paid.set(c.id, {
        ...c,
        status: 'refunded',
        payout: {
          currency: t.currency,
          rate: rateBetween(c.currency, t.currency),
          feeCents: fee,
          amountMinor: convert(c.vatCents - fee, c.currency, t.currency),
          seconds,
          at: now,
        },
      });
    }
    const amount = [...paid.values()].reduce((n, c) => n + (c.payout?.amountMinor ?? 0), 0);
    commit({
      ...state,
      stampedAt: now,
      claims: state.claims.map((c) => paid.get(c.id) ?? c),
      activity: [
        activity('convert', `Converted to ${t.currency} and paid ${t.name}`, fmt(amount, t.currency)),
        activity('clear', `Customs cleared ${mine.length} ${mine.length > 1 ? 'purchases' : 'purchase'} and released escrow`, fmt(totalEur, 'EUR')),
        ...state.activity,
      ],
    });
  },

  rejectTrip() {
    const t = state.traveller;
    const mine = state.claims.filter((c) => c.travellerId === t.id && c.status === 'locked');
    if (mine.length === 0) return;
    const total = mine.reduce((s, c) => s + convert(c.vatCents, c.currency, 'EUR'), 0);
    commit({
      ...state,
      claims: state.claims.map((c) => (mine.includes(c) ? { ...c, status: 'rejected' } : c)),
      activity: [activity('reject', 'Customs refused the export, VAT returned to the shops', fmt(total, 'EUR')), ...state.activity],
    });
  },

  reclaim(claimId: string) {
    const claim = state.claims.find((c) => c.id === claimId);
    if (!claim || claim.status !== 'locked' || claim.deadline > Date.now()) return;
    const shop = state.shops.find((s) => s.id === claim.shopId);
    commit({
      ...state,
      claims: state.claims.map((c) => (c.id === claimId ? { ...c, status: 'reclaimed' } : c)),
      activity: [activity('reclaim', `Deadline passed, ${shop?.name ?? 'shop'} took its VAT back`, fmt(claim.vatCents, claim.currency)), ...state.activity],
    });
  },

  reset() {
    commit(seed());
  },
};
