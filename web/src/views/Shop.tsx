import { useEffect, useRef, useState } from 'react';
import { ledger, useLedger } from '../lib/ledger';
import { CURRENCIES, MAX_EUR_MINOR, convert, fmt, inputAmount, parseAmount, shortDate, vatFromGross, type Code } from '../lib/money';
import { COUNTRIES, countryOf, detectCountry, ruleText } from '../lib/countries';
import type { Claim, ClaimStatus } from '../lib/types';
import { QR } from '../components/QR';
import { SHORT_WINDOW, clockTime, countdown, useNow } from '../lib/clock';
import { txUrl } from '../lib/stellar';

/** What each demo shop typically sells, to prefill the first line of the till. */
const SAMPLE: Record<string, { item: string; amount: string }> = {
  'loja-azul': { item: 'Leather bag', amount: '400.00' },
  'casa-verde': { item: 'Ceramics set', amount: '200.00' },
  'fio-de-alfama': { item: 'Linen tablecloth', amount: '180.00' },
  'ourivesaria-lume': { item: 'Gold filigree earrings', amount: '650.00' },
  'sapataria-gaivota': { item: 'Leather loafers', amount: '240.00' },
};
const DEMO_WINDOW_MS = 2 * 60_000;

const STATUS: Record<ClaimStatus, { label: string; tone: string }> = {
  locked: { label: 'In escrow', tone: 'waiting' },
  refunded: { label: 'Cleared, traveller paid', tone: 'cleared' },
  rejected: { label: 'Refused, VAT returned', tone: 'closed' },
  reclaimed: { label: 'Expired, VAT returned', tone: 'closed' },
};

interface BasketLine {
  id: number;
  item: string;
  amount: string;
  rate: number;
}

/** The QR carries the claim itself, so a phone that never saw this till can import it and check it on Stellar. */
export function joinUrl(c: Claim): string {
  const q = new URLSearchParams({ join: c.code, s: c.shopId, i: c.item, c: c.currency, p: String(c.paidCents), v: String(c.vatCents), r: String(c.vatRate), d: String(c.deadline), t: String(c.createdAt) });
  if (c.balanceId) q.set('cb', c.balanceId);
  return `${location.origin}${location.pathname}#/traveller?${q.toString()}`;
}

