import { useState } from 'react';
import { ledger, useLedger } from '../lib/ledger';
import { eur, eurPlain, shortDate } from '../lib/money';
import { Stamp } from '../components/Stamp';

export function CustomsView({ compact = false }: { compact?: boolean }) {
  const s = useLedger();
  const t = s.traveller;
  const [typed, setTyped] = useState('');
  const [opened, setOpened] = useState(false);
  const [inspect, setInspect] = useState(false);

  const open = s.claims.filter((c) => c.travellerId === t.id && c.status === 'locked');
  const total = open.reduce((n, c) => n + c.vatCents, 0);
  const shopOf = (id: string) => s.shops.find((x) => x.id === id)!;
  const lastStamp = s.stampedAt && Date.now() - s.stampedAt < 60_000 && open.length === 0 ? s.stampedAt : undefined;
  const showDossier = open.length > 0 && (opened || compact);

  function lookUp(e: React.FormEvent) {
    e.preventDefault();
    if (typed.trim().toUpperCase() === t.tripCode) setOpened(true);
  }

  return (
    <div className={`desk desk--customs${compact ? ' desk--compact' : ''}`}>
      {!compact && (
        <header className="desk__head">
          <div className="stack-0">
            <h1 className="title">Customs desk</h1>
            <span className="muted">Lisbon Airport, Terminal 1</span>
          </div>
          <span className="chip">Officer 0482</span>
        </header>
      )}

      <div className="customs">
        {!compact && (
          <aside className="card kiosk">
            <h2 className="subtitle">At the kiosk</h2>
            {open.length > 0 ? (
              <button type="button" className={`queue-item${opened ? ' queue-item--active' : ''}`} onClick={() => setOpened(true)}>
                <span className="stack-0">
                  <strong>{t.name}</strong>
                  <span className="muted small">
                    {t.flight} to {t.toCity}, {t.departs.toLowerCase()}
                  </span>
                </span>
                <span className="mono">{eur(total)}</span>
              </button>
            ) : (
              <p className="muted">Nobody is waiting. Travellers appear here when they scan at the e-Tax Free kiosk.</p>
            )}
            <form className="stack-2" onSubmit={lookUp}>
              <label className="field">
                <span className="field__label">Or enter an airport code</span>
                <input className="field__input mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="CRB-XXXX-XXX" autoComplete="off" spellCheck={false} />
              </label>
              <button className="btn btn--line btn--small" type="submit" disabled={!typed.trim()}>
                Open claim
              </button>
            </form>
          </aside>
        )}

        <section className="card dossier" aria-live="polite">
          {showDossier ? (
            <>
              <div className="dossier__head">
                <div className="stack-0">
                  <h2 className="subtitle">{t.name}</h2>
                  <span className="mono muted small">{t.tripCode}</span>
                </div>
                <span className="chip chip--waiting">
                  <span className="dot" aria-hidden="true" />
                  Waiting for export check
                </span>
              </div>
              <ul className="checks">
                <li>
                  <span className="checks__ok" aria-hidden="true">✓</span>
                  <span>
                    <strong>Lives outside the EU</strong>
                    <span className="muted small">Proof from her passport chip. No passport data stored.</span>
                  </span>
                </li>
                <li>
                  <span className="checks__ok" aria-hidden="true">✓</span>
                  <span>
                    <strong>
                      {t.flight}, {t.from} to {t.to}
                    </strong>
                    <span className="muted small">{t.departs}</span>
                  </span>
                </li>
                <li>
                  <span className="checks__ok" aria-hidden="true">✓</span>
                  <span>
                    <strong>Inside the export window</strong>
                    <span className="muted small">Earliest deadline {shortDate(Math.min(...open.map((c) => c.deadline)))}</span>
                  </span>
                </li>
              </ul>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Shop</th>
                      <th scope="col">Item</th>
                      <th scope="col" className="num">
                        Paid
                      </th>
                      <th scope="col" className="num">
                        VAT
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((c) => (
                      <tr key={c.id}>
                        <td>{shopOf(c.shopId).name}</td>
                        <td>{c.item}</td>
                        <td className="num mono">{eurPlain(c.paidCents)}</td>
                        <td className="num mono">{eur(c.vatCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {inspect && <p className="notice">Ask to see the items. Stamp once they match the receipts, or refuse.</p>}
              <div className="dossier__actions">
                <button type="button" className="btn btn--ink btn--big stamp-btn" onClick={() => ledger.clearTrip()}>
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3h6l-1 7h3a2 2 0 0 1 2 2v3H5v-3a2 2 0 0 1 2-2h3L9 3zM4 19h16" />
                  </svg>
                  Stamp and release {eur(total)}
                </button>
                {!compact && (
                  <>
                    <button type="button" className="btn btn--line" onClick={() => setInspect(true)}>
                      Inspect goods
                    </button>
                    <button type="button" className="btn btn--danger" onClick={() => ledger.rejectTrip()}>
                      Refuse
                    </button>
                  </>
                )}
              </div>
              <p className="muted small">Your signature releases the escrow on Stellar. The traveller is paid in her currency within seconds.</p>
            </>
          ) : lastStamp ? (
            <div className="cleared">
              <Stamp at={lastStamp} size={compact ? 132 : 168} />
              <p className="subtitle center">Cleared. {t.name} has been paid.</p>
            </div>
          ) : (
            <div className="handoff__empty">
              <p className="muted center">{open.length > 0 ? 'Select the traveller to open the claim.' : 'No claim open.'}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
