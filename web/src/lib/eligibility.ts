/**
 * Eligibility engine. Pure functions: given a country's rules (taxFreeRules.ts), the
 * traveller's declared profile and her purchases, it says whether a tax-free refund is
 * legally possible, why not, what would fix it, and the real export deadline.
 * No legal figure lives here: every number comes from the rules.
 */
import { exportDeadline, type PurchaseCategory, type TaxFreeRules } from './taxFreeRules';
import { EU27, countryName } from './countries';

export interface TravellerProfile {
  residenceCountry: string; // ISO-2 of the usual address (not nationality)
  arrivalDate: string; // YYYY-MM-DD, arrival in the country or zone of purchase
  departureDate: string; // YYYY-MM-DD, planned departure
  ageAtLeast?: number; // asked only when the country sets a minimum age
  exit: { kind: 'airport' | 'port' | 'land'; country: string; point?: string }; // EU: the last EU exit point
  personalUse: boolean; // goods for personal use, not business
  carriedInCabin?: boolean; // asked only when the rules require it (e.g. Australia)
}

export interface PurchaseLine {
  gross: number; // price VAT included, in major units of the rules' currency
  vatRate: number; // %
  category?: PurchaseCategory; // default "goods"
  label?: string;
}

export interface Purchase {
  id: string;
  shopId: string;
  shopName?: string;
  date: Date;
  lines: PurchaseLine[];
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[]; // why not, one sentence each
  deadline: Date | null; // last day to take the goods out
  warnings: string[]; // conditions to respect, eligible or not
  fixes: string[]; // what would make it eligible, when something can
}

// ---------------------------------------------------------------- helpers

const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100) / 100;

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' || currency === 'KRW' ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const dateText = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "2026-10-25" → local midnight of that day. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Is this country inside the zone whose residents cannot claim ("EU" = the 27 member states)? */
export function inZone(country: string, zone: string): boolean {
  return zone === 'EU' ? EU27.includes(country) : country === zone;
}

const zoneName = (zone: string) => (zone === 'EU' ? 'the EU' : countryName(zone));

/** The amount the minimum is measured on: VAT included or excluded, as the rules say. */
export function baseAmount(rules: TaxFreeRules, p: Purchase): number {
  const basis = rules.minimum?.basis ?? 'gross';
  return cents(p.lines.reduce((n, l) => n + (basis === 'net' ? l.gross / (1 + l.vatRate / 100) : l.gross), 0));
}

/** Price VAT included needed to add `missingBase` to the measured amount. */
function grossFor(rules: TaxFreeRules, missingBase: number, rate: number): number {
  return cents(rules.minimum?.basis === 'net' ? missingBase * (1 + rate / 100) : missingBase);
}

const basisText = (rules: TaxFreeRules) => (rules.minimum?.basis === 'net' ? 'VAT excluded' : 'VAT included');

/** What the traveller must declare for this country: the optional fields only appear when the rules need them. */
export function requiredFields(rules: TaxFreeRules) {
  return {
    age: rules.eligibility.minAge ?? null,
    cabin: !!rules.requirements?.carryInCabin,
    maxStayMonths: rules.eligibility.maxStayMonths ?? null,
  };
}

// ---------------------------------------------------------------- the checks

