import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixture, future, prepareTestDatabase, type Fixture } from "../db/testing";
import type { FakePaymentProvider } from "./fake";

// End-to-end money flows against driveeasy_test with the fake provider. Its
// webhooks are delivered straight into handlePaymentWebhook (signed), so both
// the synchronous API result and the webhook path are exercised together.
let res: typeof import("../reservations");
let ops: typeof import("../reservations/operations");
let svc: typeof import("./service");
let payments: typeof import("./index");
let fakeMod: typeof import("./fake");
let dbm: typeof import("../db");
let s: typeof import("../db/schema");
let job: typeof import("../jobs/release-expired-holds");
let fake: FakePaymentProvider;
let webhookErrors: unknown[] = [];

beforeAll(async () => {
  await prepareTestDatabase();
  res = await import("../reservations");
  ops = await import("../reservations/operations");
  svc = await import("./service");
  payments = await import("./index");
  fakeMod = await import("./fake");
  dbm = await import("../db");
  s = await import("../db/schema");
  job = await import("../jobs/release-expired-holds");
}, 120_000);
afterAll(async () => {
  payments?.setPaymentProvider(undefined);
  await dbm?.closeDb();
});

function install(duplicateWebhooks = false) {
  webhookErrors = [];
  fake = new fakeMod.FakePaymentProvider({
    webhookUrl: "http://test.invalid/webhook",
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET!,
    duplicateWebhooks,
    send: async (_url, body, signature) => {
      try {
        await svc.handlePaymentWebhook(body, signature);
      } catch (e) {
        webhookErrors.push(e);
      }
    },
  });
  payments.setPaymentProvider(fake);
}
beforeEach(() => install());

const NOW = new Date(Date.UTC(2029, 11, 1, 8));
const customer = (f: Fixture) => ({ id: f.userId, role: "customer" as const });
const adminOf = (f: Fixture) => ({ id: f.adminId, role: "admin" as const });

async function hold(f: Fixture, over: Partial<Parameters<typeof res.reserve>[0]> = {}, now = NOW) {
  return res.reserve(
    {
      userId: f.userId,
      idempotencyKey: randomUUID(),
      vehicleId: f.vehicleId,
      pickupBranchId: f.pickupBranchId,
      returnBranchId: f.pickupBranchId,
      pickupAt: future(10),
      returnAt: future(13),
      extras: [],
      ...over,
    },
    { now },
  );
}

async function moneyRows(reservationId: string) {
  const p = await dbm.db().select().from(s.payments).where(eq(s.payments.reservationId, reservationId)).orderBy(s.payments.createdAt);
  const d = await dbm.db().select().from(s.deposits).where(eq(s.deposits.reservationId, reservationId));
  const [r] = await dbm.db().select().from(s.reservations).where(eq(s.reservations.id, reservationId));
  return { p, d, r };
}

