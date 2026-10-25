/**
 * Escrow through Trustless Work (a HackMeridian partner): their single-release escrow
 * contract on Soroban, driven by their REST API. The API returns unsigned transactions;
 * each actor signs its own in the browser, and the API submits them.
 *
 * Mapping of a tax-free claim onto the escrow:
 *  - the shop deploys and funds it with the VAT (cEUR),
 *  - customs is service provider, approver and release signer: one stamp marks the
 *    milestone "exported", approves it and releases,
 *  - the traveller is the receiver; the platform takes Carimbo's 0.5% fee,
 *  - customs is also the dispute resolver, to send the VAT back to the shop on a refusal.
 */
import { Asset, Operation, TransactionBuilder, rpc, xdr, type Keypair } from '@stellar/stellar-sdk';
import { PASSPHRASE, asset, getConfig, horizon, keypair, submitClassic, toAmount, type Role } from './stellar';
import type { Code } from './money';

export const TW_API = 'https://dev.api.trustlesswork.com';
export const SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
const FEE_PERCENT = 0.5;

export const twKey = () => getConfig()?.trustlessWork?.apiKey ?? '';
export const twEnabled = () => !!twKey();

/** The Soroban address of a classic Carimbo stablecoin (its Stellar Asset Contract). */
export const tokenContract = (code: Code) => asset(code).contractId(PASSPHRASE);

async function api<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${TW_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': twKey() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* keep the text for the error */
  }
  if (!res.ok) {
    const msg = (data.message as string | string[] | undefined) ?? text;
    throw new Error(`Trustless Work ${path}: ${Array.isArray(msg) ? msg.join(', ') : msg}`);
  }
  return data as T;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Ask the API for a transaction, sign it as `who`, send it back. Returns the hash and the API's reply. */
async function step(path: string, body: unknown, who: Keypair) {
  const r = await api<{ unsignedTransaction: string }>(path, body);
  const tx = TransactionBuilder.fromXDR(r.unsignedTransaction, PASSPHRASE);
  tx.sign(who);
  const sent = await api<{ status: string; contractId?: string; message?: string }>('/helper/send-transaction', { signedXdr: tx.toXDR() });
  if (sent.status && sent.status !== 'SUCCESS') throw new Error(`Trustless Work: ${sent.message ?? sent.status}`);
  return { hash: hex(tx.hash()), contractId: sent.contractId };
}

const pk = (r: Role) => getConfig()!.accounts[r]!.publicKey;

/** The shop opens an escrow for one receipt and funds it with the VAT. */
export async function twOpen(shop: Role, code: Code, vatMinor: number, claimCode: string) {
  const shopKp = keypair(shop);
  const customs = pk('customs');
  const deployed = await step(
    '/deployer/single-release',
    {
      signer: shopKp.publicKey(),
      engagementId: claimCode,
      title: `Tax-free VAT ${claimCode}`,
      description: 'VAT held until customs certifies the export, then paid to the traveller.',
      roles: {
        approver: customs,
        serviceProvider: customs,
        platformAddress: pk('platform'),
        releaseSigner: customs,
        disputeResolver: customs,
        receiver: pk('traveller'),
      },
      amount: vatMinor / 100,
      platformFee: FEE_PERCENT,
      milestones: [{ description: 'Goods exported, certified by customs' }],
      trustline: [{ address: tokenContract(code), symbol: `c${code}` }],
    },
    shopKp,
  );
  if (!deployed.contractId) throw new Error('Trustless Work did not return the escrow address.');
  const funded = await step('/escrow/single-release/fund-escrow', { contractId: deployed.contractId, signer: shopKp.publicKey(), amount: vatMinor / 100 }, shopKp);
  return { contractId: deployed.contractId, deployTx: deployed.hash, fundTx: funded.hash };
}

