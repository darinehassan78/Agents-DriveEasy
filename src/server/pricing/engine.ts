// Pure pricing functions (no database access). All money is integer fils.
// Rules (docs/TEAM.md):
// - days = ceil(duration / 24h), minimum 1
// - daily rate from the best matching pricing rule
// - extras per day (optionally capped per unit) or per rental
// - one-way fee when return branch differs from pick-up branch
// - VAT (default 5%) on rental + extras + fees; the deposit is not taxed
// - late return: each started hour past a 59-minute grace period at 1/24 of the
//   daily rate, capped at one daily rate per 24h of lateness

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const LATE_GRACE_MS = 59 * 60 * 1000;
export const DEFAULT_VAT_BPS = 500;

/** Rental days: ceil(duration / 24h), at least 1. Throws if return is not after pick-up. */
export function rentalDays(pickupAt: Date, returnAt: Date): number {
  const ms = returnAt.getTime() - pickupAt.getTime();
  if (!(ms > 0)) throw new RangeError("Return time must be after pick-up time");
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/** VAT on an amount, rounded half-up to the nearest fil. */
export function vatOn(amountFils: number, vatBps = DEFAULT_VAT_BPS): number {
  assertFils(amountFils);
  return Math.floor((amountFils * vatBps + 5000) / 10000);
}

export interface PricingRuleInput {
  id: string;
  categoryId: string;
  vehicleId: string | null;
  branchId: string | null;
  dailyRateFils: number;
  minDays: number;
  validFrom: string | null; // YYYY-MM-DD inclusive
  validTo: string | null; // YYYY-MM-DD inclusive
  priority: number;
  isActive: boolean;
}

export interface RuleContext {
  categoryId: string;
  vehicleId: string;
  branchId: string;
  /** Pick-up date in the branch's local time zone, YYYY-MM-DD. */
  pickupDate: string;
  days: number;
}

/** Picks the applicable daily-rate rule, or null if none matches. */
export function selectPricingRule<R extends PricingRuleInput>(rules: R[], ctx: RuleContext): R | null {
  const matches = rules.filter(
    (r) =>
      r.isActive &&
      r.categoryId === ctx.categoryId &&
      (r.vehicleId === null || r.vehicleId === ctx.vehicleId) &&
      (r.branchId === null || r.branchId === ctx.branchId) &&
      (r.validFrom === null || r.validFrom <= ctx.pickupDate) &&
      (r.validTo === null || ctx.pickupDate <= r.validTo) &&
      r.minDays <= ctx.days,
  );
  matches.sort(
    (a, b) =>
      b.priority - a.priority ||
      Number(b.vehicleId !== null) - Number(a.vehicleId !== null) ||
      Number(b.branchId !== null) - Number(a.branchId !== null) ||
      b.minDays - a.minDays ||
      a.dailyRateFils - b.dailyRateFils ||
      a.id.localeCompare(b.id),
  );
  return matches[0] ?? null;
}

export interface ExtraInput {
  id: string;
  code: string;
  name: string;
  pricing: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxQuantity: number;
  maxChargeFils: number | null;
}

export interface ExtraLine {
  extraId: string;
  code: string;
  name: string;
  pricing: "PER_DAY" | "PER_RENTAL";
  quantity: number;
  unitPriceFils: number;
  totalFils: number;
}

export function priceExtra(extra: ExtraInput, quantity: number, days: number): ExtraLine {
  if (!Number.isInteger(quantity) || quantity < 1) throw new RangeError(`Invalid quantity for ${extra.code}`);
  if (quantity > extra.maxQuantity) throw new RangeError(`At most ${extra.maxQuantity} × ${extra.name}`);
  let perUnit = extra.pricing === "PER_DAY" ? extra.priceFils * days : extra.priceFils;
  if (extra.pricing === "PER_DAY" && extra.maxChargeFils !== null) perUnit = Math.min(perUnit, extra.maxChargeFils);
  return {
    extraId: extra.id,
    code: extra.code,
    name: extra.name,
    pricing: extra.pricing,
    quantity,
    unitPriceFils: extra.priceFils,
    totalFils: perUnit * quantity,
  };
}

export interface QuoteInput {
  pickupAt: Date;
  returnAt: Date;
  dailyRateFils: number;
  extras: { extra: ExtraInput; quantity: number }[];
  oneWay: boolean;
  oneWayFeeFils: number;
  depositFils: number;
  vatBps?: number;
}

export interface PriceBreakdown {
  currency: "AED";
  days: number;
  dailyRateFils: number;
  rentalFils: number;
  extras: ExtraLine[];
  extrasFils: number;
  oneWayFeeFils: number;
  subtotalFils: number;
  vatRateBps: number;
  vatFils: number;
  totalFils: number;
  /** Refundable security deposit, held on the card (not charged, not taxed). */
  depositFils: number;
}

export function computeQuote(input: QuoteInput): PriceBreakdown {
  assertFils(input.dailyRateFils);
  assertFils(input.oneWayFeeFils);
  assertFils(input.depositFils);
  const vatBps = input.vatBps ?? DEFAULT_VAT_BPS;
  const days = rentalDays(input.pickupAt, input.returnAt);
  const rentalFils = input.dailyRateFils * days;

  const seen = new Set<string>();
  const extras = input.extras.map(({ extra, quantity }) => {
    if (seen.has(extra.id)) throw new RangeError(`Duplicate extra ${extra.code}`);
    seen.add(extra.id);
    return priceExtra(extra, quantity, days);
  });
  const extrasFils = extras.reduce((s, e) => s + e.totalFils, 0);
  const oneWayFeeFils = input.oneWay ? input.oneWayFeeFils : 0;
  const subtotalFils = rentalFils + extrasFils + oneWayFeeFils;
  const vatFils = vatOn(subtotalFils, vatBps);
  return {
    currency: "AED",
    days,
    dailyRateFils: input.dailyRateFils,
    rentalFils,
    extras,
    extrasFils,
    oneWayFeeFils,
    subtotalFils,
    vatRateBps: vatBps,
    vatFils,
    totalFils: subtotalFils + vatFils,
    depositFils: input.depositFils,
  };
}

export interface LateFee {
  /** Chargeable late hours (started hours past the grace period). */
  lateHours: number;
  hourlyRateFils: number;
  feeFils: number;
  vatFils: number;
  totalFils: number;
}

/**
 * Late return charge. Lateness up to 59 minutes is free. Beyond that, each
 * started hour past the grace period costs 1/24 of the daily rate (rounded to
 * the nearest fil), and every full 24 chargeable hours cost at most one daily
 * rate (the remainder is capped at one daily rate too).
 */
export function computeLateFee(
  scheduledReturnAt: Date,
  actualReturnAt: Date,
  dailyRateFils: number,
  vatBps = DEFAULT_VAT_BPS,
): LateFee {
  assertFils(dailyRateFils);
  const hourlyRateFils = Math.round(dailyRateFils / 24);
  const lateMs = actualReturnAt.getTime() - scheduledReturnAt.getTime();
  if (lateMs <= LATE_GRACE_MS) return { lateHours: 0, hourlyRateFils, feeFils: 0, vatFils: 0, totalFils: 0 };
  const lateHours = Math.ceil((lateMs - LATE_GRACE_MS) / HOUR_MS);
  const fullDays = Math.floor(lateHours / 24);
  const remHours = lateHours % 24;
  const feeFils = fullDays * dailyRateFils + Math.min(dailyRateFils, remHours * hourlyRateFils);
  const vatFils = vatOn(feeFils, vatBps);
  return { lateHours, hourlyRateFils, feeFils, vatFils, totalFils: feeFils + vatFils };
}

export const FREE_CANCELLATION_MS = 48 * HOUR_MS;

export interface CancellationQuote {
  allowed: boolean;
  reason: string;
  feeFils: number;
  /** Amount refunded to the customer from what they have paid. */
  refundFils: number;
}

/**
 * Default policy: free until 48h before pick-up; within 48h a fee of one day's
 * rate (VAT inclusive, never more than was paid); no cancellation once picked
 * up or after the pick-up time.
 */
export function cancellationQuote(args: {
  status: string;
  pickupAt: Date;
  now: Date;
  dailyRateFils: number;
  paidFils: number;
  vatBps?: number;
}): CancellationQuote {
  const { status, pickupAt, now, dailyRateFils, paidFils } = args;
  if (status !== "PENDING" && status !== "CONFIRMED") {
    return { allowed: false, reason: `A ${status.toLowerCase().replace("_", " ")} booking cannot be cancelled.`, feeFils: 0, refundFils: 0 };
  }
  if (now.getTime() >= pickupAt.getTime()) {
    return { allowed: false, reason: "The pick-up time has passed; this booking can no longer be cancelled.", feeFils: 0, refundFils: 0 };
  }
  if (pickupAt.getTime() - now.getTime() >= FREE_CANCELLATION_MS) {
    return { allowed: true, reason: "Free cancellation (more than 48 hours before pick-up).", feeFils: 0, refundFils: paidFils };
  }
  const dayWithVat = dailyRateFils + vatOn(dailyRateFils, args.vatBps ?? DEFAULT_VAT_BPS);
  const feeFils = Math.min(dayWithVat, paidFils);
  return {
    allowed: true,
    reason: "Cancelling within 48 hours of pick-up costs one day's rental.",
    feeFils,
    refundFils: paidFils - feeFils,
  };
}

/** Local calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function assertFils(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Invalid amount in fils: ${n}`);
}
