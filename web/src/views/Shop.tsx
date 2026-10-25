import { useState } from 'react';
import { ledger, useLedger } from '../lib/ledger';
import { MIN_PURCHASE_CENTS, VAT_RATES, eur, parseEuros, shortDate, vatFromGross } from '../lib/money';
import type { Claim, ClaimStatus } from '../lib/types';
import { QR } from '../components/QR';

const STATUS: Record<ClaimStatus, { label: string; tone: string }> = {
  locked: { label: 'In escrow', tone: 'waiting' },
  refunded: { label: 'Cleared, traveller paid', tone: 'cleared' },
  rejected: { label: 'Refused, VAT returned', tone: 'closed' },
  reclaimed: { label: 'Expired, VAT returned', tone: 'closed' },
};

export function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}#/traveller?join=${code}`;
}

export function ShopView({ shopId = 'loja-azul', compact = false }: { shopId?: string; compact?: boolean }) {
  const s = useLedger();
  const shop = s.shops.find((x) => x.id === shopId)!;
  const [amount, setAmount] = useState('400.00');
  const [item, setItem] = useState('Leather bag');
  const [rate, setRate] = useState(23);
  const [current, setCurrent] = useState<Claim | null>(null);

  const cents = parseEuros(amount);
  const vat = cents ? vatFromGross(cents, rate) : 0;
  const tooSmall = cents !== null && cents < MIN_PURCHASE_CENTS;
  const invalid = amount.trim() !== '' && cents === null;
  const canLock = !!cents && !tooSmall && item.trim().length > 0;

  const sales = s.claims.filter((c) => c.shopId === shopId);
  // In the demo stage, sales can be created by the story player: show the newest one.
  const recent = compact ? sales.find((c) => Date.now() - c.createdAt < 10 * 60_000) : undefined;
  const live = current ? s.claims.find((c) => c.id === current.id) : recent;

  return (
    <div className={`desk${compact ? ' desk--compact' : ''}`}>
      {!compact && (
        <header className="desk__head">
          <div className="stack-0">
            <h1 className="title">{shop.name}</h1>
            <span className="muted">{shop.area}</span>
          </div>
          <span className="chip chip--cleared" title={`Identity published at ${shop.domain}/.well-known/stellar.toml`}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Verified shop, {shop.domain}
          </span>
        </header>
      )}

      <div className="desk__grid">
        <form
          className="card sale"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canLock || !cents) return;
            setCurrent(ledger.createSale(shopId, item.trim(), cents, rate));
          }}
        >
          <h2 className="subtitle">New tax-free sale</h2>
          <label className="field">
            <span className="field__label">Paid, VAT included</span>
            <input
              className="field__input field__input--amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={invalid || tooSmall}
              aria-describedby="sale-hint"
            />
          </label>
          <div className="sale__row">
            <label className="field">
              <span className="field__label">Item</span>
              <input className="field__input" value={item} onChange={(e) => setItem(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">VAT rate</span>
              <select className="field__input" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                {VAT_RATES.map((r) => (
                  <option key={r.rate} value={r.rate}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="sale__total">
            <span>VAT set aside for the traveller</span>
            <span className="mono sale__vat">{eur(vat)}</span>
          </div>
          <p id="sale-hint" className={`field__hint${invalid || tooSmall ? ' field__hint--error' : ''}`}>
            {invalid
              ? 'Type an amount like 400 or 400.50.'
              : tooSmall
                ? 'Tax-free needs at least €50.00 spent in your shop today.'
                : 'Above the €50 minimum. The traveller has until the end of the third month to leave the EU.'}
          </p>
          <button type="submit" className="btn btn--go btn--block btn--big" disabled={!canLock}>
            Lock VAT and show QR
          </button>
        </form>

        <section className="card handoff" aria-live="polite">
          {live ? (
            <>
              <h2 className="subtitle">Turn the screen to your customer</h2>
              <div className="handoff__qr">
                <QR value={joinUrl(live.code)} size={compact ? 168 : 216} label={`QR code for claim ${live.code}`} />
              </div>
              <span className="mono handoff__code">{live.code}</span>
              <p className="muted center">
                {live.travellerId ? 'Added to the traveller’s phone.' : `${eur(live.vatCents)} is in escrow on Stellar, waiting for the traveller to scan.`}
              </p>
              {live.travellerId && (
                <button type="button" className="btn btn--line btn--small" onClick={() => setCurrent(null)}>
                  Next sale
                </button>
              )}
            </>
          ) : (
            <div className="handoff__empty">
              <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="16" height="16" rx="3" />
                <rect x="34" y="6" width="16" height="16" rx="3" />
                <rect x="6" y="34" width="16" height="16" rx="3" />
                <path d="M34 34h6v6M50 34v16H40M34 46v4" strokeLinecap="round" />
              </svg>
              <p className="muted center">The customer’s QR appears here once the VAT is locked.</p>
            </div>
          )}
        </section>
      </div>

      {!compact && (
        <section className="card sales" aria-labelledby="sales-title">
          <h2 className="subtitle" id="sales-title">
            Tax-free sales
          </h2>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">
                    VAT
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((c) => {
                  const expired = c.status === 'locked' && c.deadline < Date.now();
                  const st = expired ? { label: 'Deadline passed', tone: 'danger' } : STATUS[c.status];
                  return (
                    <tr key={c.id}>
                      <td>{shortDate(c.createdAt)}</td>
                      <td>{c.item}</td>
                      <td className="num mono">{eur(c.vatCents)}</td>
                      <td>
                        <span className={`chip chip--${st.tone}`}>
                          <span className="dot" aria-hidden="true" />
                          {st.label}
                        </span>
                      </td>
                      <td className="right">
                        {expired && (
                          <button type="button" className="btn btn--line btn--small" onClick={() => ledger.reclaim(c.id)}>
                            Take VAT back
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
