/**
 * Multi-device sync. Stellar is the shared state: every few seconds each device reads
 * the traveller's account and the claimable balances it knows about, and applies what
 * changed elsewhere (a phone attached a claim, customs paid the traveller on a laptop).
 */
import { isLive, isReleasing, ledger } from './ledger';
import { attachKey, balanceExists, latestRefund, travellerData } from './stellar';
import { twEscrow } from './trustless';
import type { CurrencyCode } from './types';
import { PAYOUT_CURRENCIES } from './money';

const EVERY_MS = 4000;
let running = false;

async function tick() {
  if (running || isReleasing() || !isLive()) return;
  running = true;
  try {
    const s = ledger.get();
    const t = s.traveller;
    const data = await travellerData();

    // 1. Preferred payout currency, set on the phone.
    const cur = data['carimbo:currency'] as CurrencyCode | undefined;
    if (cur && PAYOUT_CURRENCIES.includes(cur) && cur !== t.currency) ledger.setCurrency(cur, true);

    // 2. Claims this device created that the phone has attached since.
    const ref = (c: { balanceId?: string; contractId?: string }) => c.balanceId ?? c.contractId;
    const attached = s.claims.filter((c) => c.status === 'locked' && ref(c) && !c.travellerId && data[attachKey(ref(c)!)]);
    if (attached.length) ledger.applyAttached(attached.map((c) => c.id));

    // 3. Open claims of the traveller whose balance has left the ledger: released or refused elsewhere.
    const open = ledger.get().claims.filter((c) => c.status === 'locked' && c.balanceId && c.travellerId === t.id);
    const gone: string[] = [];
    for (const c of open) if (!(await balanceExists(c.balanceId!))) gone.push(c.id);
    if (gone.length && !isReleasing()) {
      const since = Math.min(...open.filter((c) => gone.includes(c.id)).map((c) => c.createdAt));
      const refund = await latestRefund(since);
      if (refund) ledger.applySettled(gone, refund);
      else ledger.applyClosed(gone);
    }

    // 4. Trustless Work escrows: read their state from the Trustless Work indexer.
    const tw = ledger.get().claims.filter((c) => c.status === 'locked' && c.escrow === 'trustless' && c.contractId && c.travellerId === t.id);
    const released: string[] = [];
    const refused: string[] = [];
    for (const c of tw) {
      const e = await twEscrow(c.contractId!);
      if (e?.released) released.push(c.id);
      else if (e?.resolved) refused.push(c.id);
    }
    if (refused.length && !isReleasing()) ledger.applyClosed(refused);
    if (released.length && !isReleasing()) {
      const since = Math.min(...tw.filter((c) => released.includes(c.id)).map((c) => c.createdAt));
      const refund = await latestRefund(since);
      // Released but not converted yet: wait for the next tick.
      if (refund) ledger.applySettled(released, refund);
    }
  } catch {
    /* Testnet hiccup: try again on the next tick */
  } finally {
    running = false;
  }
}

/** Start polling; returns a stop function (used as a React effect cleanup). */
export function startSync(): () => void {
  const id = window.setInterval(() => void tick(), EVERY_MS);
  void tick();
  return () => window.clearInterval(id);
}
