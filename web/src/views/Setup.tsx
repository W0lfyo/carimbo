import { useState } from 'react';
import { Keypair, Operation } from '@stellar/stellar-sdk';
import { CURRENCIES, type Code } from '../lib/money';
import { ASSET_CODES, SHOP_ROLES, accountUrl, asset, balances, fund, getConfig, keypair, saveConfig, submitClassic, txUrl, type ChainConfig, type Role } from '../lib/stellar';

const ROLES: Role[] = ['issuer', 'maker', 'platform', 'customs', 'traveller', ...SHOP_ROLES];
const LOCAL: Code[] = ['EUR', 'CHF', 'JPY', 'SGD', 'KRW'];
const ALL = Object.keys(ASSET_CODES) as Code[];
const FEE_BPS = 50;

interface Line {
  text: string;
  href?: string;
  tone?: 'ok' | 'err';
}

/** One-click Testnet bootstrap: accounts, demo stablecoins and DEX liquidity. */
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
      log({ text: `Funding ${ROLES.length} test accounts with Friendbot…` });
      await Promise.all(ROLES.map((r) => fund(keys[r].publicKey())));
      log({ text: 'Accounts funded', tone: 'ok' });

      const issuer = keys.issuer.publicKey();
      const trust: Record<Role, Code[]> = {
        issuer: [],
        customs: LOCAL, // receives the VAT for the instant of the atomic release
        maker: ALL,
        traveller: ALL,
        platform: LOCAL,
        lojaAzul: LOCAL,
        casaVerde: LOCAL,
        fioAlfama: LOCAL,
        lume: LOCAL,
        gaivota: LOCAL,
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
          SHOP_ROLES.map((r) => Operation.payment({ destination: keys[r].publicKey(), asset: asset(c, issuer), amount: big(c, 200_000) })),
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
          Operation.manageSellOffer({ selling: asset(c, issuer), buying: asset('EUR', issuer), amount: big(c, 200_000), price: ((1 / CURRENCIES[c].perEur) * 1.003).toFixed(7) }),
          // sell EUR for X: price of 1 EUR in X
          Operation.manageSellOffer({ selling: asset('EUR', issuer), buying: asset(c, issuer), amount: '200000', price: (CURRENCIES[c].perEur * 1.003).toFixed(4) }),
        ]),
      );
      log({ text: '16 offers live: every currency trades against cEUR', href: txUrl(offers), tone: 'ok' });

      log({ text: 'Customs signer ready: it can claim VAT only before each export deadline', href: accountUrl(keys.customs.publicKey()), tone: 'ok' });

      const cfg: ChainConfig = {
        network: 'testnet',
        createdAt: new Date().toISOString(),
        escrow: 'claimable-balances',
        feeBps: FEE_BPS,
        issuer,
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

  /**
   * Shops listed in chain.json after the first deployment: fund them, open their
   * trustlines and give them working stablecoins. Safe to run again.
   */
  async function activateShops() {
    const cfg = getConfig();
    if (!cfg) return;
    setBusy(true);
    setLines([]);
    try {
      const shops = SHOP_ROLES.filter((r) => cfg.accounts[r]);
      for (const r of shops) {
        const pk = cfg.accounts[r]!.publicKey;
        let held: Record<string, string> | null = null;
        try {
          held = await balances(pk);
        } catch {
          log({ text: `${r}: funding with Friendbot…` });
          await fund(pk);
          held = await balances(pk);
        }
        const missing = LOCAL.filter((c) => held![ASSET_CODES[c]] === undefined);
        if (missing.length) {
          const hash = await submitClassic(keypair(r), missing.map((c) => Operation.changeTrust({ asset: asset(c) })));
          log({ text: `${r}: ${missing.length} trustlines`, href: txUrl(hash) });
        }
        if (Number(held.cEUR ?? 0) < 1000) {
          const big = (c: Code) => (CURRENCIES[c].perEur * 200_000).toFixed(2);
          const hash = await submitClassic(keypair('issuer'), LOCAL.map((c) => Operation.payment({ destination: pk, asset: asset(c), amount: big(c) })));
          log({ text: `${r}: stablecoins issued`, href: txUrl(hash) });
        }
        log({ text: `${r} ready`, href: accountUrl(pk), tone: 'ok' });
      }
      log({ text: `${shops.length} shops live on Testnet.`, tone: 'ok' });
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
            <span className="muted">Creates the demo accounts, the demo stablecoins and their liquidity on the Stellar DEX.</span>
          </div>
          {result && (
            <button type="button" className="btn btn--line" onClick={activateShops} disabled={busy}>
              Activate the shops
            </button>
          )}
          <button type="button" className="btn btn--go" onClick={run} disabled={busy}>
            {busy ? 'Deploying…' : result ? 'Deploy a fresh copy' : 'Deploy to Testnet'}
          </button>
        </header>
        <section className="card setup-log" aria-live="polite">
          {lines.length === 0 && <p className="muted">{result ? `Live on Testnet. Issuer ${result.issuer.slice(0, 8)}…` : 'Nothing deployed from this browser yet.'}</p>}
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
