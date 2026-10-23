import { describe, expect, it } from "vitest";
import {
  cancellationQuote,
  computeLateFee,
  computeQuote,
  localDate,
  rentalDays,
  selectPricingRule,
  vatOn,
  type ExtraInput,
  type PricingRuleInput,
} from "./engine";

const t = (iso: string) => new Date(iso);
const H = 3_600_000;

describe("rentalDays", () => {
  it("rounds up started days with a minimum of one", () => {
    const a = t("2027-01-01T10:00:00Z");
    expect(rentalDays(a, t("2027-01-01T11:00:00Z"))).toBe(1);
    expect(rentalDays(a, t("2027-01-02T10:00:00Z"))).toBe(1);
    expect(rentalDays(a, t("2027-01-02T10:01:00Z"))).toBe(2);
    expect(rentalDays(a, t("2027-01-04T10:00:00Z"))).toBe(3);
  });
  it("rejects empty or negative periods", () => {
    expect(() => rentalDays(t("2027-01-01T10:00:00Z"), t("2027-01-01T10:00:00Z"))).toThrow();
    expect(() => rentalDays(t("2027-01-02T10:00:00Z"), t("2027-01-01T10:00:00Z"))).toThrow();
  });
});

describe("vatOn", () => {
  it("is 5% rounded half up to the fil", () => {
    expect(vatOn(10000)).toBe(500);
    expect(vatOn(9990)).toBe(500); // 499.5 -> 500
    expect(vatOn(9989)).toBe(499); // 499.45 -> 499
    expect(vatOn(0)).toBe(0);
  });
  it("rejects floats and negatives", () => {
    expect(() => vatOn(1.5)).toThrow();
    expect(() => vatOn(-1)).toThrow();
  });
});

describe("selectPricingRule", () => {
  const base: PricingRuleInput = {
    id: "base",
    categoryId: "cat",
    vehicleId: null,
    branchId: null,
    dailyRateFils: 10000,
    minDays: 1,
    validFrom: null,
    validTo: null,
    priority: 0,
    isActive: true,
  };
  const weekly = { ...base, id: "weekly", minDays: 7, dailyRateFils: 8500 };
  const peak = { ...base, id: "peak", validFrom: "2027-12-20", validTo: "2028-01-05", priority: 10, dailyRateFils: 13000 };
  const branch = { ...base, id: "branch", branchId: "dxb", dailyRateFils: 11000 };
  const vehicle = { ...base, id: "vehicle", vehicleId: "v1", dailyRateFils: 9000 };
  const inactive = { ...base, id: "inactive", priority: 100, isActive: false };
  const rules = [base, weekly, peak, branch, vehicle, inactive];
  const ctx = { categoryId: "cat", vehicleId: "v2", branchId: "auh", pickupDate: "2027-06-01", days: 3 };

  it("uses the base rate", () => expect(selectPricingRule(rules, ctx)?.id).toBe("base"));
  it("uses the weekly rate from 7 days", () => expect(selectPricingRule(rules, { ...ctx, days: 7 })?.id).toBe("weekly"));
  it("prefers the higher-priority seasonal rule inside its window (inclusive)", () => {
    expect(selectPricingRule(rules, { ...ctx, pickupDate: "2027-12-20" })?.id).toBe("peak");
    expect(selectPricingRule(rules, { ...ctx, pickupDate: "2028-01-05" })?.id).toBe("peak");
    expect(selectPricingRule(rules, { ...ctx, pickupDate: "2028-01-06" })?.id).toBe("base");
  });
  it("prefers vehicle-specific, then branch-specific rules", () => {
    expect(selectPricingRule(rules, { ...ctx, vehicleId: "v1", branchId: "dxb" })?.id).toBe("vehicle");
    expect(selectPricingRule(rules, { ...ctx, branchId: "dxb" })?.id).toBe("branch");
  });
  it("ignores other categories and inactive rules", () => {
    expect(selectPricingRule(rules, { ...ctx, categoryId: "other" })).toBeNull();
  });
});