/** Rules about the person, independent of what she bought. */
export function checkTraveller(rules: TaxFreeRules, t: TravellerProfile, today: Date): { reasons: string[]; fixes: string[] } {
  const reasons: string[] = [];
  const fixes: string[] = [];
  const zone = rules.eligibility.residentOutside;
  if (inZone(t.residenceCountry, zone))
    reasons.push(`You live in ${countryName(t.residenceCountry)}: tax-free in ${rules.name} is only for visitors whose usual address is outside ${zoneName(zone)}. Nationality does not count.`);

  const minAge = rules.eligibility.minAge;
  if (minAge && !(typeof t.ageAtLeast === 'number' && t.ageAtLeast >= minAge)) reasons.push(`Tax-free in ${rules.name} is for visitors aged ${minAge} or over.`);

  const arrival = parseDay(t.arrivalDate);
  const departure = parseDay(t.departureDate);
  if (!arrival || !departure) reasons.push('Enter your arrival and departure dates.');
  else {
    if (departure.getTime() < arrival.getTime()) reasons.push('Your departure date is before your arrival date.');
    if (departure.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) reasons.push('Your departure date is in the past.');
    const maxStay = rules.eligibility.maxStayMonths;
    if (maxStay) {
      const limit = new Date(arrival);
      limit.setMonth(limit.getMonth() + maxStay);
      if (departure.getTime() > limit.getTime()) reasons.push(`Tax-free in ${rules.name} is for stays of up to ${maxStay} months. Yours lasts longer.`);
    }
  }

  const exitOk = zone === 'EU' ? EU27.includes(t.exit.country) : t.exit.country === rules.country;
  if (!exitOk)
    reasons.push(
      zone === 'EU'
        ? 'Customs validation happens at your last exit point from the EU: choose the EU country you leave from.'
        : `The goods must leave from ${rules.name}: choose your exit point there.`,
    );

  if (!t.personalUse) reasons.push('Tax-free is only for goods for your personal use, not for business.');
  if (rules.requirements?.carryInCabin && t.carriedInCabin !== true) {
    reasons.push(`In ${rules.name}, refunded goods must be in your cabin baggage or worn when you leave.`);
    fixes.push('Plan to carry the goods in your cabin baggage or wear them.');
  }
  return { reasons, fixes };
}

/** Is the purchase's amount enough, counting the receipts the rules let it add up with? */
export function checkMinimum(rules: TaxFreeRules, p: Purchase, all: Purchase[], departure: Date | null): { ok: boolean; reason?: string; fix?: string } {
  const min = rules.minimum;
  if (!min || min.aggregation.kind === 'none') return { ok: true };
  const cur = rules.currency;
  const rate = p.lines[0]?.vatRate ?? rules.vatRates[0].rate;
  const shop = p.shopName ?? 'the same shop';
  const need = `${money(min.amount, cur)} ${basisText(rules)}`;

  if (min.aggregation.kind === 'perInvoice') {
    const base = baseAmount(rules, p);
    // A single-rate receipt goes through the rules' own helper.
    const ok = p.lines.length === 1 ? meetsMinimumLine(rules, p.lines[0]) : base >= min.amount;
    if (ok) return { ok: true };
    return {
      ok: false,
      reason: `This receipt is ${money(base, cur)} ${basisText(rules)}. ${rules.name} needs ${need} on one receipt.`,
      fix: `Ask the shop to put at least ${money(grossFor(rules, min.amount, rate), cur)} VAT included on a single receipt.`,
    };
  }

  if (min.aggregation.kind === 'perShopPerDay' || min.aggregation.kind === 'maxReceiptsSameDay') {
    const group = all.filter((x) => x.shopId === p.shopId && sameDay(x.date, p.date));
    if (!group.some((x) => x.id === p.id)) group.push(p);
    let counted = group;
    if (min.aggregation.kind === 'maxReceiptsSameDay') {
      counted = [...group].sort((a, b) => baseAmount(rules, b) - baseAmount(rules, a)).slice(0, min.aggregation.max);
      if (!counted.some((x) => x.id === p.id))
        return { ok: false, reason: `Only ${min.aggregation.max} receipts from one shop on one day can be added up in ${rules.name}, and this one is the smallest.` };
    }
    const total = cents(counted.reduce((n, x) => n + baseAmount(rules, x), 0));
    if (total >= min.amount) return { ok: true };
    const canAdd = min.aggregation.kind === 'perShopPerDay' || group.length < min.aggregation.max;
    return {
      ok: false,
      reason: `Your receipts from ${shop} on ${dateText(p.date)} add up to ${money(total, cur)} ${basisText(rules)}. ${rules.name} needs ${need} from one shop on one day.`,
      fix: canAdd ? `Add a receipt from ${shop} the same day for at least ${money(grossFor(rules, cents(min.amount - total), rate), cur)} VAT included to reach ${need}.` : undefined,
    };
  }

  // perBusinessWithinDays: receipts from the same business bought within N days before departure.
  const days = min.aggregation.days;
  const ref = departure ?? p.date;
  const inWindow = (x: Purchase) => x.shopId === p.shopId && ref.getTime() - x.date.getTime() <= days * DAY && x.date.getTime() <= ref.getTime() + DAY;
  const group = all.filter(inWindow);
  if (!group.some((x) => x.id === p.id) && inWindow(p)) group.push(p);
  const total = cents(group.reduce((n, x) => n + baseAmount(rules, x), 0));
  if (inWindow(p) && total >= min.amount) return { ok: true };
  return {
    ok: false,
    reason: inWindow(p)
      ? `Your receipts from ${shop} add up to ${money(total, cur)} ${basisText(rules)}. ${rules.name} needs ${need} from one business within ${days} days of departure.`
      : `This receipt is more than ${days} days before your departure, so it cannot count in ${rules.name}.`,
    fix: inWindow(p) ? `Add a receipt from ${shop} for at least ${money(grossFor(rules, cents(min.amount - total), rate), cur)} VAT included before you leave.` : undefined,
  };
}

