/**
 * Stellar Testnet integration. Everything runs in the browser: the demo accounts are
 * testnet keys published in chain.json (worthless test money), so judges can replay
 * the full flow without installing a wallet.
 */
import { Asset, BASE_FEE, Claimant, Horizon, Keypair, Networks, Operation, TransactionBuilder, xdr, type Transaction } from '@stellar/stellar-sdk';
import type { Code } from './money';

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT = 'https://friendbot.stellar.org';
export const PASSPHRASE = Networks.TESTNET;
export const EXPLORER = 'https://stellar.expert/explorer/testnet';

export const horizon = new Horizon.Server(HORIZON_URL);

/** Demo stablecoins, one per currency, all issued by the Carimbo test issuer. */
export const ASSET_CODES: Record<Code, string> = {
  EUR: 'cEUR',
  USD: 'cUSD',
  GBP: 'cGBP',
  BRL: 'cBRL',
  JPY: 'cJPY',
  CNY: 'cCNY',
  CHF: 'cCHF',
  SGD: 'cSGD',
  KRW: 'cKRW',
};

export type ShopRole = 'lojaAzul' | 'casaVerde' | 'fioAlfama' | 'lume' | 'gaivota';
export type Role = 'issuer' | 'maker' | 'platform' | 'customs' | 'traveller' | ShopRole;
export const SHOP_ROLES: ShopRole[] = ['lojaAzul', 'casaVerde', 'fioAlfama', 'lume', 'gaivota'];

export interface ChainConfig {
  network: 'testnet';
  createdAt: string;
  escrow: 'claimable-balances';
  feeBps: number;
  issuer: string;
  // Shops added after the first deployment may be missing from older configs.
  trustlessWork?: { apiKey: string };
  accounts: Record<Exclude<Role, ShopRole>, { publicKey: string; secret: string }> & Partial<Record<ShopRole, { publicKey: string; secret: string }>>;
}

const CONFIG_KEY = 'carimbo.chain.v2';
let config: ChainConfig | null = null;

export async function loadConfig(): Promise<ChainConfig | null> {
  let local: ChainConfig | null = null;
  let shared: ChainConfig | null = null;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) local = JSON.parse(raw) as ChainConfig;
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch('./chain.json', { cache: 'no-store' });
    if (res.ok) shared = (await res.json()) as ChainConfig;
  } catch {
    /* not deployed yet: the app stays in simulated mode */
  }
  // A fresh deployment made from this browser wins; the same deployment picks up
  // accounts added to chain.json since (new shops).
  if (local && shared && local.issuer === shared.issuer) config = { ...local, accounts: { ...local.accounts, ...shared.accounts } };
  else config = local ?? shared;
  return config;
}

export function saveConfig(c: ChainConfig) {
  config = c;
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function getConfig(): ChainConfig | null {
  return config;
}

export function asset(code: Code, issuer = config!.issuer): Asset {
  return new Asset(ASSET_CODES[code], issuer);
}

export function keypair(role: Role): Keypair {
  const acc = config!.accounts[role];
  if (!acc) throw new Error(`No Testnet account for ${role} yet. Open /#/setup to activate it.`);
  return Keypair.fromSecret(acc.secret);
}

/** A failed transaction that still reached the ledger: it has a hash to show. */
export class ChainError extends Error {
  constructor(
    message: string,
    public hash: string,
    public opCodes: string[],
  ) {
    super(message);
  }
}

/** Our amounts are hundredths; Stellar assets have 7 decimals. */
export const toAmount = (minor: number) => (minor / 100).toFixed(2);

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const accountUrl = (id: string) => `${EXPLORER}/account/${id}`;

// ---------------------------------------------------------------- classic

export async function fund(publicKey: string) {
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok && res.status !== 400) throw new Error(`Friendbot refused ${publicKey.slice(0, 6)}: ${res.status}`);
}

/** Build, sign and submit a classic transaction; returns its hash. */
export async function submitClassic(source: Keypair, ops: xdr.Operation[], signers: Keypair[] = []): Promise<string> {
  return (await submitClassicTx(source, ops, signers)).hash;
}

