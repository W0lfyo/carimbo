import { useSyncExternalStore } from 'react';
import type { Activity, ActivityKind, Claim, CurrencyCode, LedgerState } from './types';
import { convert, feeOf, fmt, rateBetween, vatFromGross } from './money';
import { chainAttach, chainOpen, chainReclaim, chainRelease, chainReject, chainSetCurrency, claimableInfo, getConfig, type Role } from './stellar';
import { countryOf, exportDeadline } from './countries';

/**
 * Simulated ledger. It mirrors what the Soroban escrow does on Stellar Testnet
 * (lock VAT, release on the customs signature, convert, reclaim after the deadline)
 * so the interface can be built and demoed before the chain integration lands.
 */

const STORAGE_KEY = 'carimbo.ledger.v3';
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

function activity(kind: ActivityKind, label: string, amount: string, tx?: string, onChainNoHash = false): Activity {
  return { id: hex(6), at: Date.now(), kind, label, amount, tx: tx || hex(), live: !!tx && !onChainNoHash };
}

const SHOP_ROLE: Record<string, Role> = { 'loja-azul': 'lojaAzul', 'casa-verde': 'casaVerde' };
const live = () => getConfig() !== null;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isLive(): boolean {
  return live();
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

let releasing = false;
/** True while this device is signing a release: chain sync waits so it does not apply it twice. */
export const isReleasing = () => releasing;

/** Customs stamps the whole trip: every open claim is released in one atomic transaction. */
async function clearTripInner(): Promise<void> {
  const t = state.traveller;
  const mine = state.claims.filter((c) => c.travellerId === t.id && c.status === 'locked');
  if (mine.length === 0) return;
  const started = Date.now();
  // The fee is 0.5% of each currency group's total (exactly what the release transaction
  // pays), shared across its claims so the parts add up to the whole.
  const feeShare = new Map<string, number>();
  const byCur = new Map<CurrencyCode, Claim[]>();
  mine.forEach((c) => byCur.set(c.currency, [...(byCur.get(c.currency) ?? []), c]));
  for (const list of byCur.values()) {
    const total = list.reduce((n, c) => n + c.vatCents, 0);
    const fee = feeOf(total);
    let left = fee;
    list.forEach((c, i) => {
      const part = i === list.length - 1 ? left : Math.floor((fee * c.vatCents) / total);
      left -= part;
      feeShare.set(c.id, part);
    });
  }
  const net = (c: Claim) => c.vatCents - (feeShare.get(c.id) ?? 0);

  // One atomic Stellar transaction: claim, fee, DEX conversion, payout.
  let releaseTx: string | undefined;
  let chainReceived: Map<CurrencyCode, number> | undefined;
  const onChain = live() && mine.every((c) => c.balanceId);
  if (onChain) {
    const res = await chainRelease(
      mine.map((c) => ({ balanceId: c.balanceId!, currency: c.currency, vatMinor: c.vatCents })),
      t.currency,
    );
    releaseTx = res.hash;
    chainReceived = res.received;
  } else await pause(500);

  // Share each currency group's converted amount across its claims.
  const received = new Map<string, number>();
  const effective = new Map<CurrencyCode, number>();
  const groups = new Map<CurrencyCode, Claim[]>();
  mine.forEach((c) => groups.set(c.currency, [...(groups.get(c.currency) ?? []), c]));
  for (const [cur, list] of groups) {
    const sent = list.reduce((n, c) => n + net(c), 0);
    const got = chainReceived?.get(cur) ?? convert(sent, cur, t.currency);
    effective.set(cur, Math.round((got / sent) * 10_000) / 10_000);
    list.forEach((c) => received.set(c.id, Math.round((got * net(c)) / sent)));
  }

  const now = Date.now();
  const seconds = Math.max(1, Math.round((now - started) / 1000));
  const paid = new Map<string, Claim>();
  for (const c of mine) {
    paid.set(c.id, {
      ...c,
      status: 'refunded',
      payout: {
        currency: t.currency,
        rate: onChain ? effective.get(c.currency) ?? rateBetween(c.currency, t.currency) : rateBetween(c.currency, t.currency),
        feeCents: feeShare.get(c.id) ?? 0,
        amountMinor: received.get(c.id) ?? 0,
        seconds: onChain ? seconds : 4 + Math.round(Math.random() * 2),
        at: now,
        tx: releaseTx,
      },
    });
  }
  const amount = [...paid.values()].reduce((n, c) => n + (c.payout?.amountMinor ?? 0), 0);
  const totalEur = mine.reduce((n, c) => n + convert(c.vatCents, c.currency, 'EUR'), 0);
  commit({
    ...state,
    stampedAt: now,
    claims: state.claims.map((c) => paid.get(c.id) ?? c),
    activity: [
      activity('convert', `Same transaction: converted on the Stellar DEX, ${t.name} paid in ${t.currency}`, fmt(amount, t.currency), releaseTx),
      activity('clear', `Customs signed: ${mine.length} claimable ${mine.length > 1 ? 'balances' : 'balance'} released`, fmt(totalEur, 'EUR'), releaseTx),
      ...state.activity,
    ],
  });
}

/**
 * Every action goes through the Soroban escrow on Stellar Testnet when chain.json is
 * present, and falls back to a local simulation otherwise (same rules, fake hashes).
 */
export const ledger = {
  get: () => state,

  async createSale(shopId: string, items: { item: string; paidMinor: number; vatRate: number }[]): Promise<Claim> {
    const now = Date.now();
    const shop = state.shops.find((s) => s.id === shopId)!;
    const country = countryOf(shop.country);
    const lines = items.map((l) => ({ ...l, vatMinor: vatFromGross(l.paidMinor, l.vatRate, country.currency) }));
    const vat = lines.reduce((n, l) => n + l.vatMinor, 0);
    const paidMinor = lines.reduce((n, l) => n + l.paidMinor, 0);
    const item = lines.length > 1 ? `${lines[0].item} + ${lines.length - 1} more` : lines[0].item;
    const vatRate = lines[0].vatRate;
    const deadline = exportDeadline(new Date(now), country.exportRule);
    let balanceId: string | undefined;
    let tx: string | undefined;
    if (live()) {
      const res = await chainOpen(SHOP_ROLE[shopId], country.currency, vat, deadline);
      balanceId = res.balanceId;
      tx = res.hash;
    } else {
      await pause(350);
    }
    const claim: Claim = {
      id: hex(8),
      code: code(),
      shopId,
      item,
      currency: country.currency,
      paidCents: paidMinor,
      vatRate,
      vatCents: vat,
      createdAt: now,
      deadline,
      status: 'locked',
      balanceId,
      lines,
    };
    commit({
      ...state,
      claims: [claim, ...state.claims],
      activity: [activity('escrow', `${shop.name} locked the VAT in a claimable balance`, fmt(vat, claim.currency), tx), ...state.activity],
    });
    return claim;
  },

  setShopCountry(shopId: string, countryCode: string) {
    commit({ ...state, shops: state.shops.map((s) => (s.id === shopId ? { ...s, country: countryCode } : s)) });
  },

  /** The traveller scans the shop QR: the claim is attached to their account. */
  async join(claimCode: string): Promise<Claim | null> {
    const claim = state.claims.find((c) => c.code === claimCode.trim().toUpperCase());
    if (!claim || claim.status !== 'locked') return null;
    if (claim.travellerId === state.traveller.id) return claim;
    let tx: string | undefined;
    if (live() && claim.balanceId) tx = (await chainAttach(claim.balanceId)).hash;
    else await pause(600);
    commit({
      ...state,
      claims: state.claims.map((c) => (c.id === claim.id ? { ...c, travellerId: state.traveller.id } : c)),
      activity: [activity('join', `${state.traveller.name} attached the claim to her account`, fmt(claim.vatCents, claim.currency), tx), ...state.activity],
    });
    return claim;
  },

  setCurrency(currency: CurrencyCode, fromChain = false) {
    if (currency === state.traveller.currency) return;
    commit({ ...state, traveller: { ...state.traveller, currency } });
    // Tell the other devices (the customs desk) through the traveller's account.
    if (!fromChain && live()) void chainSetCurrency(currency).catch(() => undefined);
  },

  /**
   * A phone that scanned a shop QR imports the claim from the link, after checking on
   * Stellar that the claimable balance really holds that VAT.
   */
  async importClaim(q: URLSearchParams): Promise<Claim | null> {
    const code = (q.get('join') ?? '').toUpperCase();
    const existing = state.claims.find((c) => c.code === code);
    if (existing) return existing;
    const balanceId = q.get('cb') ?? undefined;
    const currency = q.get('c') as CurrencyCode | null;
    const vat = Number(q.get('v'));
    const shopId = q.get('s') ?? '';
    if (!code || !currency || !vat || !state.shops.some((s) => s.id === shopId)) return null;
    if (live() && balanceId) {
      const info = await claimableInfo(balanceId);
      if (!info || info.amountMinor !== vat || info.code !== currency) throw new Error('This QR does not match any VAT locked on Stellar.');
    }
    const claim: Claim = {
      id: hex(8),
      code,
      shopId,
      item: q.get('i') ?? 'Purchase',
      currency,
      paidCents: Number(q.get('p')),
      vatRate: Number(q.get('r')),
      vatCents: vat,
      createdAt: Number(q.get('t')) || Date.now(),
      deadline: Number(q.get('d')),
      status: 'locked',
      balanceId,
    };
    commit({ ...state, claims: [claim, ...state.claims] });
    return claim;
  },

  /** Seen on Stellar: the traveller attached these claims from her phone. */
  applyAttached(ids: string[]) {
    const t = state.traveller;
    const now = state.claims.filter((c) => ids.includes(c.id));
    if (!now.length) return;
    commit({
      ...state,
      claims: state.claims.map((c) => (ids.includes(c.id) ? { ...c, travellerId: t.id } : c)),
      activity: [
        ...now.map((c) => activity('join', `${t.name} attached the claim from her phone`, fmt(c.vatCents, c.currency), undefined, true)),
        ...state.activity,
      ],
    });
  },

  /** Seen on Stellar: customs paid the traveller for these claims (released on another device). */
  applySettled(ids: string[], payout: { hash: string; code: CurrencyCode; amountMinor: number; at: number }) {
    const list = state.claims.filter((c) => ids.includes(c.id) && c.status === 'locked');
    if (!list.length) return;
    const total = list.reduce((n, c) => n + convert(c.vatCents, c.currency, 'EUR'), 0);
    let left = payout.amountMinor;
    const paid = new Map<string, Claim>();
    list.forEach((c, i) => {
      const part = i === list.length - 1 ? left : Math.round((payout.amountMinor * convert(c.vatCents, c.currency, 'EUR')) / total);
      left -= part;
      const fee = feeOf(c.vatCents);
      paid.set(c.id, {
        ...c,
        status: 'refunded',
        payout: {
          currency: payout.code,
          rate: Math.round((part / (c.vatCents - fee)) * 10_000) / 10_000,
          feeCents: fee,
          amountMinor: part,
          seconds: Math.max(1, Math.round((Date.now() - payout.at) / 1000)),
          at: Date.now(),
          tx: payout.hash,
        },
      });
    });
    commit({
      ...state,
      stampedAt: Date.now(),
      claims: state.claims.map((c) => paid.get(c.id) ?? c),
      activity: [activity('convert', `Refund received on Stellar`, fmt(payout.amountMinor, payout.code), payout.hash), ...state.activity],
    });
  },

  /** Seen on Stellar: the balances are gone without a refund to the traveller. */
  applyClosed(ids: string[]) {
    if (!ids.length) return;
    commit({ ...state, claims: state.claims.map((c) => (ids.includes(c.id) && c.status === 'locked' ? { ...c, status: 'rejected' } : c)) });
  },

  /** Customs stamps the whole trip: every open claim is released, then converted on the DEX. */
  async clearTrip(): Promise<void> {
    releasing = true;
    try {
      await clearTripInner();
    } finally {
      releasing = false;
    }
  },

  async rejectTrip(): Promise<void> {
    const t = state.traveller;
    const mine = state.claims.filter((c) => c.travellerId === t.id && c.status === 'locked');
    if (mine.length === 0) return;
    let tx: string | undefined;
    if (live() && mine.every((c) => c.balanceId))
      tx = (await chainReject(mine.map((c) => ({ balanceId: c.balanceId!, currency: c.currency, vatMinor: c.vatCents, shop: SHOP_ROLE[c.shopId] })))).hash;
    else await pause(400);
    const total = mine.reduce((n, c) => n + convert(c.vatCents, c.currency, 'EUR'), 0);
    commit({
      ...state,
      claims: state.claims.map((c) => (mine.includes(c) ? { ...c, status: 'rejected' } : c)),
      activity: [activity('reject', 'Customs refused the export, VAT returned to the shops', fmt(total, 'EUR'), tx), ...state.activity],
    });
  },

  async reclaim(claimId: string): Promise<void> {
    const claim = state.claims.find((c) => c.id === claimId);
    if (!claim || claim.status !== 'locked' || claim.deadline > Date.now()) return;
    let tx: string | undefined;
    if (live() && claim.balanceId) tx = (await chainReclaim(SHOP_ROLE[claim.shopId], claim.balanceId)).hash;
    const shop = state.shops.find((s) => s.id === claim.shopId);
    commit({
      ...state,
      claims: state.claims.map((c) => (c.id === claimId ? { ...c, status: 'reclaimed' } : c)),
      activity: [activity('reclaim', `Deadline passed, ${shop?.name ?? 'shop'} took its VAT back`, fmt(claim.vatCents, claim.currency), tx), ...state.activity],
    });
  },

  /** The traveller closes a finished trip: past claims leave her screen. */
  newTrip() {
    const t = state.traveller;
    commit({
      ...state,
      stampedAt: undefined,
      claims: state.claims.map((c) => (c.travellerId === t.id && c.status !== 'locked' ? { ...c, archived: true } : c)),
    });
  },

  reset() {
    commit(seed());
  },
};
