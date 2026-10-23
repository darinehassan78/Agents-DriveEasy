// Q7: server-side pricing against the real DB (rules, extras, branches) plus
// late-return and cancellation rules. Expected values are computed by hand
// from docs/TEAM.md, not copied from the engine.
import { beforeAll, describe, expect, it } from "vitest";
import { one, tableExists, testPool } from "../support/db";
import { makeBranch, makeCategory, makeVehicle, uniqueCode } from "../support/fixtures";

const ready = (await tableExists("pricing_rules")) && (await import("node:fs")).existsSync("src/server/pricing/index.ts");

const H = 3600_000;
const D = 24 * H;
const T0 = new Date("2027-03-01T06:00:00Z"); // 10:00 Dubai, far future, no seasonal rule

async function makeExtra(pricing: "PER_DAY" | "PER_RENTAL", priceFils: number, opts: { max?: number; cap?: number } = {}) {
  return one<{ id: string; code: string }>(
    `insert into extras (code, name, pricing, price_fils, max_quantity, max_charge_fils)
     values ($1, $1, $2, $3, $4, $5) returning id, code`,
    [uniqueCode("X"), pricing, priceFils, opts.max ?? 1, opts.cap ?? null],
  );
}

describe.skipIf(!ready)("pricing", () => {
  type PricingModule = typeof import("@/server/pricing");
  let P: PricingModule;
  let home: { id: string };
  let other: { id: string };
  let vehicle: { id: string; categoryId: string; branchId: string };

  beforeAll(async () => {
    P = await import("@/server/pricing");
    home = await makeBranch({ oneWayFeeFils: 15000 });
    other = await makeBranch({ oneWayFeeFils: 25000 });
    const cat = await makeCategory({ depositFils: 150000, dailyRateFils: 20000 }); // AED 200/day
    vehicle = await makeVehicle({ branchId: home.id, categoryId: cat.id });
  });

  const base = () => ({
    vehicleId: vehicle.id,
    pickupBranchId: home.id,
    returnBranchId: home.id,
    pickupAt: T0,
    returnAt: new Date(T0.getTime() + D),
  });

  describe("day rounding: ceil(duration / 24h), minimum 1", () => {
    it.each([
      [1 * H, 1],
      [24 * H, 1],
      [24 * H + 60_000, 2],
      [48 * H, 2],
      [48 * H + 1000, 3],
      [7 * D, 7],
    ])("%i ms -> %i day(s)", async (ms, days) => {
      const q = await P.quote({ ...base(), returnAt: new Date(T0.getTime() + ms) });
      expect(q.days).toBe(days);
      expect(q.rentalFils).toBe(20000 * days);
    });

    it("rejects return before or equal to pick-up", async () => {
      await expect(P.quote({ ...base(), returnAt: T0 })).rejects.toThrow();
      await expect(P.quote({ ...base(), returnAt: new Date(T0.getTime() - H) })).rejects.toThrow();
    });
  });

  it("3-day rental, no extras: rental + 5% VAT, deposit separate and untaxed", async () => {
    const q = await P.quote({ ...base(), returnAt: new Date(T0.getTime() + 3 * D) });
    expect(q).toMatchObject({
      currency: "AED",
      days: 3,
      dailyRateFils: 20000,
      rentalFils: 60000,
      extrasFils: 0,
      oneWayFeeFils: 0,
      vatFils: 3000,
      totalFils: 63000,
      depositFils: 150000,
    });
  });

  it("daily rate comes from the most specific / highest-priority active rule", async () => {
    const cat = await makeCategory({ depositFils: 50000, dailyRateFils: 10000 });
    const v = await makeVehicle({ branchId: home.id, categoryId: cat.id });
    const qb = { ...base(), vehicleId: v.id };
    expect((await P.quote(qb)).dailyRateFils).toBe(10000);
    // branch-specific rule beats the generic one
    await testPool().query(
      `insert into pricing_rules (name, category_id, branch_id, daily_rate_fils) values ('br', $1, $2, 12000)`,
      [cat.id, home.id],
    );
    expect((await P.quote(qb)).dailyRateFils).toBe(12000);
    // weekly rule (min_days 7) applies only to 7+ day rentals
    await testPool().query(
      `insert into pricing_rules (name, category_id, daily_rate_fils, min_days, priority) values ('wk', $1, 8000, 7, 10)`,
      [cat.id],
    );
    expect((await P.quote(qb)).dailyRateFils).toBe(12000);
    expect((await P.quote({ ...qb, returnAt: new Date(T0.getTime() + 7 * D) })).dailyRateFils).toBe(8000);
    // inactive rules are ignored
    await testPool().query(
      `insert into pricing_rules (name, category_id, daily_rate_fils, priority, is_active) values ('off', $1, 1000, 99, false)`,
      [cat.id],
    );
    expect((await P.quote(qb)).dailyRateFils).toBe(12000);
  });

  it("extras: per-day x days x qty, per-rental once x qty, all taxed", async () => {
    const gps = await makeExtra("PER_DAY", 2500); // AED 25/day
    const seat = await makeExtra("PER_DAY", 3000, { max: 2 });
    const clean = await makeExtra("PER_RENTAL", 5000);
    const q = await P.quote({
      ...base(),
      returnAt: new Date(T0.getTime() + 3 * D),
      extras: [{ extraId: gps.id }, { extraId: seat.id, quantity: 2 }, { extraId: clean.id }],
    });
    // 2500*3 + 3000*3*2 + 5000 = 7500 + 18000 + 5000
    expect(q.extrasFils).toBe(30500);
    expect(q.vatFils).toBe(Math.round((60000 + 30500) * 0.05)); // 4525
    expect(q.totalFils).toBe(60000 + 30500 + 4525);
  });

  it("per-day extra respects its per-rental cap", async () => {
    const ins = await makeExtra("PER_DAY", 4000, { cap: 10000 });
    const q = await P.quote({ ...base(), returnAt: new Date(T0.getTime() + 5 * D), extras: [{ extraId: ins.id }] });
    expect(q.extrasFils).toBe(10000);
  });

  it("rejects quantities above the extra's maximum and inactive/unknown extras", async () => {
    const one1 = await makeExtra("PER_RENTAL", 1000, { max: 1 });
    await expect(P.quote({ ...base(), extras: [{ extraId: one1.id, quantity: 2 }] })).rejects.toThrow();
    const off = await makeExtra("PER_RENTAL", 1000);
    await testPool().query("update extras set is_active=false where id=$1", [off.id]);
    await expect(P.quote({ ...base(), extras: [{ extraId: off.id }] })).rejects.toThrow();
    await expect(
      P.quote({ ...base(), extras: [{ extraId: "00000000-0000-4000-8000-000000000000" }] }),
    ).rejects.toThrow();
  });

  it("one-way fee only when the return branch differs (return branch's fee), and it is taxed", async () => {
    const same = await P.quote(base());
    expect(same.oneWayFeeFils).toBe(0);
    const ow = await P.quote({ ...base(), returnBranchId: other.id });
    expect(ow.oneWayFeeFils).toBe(25000);
    expect(ow.vatFils).toBe(Math.round((20000 + 25000) * 0.05));
    expect(ow.totalFils).toBe(20000 + 25000 + 2250);
  });

  it("VAT rounds half-up to the nearest fil and money stays integer", async () => {
    expect(P.vatOn(10)).toBe(1); // 0.5 -> 1
    expect(P.vatOn(9)).toBe(0); // 0.45 -> 0
    expect(P.vatOn(30500 + 60000)).toBe(4525);
    const q = await P.quote(base());
    for (const k of ["rentalFils", "extrasFils", "oneWayFeeFils", "vatFils", "totalFils", "depositFils"] as const) {
      expect(Number.isInteger(q[k]), k).toBe(true);
    }
  });

  it("vehicle must be picked up at its home branch", async () => {
    await expect(P.quote({ ...base(), pickupBranchId: other.id })).rejects.toThrow();
  });

  describe("late return (59-minute grace, started hours at 1/24 daily rate, max one day per 24h)", () => {
    const rate = 24000; // 1000 fils/hour
    const ret = new Date("2027-03-05T06:00:00Z");
    const late = (mins: number) => P.computeLateFee(ret, new Date(ret.getTime() + mins * 60_000), rate);

    it.each([
      [0, 0, 0],
      [59, 0, 0],
      [60, 1, 1000],
      [119, 1, 1000],
      [120, 2, 2000],
      [59 + 23 * 60, 23, 23000],
    ])("%i min late -> %i chargeable hour(s), %i fils", (mins, hours, fee) => {
      const f = late(mins);
      expect(f.lateHours).toBe(hours);
      expect(f.feeFils).toBe(fee);
      expect(f.vatFils).toBe(Math.round(fee * 0.05));
    });

    it("caps at one daily rate per 24 hours", () => {
      expect(late(59 + 24 * 60).feeFils).toBe(rate);
      expect(late(59 + 30 * 60).feeFils).toBe(rate + 6000);
      expect(late(59 + 48 * 60).feeFils).toBe(2 * rate);
      // never more than one day per started 24h block
      for (let h = 1; h <= 72; h++) {
        expect(late(59 + h * 60).feeFils).toBeLessThanOrEqual(Math.ceil(h / 24) * rate);
      }
    });

    it("early return costs nothing", () => {
      expect(late(-120).feeFils).toBe(0);
    });
  });

  describe("cancellation policy", () => {
    const pickupAt = new Date("2027-03-10T06:00:00Z");
    const c = (hoursBefore: number, status = "CONFIRMED") =>
      P.cancellationQuote({
        status,
        pickupAt,
        now: new Date(pickupAt.getTime() - hoursBefore * H),
        dailyRateFils: 20000,
        paidFils: 63000,
      });

    it("free at 48h or more before pick-up", () => {
      expect(c(72)).toMatchObject({ allowed: true, feeFils: 0, refundFils: 63000 });
      expect(c(48)).toMatchObject({ allowed: true, feeFils: 0, refundFils: 63000 });
    });
    it("within 48h: one day's rate (+VAT) is kept", () => {
      expect(c(47.9)).toMatchObject({ allowed: true, feeFils: 21000, refundFils: 42000 });
      expect(c(1)).toMatchObject({ allowed: true, feeFils: 21000 });
    });
    it("not after pick-up time or once picked up / finished", () => {
      expect(c(0).allowed).toBe(false);
      expect(c(-1).allowed).toBe(false);
      expect(c(72, "PICKED_UP").allowed).toBe(false);
      expect(c(72, "RETURNED").allowed).toBe(false);
      expect(c(72, "CANCELLED").allowed).toBe(false);
    });
  });
});
