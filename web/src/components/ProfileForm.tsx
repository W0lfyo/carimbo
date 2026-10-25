import { useState } from 'react';
import type { TaxFreeRules } from '../lib/taxFreeRules';
import { EU27, RESIDENCE_CODES, countryName, countryOf } from '../lib/countries';
import { requiredFields, type TravellerProfile } from '../lib/eligibility';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
};

/**
 * What the traveller declares before a receipt is added: only the fields the rules of the
 * country of purchase need, each with one line on why. Nothing like a passport number.
 */
export function ProfileForm({ rules, initial, onSave, onCancel }: { rules: TaxFreeRules; initial?: TravellerProfile; onSave: (p: TravellerProfile) => void; onCancel?: () => void }) {
  const need = requiredFields(rules);
  const eu = rules.eligibility.residentOutside === 'EU';
  const exitChoices = eu ? [...EU27].sort((a, b) => countryName(a).localeCompare(countryName(b))) : [rules.country];
  const [step, setStep] = useState<1 | 2>(1);
  const [p, setP] = useState<TravellerProfile>(
    initial ?? {
      residenceCountry: '',
      arrivalDate: shift(-3),
      departureDate: shift(2),
      exit: { kind: 'airport', country: rules.country, point: countryOf(rules.country).airport },
      personalUse: true,
    },
  );
  const set = (patch: Partial<TravellerProfile>) => setP((x) => ({ ...x, ...patch }));
  const ageOk = !need.age || p.ageAtLeast !== undefined;
  const step1Ok = !!p.residenceCountry && !!p.arrivalDate && !!p.departureDate && ageOk;

  return (
    <form
      className="profile stack-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 1) setStep(2);
        else onSave(p);
      }}
    >
      <p className="profile__step mono">Step {step} of 2</p>
      {step === 1 ? (
        <>
          <label className="field">
            <span className="field__label">Country where you usually live</span>
            <select className="field__input" required value={p.residenceCountry} onChange={(e) => set({ residenceCountry: e.target.value })}>
              <option value="">Choose a country</option>
              {RESIDENCE_CODES.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </select>
            <span className="field__hint">Your home address counts, not your nationality: tax-free is for people who live outside {eu ? 'the EU' : rules.name}.</span>
          </label>
          <div className="profile__row">
            <label className="field">
              <span className="field__label">Arrived in {eu ? 'the EU' : rules.name}</span>
              <input className="field__input" type="date" required value={p.arrivalDate} onChange={(e) => set({ arrivalDate: e.target.value })} />
            </label>
            <label className="field">
              <span className="field__label">Leaving on</span>
              <input className="field__input" type="date" required value={p.departureDate} onChange={(e) => set({ departureDate: e.target.value })} />
            </label>
          </div>
          <span className="field__hint">
            The goods must leave before the export deadline{need.maxStayMonths ? `, and stays are limited to ${need.maxStayMonths} months` : ''}.
          </span>
          {need.age && (
            <label className="check">
              <input type="checkbox" checked={(p.ageAtLeast ?? 0) >= need.age} onChange={(e) => set({ ageAtLeast: e.target.checked ? need.age! : 0 })} />
              <span>
                <strong>I am at least {need.age} years old</strong>
                <span className="muted small">{rules.name} only refunds visitors aged {need.age} or over.</span>
              </span>
            </label>
          )}
          <button type="submit" className="btn btn--ink btn--block" disabled={!step1Ok}>
            Next
          </button>
        </>
      ) : (
        <>
          <div className="profile__row">
            <label className="field">
              <span className="field__label">You leave by</span>
              <select className="field__input" value={p.exit.kind} onChange={(e) => set({ exit: { ...p.exit, kind: e.target.value as TravellerProfile['exit']['kind'] } })}>
                <option value="airport">Plane</option>
                <option value="port">Boat</option>
                <option value="land">Land border</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">From</span>
              <select className="field__input" value={p.exit.country} onChange={(e) => set({ exit: { ...p.exit, country: e.target.value, point: countryOf(e.target.value).airport } })}>
                {exitChoices.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span className="field__hint">
            {eu ? 'Customs validates the goods at your last exit point from the EU, even if it is another EU country.' : `Customs validates the goods when they leave ${rules.name}.`}
          </span>
          <label className="check">
            <input type="checkbox" checked={p.personalUse} onChange={(e) => set({ personalUse: e.target.checked })} />
            <span>
              <strong>For my personal use, not for business</strong>
              <span className="muted small">Goods bought for a business are not tax-free.</span>
            </span>
          </label>
          {need.cabin && (
            <label className="check">
              <input type="checkbox" checked={p.carriedInCabin === true} onChange={(e) => set({ carriedInCabin: e.target.checked })} />
              <span>
                <strong>I will carry the goods in my cabin bag or wear them</strong>
                <span className="muted small">{rules.name} checks the goods at the gate, so they cannot be in checked luggage.</span>
              </span>
            </label>
          )}
          <div className="profile__row">
            <button type="button" className="btn btn--line" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="submit" className="btn btn--ink">
              Check my refund
            </button>
          </div>
        </>
      )}
      {onCancel && (
        <button type="button" className="textlink linklike" onClick={onCancel}>
          Cancel
        </button>
      )}
      <p className="fineprint">Kept on this phone only. No passport number is asked or stored.</p>
    </form>
  );
}