export async function submitClassicTx(source: Keypair, ops: xdr.Operation[], signers: Keypair[] = []): Promise<{ hash: string; tx: Transaction }> {
  const account = await horizon.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: PASSPHRASE });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(120).build();
  tx.sign(source, ...signers);
  const hash = Array.from(tx.hash(), (b) => b.toString(16).padStart(2, '0')).join('');

  // The public Testnet Horizon sometimes answers 504 while the transaction still lands.
  // Before giving up, look the transaction up by hash; resubmitting the same signed
  // transaction is safe because its sequence number can only be used once.
  let lastError = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await horizon.submitTransaction(tx);
      return { hash: res.hash, tx };
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } };
      const codes = err.response?.data?.extras?.result_codes;
      if (codes && codes.transaction !== 'tx_bad_seq') throw new ChainError(`Transaction failed: ${JSON.stringify(codes)}`, hash, codes.operations ?? []);
      lastError = codes ? JSON.stringify(codes) : (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
    if (await landed(hash)) return { hash, tx };
  }
  throw new Error(`Stellar Testnet did not confirm the transaction in time (${lastError})`);
}

async function landed(hash: string): Promise<boolean> {
  try {
    const t = await horizon.transactions().transaction(hash).call();
    return t.successful;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- escrow on native primitives

/**
 * Each tax-free claim is a claimable balance created by the shop, holding the VAT:
 *  - customs can claim it before the export deadline (to pay the traveller),
 *  - the shop can claim it back only after the deadline.
 * The time conditions are enforced by the Stellar protocol itself.
 */
export async function chainOpen(shop: Role, code: Code, vatMinor: number, deadlineMs: number) {
  const kp = keypair(shop);
  const deadline = String(Math.floor(deadlineMs / 1000));
  const op = Operation.createClaimableBalance({
    asset: asset(code),
    amount: toAmount(vatMinor),
    claimants: [
      new Claimant(config!.accounts.customs.publicKey, Claimant.predicateBeforeAbsoluteTime(deadline)),
      new Claimant(kp.publicKey(), Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(deadline))),
    ],
  });
  const { hash, tx } = await submitClassicTx(kp, [op]);
  return { hash, balanceId: tx.getClaimableBalanceId(0) };
}

/** The traveller records the claim on her own account (a data entry she signs). */
export async function chainAttach(balanceId: string) {
  const kp = keypair('traveller');
  const hash = await submitClassic(kp, [Operation.manageData({ name: `carimbo:${balanceId.slice(-48)}`, value: 'attached' })]);
  return { hash };
}

export interface ReleaseItem {
  balanceId: string;
  currency: Code;
  vatMinor: number;
}

/**
 * Customs certifies the export. One atomic transaction: claim every balance, send the
 * 0.5% fee to the platform, convert the rest on the DEX and pay the traveller.
 */
export async function chainRelease(items: ReleaseItem[], to: Code): Promise<{ hash: string; received: Map<Code, number> }> {
  const customs = keypair('customs');
  const traveller = config!.accounts.traveller.publicKey;
  const ops: xdr.Operation[] = items.map((i) => Operation.claimClaimableBalance({ balanceId: i.balanceId }));
  const received = new Map<Code, number>();
  const groups = new Map<Code, number>();
  items.forEach((i) => groups.set(i.currency, (groups.get(i.currency) ?? 0) + i.vatMinor));
  for (const [cur, total] of groups) {
    const fee = Math.floor((total * config!.feeBps) / 10_000);
    const net = total - fee;
    if (fee > 0) ops.push(Operation.payment({ destination: config!.accounts.platform.publicKey, asset: asset(cur), amount: toAmount(fee) }));
    if (cur === to) {
      ops.push(Operation.payment({ destination: traveller, asset: asset(cur), amount: toAmount(net) }));
      received.set(cur, net);
    } else {
      const paths = await horizon.strictSendPaths(asset(cur), toAmount(net), [asset(to)]).call();
      const best = paths.records.sort((a, b) => Number(b.destination_amount) - Number(a.destination_amount))[0];
      if (!best) throw new Error(`No DEX path from ${cur} to ${to}`);
      ops.push(
        Operation.pathPaymentStrictSend({
          sendAsset: asset(cur),
          sendAmount: toAmount(net),
          destination: traveller,
          destAsset: asset(to),
          destMin: (Number(best.destination_amount) * 0.99).toFixed(7),
          path: best.path.map((p) => (p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!))),
        }),
      );
      received.set(cur, Math.round(Number(best.destination_amount) * 100));
    }
  }
  const hash = await submitClassic(customs, ops);
  return { hash, received };
}