describe("computeQuote", () => {
  const seat: ExtraInput = { id: "e1", code: "CHILD_SEAT", name: "Child seat", pricing: "PER_DAY", priceFils: 2500, maxQuantity: 3, maxChargeFils: 25000 };
  const fuel: ExtraInput = { id: "e2", code: "FUEL", name: "Fuel", pricing: "PER_RENTAL", priceFils: 12000, maxQuantity: 1, maxChargeFils: null };
  const pickupAt = t("2027-03-01T10:00:00Z");

  it("prices rental, extras, one-way fee and VAT; deposit is separate and untaxed", () => {
    const q = computeQuote({
      pickupAt,
      returnAt: t("2027-03-04T10:00:00Z"),
      dailyRateFils: 9900,
      extras: [
        { extra: seat, quantity: 2 },
        { extra: fuel, quantity: 1 },
      ],
      oneWay: true,
      oneWayFeeFils: 15000,
      depositFils: 100000,
    });
    expect(q.days).toBe(3);
    expect(q.rentalFils).toBe(29700);
    expect(q.extras.map((e) => e.totalFils)).toEqual([15000, 12000]);
    expect(q.extrasFils).toBe(27000);
    expect(q.oneWayFeeFils).toBe(15000);
    expect(q.subtotalFils).toBe(71700);
    expect(q.vatFils).toBe(3585);
    expect(q.totalFils).toBe(75285);
    expect(q.depositFils).toBe(100000);
  });

  it("caps per-day extras per unit and skips the one-way fee for same-branch returns", () => {
    const q = computeQuote({
      pickupAt,
      returnAt: t("2027-03-21T10:00:00Z"),
      dailyRateFils: 10000,
      extras: [{ extra: seat, quantity: 2 }],
      oneWay: false,
      oneWayFeeFils: 15000,
      depositFils: 0,
    });
    expect(q.days).toBe(20);
    expect(q.extrasFils).toBe(50000); // 2 x min(20 x 2500, 25000)
    expect(q.oneWayFeeFils).toBe(0);
  });

  it("rejects too many units and duplicate extras", () => {
    const base = { pickupAt, returnAt: t("2027-03-02T10:00:00Z"), dailyRateFils: 1, oneWay: false, oneWayFeeFils: 0, depositFils: 0 };
    expect(() => computeQuote({ ...base, extras: [{ extra: seat, quantity: 4 }] })).toThrow();
    expect(() => computeQuote({ ...base, extras: [{ extra: seat, quantity: 1 }, { extra: seat, quantity: 1 }] })).toThrow();
  });
});

describe("computeLateFee", () => {
  const due = t("2027-03-04T10:00:00Z");
  const at = (ms: number) => new Date(due.getTime() + ms);
  const daily = 24000; // hourly = 1000

  it("is free within the 59-minute grace period", () => {
    expect(computeLateFee(due, due, daily).feeFils).toBe(0);
    expect(computeLateFee(due, at(59 * 60_000), daily).feeFils).toBe(0);
    expect(computeLateFee(due, at(-5 * H), daily).feeFils).toBe(0);
  });
  it("charges each started hour past the grace period at 1/24 of the daily rate, plus VAT", () => {
    const f = computeLateFee(due, at(59 * 60_000 + 1), daily);
    expect(f).toMatchObject({ lateHours: 1, feeFils: 1000, vatFils: 50, totalFils: 1050 });
    expect(computeLateFee(due, at(2 * H), daily).lateHours).toBe(2); // 61 min past grace
    expect(computeLateFee(due, at(3 * H + 59 * 60_000), daily).lateHours).toBe(3);
  });
  it("caps at one daily rate per 24 hours", () => {
    expect(computeLateFee(due, at(23 * H + 59 * 60_000), daily).feeFils).toBe(23000);
    expect(computeLateFee(due, at(30 * H), daily).feeFils).toBe(24000 + 6000); // 30h late = 29h01m past grace -> 30 started hours = 1 day + 6h
    // 24 chargeable hours cost exactly one daily rate even when 24 x rounded hourly rate is more.
    expect(computeLateFee(due, at(24 * H + 59 * 60_000), 100010).feeFils).toBe(100010);
    // the remainder is capped too (tiny rate where rounding makes 23 hours exceed a day)
    expect(computeLateFee(due, at(23 * H + 59 * 60_000), 23).feeFils).toBe(23);
  });
});

describe("cancellationQuote", () => {
  const pickupAt = t("2027-03-10T10:00:00Z");
  const base = { status: "CONFIRMED", pickupAt, dailyRateFils: 10000, paidFils: 50000 };
  it("is free 48h or more before pick-up", () => {
    const q = cancellationQuote({ ...base, now: new Date(pickupAt.getTime() - 48 * H) });
    expect(q).toMatchObject({ allowed: true, feeFils: 0, refundFils: 50000 });
  });
  it("charges one day (incl. VAT) within 48h", () => {
    const q = cancellationQuote({ ...base, now: new Date(pickupAt.getTime() - 47 * H) });
    expect(q).toMatchObject({ allowed: true, feeFils: 10500, refundFils: 39500 });
  });
  it("never charges more than was paid; unpaid holds cancel for free", () => {
    expect(cancellationQuote({ ...base, paidFils: 5000, now: new Date(pickupAt.getTime() - H) }).feeFils).toBe(5000);
    expect(cancellationQuote({ ...base, status: "PENDING", paidFils: 0, now: new Date(pickupAt.getTime() - H) })).toMatchObject({
      allowed: true,
      feeFils: 0,
      refundFils: 0,
    });
  });
  it("refuses after pick-up time or once picked up", () => {
    expect(cancellationQuote({ ...base, now: pickupAt }).allowed).toBe(false);
    expect(cancellationQuote({ ...base, status: "PICKED_UP", now: new Date(pickupAt.getTime() - 72 * H) }).allowed).toBe(false);
  });
});

describe("localDate", () => {
  it("uses the branch time zone", () => {
    expect(localDate(t("2027-03-01T21:00:00Z"), "Asia/Dubai")).toBe("2027-03-02");
    expect(localDate(t("2027-03-01T19:59:59Z"), "Asia/Dubai")).toBe("2027-03-01");
  });
});
