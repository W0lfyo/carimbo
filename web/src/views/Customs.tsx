import { useState } from 'react';
import { ledger, useLedger } from '../lib/ledger';
import { convert, fmt, fmtPlain, shortDate } from '../lib/money';
import { countryOf } from '../lib/countries';
import { Stamp } from '../components/Stamp';
import { SHORT_WINDOW, clockTime, countdown, useNow } from '../lib/clock';
import { ChainError, txUrl } from '../lib/stellar';

export function CustomsView({ compact = false }: { compact?: boolean }) {
  const s = useLedger();
  const t = s.traveller;
  const [typed, setTyped] = useState('');
  const [opened, setOpened] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [working, setWorking] = useState<'stamp' | 'refuse' | null>(null);
  const [failure, setFailure] = useState<{ text: string; tx?: string } | null>(null);

  async function act(kind: 'stamp' | 'refuse') {
    setWorking(kind);
    setFailure(null);
    try {
      await (kind === 'stamp' ? ledger.clearTrip() : ledger.rejectTrip());
    } catch (err) {
      const e = err as Error;
      const late = (e instanceof ChainError && e.opCodes.includes('op_cannot_claim')) || e.message.includes('op_cannot_claim');
      setFailure({
        text: late
          ? `Stellar refused the signature: the export window closed at ${clockTime(earliest)}. The protocol no longer lets customs claim this VAT. Only the shop can take it back.`
          : `Stellar did not accept the signature: ${e.message}`,
        tx: e instanceof ChainError ? e.hash : undefined,
      });
    } finally {
      setWorking(null);
    }
  }

  const open = s.claims.filter((c) => c.travellerId === t.id && c.status === 'locked');
  // Claims can come from shops in different currencies: the total is shown in the first one's.
  const cur = open[0]?.currency ?? 'EUR';
  const total = open.reduce((n, c) => n + convert(c.vatCents, c.currency, cur), 0);
  const shopOf = (id: string) => s.shops.find((x) => x.id === id)!;
  const lastStamp = s.stampedAt && Date.now() - s.stampedAt < 60_000 && open.length === 0 ? s.stampedAt : undefined;
  const showDossier = open.length > 0 && (opened || compact);
  const earliest = open.length ? Math.min(...open.map((c) => c.deadline)) : 0;
  const now = useNow(open.length > 0 && earliest - Date.now() < SHORT_WINDOW && earliest > Date.now() - 5000);
  const closed = open.length > 0 && earliest <= now;

  const [lookupMsg, setLookupMsg] = useState('');

  function lookUp(e: React.FormEvent) {
    e.preventDefault();
    const q = typed.trim().toUpperCase();
    const claim = s.claims.find((c) => c.code === q);
    const isTrip = q === t.tripCode || (claim?.travellerId === t.id && claim.status === 'locked');
    if (isTrip && open.length > 0) {
      setOpened(true);
      setLookupMsg('');
    } else if (q === t.tripCode) setLookupMsg('This trip has no open claims: everything on it was already handled.');
    else if (!claim) setLookupMsg('No claim or trip matches this code. Check it on the traveller’s screen.');
    else if (claim.status === 'refunded') setLookupMsg(`Already cleared on ${shortDate(claim.payout?.at ?? claim.createdAt)}. Nothing left to stamp.`);
    else if (claim.status === 'rejected') setLookupMsg('This claim was refused earlier and its VAT went back to the shop.');
    else if (claim.status === 'reclaimed') setLookupMsg('The export deadline passed: the shop has taken this VAT back.');
    else setLookupMsg('The traveller has not added this claim to her phone yet.');
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
                <span className="mono">{fmt(total, cur)}</span>
              </button>
            ) : (
              <p className="muted">Nobody is waiting. Travellers appear here when they scan at the e-Tax Free kiosk.</p>
            )}
            <form className="stack-2" onSubmit={lookUp}>
              <label className="field">
                <span className="field__label">Or enter a trip or claim code</span>
                <input
                  className="field__input mono"
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setLookupMsg('');
                  }}
                  placeholder="CRB-XXXX-XXX"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="lookup-msg"
                />
              </label>
              {lookupMsg && (
                <p id="lookup-msg" className="field__hint field__hint--error" role="status">
                  {lookupMsg}
                </p>
              )}
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
                    <strong>Lives {countryOf(s.shops.find((x) => x.id === open[0]?.shopId)?.country ?? 'PT').zone}</strong>
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
                  <span className={closed ? 'checks__ok checks__ok--no' : 'checks__ok'} aria-hidden="true">
                    {closed ? '✕' : '✓'}
                  </span>
                  <span>
                    <strong>{closed ? 'Export window closed' : 'Inside the export window'}</strong>
                    <span className="muted small">
                      {closed
                        ? `Closed at ${clockTime(earliest)}. Stellar will refuse the release.`
                        : earliest - now < SHORT_WINDOW
                          ? `Closes in ${countdown(earliest - now)}, at ${clockTime(earliest)}`
                          : `Earliest deadline ${shortDate(earliest)}`}
                    </span>
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
                        <td className="num mono">{fmtPlain(c.paidCents, c.currency)}</td>
                        <td className="num mono">{fmt(c.vatCents, c.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {inspect && <p className="notice">Ask to see the items. Stamp once they match the receipts, or refuse.</p>}
              <div className="dossier__actions">
                <button type="button" className="btn btn--ink btn--big stamp-btn" disabled={working !== null} onClick={() => act('stamp')}>
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3h6l-1 7h3a2 2 0 0 1 2 2v3H5v-3a2 2 0 0 1 2-2h3L9 3zM4 19h16" />
                  </svg>
                  {working === 'stamp' ? 'Signing on Stellar…' : `Stamp and release ${fmt(total, cur)}`}
                </button>
                {!compact && (
                  <>
                    <button type="button" className="btn btn--line" onClick={() => setInspect(true)}>
                      Inspect goods
                    </button>
                    <button type="button" className="btn btn--danger" disabled={working !== null} onClick={() => act('refuse')}>
                      Refuse
                    </button>
                  </>
                )}
              </div>
              {failure && (
                <p className="field__hint field__hint--error" role="alert">
                  {failure.text}{' '}
                  {failure.tx && (
                    <a href={txUrl(failure.tx)} target="_blank" rel="noreferrer">
                      See the refused transaction
                    </a>
                  )}
                </p>
              )}
              <p className="muted small">Your signature releases the escrow on Stellar. The traveller is paid in her currency within seconds.</p>
            </>
          ) : lastStamp ? (
            <div className="cleared">
              <Stamp at={lastStamp} size={compact ? 132 : 168} text={countryOf(s.shops.find((x) => x.id === s.claims.find((c) => c.travellerId === t.id && c.status === 'refunded')?.shopId)?.country ?? 'PT').stamp} port={countryOf(s.shops.find((x) => x.id === s.claims.find((c) => c.travellerId === t.id && c.status === 'refunded')?.shopId)?.country ?? 'PT').airport} />
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
