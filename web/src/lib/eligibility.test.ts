import { describe, expect, it } from 'vitest';
import { TAX_FREE_RULES } from './taxFreeRules';
import { checkEligibility, checkMinimum, checkPurchase, checkSale, inZone, requiredFields, type Purchase, type TravellerProfile } from './eligibility';

const TODAY = new Date(2026, 9, 25, 12, 0); // 25 Oct 2026, local
const day = (offset: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return d;
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const visitor = (o: Partial<TravellerProfile> = {}): TravellerProfile => ({
  residenceCountry: 'US',
  arrivalDate: iso(day(-5)),
  departureDate: iso(day(3)),
  exit: { kind: 'airport', country: 'PT' },
  personalUse: true,
  ...o,
});

let n = 0;
const buy = (gross: number, o: Partial<Purchase> & { rate?: number } = {}): Purchase => ({
  id: `p${++n}`,
  shopId: o.shopId ?? 'shop-a',
  shopName: o.shopName ?? 'Shop A',
  date: o.date ?? TODAY,
  lines: o.lines ?? [{ gross, vatRate: o.rate ?? 23 }],
});

const PT = TAX_FREE_RULES.PT;
const FR = TAX_FREE_RULES.FR;
const JP = TAX_FREE_RULES.JP;
const SG = TAX_FREE_RULES.SG;

describe('the five cases from the brief', () => {
  it('Portugal, €55 VAT included → refused (€44.72 VAT excluded < €50)', () => {
    const p = buy(55);
    const r = checkEligibility(PT, visitor(), [p], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/VAT excluded/);
  });

  it('Portugal, €62 VAT included → accepted (€50.41 VAT excluded)', () => {
    const r = checkEligibility(PT, visitor(), [buy(62)], TODAY);
    expect(r.reasons).toEqual([]);
    expect(r.eligible).toBe(true);
    expect(r.deadline?.getMonth()).toBe(0); // end of January 2027
    expect(r.deadline?.getDate()).toBe(31);
  });

  it('a French resident buying in France → refused', () => {
    const r = checkEligibility(FR, visitor({ residenceCountry: 'FR', exit: { kind: 'airport', country: 'FR' } }), [buy(300, { rate: 20 })], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/outside the EU/);
  });

  it('Japan, departure 95 days after the purchase → refused (90-day window)', () => {
    const t = visitor({ residenceCountry: 'US', arrivalDate: iso(day(-1)), departureDate: iso(day(95)), exit: { kind: 'airport', country: 'JP' } });
    const r = checkEligibility(JP, t, [buy(20_000, { rate: 10 })], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/after the export deadline/);
  });

  it('Singapore, a 15-year-old traveller → refused (minimum age 16)', () => {
    const t = visitor({ ageAtLeast: 15, exit: { kind: 'airport', country: 'SG' } });
    const r = checkEligibility(SG, t, [buy(150, { rate: 9 })], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/16 or over/);
  });
});

describe('residence', () => {
  it('"EU" means the 27 member states', () => {
    expect(inZone('DE', 'EU')).toBe(true);
    expect(inZone('CH', 'EU')).toBe(false);
    expect(inZone('NO', 'EU')).toBe(false);
  });
  it('a Swiss resident can claim in Portugal', () => {
    expect(checkEligibility(PT, visitor({ residenceCountry: 'CH' }), [buy(100)], TODAY).eligible).toBe(true);
  });
  it('a Japanese resident cannot claim in Japan', () => {
    const r = checkEligibility(JP, visitor({ residenceCountry: 'JP', exit: { kind: 'airport', country: 'JP' } }), [buy(20_000, { rate: 10 })], TODAY);
    expect(r.eligible).toBe(false);
  });
});

describe('age and length of stay', () => {
  it('Singapore at 16 is fine, and the age is a required field there only', () => {
    expect(checkEligibility(SG, visitor({ ageAtLeast: 16, exit: { kind: 'airport', country: 'SG' } }), [buy(150, { rate: 9 })], TODAY).eligible).toBe(true);
    expect(requiredFields(SG).age).toBe(16);
    expect(requiredFields(PT).age).toBeNull();
  });
  it('Korea refuses stays over 6 months', () => {
    const t = visitor({ arrivalDate: iso(day(-200)), departureDate: iso(day(2)), exit: { kind: 'airport', country: 'KR' } });
    const r = checkEligibility(TAX_FREE_RULES.KR, t, [buy(50_000, { rate: 10 })], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/6 months/);
  });
});

describe('minimum and how receipts add up', () => {
  it('France adds up the same shop on the same day (€100.01 VAT included)', () => {
    const a = buy(60, { rate: 20, shopId: 'f', shopName: 'Boutique' });
    const b = buy(41, { rate: 20, shopId: 'f', shopName: 'Boutique' });
    expect(checkMinimum(FR, a, [a], null).ok).toBe(false);
    expect(checkMinimum(FR, a, [a], null).fix).toMatch(/same day for at least €40\.01/);
    expect(checkMinimum(FR, a, [a, b], null).ok).toBe(true);
  });
  it('France does not add up two different shops, or two days', () => {
    const a = buy(60, { rate: 20, shopId: 'f1' });
    const b = buy(60, { rate: 20, shopId: 'f2' });
    const c = buy(60, { rate: 20, shopId: 'f1', date: day(-1) });
    expect(checkMinimum(FR, a, [a, b, c], null).ok).toBe(false);
  });
  it('Portugal is per receipt: two small receipts do not add up', () => {
    const a = buy(40);
    const b = buy(40);
    expect(checkMinimum(PT, a, [a, b], null).ok).toBe(false);
  });
  it('Singapore adds up at most 3 receipts from one shop on one day', () => {
    const r = [30, 30, 30, 25].map((g) => buy(g, { rate: 9, shopId: 's' }));
    expect(checkMinimum(SG, r[0], r.slice(0, 3), null).ok).toBe(false); // 90 < 100
    const big = [40, 35, 30].map((g) => buy(g, { rate: 9, shopId: 's' }));
    expect(checkMinimum(SG, big[0], big, null).ok).toBe(true); // 105
    const four = [...big, buy(10, { rate: 9, shopId: 's' })];
    expect(checkMinimum(SG, four[3], four, null).ok).toBe(false); // only the 3 largest count
  });
  it('Australia adds up one business within 60 days of departure', () => {
    const departure = day(10);
    const a = buy(200, { rate: 10, shopId: 'au' });
    const b = buy(150, { rate: 10, shopId: 'au', date: day(-20) });
    const old = buy(150, { rate: 10, shopId: 'au', date: day(-80) });
    expect(checkMinimum(TAX_FREE_RULES.AU, a, [a, b], departure).ok).toBe(true);
    expect(checkMinimum(TAX_FREE_RULES.AU, a, [a, old], departure).ok).toBe(false);
  });
  it('Japan measures ¥5,000 VAT excluded', () => {
    expect(checkMinimum(JP, buy(5400, { rate: 10 }), [], null).ok).toBe(false); // ¥4,909 excl.
    expect(checkMinimum(JP, buy(5500, { rate: 10 }), [], null).ok).toBe(true); // ¥5,000 excl.
  });
  it('Spain has no minimum', () => {
    expect(checkMinimum(TAX_FREE_RULES.ES, buy(1, { rate: 21 }), [], null).ok).toBe(true);
  });
});

describe('export deadline', () => {
  it('leaving on the last EU day is fine, one day later is not', () => {
    const ok = visitor({ departureDate: '2027-01-31' });
    const late = visitor({ departureDate: '2027-02-01' });
    expect(checkEligibility(PT, ok, [buy(100)], TODAY).eligible).toBe(true);
    expect(checkEligibility(PT, late, [buy(100)], TODAY).eligible).toBe(false);
  });
  it('a past deadline refuses the purchase', () => {
    const r = checkPurchase(PT, null, buy(100, { date: new Date(2026, 5, 2) }), [], TODAY);
    expect(r.eligible).toBe(false);
  });
});

describe('dates of the stay', () => {
  it('refuses a purchase made before the declared arrival', () => {
    const t = visitor({ arrivalDate: iso(day(3)), departureDate: iso(day(6)) });
    const r = checkEligibility(PT, t, [buy(100)], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/future|before your arrival/);
  });
  it('refuses a purchase dated before arrival even with a past arrival', () => {
    const t = visitor({ arrivalDate: iso(day(-1)) });
    const r = checkEligibility(PT, t, [buy(100, { date: day(-3) })], TODAY);
    expect(r.reasons.join(' ')).toMatch(/before your arrival/);
  });
});

describe('scheme "none"', () => {
  it('the United Kingdom is never eligible, with an explanation', () => {
    const r = checkEligibility(TAX_FREE_RULES.GB, visitor({ exit: { kind: 'airport', country: 'GB' } }), [buy(500, { rate: 20 })], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/no tax-free shopping/);
    expect(r.deadline).toBeNull();
  });
});

describe('exclusions and declarations', () => {
  it('services cannot be refunded in the EU', () => {
    const p = buy(0, { lines: [{ gross: 200, vatRate: 23, category: 'services', label: 'Tailoring' }] });
    const r = checkEligibility(PT, visitor(), [p], TODAY);
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toMatch(/Tailoring/);
  });
  it('tobacco cannot be refunded in Korea', () => {
    const p = buy(0, { lines: [{ gross: 50_000, vatRate: 10, category: 'tobacco' }] });
    expect(checkEligibility(TAX_FREE_RULES.KR, visitor({ exit: { kind: 'airport', country: 'KR' } }), [p], TODAY).eligible).toBe(false);
  });
  it('services are refused outside the EU too (Japan)', () => {
    const p = buy(0, { lines: [{ gross: 20_000, vatRate: 10, category: 'services' }] });
    expect(checkEligibility(JP, visitor({ exit: { kind: 'airport', country: 'JP' } }), [p], TODAY).eligible).toBe(false);
  });
  it('business use is refused', () => {
    expect(checkEligibility(PT, visitor({ personalUse: false }), [buy(100)], TODAY).eligible).toBe(false);
  });
  it('Australia requires the goods in the cabin', () => {
    const t = visitor({ exit: { kind: 'airport', country: 'AU' } });
    const p = buy(400, { rate: 10 });
    expect(checkEligibility(TAX_FREE_RULES.AU, t, [p], TODAY).eligible).toBe(false);
    expect(checkEligibility(TAX_FREE_RULES.AU, { ...t, carriedInCabin: true }, [p], TODAY).eligible).toBe(true);
  });
  it('in the EU the exit point must be in the EU', () => {
    expect(checkEligibility(PT, visitor({ exit: { kind: 'airport', country: 'US' } }), [buy(100)], TODAY).eligible).toBe(false);
    const r = checkEligibility(PT, visitor({ exit: { kind: 'airport', country: 'ES' } }), [buy(100)], TODAY);
    expect(r.eligible).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Spain/);
  });
});

describe('at the till', () => {
  it('blocks a per-receipt minimum, only warns when receipts can add up', () => {
    expect(checkSale(PT, buy(55), TODAY).ok).toBe(false);
    const fr = checkSale(FR, buy(60, { rate: 20 }), TODAY);
    expect(fr.ok).toBe(true);
    expect(fr.warnings.join(' ')).toMatch(/add up/);
  });
  it('blocks the United Kingdom', () => {
    expect(checkSale(TAX_FREE_RULES.GB, buy(500, { rate: 20 }), TODAY).ok).toBe(false);
  });
});
