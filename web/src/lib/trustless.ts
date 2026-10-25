/**
 * Escrow through Trustless Work (a HackMeridian partner): their single-release escrow
 * contract on Soroban, driven by their REST API. The API returns unsigned transactions;
 * each actor signs its own in the browser, and the API submits them.
 *
 * Trustless Work escrows hold Circle's USDC (the token their Testnet API accepts), so on
 * this path the VAT is escrowed as USDC at the DEX rate.
 *
 * Mapping of a tax-free claim onto the escrow:
 *  - the shop deploys and funds it with the VAT, in USDC,
 *  - customs is service provider, approver and release signer: one stamp marks the
 *    milestone "exported", approves it and releases,
 *  - the traveller is the receiver; the platform takes Carimbo's 0.5% fee,
 *  - customs is also the dispute resolver, to send the VAT back to the shop on a refusal.
 */
import { Asset, Operation, TransactionBuilder, type Keypair } from '@stellar/stellar-sdk';
import { PASSPHRASE, SHOP_ROLES, asset, balances, getConfig, horizon, keypair, submitClassic, toAmount, type Role } from './stellar';
import { convert, type Code } from './money';

export const TW_API = 'https://dev.api.trustlesswork.com';
const FEE_PERCENT = 0.5;
/** Circle's USDC on Stellar Testnet. */
export const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

export const twKey = () => getConfig()?.trustlessWork?.apiKey ?? '';
export const twEnabled = () => !!twKey();


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
  const usdcMinor = quoteUsdc(code, vatMinor);
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
      amount: usdcMinor / 100,
      platformFee: FEE_PERCENT,
      milestones: [{ description: 'Goods exported, certified by customs' }],
      trustline: { address: USDC.getIssuer(), symbol: 'USDC' },
    },
    shopKp,
  );
  if (!deployed.contractId) throw new Error('Trustless Work did not return the escrow address.');
  const funded = await step('/escrow/single-release/fund-escrow', { contractId: deployed.contractId, signer: shopKp.publicKey(), amount: usdcMinor / 100 }, shopKp);
  return { contractId: deployed.contractId, deployTx: deployed.hash, fundTx: funded.hash, usdcMinor };
}

/** The VAT in USDC at the reference rate (1 USDC = 1 USD). */
export function quoteUsdc(code: Code, minor: number): number {
  return Math.floor(convert(minor, code, 'USD'));
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
export async function twRefuse(contractId: string, shop: Role, usdcMinor: number) {
  const customs = keypair('customs');
  await step('/escrow/single-release/dispute-escrow', { contractId, signer: customs.publicKey() }, customs);
  return (await step('/escrow/single-release/resolve-dispute', { contractId, disputeResolver: customs.publicKey(), distributions: [{ address: pk(shop), amount: usdcMinor / 100 }] }, customs)).hash;
}

/** The released USDC reach the traveller; she converts them on the DEX into her currency's Carimbo stablecoin in one path payment. */
export async function twConvert(minor: number, to: Code): Promise<{ hash?: string; received: number }> {
  if (minor <= 0) return { received: minor };
  const paths = await horizon.strictSendPaths(USDC, toAmount(minor), [asset(to)]).call();
  const best = paths.records.sort((a, b) => Number(b.destination_amount) - Number(a.destination_amount))[0];
  if (!best) throw new Error(`No DEX path from USDC to ${to}`);
  const traveller = keypair('traveller');
  const hash = await submitClassic(traveller, [
    Operation.pathPaymentStrictSend({
      sendAsset: USDC,
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
  const res = await fetch(`${TW_API}/helper/get-escrow-by-contract-ids?contractIds[]=${encodeURIComponent(contractId)}&validateOnChain=true`, { headers: { 'x-api-key': twKey() } });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ flags?: { released?: boolean; disputed?: boolean; resolved?: boolean } }> | { escrows?: unknown[] };
  const first = (Array.isArray(data) ? data[0] : (data.escrows as Array<{ flags?: Record<string, boolean> }> | undefined)?.[0]) as { flags?: Record<string, boolean> } | undefined;
  if (!first) return null;
  return { released: !!first.flags?.released, disputed: !!first.flags?.disputed, resolved: !!first.flags?.resolved };
}

/**
 * One-time Testnet preparation: every role trusts USDC, each shop buys USDC with test XLM
 * on the DEX, and the market maker quotes USDC against cEUR so refunds convert onwards.
 */
export async function prepareTrustless(log: (s: string) => void) {
  const cfg = getConfig()!;
  const roles = (Object.keys(cfg.accounts) as Role[]).filter((r) => r !== 'issuer' && cfg.accounts[r]);
  for (const r of roles) {
    const held = await balances(cfg.accounts[r]!.publicKey);
    if (held.USDC === undefined) {
      await submitClassic(keypair(r), [Operation.changeTrust({ asset: USDC })]);
      log(`${r}: USDC trustline`);
    }
  }
  for (const r of SHOP_ROLES.filter((x) => cfg.accounts[x])) {
    const held = await balances(cfg.accounts[r]!.publicKey);
    if (Number(held.USDC ?? 0) < 200) {
      const hash = await submitClassic(keypair(r), [
        Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '2000', destination: cfg.accounts[r]!.publicKey, destAsset: USDC, destAmount: '1000', path: [] }),
      ]);
      log(`${r}: bought 1,000 USDC with test XLM (${hash.slice(0, 8)}…)`);
    }
  }
  // The maker sells cEUR for USDC (so USDC → cEUR → any currency) and USDC is quoted from cEUR the other way.
  const usdPerEur = 1.16;
  await submitClassic(keypair('maker'), [
    Operation.manageSellOffer({ selling: asset('EUR'), buying: USDC, amount: '100000', price: (usdPerEur * 1.003).toFixed(4) }),
  ]);
  log('Market maker: cEUR offered against USDC');
}