function meetsMinimumLine(rules: TaxFreeRules, l: PurchaseLine): boolean {
  // Same arithmetic as meetsMinimum() in taxFreeRules.ts, rounded to cents so 61.50 at 23% is exactly 50.00.
  if (!rules.minimum) return rules.scheme !== 'none';
  const base = rules.minimum.basis === 'net' ? cents(l.gross / (1 + l.vatRate / 100)) : l.gross;
  return base >= rules.minimum.amount;
}

/** One purchase, in the context of the traveller's other purchases. `t` null = the till, before anyone is known. */
export function checkPurchase(rules: TaxFreeRules, t: TravellerProfile | null, p: Purchase, all: Purchase[], today: Date): EligibilityResult {
  const reasons: string[] = [];
  // Exclusions the engine checks by category are reasons, not warnings; the others are conditions to tell people.
  const warnings: string[] = rules.excludedCategories?.length ? [] : [...(rules.excluded ?? [])];
  const fixes: string[] = [];

  if (rules.scheme === 'none' || !rules.refundModel) {
    return {
      eligible: false,
      reasons: [`${rules.name} has no tax-free shopping for visitors since the end of 2020. VAT is only removed when the shop ships the goods abroad itself.`],
      deadline: null,
      warnings: [],
      fixes: ['Ask the shop to ship the goods directly to your home address abroad.'],
    };
  }

  // Exclusions: services, restaurants, tobacco… cannot be refunded.
  const excluded = p.lines.filter((l) => rules.excludedCategories?.includes(l.category ?? 'goods'));
  if (excluded.length) {
    reasons.push(`${excluded.map((l) => l.label ?? CATEGORY_LABEL[l.category ?? 'goods']).join(', ')}: ${excluded.length > 1 ? 'these cannot' : 'this cannot'} be refunded in ${rules.name}.`);
    if (excluded.length < p.lines.length) fixes.push('Ask the shop for a separate receipt with the goods only.');
  }

  if (rules.maximum) {
    const gross = p.lines.reduce((n, l) => n + l.gross, 0);
    if (gross > rules.maximum.amount) warnings.push(rules.maximum.note);
  }

  const departure = t ? parseDay(t.departureDate) : null;
  const min = checkMinimum(rules, p, all, departure);
  if (!min.ok && min.reason) {
    reasons.push(min.reason);
    if (min.fix) fixes.push(min.fix);
  }

  const deadline = exportDeadline(rules, p.date);
  if (deadline && today.getTime() > deadline.getTime()) reasons.push(`The export deadline was ${dateText(deadline)}: it has passed.`);
  if (t) {
    const who = checkTraveller(rules, t, today);
    reasons.push(...who.reasons);
    fixes.push(...who.fixes);
    if (deadline && departure && departure.getTime() > deadline.getTime())
      reasons.push(`You leave on ${dateText(departure)}, after the export deadline of ${dateText(deadline)}. The goods must leave ${rules.scheme === 'EU' ? 'the EU' : rules.name} by then.`);
    if (rules.scheme === 'EU' && t.exit.country && t.exit.country !== rules.country && EU27.includes(t.exit.country))
      warnings.push(`Have your goods validated at your last EU exit point, in ${countryName(t.exit.country)}.`);
  }
  return { eligible: reasons.length === 0, reasons, deadline, warnings, fixes };
}

