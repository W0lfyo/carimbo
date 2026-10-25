/**
 * Stellar Testnet integration. Everything runs in the browser: the demo accounts are
 * testnet keys published in chain.json (worthless test money), so judges can replay
 * the full flow without installing a wallet.
 */
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import type { Code } from './money';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const FRIENDBOT = 'https://friendbot.stellar.org';
export const PASSPHRASE = Networks.TESTNET;
export const EXPLORER = 'https://stellar.expert/explorer/testnet';

export const rpcServer = new rpc.Server(RPC_URL);
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

export type Role = 'issuer' | 'maker' | 'platform' | 'customs' | 'traveller' | 'lojaAzul' | 'casaVerde';

export interface ChainConfig {
  network: 'testnet';
  createdAt: string;
  contractId: string;
  wasmHash: string;
  feeBps: number;
  issuer: string;
  sac: Record<Code, string>; // Stellar Asset Contract id of each demo stablecoin
  accounts: Record<Role, { publicKey: string; secret: string }>;
}

const CONFIG_KEY = 'carimbo.chain.v1';
let config: ChainConfig | null = null;

export async function loadConfig(): Promise<ChainConfig | null> {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) config = JSON.parse(raw) as ChainConfig;
  } catch {
    /* ignore */
  }
  if (!config) {
    try {
      const res = await fetch('./chain.json', { cache: 'no-store' });
      if (res.ok) config = (await res.json()) as ChainConfig;
    } catch {
      /* not deployed yet: the app stays in simulated mode */
    }
  }
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
  return Keypair.fromSecret(config!.accounts[role].secret);
}

/** Our amounts are hundredths; Stellar assets have 7 decimals. */
export const toStroops = (minor: number) => BigInt(minor) * 100_000n;
export const fromStroops = (s: bigint | string | number) => Number(BigInt(s) / 100_000n);
export const toAmount = (minor: number) => (minor / 100).toFixed(2);

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const contractUrl = (id: string) => `${EXPLORER}/contract/${id}`;

// ---------------------------------------------------------------- classic

export async function fund(publicKey: string) {
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok && res.status !== 400) throw new Error(`Friendbot refused ${publicKey.slice(0, 6)}: ${res.status}`);
}

/** Build, sign and submit a classic transaction; returns its hash. */
export async function submitClassic(source: Keypair, ops: xdr.Operation[], signers: Keypair[] = []): Promise<string> {
  const account = await horizon.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: PASSPHRASE });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(60).build();
  tx.sign(source, ...signers);
  try {
    const res = await horizon.submitTransaction(tx);
    return res.hash;
  } catch (e: unknown) {
    const extras = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras?.result_codes;
    throw new Error(`Transaction failed: ${JSON.stringify(extras ?? (e as Error).message)}`);
  }
}

// ---------------------------------------------------------------- soroban

async function sendSoroban(source: Keypair, op: xdr.Operation): Promise<{ hash: string; value: unknown }> {
  const account = await rpcServer.getAccount(source.publicKey());
  const built = new TransactionBuilder(account as Account, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const prepared = (await rpcServer.prepareTransaction(built)) as Transaction;
  prepared.sign(source);
  const sent = await rpcServer.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`Rejected: ${sent.errorResult?.toXDR('base64') ?? sent.status}`);
  const hash = sent.hash;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const got = await rpcServer.getTransaction(hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash, value: got.returnValue ? scValToNative(got.returnValue) : undefined };
    }
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`Transaction ${hash.slice(0, 8)} failed on-chain`);
  }
  throw new Error(`Timed out waiting for ${hash.slice(0, 8)}`);
}

export async function uploadWasm(source: Keypair, wasm: Uint8Array): Promise<string> {
  const { value } = await sendSoroban(source, Operation.uploadContractWasm({ wasm }));
  return Buffer.from(value as Uint8Array).toString('hex');
}

export async function deployContract(source: Keypair, wasmHashHex: string): Promise<string> {
  const { value } = await sendSoroban(
    source,
    Operation.createCustomContract({ address: Address.fromString(source.publicKey()), wasmHash: Buffer.from(wasmHashHex, 'hex') }),
  );
  return value as string; // contract address (C...)
}

export async function deploySac(source: Keypair, a: Asset): Promise<string> {
  const id = a.contractId(PASSPHRASE);
  try {
    await sendSoroban(source, Operation.createStellarAssetContract({ asset: a }));
  } catch (e) {
    // Already deployed by an earlier run: the id is deterministic, so carry on.
    if (!String((e as Error).message).includes('failed') && !String((e as Error).message).includes('Rejected')) throw e;
  }
  return id;
}

function call(fn: string, ...args: xdr.ScVal[]) {
  return new Contract(config!.contractId).call(fn, ...args);
}

const u64 = (n: number | bigint) => nativeToScVal(BigInt(n), { type: 'u64' });
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' });
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const addr = (s: string) => Address.fromString(s).toScVal();

export async function initEscrow(admin: Keypair, contractId: string, customs: string, platform: string, feeBps: number) {
  const op = new Contract(contractId).call('init', addr(customs), addr(platform), u32(feeBps));
  return sendSoroban(admin, op);
}

/** Shop locks the VAT. Returns the on-chain claim id and the transaction hash. */
export async function chainOpen(shop: Role, code: Code, vatMinor: number, deadlineMs: number) {
  const kp = keypair(shop);
  const { hash, value } = await sendSoroban(
    kp,
    call('open', addr(kp.publicKey()), addr(config!.sac[code]), i128(toStroops(vatMinor)), u64(Math.floor(deadlineMs / 1000))),
  );
  return { hash, id: Number(value as bigint) };
}

export async function chainAttach(id: number) {
  const kp = keypair('traveller');
  return sendSoroban(kp, call('attach', u64(id), addr(kp.publicKey())));
}

export async function chainRelease(ids: number[]) {
  return sendSoroban(keypair('customs'), call('release', vecU64(ids)));
}

export async function chainReject(ids: number[]) {
  return sendSoroban(keypair('customs'), call('reject', vecU64(ids)));
}

export async function chainReclaim(shop: Role, id: number) {
  return sendSoroban(keypair(shop), call('reclaim', u64(id)));
}

function vecU64(ids: number[]) {
  return xdr.ScVal.scvVec(ids.map((i) => u64(i)));
}

/**
 * Convert the traveller's refund on the Stellar DEX: a path payment from the claim
 * currency to the payout currency, sent to themselves.
 */
export async function chainConvert(from: Code, to: Code, minor: number): Promise<{ hash: string; received: number }> {
  const kp = keypair('traveller');
  if (from === to) return { hash: '', received: minor };
  const sendAmount = toAmount(minor);
  const paths = await horizon.strictSendPaths(asset(from), sendAmount, [asset(to)]).call();
  const best = paths.records.sort((a, b) => Number(b.destination_amount) - Number(a.destination_amount))[0];
  if (!best) throw new Error(`No DEX path from ${from} to ${to}`);
  const destMin = (Number(best.destination_amount) * 0.99).toFixed(7);
  const hash = await submitClassic(kp, [
    Operation.pathPaymentStrictSend({
      sendAsset: asset(from),
      sendAmount,
      destination: kp.publicKey(),
      destAsset: asset(to),
      destMin,
      path: best.path.map((p) => (p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!))),
    }),
  ]);
  return { hash, received: Math.round(Number(best.destination_amount) * 100) };
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
