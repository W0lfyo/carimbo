import { useEffect, useRef, useState } from 'react';
import { isLive, ledger, useLedger } from '../lib/ledger';
import { txUrl } from '../lib/stellar';
import { clock } from '../lib/money';
import { ShopView } from './Shop';
import { CustomsView } from './Customs';
import { Traveller } from './Traveller';

type Stage = 'idle' | 'shop' | 'traveller' | 'customs' | 'paid';

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'shop', label: 'Shop locks the VAT' },
  { stage: 'traveller', label: 'Traveller adds it' },
  { stage: 'customs', label: 'Customs stamps' },
  { stage: 'paid', label: 'Paid in dollars' },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Demo() {
  const s = useLedger();
  const [stage, setStage] = useState<Stage>('idle');
  const [playing, setPlaying] = useState(false);
  const [joinCode, setJoinCode] = useState<string | undefined>();
  const [failure, setFailure] = useState('');
  const run = useRef(0);

  useEffect(() => () => void (run.current += 1), []);

  async function play() {
    setFailure('');
    try {
      await story();
    } catch (err) {
      setFailure(`Stellar Testnet did not answer as expected: ${(err as Error).message}. Press Play again to retry.`);
      setPlaying(false);
    }
  }

  async function story() {
    const id = ++run.current;
    const alive = () => run.current === id;
    setPlaying(true);
    ledger.reset();
    setJoinCode(undefined);
    setStage('shop');
    await wait(900);
    if (!alive()) return;
    const a = await ledger.createSale('loja-azul', 'Leather bag', 40000, 23);
    setJoinCode(a.code);
    await wait(1600);
    if (!alive()) return;
    setStage('traveller');
    await wait(1400);
    if (!alive()) return;
    await ledger.join(a.code);
    if (!alive()) return;
    const b = await ledger.createSale('casa-verde', 'Ceramics set', 20000, 23);
    await ledger.join(b.code);
    setJoinCode(undefined);
    await wait(2200);
    if (!alive()) return;
    setStage('customs');
    await wait(1800);
    if (!alive()) return;
    await ledger.clearTrip();
    setStage('paid');
    setPlaying(false);
  }

  function reset() {
    run.current += 1;
    ledger.reset();
    setJoinCode(undefined);
    setStage('idle');
    setPlaying(false);
  }

  const current = STEPS.findIndex((x) => x.stage === stage);

  return (
    <main className="demo">
      <section className="demo__intro">
        <h1 className="demo__headline">
          Travellers leave about a quarter of their tax-free refund with middlemen. Carimbo gives back 99.5% of it, in their own currency, the moment customs clears them.
        </h1>
        <p className="demo__source">
          Refund operators keep around a quarter of the reclaimable VAT across the EU.{' '}
          <a href="https://www.withprive.com/en/blog/vat-refund-what-you-actually-get-back" target="_blank" rel="noreferrer">
            Source: Privé, 2026 estimates
          </a>
        </p>
        <div className="demo__controls">
          <button type="button" className="btn btn--go btn--big" onClick={play} disabled={playing}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 2.5v13l11-6.5z" fill="currentColor" />
            </svg>
            {playing ? 'Playing…' : stage === 'paid' ? 'Play again' : 'Play the refund'}
          </button>
          <button type="button" className="btn btn--line" onClick={reset}>
            Reset
          </button>
        </div>
      </section>

      <ol className="steps" aria-label="Demo progress">
        {STEPS.map((x, i) => (
          <li key={x.stage} className={`steps__item${i < current ? ' steps__item--done' : ''}${i === current ? ' steps__item--now' : ''}`} aria-current={i === current ? 'step' : undefined}>
            <span className="steps__num mono">{i + 1}</span>
            {x.label}
          </li>
        ))}
      </ol>

      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}

      <div className="stage">
        <section className={`stage__pane${stage === 'shop' ? ' stage__pane--lit' : ''}`} aria-labelledby="pane-shop">
          <h2 className="stage__label" id="pane-shop">
            Shop till, Loja Azul
          </h2>
          <ShopView compact />
        </section>
        <section className={`stage__pane stage__pane--phone${stage === 'traveller' || stage === 'paid' ? ' stage__pane--lit' : ''}`} aria-labelledby="pane-traveller">
          <h2 className="stage__label" id="pane-traveller">
            Traveller’s phone
          </h2>
          <div className="phone">
            <Traveller joinCode={joinCode} />
          </div>
        </section>
        <section className={`stage__pane${stage === 'customs' ? ' stage__pane--lit' : ''}`} aria-labelledby="pane-customs">
          <h2 className="stage__label" id="pane-customs">
            Customs desk, LIS T1
          </h2>
          <CustomsView compact />
        </section>
      </div>

      <section className="chain" aria-labelledby="chain-title">
        <div className="chain__head">
          <h2 className="subtitle" id="chain-title">
            On-chain activity
          </h2>
          {isLive() ? (
            <span className="chip chip--cleared">
              <span className="dot" aria-hidden="true" />
              Live on Stellar Testnet
            </span>
          ) : (
            <span className="chip">Simulated: Testnet contract not configured</span>
          )}
        </div>
        {s.activity.length === 0 ? (
          <p className="muted">Nothing yet. Play the refund to see every step land on the ledger.</p>
        ) : (
          <ol className="chain__list">
            {s.activity.slice(0, 6).map((a) => (
              <li key={a.id} className={`chain__item chain__item--${a.kind}`}>
                <span className="mono muted small">{clock(a.at)}</span>
                <span>{a.label}</span>
                <span className="mono strong">{a.amount}</span>
                {a.live ? (
                  <a className="mono small chain__tx" href={txUrl(a.tx)} target="_blank" rel="noreferrer" title="Open on Stellar Expert">
                    {a.tx.slice(0, 6)}…{a.tx.slice(-4)}
                  </a>
                ) : (
                  <span className="mono muted small chain__tx" title="Simulated transaction">
                    {a.tx.slice(0, 6)}…{a.tx.slice(-4)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