/** Customs refuses the export: claim each balance and pay the VAT back to its shop. */
export async function chainReject(items: (ReleaseItem & { shop: Role })[]) {
  const customs = keypair('customs');
  const ops = items.flatMap((i) => [
    Operation.claimClaimableBalance({ balanceId: i.balanceId }),
    Operation.payment({ destination: config!.accounts[i.shop]!.publicKey, asset: asset(i.currency), amount: toAmount(i.vatMinor) }),
  ]);
  return { hash: await submitClassic(customs, ops) };
}

/** After the deadline the protocol lets the shop claim its VAT back. */
export async function chainReclaim(shop: Role, balanceId: string) {
  return { hash: await submitClassic(keypair(shop), [Operation.claimClaimableBalance({ balanceId })]) };
}

// ---------------------------------------------------------------- reads for multi-device sync

const DATA_PREFIX = 'carimbo:';
export const attachKey = (balanceId: string) => `${DATA_PREFIX}${balanceId.slice(-48)}`;

/** The traveller tells every device which currency she wants, as a data entry on her account. */
export async function chainSetCurrency(code: Code) {
  return { hash: await submitClassic(keypair('traveller'), [Operation.manageData({ name: `${DATA_PREFIX}currency`, value: code })]) };
}

/** Data entries on the traveller's account (attachments and preferred currency), decoded. */
export async function travellerData(): Promise<Record<string, string>> {
  const acc = await horizon.loadAccount(config!.accounts.traveller.publicKey);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(acc.data_attr ?? {})) {
    try {
      out[k] = atob(v as string);
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function balanceExists(balanceId: string): Promise<boolean> {
  try {
    await horizon.claimableBalances().claimableBalance(balanceId).call();
    return true;
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 404) return false;
    throw e;
  }
}

export interface ClaimableInfo {
  amountMinor: number;
  code: Code | null;
  sponsor: string;
}

export async function claimableInfo(balanceId: string): Promise<ClaimableInfo | null> {
  try {
    const cb = await horizon.claimableBalances().claimableBalance(balanceId).call();
    const assetCode = cb.asset.split(':')[0];
    const code = (Object.entries(ASSET_CODES).find(([, v]) => v === assetCode)?.[0] ?? null) as Code | null;
    return { amountMinor: Math.round(Number(cb.amount) * 100), code, sponsor: cb.sponsor ?? '' };
  } catch {
    return null;
  }
}

/** The latest payment customs made to the traveller since `sinceMs`: the refund. */
export async function latestRefund(sinceMs: number): Promise<{ hash: string; code: Code; amountMinor: number; at: number } | null> {
  const page = await horizon.payments().forAccount(config!.accounts.traveller.publicKey).order('desc').limit(20).call();
  for (const r of page.records as unknown as Array<Record<string, string>>) {
    const at = Date.parse(r.created_at);
    if (at < sinceMs - 60_000) break;
    const fromCustoms = r.from === config!.accounts.customs.publicKey || r.source_account === config!.accounts.customs.publicKey;
    // Escrows released by Trustless Work: the traveller converts her euros herself.
    const selfConversion = r.type === 'path_payment_strict_send' && r.from === config!.accounts.traveller.publicKey;
    if ((!fromCustoms && !selfConversion) || r.to !== config!.accounts.traveller.publicKey) continue;
    const code = (Object.entries(ASSET_CODES).find(([, v]) => v === r.asset_code)?.[0] ?? null) as Code | null;
    if (!code) continue;
    return { hash: r.transaction_hash, code, amountMinor: Math.round(Number(r.amount) * 100), at };
  }
  return null;
}

export async function balances(publicKey: string): Promise<Record<string, string>> {
  const acc = await horizon.loadAccount(publicKey);
  const out: Record<string, string> = {};
  for (const b of acc.balances) {
    if (b.asset_type === 'native') out.XLM = b.balance;
    else if ('asset_code' in b) out[b.asset_code] = b.balance;
  }
  return out;
}
