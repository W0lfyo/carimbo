import { useState } from 'react';
import { Keypair, Operation } from '@stellar/stellar-sdk';
import { CURRENCIES, type Code } from '../lib/money';
import {
  ASSET_CODES,
  asset,
  contractUrl,
  deployContract,
  deploySac,
  fund,
  getConfig,
  initEscrow,
  saveConfig,
  submitClassic,
  txUrl,
  uploadWasm,
  type ChainConfig,
  type Role,
} from '../lib/stellar';

const ROLES: Role[] = ['issuer', 'maker', 'platform', 'customs', 'traveller', 'lojaAzul', 'casaVerde'];
const LOCAL: Code[] = ['EUR', 'CHF', 'JPY', 'SGD', 'KRW'];
const ALL = Object.keys(ASSET_CODES) as Code[];
const FEE_BPS = 50;

interface Line {
  text: string;
  href?: string;
  tone?: 'ok' | 'err';
}

/** One-click Testnet bootstrap: accounts, demo stablecoins, DEX liquidity, escrow contract. */
export function Setup() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChainConfig | null>(getConfig());

  const log = (l: Line) => setLines((prev) => [...prev, l]);

  async function run() {
    setBusy(true);
    setLines([]);
    try {
      const keys = Object.fromEntries(ROLES.map((r) => [r, Keypair.random()])) as Record<Role, Keypair>;
      log({ text: 'Funding 7 test accounts with Friendbot…' });
      await Promise.all(ROLES.map((r) => fund(keys[r].publicKey())));
      log({ text: 'Accounts funded', tone: 'ok' });

      const issuer = keys.issuer.publicKey();
      const trust: Record<Role, Code[]> = {
        issuer: [],
        customs: [],
        maker: ALL,
        traveller: ALL,
        platform: LOCAL,
        lojaAzul: LOCAL,
        casaVerde: LOCAL,
      };
      log({ text: 'Opening trustlines for the demo stablecoins…' });
      await Promise.all(
        ROLES.filter((r) => trust[r].length).map(async (r) => {
          const hash = await submitClassic(
            keys[r],
            trust[r].map((c) => Operation.changeTrust({ asset: asset(c, issuer) })),
          );
          log({ text: `${r}: ${trust[r].length} trustlines`, href: txUrl(hash) });
        }),
      );

      log({ text: 'Issuing cEUR, cUSD, cJPY… to the market maker and the shops' });
      const big = (c: Code, eur: number) => (CURRENCIES[c].perEur * eur).toFixed(2);
      const mint = await submitClassic(keys.issuer, [
        ...ALL.map((c) => Operation.payment({ destination: keys.maker.publicKey(), asset: asset(c, issuer), amount: big(c, 5_000_000) })),
        ...LOCAL.flatMap((c) =>
          (['lojaAzul', 'casaVerde'] as Role[]).map((r) => Operation.payment({ destination: keys[r].publicKey(), asset: asset(c, issuer), amount: big(c, 200_000) })),
        ),
      ]);
      log({ text: 'Stablecoins issued', href: txUrl(mint), tone: 'ok' });

      log({ text: 'Placing market-maker offers on the Stellar DEX…' });
      const offers = await submitClassic(
        keys.maker,
        ALL.filter((c) => c !== 'EUR').flatMap((c) => [
          // Two-sided book around the reference rate with a 0.3% spread each way,
          // so the maker's own bid and ask never cross.
          // sell X for EUR: price of 1 X in EUR
          Operation.manageSellOffer({ selling: asset(c, issuer), buying: asset('EUR', issuer), amount: big(c, 1_000_000), price: ((1 / CURRENCIES[c].perEur) * 1.003).toFixed(7) }),
          // sell EUR for X: price of 1 EUR in X
          Operation.manageSellOffer({ selling: asset('EUR', issuer), buying: asset(c, issuer), amount: '1000000', price: (CURRENCIES[c].perEur * 1.003).toFixed(4) }),
        ]),
      );
      log({ text: '16 offers live: every currency trades against cEUR', href: txUrl(offers), tone: 'ok' });

      log({ text: 'Deploying the Stellar Asset Contracts of the local currencies…' });
      const sac = {} as Record<Code, string>;
      for (const c of ALL) sac[c] = asset(c, issuer).contractId('Test SDF Network ; September 2015');
      for (const c of LOCAL) {
        await deploySac(keys.issuer, asset(c, issuer));
        log({ text: `${ASSET_CODES[c]} contract`, href: contractUrl(sac[c]) });
      }

      log({ text: 'Uploading the Carimbo escrow contract…' });
      const wasmRes = await fetch('./carimbo_escrow.wasm');
      if (!wasmRes.ok) throw new Error('carimbo_escrow.wasm is missing from the site');
      const wasm = new Uint8Array(await wasmRes.arrayBuffer());
      const wasmHash = await uploadWasm(keys.issuer, wasm);
      const contractId = await deployContract(keys.issuer, wasmHash);
      log({ text: 'Escrow deployed', href: contractUrl(contractId), tone: 'ok' });
      const init = await initEscrow(keys.issuer, contractId, keys.customs.publicKey(), keys.platform.publicKey(), FEE_BPS);
      log({ text: `Escrow initialised: customs signer set, fee ${FEE_BPS / 100}%`, href: txUrl(init.hash), tone: 'ok' });

      const cfg: ChainConfig = {
        network: 'testnet',
        createdAt: new Date().toISOString(),
        contractId,
        wasmHash,
        feeBps: FEE_BPS,
        issuer,
        sac,
        accounts: Object.fromEntries(ROLES.map((r) => [r, { publicKey: keys[r].publicKey(), secret: keys[r].secret() }])) as ChainConfig['accounts'],
      };
      saveConfig(cfg);
      setResult(cfg);
      log({ text: 'Done. This browser now runs Carimbo on Stellar Testnet.', tone: 'ok' });
    } catch (e) {
      log({ text: (e as Error).message, tone: 'err' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="desk">
        <header className="desk__head">
          <div className="stack-0">
            <h1 className="title">Testnet setup</h1>
            <span className="muted">Creates the demo accounts, stablecoins, DEX liquidity and the escrow contract.</span>
          </div>
          <button type="button" className="btn btn--go" onClick={run} disabled={busy}>
            {busy ? 'Deploying…' : result ? 'Deploy a fresh copy' : 'Deploy to Testnet'}
          </button>
        </header>
        <section className="card setup-log" aria-live="polite">
          {lines.length === 0 && <p className="muted">{result ? `Live contract: ${result.contractId}` : 'Nothing deployed from this browser yet.'}</p>}
          <ol className="stack-2">
            {lines.map((l, i) => (
              <li key={i} className={`setup-line setup-line--${l.tone ?? 'info'}`}>
                <span>{l.text}</span>
                {l.href && (
                  <a href={l.href} target="_blank" rel="noreferrer" className="small">
                    View on Stellar Expert
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
        {result && (
          <section className="card stack-3">
            <h2 className="subtitle">chain.json</h2>
            <p className="muted small">Testnet keys only. Commit this as web/public/chain.json so every visitor uses the same deployment.</p>
            <textarea id="chain-json" className="field__input mono setup-json" readOnly value={JSON.stringify(result, null, 2)} rows={12} />
          </section>
        )}
      </div>
    </main>
  );
}