describe("checkout", () => {
  it("holds the deposit, charges, and confirms", async () => {
    const f = await createFixture();
    const h = await hold(f);
    const out = await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    expect(out).toMatchObject({ outcome: "CONFIRMED", reservationStatus: "CONFIRMED", paymentStatus: "PAID", depositStatus: "HELD" });
    const { p, d } = await moneyRows(h.reservationId);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ status: "SUCCEEDED", amountFils: h.quote.totalFils, kind: "CHARGE" });
    expect(d[0]).toMatchObject({ status: "HELD", amountFils: 100000 });
    expect(webhookErrors).toEqual([]);
    // Calling again is a no-op: no second charge.
    const again = await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    expect(again.outcome).toBe("CONFIRMED");
    expect(fake.listEvents().filter((e) => e.type === "payment.succeeded")).toHaveLength(1);
  });

  it("does not confirm when the card is declined; a retry uses a new key and confirms once", async () => {
    const f = await createFixture();
    const h = await hold(f);
    const failed = await svc.startCheckout(h.reservationId, customer(f), { fakeOutcome: "fail", now: NOW });
    expect(failed).toMatchObject({ outcome: "FAILED", reservationStatus: "PENDING", paymentStatus: "FAILED", depositStatus: "HELD" });
    const ok = await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    expect(ok.outcome).toBe("CONFIRMED");
    const { p, d } = await moneyRows(h.reservationId);
    expect(p.map((x) => x.status)).toEqual(["FAILED", "SUCCEEDED"]);
    expect(new Set(p.map((x) => x.idempotencyKey)).size).toBe(2);
    expect(d).toHaveLength(1); // deposit hold reused, not taken twice
  });

  it("does not charge when the deposit cannot be held", async () => {
    const f = await createFixture();
    const h = await hold(f);
    const out = await svc.startCheckout(h.reservationId, customer(f), { depositFakeOutcome: "fail", now: NOW });
    expect(out).toMatchObject({ outcome: "FAILED", step: "deposit", reservationStatus: "PENDING", depositStatus: "FAILED" });
    expect((await moneyRows(h.reservationId)).p.every((x) => x.status === "PENDING")).toBe(true);
    expect(fake.listEvents().some((e) => e.type === "payment.succeeded")).toBe(false);
  });

  it("concurrent double-submits charge exactly once", async () => {
    const f = await createFixture();
    const h = await hold(f);
    const outs = await Promise.all([1, 2, 3].map(() => svc.startCheckout(h.reservationId, customer(f), { now: NOW })));
    expect(outs.some((o) => o.outcome === "CONFIRMED")).toBe(true);
    const { p, d } = await moneyRows(h.reservationId);
    expect(p.filter((x) => x.status === "SUCCEEDED")).toHaveLength(1);
    expect(d.filter((x) => x.status === "HELD")).toHaveLength(1);
    expect(fake.listEvents().filter((e) => e.type === "payment.succeeded")).toHaveLength(1);
  });

  it("requires_action stays PENDING until the verified webhook arrives", async () => {
    const f = await createFixture();
    const h = await hold(f);
    const out = await svc.startCheckout(h.reservationId, customer(f), { fakeOutcome: "requires_action", now: NOW });
    expect(out).toMatchObject({ outcome: "REQUIRES_ACTION", step: "payment", reservationStatus: "PENDING" });
    expect(out.clientSecret).toBeTruthy();
    const { p } = await moneyRows(h.reservationId);
    await fake.completeAction(p[0].providerRef!, "succeed"); // webhook -> confirm
    expect((await moneyRows(h.reservationId)).r.status).toBe("CONFIRMED");
  });

  it("rejects checkout after the hold expired, and for other users", async () => {
    const f = await createFixture();
    const h = await hold(f);
    await expect(svc.startCheckout(h.reservationId, { id: f.otherUserId, role: "customer" }, { now: NOW })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.startCheckout(h.reservationId, customer(f), { now: new Date(NOW.getTime() + 16 * 60_000) })).rejects.toMatchObject({ code: "HOLD_EXPIRED" });
  });
});