/** Every purchase must qualify. The deadline returned is the earliest one. */
export function checkEligibility(rules: TaxFreeRules, traveller: TravellerProfile, purchases: Purchase[], today: Date): EligibilityResult {
  const results = purchases.map((p) => ({ p, r: checkPurchase(rules, traveller, p, purchases, today) }));
  const several = purchases.length > 1;
  const tag = (p: Purchase, s: string) => (several ? `${p.shopName ?? p.id}: ${s}` : s);
  const uniq = (xs: string[]) => Array.from(new Set(xs));
  const deadlines = results.map((x) => x.r.deadline).filter((d): d is Date => !!d);
  if (rules.scheme === 'none' || purchases.length === 0) {
    const r = checkPurchase(rules, traveller, purchases[0] ?? { id: '-', shopId: '-', date: today, lines: [] }, purchases, today);
    return { ...r, eligible: rules.scheme !== 'none' && purchases.length > 0 && r.eligible };
  }
  return {
    eligible: results.every((x) => x.r.eligible),
    reasons: uniq(results.flatMap((x) => x.r.reasons.map((s) => tag(x.p, s)))),
    deadline: deadlines.length ? new Date(Math.min(...deadlines.map((d) => d.getTime()))) : null,
    warnings: uniq(results.flatMap((x) => x.r.warnings)),
    fixes: uniq(results.flatMap((x) => x.r.fixes)),
  };
}

/**
 * At the till, before the traveller is known: can this sale be locked? Hard rules block it
 * (no scheme, an excluded category, a per-receipt minimum); minimums that add up across
 * receipts only warn, because the traveller may bring more receipts.
 */
export function checkSale(rules: TaxFreeRules, p: Purchase, today: Date): { ok: boolean; reasons: string[]; warnings: string[] } {
  const r = checkPurchase(rules, null, p, [p], today);
  const agg = rules.minimum?.aggregation.kind;
  const additive = agg === 'perShopPerDay' || agg === 'maxReceiptsSameDay' || agg === 'perBusinessWithinDays';
  if (r.eligible || !additive) return { ok: r.eligible, reasons: r.reasons, warnings: r.warnings };
  const min = checkMinimum(rules, p, [p], null);
  const others = r.reasons.filter((s) => s !== min.reason);
  const warnings = [...r.warnings];
  if (!min.ok) warnings.push(`Below the minimum on its own: it counts only if the traveller’s receipts from this shop add up to ${money(rules.minimum!.amount, rules.currency)} ${basisText(rules)}.`);
  return { ok: others.length === 0, reasons: others, warnings };
}

export const CATEGORY_LABEL: Record<PurchaseCategory, string> = {
  goods: 'Goods',
  services: 'Services',
  hospitality: 'Hotel or restaurant',
  business: 'Goods for business use',
  tobacco: 'Tobacco',
  secondhand: 'Second-hand goods',
  'cosmetic-procedures': 'Cosmetic treatment',
};

/** The minimum in words, from the rules: "€50.00 VAT excluded on one receipt". */
export function minimumText(rules: TaxFreeRules): string {
  const m = rules.minimum;
  if (rules.scheme === 'none') return `No tax-free scheme in ${rules.name}.`;
  if (!m || m.aggregation.kind === 'none') return `No minimum purchase in ${rules.name}.`;
  const a = m.aggregation;
  const how =
    a.kind === 'perInvoice'
      ? 'on one receipt'
      : a.kind === 'perShopPerDay'
        ? 'from one shop on one day (receipts add up)'
        : a.kind === 'maxReceiptsSameDay'
          ? `on up to ${a.max} receipts from one shop on one day`
          : `from one business within ${a.days} days of departure`;
  return `Minimum ${money(m.amount, rules.currency)} ${basisText(rules)} ${how}.`;
}

/** What happens at departure, from refundModel and digitalValidation. */
export function processSteps(rules: TaxFreeRules): string[] {
  const where = rules.scheme === 'EU' ? 'at your last exit point from the EU' : `when you leave ${rules.name}`;
  const kiosk = rules.digitalValidation ? `, via ${rules.digitalValidation}` : '';
  switch (rules.refundModel) {
    case 'validateAtExitThenRefund':
      return [`Customs validates the export ${where}${kiosk}.`, 'The validation releases the VAT held for the traveller.'];
    case 'instantAtStoreWithCheck':
      return ['The VAT is refunded in the shop at the time of purchase.', `Customs checks the goods ${where}${kiosk}; unchecked goods are charged back.`];
    case 'refundAfterDeparture':
      return [`The traveller pays the VAT in the shop; customs confirms the export ${where}${kiosk}.`, 'The refund is paid after departure, once the export is confirmed.'];
    default:
      return [`No tax-free refund in ${rules.name}.`];
  }
}
