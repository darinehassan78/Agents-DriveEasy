// Q3: availability search, filters, date ranges and the per-vehicle calendar.
// Each test uses its own branch so seed data never interferes.
import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { one, tableExists, testPool } from "../support/db";
import {
  insertMaintenance,
  insertReservation,
  makeBranch,
  makeCategory,
  makeUser,
  makeVehicle,
  uniqueCode,
} from "../support/fixtures";

const ready = (await tableExists("vehicle_blocks")) && existsSync("src/server/catalog/index.ts");

const H = 3600_000;
const D = 24 * H;
const T = (iso: string) => new Date(iso);
// Fixed clock: "now" is 2027-01-01, searches are in March 2027.
const NOW = T("2027-01-01T00:00:00Z");
const P0 = T("2027-03-10T06:00:00Z");
const R0 = T("2027-03-12T06:00:00Z");

describe.skipIf(!ready)("vehicle search", () => {
  type Catalog = typeof import("@/server/catalog");
  let C: Catalog;
  let user: { id: string };

  beforeAll(async () => {
    C = await import("@/server/catalog");
    user = await makeUser();
  });

  async function fleet() {
    const branch = await makeBranch();
    const cheap = await makeCategory({ dailyRateFils: 15000, depositFils: 50000 });
    const lux = await makeCategory({ dailyRateFils: 60000, depositFils: 300000 });
    const a = await makeVehicle({ branchId: branch.id, categoryId: cheap.id, make: "Nissan", model: "Sunny", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5 });
    const b = await makeVehicle({ branchId: branch.id, categoryId: cheap.id, make: "Kia", model: "Picanto", transmission: "MANUAL", fuelType: "PETROL", seats: 4 });
    const c = await makeVehicle({ branchId: branch.id, categoryId: lux.id, make: "Tesla", model: "Model Y", transmission: "AUTOMATIC", fuelType: "ELECTRIC", seats: 7 });
    return { branch, cheap, lux, a, b, c };
  }
  const ids = (rs: { vehicle: { id: string } }[]) => rs.map((r) => r.vehicle.id).sort();

  it("returns only vehicles at the pick-up branch, priced server-side and sorted by price", async () => {
    const f = await fleet();
    const elsewhere = await makeVehicle(); // another branch
    const rs = await C.searchAvailableVehicles({ pickupBranchId: f.branch.id, pickupAt: P0, returnAt: R0 }, NOW);
    expect(ids(rs)).toEqual([f.a.id, f.b.id, f.c.id].sort());
    expect(ids(rs)).not.toContain(elsewhere.id);
    const tesla = rs.find((r) => r.vehicle.id === f.c.id)!;
    expect(tesla).toMatchObject({ days: 2, dailyRateFils: 60000, rentalFils: 120000, vatFils: 6000, estimatedTotalFils: 126000, depositFils: 300000 });
    const totals = rs.map((r) => r.estimatedTotalFils);
    expect(totals).toEqual([...totals].sort((x, y) => x - y));
  });

  it("filters: category, transmission, fuel, seats, max price, features", async () => {
    const f = await fleet();
    const s = (extra: Partial<Parameters<Catalog["searchAvailableVehicles"]>[0]>) =>
      C.searchAvailableVehicles({ pickupBranchId: f.branch.id, pickupAt: P0, returnAt: R0, ...extra }, NOW).then(ids);
    expect(await s({ categoryId: f.lux.id })).toEqual([f.c.id]);
    expect(await s({ transmission: "MANUAL" })).toEqual([f.b.id]);
    expect(await s({ fuelType: "ELECTRIC" })).toEqual([f.c.id]);
    expect(await s({ minSeats: 5 })).toEqual([f.a.id, f.c.id].sort());
    expect(await s({ maxDailyRateFils: 20000 })).toEqual([f.a.id, f.b.id].sort());
    expect(await s({ transmission: "AUTOMATIC", minSeats: 6 })).toEqual([f.c.id]);

    const feat = await one<{ id: string; code: string }>(
      "insert into vehicle_features (code, name) values ($1, 'QA feature') returning id, code",
      [uniqueCode("F").toLowerCase()],
    );
    await testPool().query("insert into vehicle_feature_map (vehicle_id, feature_id) values ($1, $2)", [f.a.id, feat.id]);
    expect(await s({ featureCodes: [feat.code] })).toEqual([f.a.id]);
  });

  it("excludes vehicles with an overlapping reservation or maintenance; [) boundaries are bookable", async () => {
    const f = await fleet();
    const s = (p: Date, r: Date) => C.searchAvailableVehicles({ pickupBranchId: f.branch.id, pickupAt: p, returnAt: r }, NOW).then(ids);
    await insertReservation({ userId: user.id, vehicleId: f.a.id, branchId: f.branch.id, pickupAt: P0, returnAt: R0 });
    await insertMaintenance({ vehicleId: f.b.id, startsAt: T("2027-03-11T00:00:00Z"), endsAt: T("2027-03-13T00:00:00Z") });

    expect(await s(P0, R0)).toEqual([f.c.id]);
    // starts exactly when A's rental ends -> A available
    expect(await s(R0, new Date(R0.getTime() + D))).toContain(f.a.id);
    // ends exactly when A's rental starts -> A available
    expect(await s(new Date(P0.getTime() - D), P0)).toContain(f.a.id);
    // one minute overlap -> A excluded
    expect(await s(new Date(R0.getTime() - 60_000), new Date(R0.getTime() + D))).not.toContain(f.a.id);
    // maintenance ends 03-13 00:00 -> B available from then
    expect(await s(T("2027-03-13T00:00:00Z"), T("2027-03-14T00:00:00Z"))).toContain(f.b.id);
  });

  it("cancelled reservations and expired holds do not hide a vehicle", async () => {
    const f = await fleet();
    await insertReservation({ userId: user.id, vehicleId: f.a.id, branchId: f.branch.id, pickupAt: P0, returnAt: R0, status: "CANCELLED" });
    await insertReservation({
      userId: user.id, vehicleId: f.b.id, branchId: f.branch.id, pickupAt: P0, returnAt: R0,
      status: "PENDING", holdExpiresAt: new Date(NOW.getTime() - 60_000),
    });
    const rs = await C.searchAvailableVehicles({ pickupBranchId: f.branch.id, pickupAt: P0, returnAt: R0 }, NOW);
    expect(ids(rs)).toEqual([f.a.id, f.b.id, f.c.id].sort());
  });

  it("an active hold hides the vehicle", async () => {
    const f = await fleet();
    await insertReservation({
      userId: user.id, vehicleId: f.a.id, branchId: f.branch.id, pickupAt: P0, returnAt: R0,
      status: "PENDING", holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
    });
    const rs = await C.searchAvailableVehicles({ pickupBranchId: f.branch.id, pickupAt: P0, returnAt: R0 }, NOW);
    expect(ids(rs)).not.toContain(f.a.id);
  });

  it("does not list vehicles in MAINTENANCE or RETIRED status", async () => {
    const branch = await makeBranch();
    const cat = await makeCategory({ dailyRateFils: 10000 });
    const m = await makeVehicle({ branchId: branch.id, categoryId: cat.id, status: "MAINTENANCE" });
    const r = await makeVehicle({ branchId: branch.id, categoryId: cat.id, status: "RETIRED" });
    const ok = await makeVehicle({ branchId: branch.id, categoryId: cat.id });
    const rs = await C.searchAvailableVehicles({ pickupBranchId: branch.id, pickupAt: P0, returnAt: R0 }, NOW);
    expect(ids(rs)).toEqual([ok.id]);
    expect(ids(rs)).not.toContain(m.id);
    expect(ids(rs)).not.toContain(r.id);
  });

  it("one-way search adds the return branch's fee", async () => {
    const f = await fleet();
    const ret = await makeBranch({ oneWayFeeFils: 20000 });
    const rs = await C.searchAvailableVehicles({ pickupBranchId: f.branch.id, returnBranchId: ret.id, pickupAt: P0, returnAt: R0 }, NOW);
    const a = rs.find((r) => r.vehicle.id === f.a.id)!;
    expect(a.oneWayFeeFils).toBe(20000);
    expect(a.estimatedTotalFils).toBe(30000 + 20000 + 2500);
  });

  it("rejects invalid ranges: return before pick-up, equal, past pick-up, over the max length, unknown/inactive branch", async () => {
    const f = await fleet();
    const s = (p: Date, r: Date, branch = f.branch.id) =>
      C.searchAvailableVehicles({ pickupBranchId: branch, pickupAt: p, returnAt: r }, NOW);
    await expect(s(R0, P0)).rejects.toThrow();
    await expect(s(P0, P0)).rejects.toThrow();
    await expect(s(T("2026-12-30T00:00:00Z"), T("2026-12-31T00:00:00Z"))).rejects.toThrow(/future/i);
    await expect(s(P0, new Date(P0.getTime() + 400 * D))).rejects.toThrow();
    await expect(s(P0, R0, "00000000-0000-4000-8000-000000000000")).rejects.toThrow();
    const closed = await makeBranch();
    await testPool().query("update branches set is_active=false where id=$1", [closed.id]);
    await expect(s(P0, R0, closed.id)).rejects.toThrow();
  });

  describe("availability calendar", () => {
    it("marks booked and maintenance days (branch local time), leaves others free, hides who booked", async () => {
      const f = await fleet();
      // Dubai = UTC+4. Reservation 03-10 10:00 -> 03-12 10:00 local
      await insertReservation({ userId: user.id, vehicleId: f.a.id, branchId: f.branch.id, pickupAt: P0, returnAt: R0 });
      // Maintenance 03-15 22:00 UTC -> 03-16 02:00 UTC = 03-16 02:00..06:00 local
      await insertMaintenance({ vehicleId: f.a.id, startsAt: T("2027-03-15T22:00:00Z"), endsAt: T("2027-03-16T02:00:00Z") });
      const cal = await C.getVehicleAvailability(f.a.id, T("2027-03-08T20:00:00Z"), T("2027-03-18T20:00:00Z"), NOW);
      expect(cal.timeZone).toBe("Asia/Dubai");
      const busy = cal.days.filter((d) => !d.available).map((d) => d.date);
      expect(busy).toEqual(["2027-03-10", "2027-03-11", "2027-03-12", "2027-03-16"]);
      expect(cal.days.find((d) => d.date === "2027-03-13")?.available).toBe(true);
      expect(cal.blocks.map((b) => b.kind)).toEqual(["reservation", "maintenance"]);
      expect(JSON.stringify(cal)).not.toContain(user.id);
    });

    it("rejects unknown vehicle and bad ranges", async () => {
      await expect(C.getVehicleAvailability("not-a-uuid", P0, R0, NOW)).rejects.toThrow();
      await expect(C.getVehicleAvailability("00000000-0000-4000-8000-000000000000", P0, R0, NOW)).rejects.toThrow();
      const f = await fleet();
      await expect(C.getVehicleAvailability(f.a.id, R0, P0, NOW)).rejects.toThrow();
    });
  });
});
