import type { Claim, Shop, Traveller } from '../lib/types';
import { CURRENCIES, fmt, fmtPlain, shortDate } from '../lib/money';

export function JourneyRail({ step }: { step: 0 | 1 | 2 }) {
  const steps = ['Bought', 'Customs', 'Paid'];
  return (
    <ol className="rail" aria-label="Refund progress">
      {steps.map((s, i) => (
        <li key={s} className={`rail__step${i <= step ? ' rail__step--done' : ''}${i === step ? ' rail__step--now' : ''}`} aria-current={i === step ? 'step' : undefined}>
          <span className="rail__node" aria-hidden="true" />
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

interface Props {
  claim: Claim;
  shop: Shop;
  traveller: Traveller;
}

/** A VAT claim drawn as a boarding pass: route on top, details, perforation, then the stub with the amount. */
export function BoardingPass({ claim, shop, traveller }: Props) {
  const step = claim.status === 'refunded' ? 2 : 0;
  return (
    <article className="pass" aria-label={`VAT claim from ${shop.name}`}>
      <header className="pass__route">
        <div className="pass__port">
          <span className="pass__iata mono">{traveller.from}</span>
          <span className="pass__city">Lisbon</span>
        </div>
        <svg className="pass__arc" viewBox="0 0 80 20" aria-hidden="true">
          <path d="M2 14 Q40 -4 72 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 4" />
          <path d="M66 9l7 5-8 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        <div className="pass__port pass__port--end">
          <span className="pass__iata mono">{traveller.to}</span>
          <span className="pass__city">{traveller.toCity}</span>
        </div>
      </header>
      <dl className="pass__grid">
        <div>
          <dt>Shop</dt>
          <dd>{shop.name}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd className="mono">{fmtPlain(claim.paidCents, claim.currency)}</dd>
        </div>
        <div>
          <dt>Export by</dt>
          <dd>{shortDate(claim.deadline)}</dd>
        </div>
        <div>
          <dt>Refund in</dt>
          <dd>{CURRENCIES[traveller.currency].name}</dd>
        </div>
      </dl>
      <div className="pass__tear" aria-hidden="true" />
      <footer className="pass__stub">
        <div className="pass__amount">
          <span className="muted">{claim.status === 'refunded' ? 'VAT refunded' : 'VAT locked for you'}</span>
          <span className="mono pass__vat">{fmt(claim.vatCents, claim.currency)}</span>
        </div>
        <JourneyRail step={step} />
      </footer>
    </article>
  );
}
