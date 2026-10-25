// Carimbo — tax-free rules by country. The single source of the legal rules in the app.
// Researched on 25/10/2026. `verified: false` = figure found in a single secondary or old
// source: to confirm with the tax authority before production.

export type PurchaseCategory = "goods" | "services" | "hospitality" | "business" | "tobacco" | "secondhand" | "cosmetic-procedures";

export type MinimumBasis = "gross" | "net"; // threshold on the price VAT included (gross) or excluded (net)
export type Aggregation =
  | { kind: "perInvoice" }                         // each receipt must reach the threshold on its own
  | { kind: "perShopPerDay" }                      // same shop, same day, receipts add up
  | { kind: "maxReceiptsSameDay"; max: number }    // e.g. Singapore: up to 3 receipts
  | { kind: "perBusinessWithinDays"; days: number } // e.g. Australia: same business within 60 days
  | { kind: "none" };                              // no minimum

export type ExportDeadline =
  | { kind: "endOfNthMonthAfterPurchase"; months: number } // EU rule
  | { kind: "days"; days: number }
  | { kind: "months"; months: number };

export type RefundModel =
  | "validateAtExitThenRefund" // customs stamp or kiosk at departure, then refund
  | "instantAtStoreWithCheck"  // refunded in the shop, checked at departure
  | "refundAfterDeparture";    // Japan from 1 Nov 2026

export interface TaxFreeRules {
  country: string;            // ISO 3166-1 alpha-2
  name: string;
  currency: string;           // ISO 4217
  scheme: "EU" | "national" | "none";
  vatRates: { label: string; rate: number }[]; // rate in %, the first one is the standard rate
  minimum: { amount: number; basis: MinimumBasis; aggregation: Aggregation } | null;
  maximum?: { amount: number; note: string };
  exportDeadline: ExportDeadline | null;
  eligibility: {
    residentOutside: string;  // "EU", "CH", "JP"…
    minAge?: number;
    maxStayMonths?: number;
  };
  refundModel: RefundModel | null;
  digitalValidation?: string; // national electronic export validation
  excluded?: string[]; // conditions and exclusions, shown to people
  excludedCategories?: PurchaseCategory[]; // what cannot be refunded, checked by the engine
  requirements?: { carryInCabin?: boolean }; // e.g. Australia: goods in cabin baggage or worn
  verified: boolean;
  sources: string[];
}

const EU_DEADLINE: ExportDeadline = { kind: "endOfNthMonthAfterPurchase", months: 3 };
const EU_EXCLUDED = ["Services", "Hotels and restaurants", "Goods for business use"];
const EU_EXCLUDED_CATEGORIES: PurchaseCategory[] = ["services", "hospitality", "business"];