export function ShopView({ initialShop = 'loja-azul', compact = false }: { initialShop?: string; compact?: boolean }) {
  const s = useLedger();
  const [shopId, setShopId] = useState(initialShop);
  const shop = s.shops.find((x) => x.id === shopId)!;
  const country = countryOf(shop.country);
  const cur = country.currency;
  const detected = detectCountry().code;
  const sample = (id: string) => SAMPLE[id] ?? SAMPLE['loja-azul'];
  const [lines, setLines] = useState<BasketLine[]>(() => [{ id: 1, ...sample(initialShop), rate: country.rates[0].rate }]);
  const [shortWindow, setShortWindow] = useState(false);
  const [reclaiming, setReclaiming] = useState<string | null>(null);
  const [reclaimMsg, setReclaimMsg] = useState<{ text: string; tx?: string; error?: boolean } | null>(null);
  const [current, setCurrent] = useState<Claim | null>(null);
  const [locking, setLocking] = useState(false);
  const [failure, setFailure] = useState('');

  // A new country brings its own standard rate, and prices are converted into its currency.
  const prevCur = useRef<Code>(cur);
  useEffect(() => {
    const from = prevCur.current;
    prevCur.current = cur;
    setLines((ls) =>
      ls.map((l) => {
        const minor = parseAmount(l.amount);
        return { ...l, rate: country.rates[0].rate, amount: minor && from !== cur ? inputAmount(convert(minor, from, cur), cur) : l.amount };
      }),
    );
  }, [country.code, country.rates, cur]);

  const parsed = lines.map((l) => {
    const minor = parseAmount(l.amount);
    return { ...l, minor, vat: minor ? vatFromGross(minor, l.rate, cur) : 0, invalid: l.amount.trim() !== '' && minor === null };
  });
  const total = parsed.reduce((n, l) => n + (l.minor ?? 0), 0);
  const vat = parsed.reduce((n, l) => n + l.vat, 0);
  const invalid = parsed.some((l) => l.invalid);
  const incomplete = parsed.some((l) => !l.minor || !l.item.trim());
  const tooSmall = total > 0 && total < country.minPurchase;
  const maxLocal = convert(MAX_EUR_MINOR, 'EUR', cur);
  const tooBig = total > maxLocal;
  const minText = country.minPurchase > 0 ? `Meets the ${fmt(country.minPurchase, cur)} minimum.` : `No minimum purchase in ${country.name}.`;
  const canLock = !invalid && !incomplete && !tooSmall && !tooBig && total > 0;

  const update = (id: number, patch: Partial<BasketLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { id: Math.max(...ls.map((l) => l.id)) + 1, item: '', amount: '', rate: country.rates[0].rate }]);
  const removeLine = (id: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  const sales = s.claims.filter((c) => c.shopId === shopId);
  // Tick every second while a short (demo) export window is running.
  const now = useNow(sales.some((c) => c.status === 'locked' && c.deadline - Date.now() < SHORT_WINDOW && c.deadline > Date.now() - 5000));

  async function takeBack(c: Claim) {
    setReclaiming(c.id);
    setReclaimMsg(null);
    try {
      const tx = await ledger.reclaim(c.id);
      setReclaimMsg({ text: `${fmt(c.vatCents, c.currency)} is back in the shop’s account. Stellar allowed it because the deadline has passed.`, tx });
    } catch (err) {
      setReclaimMsg({ text: `Stellar refused: ${(err as Error).message}`, error: true });
    } finally {
      setReclaiming(null);
    }
  }
  // In the demo stage, sales can be created by the story player: show the newest one.
  const recent = compact ? sales.find((c) => Date.now() - c.createdAt < 10 * 60_000) : undefined;
  const live = current ? s.claims.find((c) => c.id === current.id) : recent;

  return (
    <div className={`desk${compact ? ' desk--compact' : ''}`}>
      {!compact && (
        <nav className="shop-switch" aria-label="Choose the shop">
          <span className="field__label">You are at the till of</span>
          <div className="shop-switch__options">
            {s.shops.map((x) => (
              <button
                key={x.id}
                type="button"
                className="shop-switch__option"
                aria-pressed={x.id === shopId}
                onClick={() => {
                  setShopId(x.id);
                  setCurrent(null);
                  setReclaimMsg(null);
                  setLines([{ id: 1, ...sample(x.id), rate: countryOf(x.country).rates[0].rate }]);
                }}
              >
                {x.name}
              </button>
            ))}
          </div>
        </nav>
      )}

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

      {!compact && (
        <label className="field country">
          <span className="field__label">Shop location sets the VAT rates, minimum and export window</span>
          <select className="field__input" value={shop.country} onChange={(e) => ledger.setShopCountry(shopId, e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}, {c.currency}
                {c.code === detected ? ' (detected on this device)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="desk__grid">
        {compact && live ? (
          <section className="card sale receipt-card" aria-label={`Receipt ${live.code}`}>
            <h2 className="subtitle">Receipt {live.code.slice(-3)}</h2>
            <ul className="receipt-lines">
              {(live.lines ?? [{ item: live.item, paidMinor: live.paidCents, vatRate: live.vatRate, vatMinor: live.vatCents }]).map((l, i) => (
                <li key={i}>
                  <span>{l.item}</span>
                  <span className="muted small">VAT {l.vatRate}%</span>
                  <span className="mono">{fmt(l.paidMinor, live.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="sale__total">
              <span>VAT set aside for the traveller</span>
              <span className="mono sale__vat">{fmt(live.vatCents, live.currency)}</span>
            </div>
          </section>
        ) : (
        <form
          className="card sale"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canLock || locking) return;
            setLocking(true);
            setFailure('');
            ledger
              .createSale(
                shopId,
                parsed.map((l) => ({ item: l.item.trim(), paidMinor: l.minor!, vatRate: l.rate })),
                shortWindow ? DEMO_WINDOW_MS : undefined,
              )
              .then(setCurrent)
              .catch((err: Error) => setFailure(`The escrow did not accept the sale: ${err.message}`))
              .finally(() => setLocking(false));
          }}
        >
          <h2 className="subtitle">New tax-free sale</h2>
          <ul className="basket" aria-label="Items on the receipt">
            {parsed.map((l, i) => (
              <li key={l.id} className="basket__line">
                <label className="field basket__item">
                  <span className="field__label">Item {lines.length > 1 ? i + 1 : ''}</span>
                  <input className="field__input" value={l.item} placeholder="What was sold" onChange={(e) => update(l.id, { item: e.target.value })} />
                </label>
                <label className="field basket__amount">
                  <span className="field__label">Price, VAT incl.</span>
                  <input
                    className="field__input mono"
                    inputMode="decimal"
                    value={l.amount}
                    placeholder="0.00"
                    onChange={(e) => update(l.id, { amount: e.target.value })}
                    aria-invalid={l.invalid}
                  />
                </label>
                <label className="field basket__rate">
                  <span className="field__label">VAT category</span>
                  <select className="field__input" value={l.rate} onChange={(e) => update(l.id, { rate: Number(e.target.value) })}>
                    {country.rates.map((r) => (
                      <option key={r.rate} value={r.rate}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                {lines.length > 1 && (
                  <button type="button" className="basket__remove" onClick={() => removeLine(l.id)} aria-label={`Remove ${l.item || 'this item'}`}>
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--line btn--small basket__add" onClick={addLine}>
            + Add an item
          </button>
          <div className="sale__sum">
            <span className="muted">
              {lines.length} {lines.length > 1 ? 'items' : 'item'}, paid in {CURRENCIES[cur].name}
            </span>
            <span className="mono">{fmt(total, cur)}</span>
          </div>
          <div className="sale__total">
            <span>VAT set aside for the traveller</span>
            <span className="mono sale__vat">{fmt(vat, cur)}</span>
          </div>
          <p id="sale-hint" className={`field__hint${invalid || tooSmall || tooBig ? ' field__hint--error' : ''}`}>
            {invalid
              ? `Type each price in ${CURRENCIES[cur].name} as a positive number, like 400 or 400.50.`
              : tooBig
                ? `A single receipt is capped at ${fmt(maxLocal, cur)}. Split the sale or check the price.`
                : tooSmall
                  ? `Tax-free in ${country.name} needs at least ${fmt(country.minPurchase, cur)} on one receipt.`
                  : `${minText} For visitors living ${country.zone}: ${ruleText(country.exportRule)}.`}
          </p>
          <label className="check">
            <input type="checkbox" checked={shortWindow} onChange={(e) => setShortWindow(e.target.checked)} />
            <span>
              <strong>Demo: 2-minute export window</strong>
              <span className="muted small">Shortens the legal window so you can watch Stellar refuse a late stamp and return the VAT to the shop.</span>
            </span>
          </label>
          <button type="submit" className="btn btn--go btn--block btn--big" disabled={!canLock || locking}>
            {locking ? 'Locking VAT on Stellar…' : 'Lock VAT and show QR'}
          </button>
          {failure && <p className="field__hint field__hint--error">{failure}</p>}
        </form>
        )}

        <section className="card handoff" aria-live="polite">
          {live ? (
            <>
              <h2 className="subtitle">Turn the screen to your customer</h2>
              <div className="handoff__qr">
                <QR value={joinUrl(live)} size={compact ? 168 : 216} label={`QR code for claim ${live.code}`} />
              </div>
              <span className="mono handoff__code">{live.code}</span>
              <p className="muted center">
                {live.travellerId ? 'Added to the traveller’s phone.' : `${fmt(live.vatCents, live.currency)} is in escrow on Stellar, waiting for the traveller to scan.`}
              </p>
              {live.status === 'locked' && live.deadline - now < SHORT_WINDOW && (
                <p className={`window-timer${live.deadline <= now ? ' window-timer--closed' : ''}`} role="timer">
                  {live.deadline > now ? (
                    <>
                      Export window closes in <span className="mono">{countdown(live.deadline - now)}</span>
                    </>
                  ) : (
                    `Export window closed at ${clockTime(live.deadline)}. Only the shop can claim this VAT now.`
                  )}
                </p>
              )}
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
                  const expired = c.status === 'locked' && c.deadline < now;
                  const short = c.status === 'locked' && !expired && c.deadline - now < SHORT_WINDOW;
                  const st = expired ? { label: 'Deadline passed', tone: 'danger' } : short ? { label: `In escrow, ${countdown(c.deadline - now)} left`, tone: 'waiting' } : STATUS[c.status];
                  return (
                    <tr key={c.id}>
                      <td>{shortDate(c.createdAt)}</td>
                      <td>{c.item}</td>
                      <td className="num mono">{fmt(c.vatCents, c.currency)}</td>
                      <td>
                        <span className={`chip chip--${st.tone}`}>
                          <span className="dot" aria-hidden="true" />
                          {st.label}
                        </span>
                      </td>
                      <td className="right">
                        {expired && (
                          <button type="button" className="btn btn--line btn--small" disabled={reclaiming !== null} onClick={() => void takeBack(c)}>
                            {reclaiming === c.id ? 'Claiming on Stellar…' : 'Take VAT back'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {reclaimMsg && (
            <p className={reclaimMsg.error ? 'field__hint field__hint--error' : 'notice'} role="status">
              {reclaimMsg.text}{' '}
              {reclaimMsg.tx && (
                <a href={txUrl(reclaimMsg.tx)} target="_blank" rel="noreferrer">
                  See it on Stellar
                </a>
              )}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