describe("webhooks", () => {
  it("de-duplicates repeated deliveries by event id", async () => {
    install(true); // every webhook delivered twice
    const f = await createFixture();
    const h = await hold(f);
    const out = await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    expect(out.outcome).toBe("CONFIRMED");
    const ev = fake.listEvents().find((e) => e.type === "payment.succeeded")!;
    await fake.resendWebhook(ev.id);
    const { rows } = await dbm.db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM payment_webhook_events WHERE event_id = ${ev.id}`);
    expect(rows[0].n).toBe(1);
    const audits = await dbm.db().select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, h.reservationId), eq(s.auditLogs.action, "reservation.confirmed")));
    expect(audits).toHaveLength(1);
    expect(webhookErrors).toEqual([]);
  });

  it("rejects bad signatures", async () => {
    await expect(svc.handlePaymentWebhook('{"id":"x"}', "sha256=deadbeef")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.handlePaymentWebhook('{"id":"x"}', null)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refunds money that arrives after the hold expired", async () => {
    const f = await createFixture();
    const h = await hold(f);
    const out = await svc.startCheckout(h.reservationId, customer(f), { fakeOutcome: "requires_action", now: NOW });
    expect(out.outcome).toBe("REQUIRES_ACTION");
    await job.releaseExpiredHolds(new Date(NOW.getTime() + 20 * 60_000)); // hold expires; deposit released
    const { p } = await moneyRows(h.reservationId);
    await fake.completeAction(p[0].providerRef!, "succeed"); // late success -> compensation refund
    const after = await moneyRows(h.reservationId);
    expect(after.r.status).toBe("EXPIRED");
    expect(after.r.paymentStatus).toBe("REFUNDED");
    expect(after.r.depositStatus).toBe("RELEASED");
  });
});

describe("release-expired-holds job", () => {
  it("expires holds, frees the car and is idempotent", async () => {
    const f = await createFixture();
    const h = await hold(f);
    const later = new Date(NOW.getTime() + 30 * 60_000);
    const first = await job.releaseExpiredHolds(later);
    expect(first.expired).toContain(h.reservationId);
    const second = await job.releaseExpiredHolds(later);
    expect(second.expired).not.toContain(h.reservationId);
    const { rows } = await dbm.db().execute(sql`SELECT 1 FROM vehicle_blocks WHERE reservation_id = ${h.reservationId}`);
    expect(rows).toHaveLength(0);
    const again = await hold({ ...f, userId: f.otherUserId }, {}, later);
    expect(again.status).toBe("PENDING");
  });
});

describe("cancel, modify, refund", () => {
  it("cancels for free 48h+ before pick-up: full refund, deposit released, car freed", async () => {
    const f = await createFixture();
    const h = await hold(f);
    await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    const q = await res.quoteCancellation(h.reservationId, customer(f), NOW);
    expect(q).toMatchObject({ allowed: true, feeFils: 0, refundFils: h.quote.totalFils });
    const c = await res.cancelReservation(h.reservationId, customer(f), { now: NOW });
    expect(c).toMatchObject({ status: "REFUNDED", feeFils: 0, refundedFils: h.quote.totalFils, depositReleased: true });
    // Second call is a no-op (no double refund).
    const c2 = await res.cancelReservation(h.reservationId, customer(f), { now: NOW });
    expect(c2.refundedFils).toBe(0);
    const { p } = await moneyRows(h.reservationId);
    expect(p.filter((x) => x.kind === "REFUND")).toHaveLength(1);
    expect((await hold({ ...f, userId: f.otherUserId })).status).toBe("PENDING");
  });

  it("charges one day's rate within 48h and refuses after pick-up", async () => {
    const f = await createFixture();
    const h = await hold(f);
    await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    const late = new Date(future(10).getTime() - 24 * 3_600_000);
    const c = await res.cancelReservation(h.reservationId, customer(f), { now: late });
    expect(c.feeFils).toBe(10500);
    expect(c.refundedFils).toBe(h.quote.totalFils - 10500);
    expect(c.status).toBe("REFUNDED");

    const h2 = await hold(f, { pickupAt: future(20), returnAt: future(21) });
    await svc.startCheckout(h2.reservationId, customer(f), { now: NOW });
    await expect(res.cancelReservation(h2.reservationId, customer(f), { now: future(20, 1) })).rejects.toMatchObject({ code: "POLICY" });
  });

  it("modifies dates: reprices, charges the difference once, and blocks overlaps", async () => {
    const f = await createFixture();
    const h = await hold(f); // 3 days
    await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    const other = await hold({ ...f, userId: f.otherUserId }, { pickupAt: future(20), returnAt: future(22) });
    await expect(
      res.modifyReservationDates(h.reservationId, customer(f), { pickupAt: future(10), returnAt: future(21) }, { now: NOW }),
    ).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    const m = await res.modifyReservationDates(h.reservationId, customer(f), { pickupAt: future(10), returnAt: future(15) }, { now: NOW });
    expect(m).toMatchObject({ totalFils: 52500, differenceFils: 52500 - 31500 });
    const detail = await res.getReservationForUser(h.reservationId, f.userId);
    expect(detail!.paidFils).toBe(52500);
    // Shorter again -> refund of the difference
    const m2 = await res.modifyReservationDates(h.reservationId, customer(f), { pickupAt: future(10), returnAt: future(12) }, { now: NOW });
    expect(m2.differenceFils).toBe(21000 - 52500);
    expect((await res.getReservationForUser(h.reservationId, f.userId))!.paidFils).toBe(21000);
    expect(other.status).toBe("PENDING");
  });
});

describe("check-out / check-in", () => {
  it("records mileage and fuel, charges late return from the deposit and releases the rest", async () => {
    const f = await createFixture({ dailyRateFils: 24000 });
    const h = await hold(f);
    await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    const a = adminOf(f);
    await expect(ops.checkOut(h.reservationId, customer(f), { mileageKm: 1000, fuelPct: 100 }, { now: future(10) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ops.checkOut(h.reservationId, a, { mileageKm: 999, fuelPct: 100 }, { now: future(10) })).rejects.toMatchObject({ code: "VALIDATION" });
    const out = await ops.checkOut(h.reservationId, a, { mileageKm: 1010, fuelPct: 100 }, { now: future(10) });
    expect(out.status).toBe("PICKED_UP");
    const [v] = await dbm.db().select().from(s.vehicles).where(eq(s.vehicles.id, f.vehicleId));
    expect(v.status).toBe("ON_RENT");

    // Returned 3h late -> 2h01m past grace -> 3 started hours x 1000 + VAT
    const back = await ops.checkIn(h.reservationId, a, { mileageKm: 1450, fuelPct: 80 }, { now: future(13, 3) });
    expect(back.lateFee).toMatchObject({ lateHours: 3, feeFils: 3000, vatFils: 150, totalFils: 3150 });
    expect(back).toMatchObject({ capturedFromDepositFils: 3150, chargedToCardFils: 0, depositStatus: "CAPTURED", distanceKm: 440 });
    const detail = await res.getReservationAdmin(h.reservationId);
    expect(detail).toMatchObject({ status: "RETURNED", lateFeeFils: 3150 });
    expect(detail!.agreement).toMatchObject({ pickupMileageKm: 1010, returnMileageKm: 1450, pickupFuelPct: 100, returnFuelPct: 80, lateHours: 3 });
    const [v2] = await dbm.db().select().from(s.vehicles).where(eq(s.vehicles.id, f.vehicleId));
    expect(v2).toMatchObject({ status: "AVAILABLE", mileageKm: 1450 });

    const report = await ops.createDamageReport(a, { reservationId: h.reservationId, stage: "RETURN", severity: "MINOR", description: "Scratch on rear bumper", photoKeys: [`damage/${h.reservationId}/1.jpg`] });
    expect(report.vehicleId).toBe(f.vehicleId);
    const audit = await dbm.db().select().from(s.auditLogs).where(eq(s.auditLogs.entityId, h.reservationId));
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["reservation.created", "reservation.confirmed", "reservation.checked_out", "reservation.checked_in"]));
  });

  it("returns on time release the deposit in full", async () => {
    const f = await createFixture();
    const h = await hold(f);
    await svc.startCheckout(h.reservationId, customer(f), { now: NOW });
    const a = adminOf(f);
    await ops.checkOut(h.reservationId, a, { mileageKm: 1000, fuelPct: 90 }, { now: future(10) });
    const back = await ops.checkIn(h.reservationId, a, { mileageKm: 1100, fuelPct: 90 }, { now: future(13, 0.5) });
    expect(back).toMatchObject({ chargesFils: 0, depositStatus: "RELEASED" });
  });
});