export const TAX_FREE_RULES: Record<string, TaxFreeRules> = {
  PT: {
    country: "PT", name: "Portugal", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 23 }, { label: "Intermediate", rate: 13 }, { label: "Reduced", rate: 6 }],
    // €50 VAT EXCLUDED per receipt
    minimum: { amount: 50, basis: "net", aggregation: { kind: "perInvoice" } },
    exportDeadline: EU_DEADLINE,
    eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund",
    digitalValidation: "e-Taxfree Portugal (kiosks at the airport)",
    excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: true,
    sources: ["https://info.portaldasfinancas.gov.pt/pt/docs/Conteudos_1pagina/E_Taxfree_Portugal_Information/Documents/e_Taxfree_Ingles.pdf"],
  },
  ES: {
    country: "ES", name: "Spain", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 21 }, { label: "Reduced", rate: 10 }, { label: "Super-reduced", rate: 4 }],
    minimum: null, // no legal minimum
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", digitalValidation: "DIVA",
    excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: true,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country", "https://goodvat.com/guides/eu-vat/vat-refund-guide/"],
  },
  FR: {
    country: "FR", name: "France", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 20 }, { label: "Intermediate", rate: 10 }, { label: "Reduced", rate: 5.5 }, { label: "Special", rate: 2.1 }],
    minimum: { amount: 100.01, basis: "gross", aggregation: { kind: "perShopPerDay" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", digitalValidation: "PABLO",
    excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: true,
    sources: ["https://goodvat.com/guides/eu-vat/vat-refund-guide/", "https://zapptax.com/en/blog/minimum-purchases-tax-refund"],
  },
  IT: {
    country: "IT", name: "Italy", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 22 }, { label: "Reduced", rate: 10 }, { label: "Reduced", rate: 5 }, { label: "Super-reduced", rate: 4 }],
    minimum: { amount: 70.01, basis: "gross", aggregation: { kind: "perInvoice" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", digitalValidation: "OTELLO",
    excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: true,
    sources: ["https://www.mightytravels.com/2026/10/eu-vat-refund-2026-france-germany-italy-minimums-vs-airport-duty-free/"],
  },
  DE: {
    country: "DE", name: "Germany", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 19 }, { label: "Reduced", rate: 7 }],
    minimum: { amount: 50.01, basis: "gross", aggregation: { kind: "perInvoice" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: true,
    sources: ["https://www.mightytravels.com/2026/10/eu-vat-refund-2026-france-germany-italy-minimums-vs-airport-duty-free/"],
  },
  NL: {
    country: "NL", name: "Netherlands", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 21 }, { label: "Reduced", rate: 9 }],
    minimum: { amount: 50, basis: "gross", aggregation: { kind: "perShopPerDay" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country"],
  },
  BE: {
    country: "BE", name: "Belgium", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 21 }, { label: "Intermediate", rate: 12 }, { label: "Reduced", rate: 6 }],
    minimum: { amount: 125.01, basis: "gross", aggregation: { kind: "perShopPerDay" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: true,
    sources: ["https://zapptax.com/en/blog/minimum-purchases-tax-refund"],
  },
  AT: {
    country: "AT", name: "Austria", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 20 }, { label: "Intermediate", rate: 13 }, { label: "Reduced", rate: 10 }],
    minimum: { amount: 75.01, basis: "gross", aggregation: { kind: "perInvoice" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country"],
  },
  IE: {
    country: "IE", name: "Ireland", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 23 }, { label: "Reduced", rate: 13.5 }, { label: "Second reduced", rate: 9 }],
    minimum: null, // no legal minimum; operators may set one (sources disagree: 0 / €30)
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country", "https://en.wikipedia.org/wiki/Tax-free_shopping"],
  },
  GR: {
    country: "GR", name: "Greece", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 24 }, { label: "Reduced", rate: 13 }, { label: "Super-reduced", rate: 6 }],
    minimum: { amount: 50, basis: "gross", aggregation: { kind: "perInvoice" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country"],
  },
  FI: {
    country: "FI", name: "Finland", currency: "EUR", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 25.5 }], // reduced rates changed in 2025-26: to check
    minimum: { amount: 40, basis: "gross", aggregation: { kind: "perInvoice" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country"],
  },
  SE: {
    country: "SE", name: "Sweden", currency: "SEK", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 25 }, { label: "Reduced", rate: 12 }, { label: "Reduced", rate: 6 }],
    minimum: { amount: 200, basis: "gross", aggregation: { kind: "perInvoice" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country"],
  },
  DK: {
    country: "DK", name: "Denmark", currency: "DKK", scheme: "EU",
    vatRates: [{ label: "Standard", rate: 25 }],
    minimum: { amount: 300, basis: "gross", aggregation: { kind: "perShopPerDay" } },
    exportDeadline: EU_DEADLINE, eligibility: { residentOutside: "EU" },
    refundModel: "validateAtExitThenRefund", excluded: EU_EXCLUDED, excludedCategories: EU_EXCLUDED_CATEGORIES, verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country"],
  },
  CH: {
    country: "CH", name: "Switzerland", currency: "CHF", scheme: "national",
    vatRates: [{ label: "Standard", rate: 8.1 }, { label: "Accommodation", rate: 3.8 }, { label: "Reduced", rate: 2.6 }],
    minimum: { amount: 300, basis: "gross", aggregation: { kind: "perShopPerDay" } },
    exportDeadline: { kind: "days", days: 30 },
    eligibility: { residentOutside: "CH" },
    refundModel: "validateAtExitThenRefund", verified: false,
    sources: ["https://www.withprive.com/en/blog/vat-refund-rates-by-country"],
  },
  NO: {
    country: "NO", name: "Norway", currency: "NOK", scheme: "national",
    vatRates: [{ label: "Standard", rate: 25 }, { label: "Food", rate: 15 }, { label: "Reduced", rate: 12 }],
    minimum: { amount: 315, basis: "gross", aggregation: { kind: "perInvoice" } },
    exportDeadline: { kind: "months", months: 1 },
    eligibility: { residentOutside: "NO" },
    refundModel: "validateAtExitThenRefund", verified: false,
    sources: ["https://en.wikipedia.org/wiki/Tax-free_shopping"],
  },
  GB: {
    country: "GB", name: "United Kingdom", currency: "GBP", scheme: "none",
    vatRates: [{ label: "Standard", rate: 20 }],
    minimum: null, exportDeadline: null,
    eligibility: { residentOutside: "GB" },
    refundModel: null, // tourist tax-free ended at the end of 2020: only goods shipped abroad by the seller
    verified: true,
    sources: ["https://en.wikipedia.org/wiki/Tax-free_shopping"],
  },
  JP: {
    country: "JP", name: "Japan", currency: "JPY", scheme: "national",
    vatRates: [{ label: "Standard", rate: 10 }, { label: "Reduced (food)", rate: 8 }],
    // ¥5,000 VAT EXCLUDED, same shop, same day
    minimum: { amount: 5000, basis: "net", aggregation: { kind: "perShopPerDay" } },
    exportDeadline: { kind: "days", days: 90 }, // from 1 Nov 2026
    eligibility: { residentOutside: "JP" },
    refundModel: "refundAfterDeparture", // new model from 1 Nov 2026; before: exempt at the till
    digitalValidation: "Customs kiosks / Visit Japan Web",
    excluded: ["If one item of a receipt is missing at departure, the whole receipt is refused"],
    verified: true,
    sources: ["https://www.japan-guide.com/news/tax-free-shopping.html"],
  },
  KR: {
    country: "KR", name: "South Korea", currency: "KRW", scheme: "national",
    vatRates: [{ label: "Standard", rate: 10 }],
    minimum: { amount: 15000, basis: "gross", aggregation: { kind: "perInvoice" } },
    maximum: { amount: 1_000_000, note: "Refund in the shop: up to ₩1M per receipt and ₩5M per stay" },
    exportDeadline: { kind: "months", months: 3 },
    eligibility: { residentOutside: "KR", maxStayMonths: 6 },
    refundModel: "instantAtStoreWithCheck",
    excluded: ["Tobacco", "Second-hand goods", "Cosmetic surgery and treatments (since 01/2026)"],
    excludedCategories: ["tobacco", "secondhand", "cosmetic-procedures"],
    verified: false,
    sources: ["https://www.trip.com/guide/info/korea-tax-refund.html"],
  },
  SG: {
    country: "SG", name: "Singapore", currency: "SGD", scheme: "national",
    vatRates: [{ label: "GST", rate: 9 }],
    minimum: { amount: 100, basis: "gross", aggregation: { kind: "maxReceiptsSameDay", max: 3 } },
    exportDeadline: { kind: "months", months: 2 }, // to check
    eligibility: { residentOutside: "SG", minAge: 16 },
    refundModel: "validateAtExitThenRefund", digitalValidation: "eTRS (kiosks at Changi)",
    verified: true,
    sources: ["https://www.customs.gov.sg/at-customs/departing-singapore/tourist-refund-scheme/"],
  },
  TH: {
    country: "TH", name: "Thailand", currency: "THB", scheme: "national",
    vatRates: [{ label: "Standard", rate: 7 }],
    minimum: { amount: 2000, basis: "gross", aggregation: { kind: "perShopPerDay" } },
    exportDeadline: { kind: "days", days: 60 },
    eligibility: { residentOutside: "TH" },
    refundModel: "validateAtExitThenRefund",
    excluded: ["Jewellery, gold, watches, glasses and pens: extra check after immigration"],
    verified: true,
    sources: ["https://vrtmap.rd.go.th/gps/en/Conditions.aspx"],
  },
  AU: {
    country: "AU", name: "Australia", currency: "AUD", scheme: "national",
    vatRates: [{ label: "GST", rate: 10 }],
    minimum: { amount: 300, basis: "gross", aggregation: { kind: "perBusinessWithinDays", days: 60 } },
    exportDeadline: { kind: "days", days: 60 },
    eligibility: { residentOutside: "AU" },
    refundModel: "validateAtExitThenRefund",
    excluded: ["Goods must be in cabin baggage or worn"],
    requirements: { carryInCabin: true },
    verified: true,
    sources: ["https://en.wikipedia.org/wiki/Tax-free_shopping"],
  },
  TR: {
    country: "TR", name: "Turkey", currency: "TRY", scheme: "national",
    vatRates: [{ label: "Standard", rate: 20 }, { label: "Reduced", rate: 10 }, { label: "Reduced", rate: 1 }],
    minimum: { amount: 1000, basis: "net", aggregation: { kind: "perInvoice" } }, // often raised with inflation
    exportDeadline: { kind: "months", months: 3 },
    eligibility: { residentOutside: "TR" },
    refundModel: "validateAtExitThenRefund", verified: false,
    sources: ["https://www.wise.com/gb/blog/vat-refund-turkey"],
  },
};

// ---- Helpers ----

/** VAT contained in a price VAT included */
export const vatFromGross = (gross: number, rate: number) => gross - gross / (1 + rate / 100);

/** Does one amount reach the minimum? (VAT included or excluded) */
export function meetsMinimum(rules: TaxFreeRules, gross: number, rate: number): boolean {
  if (!rules.minimum) return rules.scheme !== "none";
  const base = rules.minimum.basis === "net" ? gross / (1 + rate / 100) : gross;
  return base >= rules.minimum.amount;
}

/** Last day to take the goods out of the territory */
export function exportDeadline(rules: TaxFreeRules, purchase: Date): Date | null {
  const d = rules.exportDeadline;
  if (!d) return null;
  const out = new Date(purchase);
  if (d.kind === "days") out.setDate(out.getDate() + d.days);
  if (d.kind === "months") out.setMonth(out.getMonth() + d.months);
  if (d.kind === "endOfNthMonthAfterPurchase") {
    out.setDate(1);
    out.setMonth(out.getMonth() + d.months + 1);
    out.setDate(0); // last day of the Nth following month
  }
  out.setHours(23, 59, 59, 0); // the whole last day counts
  return out;
}