/** Customs' stamp on one escrow: milestone done, approved, released to the traveller. */
export async function twRelease(contractId: string) {
  const customs = keypair('customs');
  const me = customs.publicKey();
  await step('/escrow/single-release/change-milestone-status', { contractId, milestoneIndex: '0', newStatus: 'exported', newEvidence: 'Customs stamp, Lisbon Airport T1', serviceProvider: me }, customs);
  await step('/escrow/single-release/approve-milestone', { contractId, milestoneIndex: '0', approver: me }, customs);
  return (await step('/escrow/single-release/release-funds', { contractId, releaseSigner: me }, customs)).hash;
}

/** Customs refuses: dispute the escrow, then resolve it with the whole VAT back to the shop. */
export async function twRefuse(contractId: string, shop: Role, vatMinor: number) {
  const customs = keypair('customs');
  await step('/escrow/single-release/dispute-escrow', { contractId, signer: customs.publicKey() }, customs);
  return (await step('/escrow/single-release/resolve-dispute', { contractId, disputeResolver: customs.publicKey(), distributions: [{ address: pk(shop), amount: vatMinor / 100 }] }, customs)).hash;
}

/** The released euros reach the traveller; she converts them on the DEX in one path payment. */
export async function twConvert(from: Code, minor: number, to: Code): Promise<{ hash?: string; received: number }> {
  if (from === to || minor <= 0) return { received: minor };
  const paths = await horizon.strictSendPaths(asset(from), toAmount(minor), [asset(to)]).call();
  const best = paths.records.sort((a, b) => Number(b.destination_amount) - Number(a.destination_amount))[0];
  if (!best) throw new Error(`No DEX path from ${from} to ${to}`);
  const traveller = keypair('traveller');
  const hash = await submitClassic(traveller, [
    Operation.pathPaymentStrictSend({
      sendAsset: asset(from),
      sendAmount: toAmount(minor),
      destination: traveller.publicKey(),
      destAsset: asset(to),
      destMin: (Number(best.destination_amount) * 0.99).toFixed(7),
      path: best.path.map((p) => (p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!))),
    }),
  ]);
  return { hash, received: Math.round(Number(best.destination_amount) * 100) };
}

/** Escrow state from the Trustless Work indexer, for the phone's sync. */
export async function twEscrow(contractId: string): Promise<{ released: boolean; disputed: boolean; resolved: boolean } | null> {
  const res = await fetch(`${TW_API}/helper/get-escrow-by-contract-ids?contractIds=${encodeURIComponent(contractId)}&validateOnChain=true`, { headers: { 'x-api-key': twKey() } });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ flags?: { released?: boolean; disputed?: boolean; resolved?: boolean } }> | { escrows?: unknown[] };
  const first = (Array.isArray(data) ? data[0] : (data.escrows as Array<{ flags?: Record<string, boolean> }> | undefined)?.[0]) as { flags?: Record<string, boolean> } | undefined;
  if (!first) return null;
  return { released: !!first.flags?.released, disputed: !!first.flags?.disputed, resolved: !!first.flags?.resolved };
}

/** One-time: publish the Stellar Asset Contracts of the stablecoins so Soroban escrows can hold them. */
export async function deployTokenContracts(codes: Code[], log: (s: string) => void) {
  const server = new rpc.Server(SOROBAN_RPC);
  const issuer = keypair('issuer');
  for (const code of codes) {
    const id = tokenContract(code);
    try {
      await server.getContractData(id, xdr.ScVal.scvLedgerKeyContractInstance());
      log(`c${code} contract already live: ${id}`);
      continue;
    } catch {
      /* not deployed yet */
    }
    const account = await server.getAccount(issuer.publicKey());
    const tx = new TransactionBuilder(account, { fee: '100000', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.createStellarAssetContract({ asset: asset(code) }))
      .setTimeout(120)
      .build();
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(issuer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') throw new Error(`c${code} contract: ${sent.errorResult?.toXDR('base64') ?? 'error'}`);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await server.getTransaction(sent.hash);
      if (got.status === 'SUCCESS') break;
      if (got.status === 'FAILED') throw new Error(`c${code} contract deployment failed`);
    }
    log(`c${code} contract live: ${id}`);
  }
}
