import { useEffect, useMemo, useState } from 'react';
import { ledger, useLedger } from '../lib/ledger';
import { CURRENCIES, PAYOUT_CURRENCIES, convert, fmt, fmtBare, fmtPlain } from '../lib/money';
import { countryOf } from '../lib/countries';
import { txUrl } from '../lib/stellar';
import type { CurrencyCode } from '../lib/types';
import { LogoMark } from '../components/Logo';
import { BoardingPass } from '../components/BoardingPass';
import { Board } from '../components/Board';
import { QR } from '../components/QR';
import { Stamp } from '../components/Stamp';
import { SplitFlap } from '../components/SplitFlap';

type Screen = 'trip' | 'airport';

function FaceIdIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 9v1M15 9v1M12 9v4h-1M9 16c1.6 1.2 4.4 1.2 6 0" />
    </svg>
  );
}

export function Traveller({ joinCode }: { joinCode?: string }) {
  const s = useLedger();
  const t = s.traveller;
  const [screen, setScreen] = useState<Screen>('trip');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [cashout, setCashout] = useState(false);

  const mine = s.claims.filter((c) => c.travellerId === t.id && !c.archived).sort((a, b) => a.createdAt - b.createdAt);
  const open = mine.filter((c) => c.status === 'locked');
  const paid = mine.filter((c) => c.status === 'refunded');
  const rejected = mine.filter((c) => c.status === 'rejected');
  const pending = joinCode ? s.claims.find((c) => c.code === joinCode && c.status === 'locked' && c.travellerId !== t.id) : undefined;
  const shopOf = (id: string) => s.shops.find((x) => x.id === id)!;

  // A fresh stamp brings the traveller to the refund moment, wherever they were.
  const justPaid = paid.length > 0 && open.length === 0;
  useEffect(() => {
    if (open.length === 0) setScreen('trip');
  }, [open.length]);

  async function join(codeToJoin: string) {
    setBusy(true);
    setError('');
    let ok = null;
    try {
      ok = await ledger.join(codeToJoin);
    } catch (err) {
      setBusy(false);
      setError(`Stellar did not accept the claim: ${(err as Error).message}`);
      return;
    }
    setBusy(false);
    if (!ok) setError('That code does not match an open tax-free sale. Check the receipt and try again.');
    else {
      setTyped('');
      if (location.hash.includes('join=')) location.hash = '#/traveller';
    }
  }

  // ---------- 1. joining from a shop QR ----------
  if (pending) {
    const shop = shopOf(pending.shopId);
    return (
      <div className="phone-screen phone-screen--paper">
        <div className="brandline">
          <LogoMark />
          <span>Carimbo</span>
        </div>
        <h1 className="headline">Your VAT back before you board.</h1>
        <p className="lede">
          {shop.name} added a tax-free claim to your trip. Keep it here, show it at the airport, get paid in your own currency.
        </p>
        <div className="receipt">
          <div className="receipt__row">
            <strong>{shop.name}</strong>
            <span className="muted">{shop.area}</span>
          </div>
          <div className="receipt__row muted">
            <span>{pending.item}</span>
            <span className="mono">{fmtPlain(pending.paidCents, pending.currency)}</span>
          </div>
          <div className="receipt__tear" aria-hidden="true" />
          <span className="muted">VAT you get back</span>
          <span className="mono receipt__big">{fmt(pending.vatCents, pending.currency)}</span>
        </div>
        <div className="grow" />
        <button type="button" className="btn btn--go btn--big btn--block" disabled={busy} onClick={() => join(pending.code)}>
          <FaceIdIcon />
          {busy ? 'Adding it to your account…' : 'Continue with Face ID'}
        </button>
        <p className="fineprint">No seed phrase, no crypto to buy.</p>
      </div>
    );
  }

  // ---------- 4. refunded ----------
  if (justPaid) {
    const cur = paid[0].currency;
    const total = paid.reduce((n, c) => n + convert(c.vatCents, c.currency, cur), 0);
    const fee = paid.reduce((n, c) => n + convert(c.payout?.feeCents ?? 0, c.currency, cur), 0);
    const country = countryOf(shopOf(paid[0].shopId).country);
    const amount = paid.reduce((n, c) => n + (c.payout?.amountMinor ?? 0), 0);
    const p = paid[0].payout!;
    const at = s.stampedAt ?? p.at;
    const fresh = Date.now() - at < 8000;
    return (
      <div className="phone-screen phone-screen--paper refund" key={at}>
        <Stamp at={at} strike={fresh} text={country.stamp} port={country.airport} />
        <h1 className="headline headline--center">You're paid. Have a good flight.</h1>
        <SplitFlap value={fmt(amount, p.currency)} from={fmt(total, cur)} play delay={fresh ? 620 : 0} label={`Refunded ${fmt(amount, p.currency)}`} />
        <dl className="ledger-list">
          <div>
            <dt>VAT reclaimed</dt>
            <dd className="mono">{fmtPlain(total, cur)}</dd>
          </div>
          <div>
            <dt>Carimbo fee, 0.5%</dt>
            <dd className="mono">{fmtPlain(fee, cur)}</dd>
          </div>
          <div>
            <dt>Converted at</dt>
            <dd className="mono">
              1 {cur} = {p.rate} {p.currency}
            </dd>
          </div>
          <div>
            <dt>Arrived in</dt>
            <dd className="mono">{p.seconds} seconds</dd>
          </div>
        </dl>
        <div className="grow" />
        {cashout ? (
          <div className="cashout" role="region" aria-label="Cash out">
            <strong>Cash out through a Stellar anchor</strong>
            <p className="small muted">
              Your {CURRENCIES[p.currency].name.toLowerCase()} sit in your Stellar account. Anchors such as MoneyGram turn them into a bank transfer or cash in 170+ countries, using the SEP-24 standard.
              This demo runs on Testnet money, so the payout stops here.
            </p>
            <button type="button" className="btn btn--line btn--small" onClick={() => setCashout(false)}>
              Close
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn--go btn--block" onClick={() => setCashout(true)}>
            Send to my bank card
          </button>
        )}
        {p.tx ? (
          <a className="textlink" href={txUrl(p.tx)} target="_blank" rel="noreferrer">
            See the transaction on Stellar
          </a>
        ) : (
          <span className="textlink muted">Demo mode: simulated refund</span>
        )}
        <button type="button" className="textlink linklike" onClick={() => ledger.newTrip()}>
          Start a new trip
        </button>
      </div>
    );
  }

  // ---------- 3. at the airport ----------
  if (screen === 'airport' && open.length > 0) {
    const cur = open[0].currency;
    const total = open.reduce((n, c) => n + convert(c.vatCents, c.currency, cur), 0);
    return (
      <div className="phone-screen phone-screen--night">
        <button type="button" className="back" onClick={() => setScreen('trip')}>
          <span aria-hidden="true">←</span> Your trip
        </button>
        <div className="stack-2">
          <h1 className="title">At the airport</h1>
          <p className="night-muted">Scan once at the e-Tax Free kiosk, before check-in.</p>
        </div>
        <Board
          caption="Your tax-free purchases"
          rows={open.map((c) => ({ key: c.id, name: shopOf(c.shopId).name.toUpperCase(), amount: fmtBare(c.vatCents, c.currency), status: 'READY' }))}
          total={fmt(total, cur)}
        />
        <div className="airport-code">
          <QR value={`carimbo:trip:${t.tripCode}`} size={184} label={`Airport code ${t.tripCode}`} />
          <span className="mono airport-code__text">{t.tripCode}</span>
        </div>
        <div className="grow" />
        <p className="night-muted center">Green at the kiosk means you are paid. There is no second queue.</p>
      </div>
    );
  }

  // ---------- 2. the trip ----------
  if (mine.length > 0 && open.length > 0) {
    const [first, ...rest] = open;
    return (
      <div className="phone-screen phone-screen--paper">
        <div className="screen-head">
          <h1 className="title">Your trip</h1>
          <span className="muted">
            {open.length} {open.length > 1 ? 'claims' : 'claim'}
          </span>
        </div>
        <BoardingPass claim={first} shop={shopOf(first.shopId)} traveller={t} />
        {rest.map((c) => (
          <div className="mini-pass" key={c.id}>
            <div className="stack-0">
              <strong>{shopOf(c.shopId).name}</strong>
              <span className="muted small">
                {c.item}, {fmtPlain(c.paidCents, c.currency)}
              </span>
            </div>
            <span className="mono strong">{fmt(c.vatCents, c.currency)}</span>
          </div>
        ))}
        <CurrencyPicker value={t.currency} />
        <div className="grow" />
        <button type="button" className="btn btn--ink btn--block" onClick={() => setScreen('airport')}>
          Show my airport code
        </button>
      </div>
    );
  }

  // ---------- 0. empty: nothing to claim yet ----------
  return (
    <div className="phone-screen phone-screen--paper">
      <div className="brandline">
        <LogoMark />
        <span>Carimbo</span>
      </div>
      <h1 className="headline">{rejected.length ? 'Customs did not clear this trip.' : 'Shopping abroad?'}</h1>
      <p className="lede">
        {rejected.length
          ? 'The VAT went back to the shops. Ask the customs officer what was missing, or contact the shop.'
          : 'Ask for Carimbo at the till. Scan the code on screen and your VAT is set aside for you until you fly home.'}
      </p>
      <form
        className="stack-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) join(typed);
        }}
      >
        <label className="field">
          <span className="field__label">Or type the code under the QR</span>
          <input className="field__input mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="CRB-XXXX-XXX" autoComplete="off" spellCheck={false} />
        </label>
        {error && <p className="field__hint field__hint--error">{error}</p>}
        <button type="submit" className="btn btn--line btn--block" disabled={!typed.trim() || busy}>
          {busy ? 'Adding…' : 'Add to my trip'}
        </button>
      </form>
      <div className="grow" />
      <p className="fineprint">Works for visitors who live outside the EU.</p>
    </div>
  );
}

function CurrencyPicker({ value }: { value: CurrencyCode }) {
  const options = useMemo(() => PAYOUT_CURRENCIES.map((code) => [code, CURRENCIES[code]] as const), []);
  return (
    <label className="field currency">
      <span className="field__label">Refund me in</span>
      <select className="field__input" value={value} onChange={(e) => ledger.setCurrency(e.target.value as CurrencyCode)}>
        {options.map(([code, c]) => (
          <option key={code} value={code}>
            {c.name} ({code})
          </option>
        ))}
      </select>
    </label>
  );
}
