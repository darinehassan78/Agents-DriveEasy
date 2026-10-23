import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, future, prepareTestDatabase, type Fixture } from "../db/testing";

// Integration tests against driveeasy_test (TEST_DATABASE_URL).
let mod: typeof import("./index");
let dbm: typeof import("../db");
let schema: typeof import("../db/schema");
let admin: typeof import("../admin");

beforeAll(async () => {
  await prepareTestDatabase();
  mod = await import("./index");
  dbm = await import("../db");
  schema = await import("../db/schema");
  admin = await import("../admin");
}, 120_000);
afterAll(async () => {
  await dbm?.closeDb();
});

// Before every future() date, and later than the clocks service.test.ts passes to the
// (global) release-expired-holds job, so that job can never expire these holds mid-test.
const NOW = new Date(Date.UTC(2029, 11, 15, 8));

function input(f: Fixture, over: Partial<Parameters<typeof mod.reserve>[0]> = {}) {
  return {
    userId: f.userId,
    idempotencyKey: randomUUID(),
    vehicleId: f.vehicleId,
    pickupBranchId: f.pickupBranchId,
    returnBranchId: f.pickupBranchId,
    pickupAt: future(10),
    returnAt: future(13),
    extras: [],
    ...over,
  };
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

describe("reserve", () => {
  it("creates a PENDING hold priced on the server, with VAT, extras, one-way fee and deposit", async () => {
    const f = await createFixture();
    const r = await mod.reserve(
      input(f, { returnBranchId: f.returnBranchId, extras: [{ code: f.extraCode, quantity: 2 }] }),
      { now: NOW },
    );
    expect(r.status).toBe("PENDING");
    expect(r.holdExpiresAt!.getTime() - NOW.getTime()).toBe(15 * 60_000);
    // 3 days x 100 AED + 2 seats x 3 days x 25 AED + 200 AED one-way, + 5% VAT
    expect(r.quote).toMatchObject({ days: 3, rentalFils: 30000, extrasFils: 15000, oneWayFeeFils: 20000, vatFils: 3250, totalFils: 68250, depositFils: 100000 });
    const details = await mod.getReservationForUser(r.reference, f.userId);
    expect(details).toMatchObject({ status: "PENDING", totalFils: 68250, paymentStatus: "UNPAID", depositStatus: "NONE" });
    expect(details!.extras).toHaveLength(1);
    expect(details!.driver.fullName).toBe("Test Driver");
  });

  it("is idempotent per (user, key)", async () => {
    const f = await createFixture();
    const i = input(f);
    const a = await mod.reserve(i, { now: NOW });
    const b = await mod.reserve(i, { now: NOW });
    expect(b.reservationId).toBe(a.reservationId);
    expect(b.replayed).toBe(true);
    const [{ n }] = (await dbm.db().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM reservations WHERE vehicle_id = ${f.vehicleId}`)).rows;
    expect(n).toBe(1);
  });

  it("rejects overlaps but allows back-to-back [) periods", async () => {
    const f = await createFixture();
    await mod.reserve(input(f), { now: NOW });
    expect(await errorCode(mod.reserve(input(f, { userId: f.otherUserId, pickupAt: future(12), returnAt: future(14) }), { now: NOW }))).toBe("NOT_AVAILABLE");
    expect(await errorCode(mod.reserve(input(f, { userId: f.otherUserId, pickupAt: future(9), returnAt: future(10, 1) }), { now: NOW }))).toBe("NOT_AVAILABLE");
    const back = await mod.reserve(input(f, { userId: f.otherUserId, pickupAt: future(13), returnAt: future(15) }), { now: NOW });
    expect(back.status).toBe("PENDING");
    const before = await mod.reserve(input(f, { userId: f.otherUserId, pickupAt: future(8), returnAt: future(10) }), { now: NOW });
    expect(before.status).toBe("PENDING");
  });

  it("exactly one of many concurrent overlapping reservations wins", async () => {
    const f = await createFixture();
    const attempts = Array.from({ length: 12 }, (_, i) =>
      mod.reserve(input(f, { userId: i % 2 ? f.userId : f.otherUserId, pickupAt: future(20, i % 3), returnAt: future(23) }), { now: NOW }),
    );
    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === "fulfilled");
    const codes = results.flatMap((r) => (r.status === "rejected" ? [(r.reason as { code?: string }).code] : []));
    expect(ok).toHaveLength(1);
    expect(codes.every((c) => c === "NOT_AVAILABLE")).toBe(true);
    const { rows } = await dbm.db().execute(sql`SELECT 1 FROM vehicle_blocks WHERE vehicle_id = ${f.vehicleId}`);
    expect(rows).toHaveLength(1);
  });

  it("concurrent bookings of different cars all succeed", async () => {
    const f = await createFixture({ vehicles: 5 });
    const results = await Promise.all(f.vehicleIds.map((vehicleId) => mod.reserve(input(f, { vehicleId }), { now: NOW })));
    expect(new Set(results.map((r) => r.reservationId)).size).toBe(5);
  });

  it("expires a stale hold on the same vehicle before checking", async () => {
    const f = await createFixture();
    const first = await mod.reserve(input(f), { now: NOW });
    expect(await errorCode(mod.reserve(input(f, { userId: f.otherUserId }), { now: new Date(NOW.getTime() + 14 * 60_000) }))).toBe("NOT_AVAILABLE");
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const second = await mod.reserve(input(f, { userId: f.otherUserId }), { now: later });
    expect(second.status).toBe("PENDING");
    const [old] = await dbm.db().select().from(schema.reservations).where(eq(schema.reservations.id, first.reservationId));
    expect(old.status).toBe("EXPIRED");
  });

  it("respects maintenance blocks, and maintenance cannot overlap a booking", async () => {
    const f = await createFixture();
    const a = { id: f.adminId, role: "admin" as const };
    await admin.createMaintenanceBlock(a, { vehicleId: f.vehicleId, startsAt: future(30), endsAt: future(32), reason: "Service" });
    expect(await errorCode(mod.reserve(input(f, { pickupAt: future(31), returnAt: future(33) }), { now: NOW }))).toBe("NOT_AVAILABLE");
    await mod.reserve(input(f, { pickupAt: future(32), returnAt: future(33) }), { now: NOW });
    expect(await errorCode(admin.createMaintenanceBlock(a, { vehicleId: f.vehicleId, startsAt: future(32, 12), endsAt: future(34), reason: "Tyres" }))).toBe("NOT_AVAILABLE");
  });

  it("validates input: dates, unknown extras, driver age, retired cars, wrong branch", async () => {
    const f = await createFixture();
    expect(await errorCode(mod.reserve(input(f, { pickupAt: future(5), returnAt: future(5) }), { now: NOW }))).toBe("VALIDATION");
    expect(await errorCode(mod.reserve(input(f, { pickupAt: new Date(NOW.getTime() - 1000), returnAt: future(1) }), { now: NOW }))).toBe("VALIDATION");
    expect(await errorCode(mod.reserve(input(f, { extras: [{ code: "NOPE", quantity: 1 }] }), { now: NOW }))).toBe("VALIDATION");
    expect(await errorCode(mod.reserve(input(f, { extras: [{ code: f.extraCode, quantity: 3 }] }), { now: NOW }))).toBe("VALIDATION");
    expect(await errorCode(mod.reserve(input(f, { pickupBranchId: f.returnBranchId }), { now: NOW }))).toBe("VALIDATION");
    const young = { fullName: "Kid", phone: "+971500000001", dateOfBirth: "2012-01-01", licenceNumber: "X1", licenceCountry: "AE", licenceExpiry: "2099-01-01" };
    expect(await errorCode(mod.reserve(input(f, { driver: young }), { now: NOW }))).toBe("VALIDATION");
    await admin.setVehicleStatus({ id: f.adminId, role: "admin" }, f.vehicleId, "RETIRED");
    expect(await errorCode(mod.reserve(input(f), { now: NOW }))).toBe("NOT_AVAILABLE");
  });

  it("never returns another user's reservation", async () => {
    const f = await createFixture();
    const r = await mod.reserve(input(f), { now: NOW });
    expect(await mod.getReservationForUser(r.reservationId, f.otherUserId)).toBeNull();
    expect(await mod.getReservationForUser(r.reference, f.otherUserId)).toBeNull();
    expect(await errorCode(mod.cancelReservation(r.reservationId, { id: f.otherUserId, role: "customer" }, { now: NOW }))).toBe("NOT_FOUND");
    expect((await mod.getReservationAdmin(r.reference))?.customer?.id).toBe(f.userId);
  });
});

describe("expireStaleHolds", () => {
  it("is idempotent", async () => {
    const f = await createFixture();
    const r = await mod.reserve(input(f), { now: NOW });
    const later = new Date(NOW.getTime() + 60 * 60_000);
    const first = await dbm.db().transaction((tx) => mod.expireStaleHolds(tx, { vehicleId: f.vehicleId, now: later }));
    const second = await dbm.db().transaction((tx) => mod.expireStaleHolds(tx, { vehicleId: f.vehicleId, now: later }));
    expect(first).toEqual([r.reservationId]);
    expect(second).toEqual([]);
  });
});
