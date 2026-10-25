import { useSyncExternalStore } from 'react';
import type { Activity, ActivityKind, Claim, CurrencyCode, LedgerState } from './types';
import { CURRENCIES, FLAT_FEE_CENTS, convert, eur, exportDeadline, money, vatFromGross } from './money';

/**
 * Simulated ledger. It mirrors what the Soroban escrow does on Stellar Testnet
 * (lock VAT, release on the customs signature, convert, reclaim after the deadline)
 * so the interface can be built and demoed before the chain integration lands.
 */

const STORAGE_KEY = 'carimbo.ledger.v1';
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
  const june = new Date(new Date(now).getFullYear(), 5, 2, 11, 20).getTime();
  const c1Created = now - 7 * DAY;
  return {
    shops: [
      { id: 'loja-azul', name: 'Loja Azul', area: 'Chiado, Lisbon', domain: 'lojaazul.pt' },
      { id: 'casa-verde', name: 'Casa Verde', area: 'Príncipe Real, Lisbon', domain: 'casaverde.pt' },
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
        paidCents: 24600,
        vatRate: 23,
        vatCents: vatFromGross(24600, 23),
        createdAt: c1Created,
        deadline: exportDeadline(new Date(c1Created)),
        status: 'refunded',
        travellerId: 'someone-else',
      },
      {
        id: 'c-hist-2',
        code: code(),
        shopId: 'loja-azul',
        item: 'Silver earrings',
        paidCents: 10000,
        vatRate: 23,
        vatCents: vatFromGross(10000, 23),
        createdAt: june,
        deadline: exportDeadline(new Date(june)),
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

  createSale(shopId: string, item: string, paidCents: number, vatRate: number): Claim {
    const now = Date.now();
    const claim: Claim = {
      id: hex(8),
      code: code(),
      shopId,
      item,
      paidCents,
      vatRate,
      vatCents: vatFromGross(paidCents, vatRate),
      createdAt: now,
      deadline: exportDeadline(new Date(now)),
      status: 'locked',
    };
    const shop = state.shops.find((s) => s.id === shopId);
    commit({
      ...state,
      claims: [claim, ...state.claims],
      activity: [activity('escrow', `${shop?.name ?? 'Shop'} locked VAT in escrow`, eur(claim.vatCents)), ...state.activity],
    });
    return claim;
  },

  /** The traveller scans the shop QR: the claim is attached to their wallet. */
  join(claimCode: string): Claim | null {
    const claim = state.claims.find((c) => c.code === claimCode.trim().toUpperCase());
    if (!claim || claim.status !== 'locked') return null;
    if (claim.travellerId === state.traveller.id) return claim;
    commit({
      ...state,
      claims: state.claims.map((c) => (c.id === claim.id ? { ...c, travellerId: state.traveller.id } : c)),
      activity: [activity('join', `${state.traveller.name} added the claim to her wallet`, eur(claim.vatCents)), ...state.activity],
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
    const total = mine.reduce((s, c) => s + c.vatCents, 0);
    const fee = FLAT_FEE_CENTS;
    const amount = convert(total - fee, t.currency);
    const share = (c: Claim) => Math.round((amount * c.vatCents) / total);
    const seconds = 4 + Math.round(Math.random() * 2);
    commit({
      ...state,
      stampedAt: now,
      claims: state.claims.map((c) =>
        mine.includes(c)
          ? {
              ...c,
              status: 'refunded',
              payout: {
                currency: t.currency,
                rate: CURRENCIES[t.currency].rate,
                feeCents: Math.round((fee * c.vatCents) / total),
                amountMinor: share(c),
                seconds,
                at: now,
              },
            }
          : c,
      ),
      activity: [
        activity('convert', `Converted EUR to ${t.currency} and paid ${t.name}`, money(amount, t.currency)),
        activity('clear', `Customs cleared ${mine.length} ${mine.length > 1 ? 'purchases' : 'purchase'} and released escrow`, eur(total)),
        ...state.activity,
      ],
    });
  },

  rejectTrip() {
    const t = state.traveller;
    const mine = state.claims.filter((c) => c.travellerId === t.id && c.status === 'locked');
    if (mine.length === 0) return;
    const total = mine.reduce((s, c) => s + c.vatCents, 0);
    commit({
      ...state,
      claims: state.claims.map((c) => (mine.includes(c) ? { ...c, status: 'rejected' } : c)),
      activity: [activity('reject', 'Customs refused the export, VAT returned to the shops', eur(total)), ...state.activity],
    });
  },

  reclaim(claimId: string) {
    const claim = state.claims.find((c) => c.id === claimId);
    if (!claim || claim.status !== 'locked' || claim.deadline > Date.now()) return;
    const shop = state.shops.find((s) => s.id === claim.shopId);
    commit({
      ...state,
      claims: state.claims.map((c) => (c.id === claimId ? { ...c, status: 'reclaimed' } : c)),
      activity: [activity('reclaim', `Deadline passed, ${shop?.name ?? 'shop'} took its VAT back`, eur(claim.vatCents)), ...state.activity],
    });
  },

  reset() {
    commit(seed());
  },
};
