// Raw-SQL fixtures for integration tests. Every fixture gets unique codes so
// tests never depend on (or collide with) seed data.
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { one, testPool } from "./db";

type Exec = Pick<PoolClient, "query">;
const ex = (c?: Exec): Exec => c ?? testPool();

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
export function uniqueVin(): string {
  const b = randomBytes(17);
  return Array.from(b, (x) => VIN_CHARS[x % VIN_CHARS.length]).join("");
}
export function uniqueCode(prefix = "T"): string {
  return (prefix + randomBytes(4).toString("hex")).toUpperCase().slice(0, 12);
}

export async function makeUser(opts: { role?: "customer" | "admin"; email?: string } = {}) {
  const email = opts.email ?? `qa-${randomUUID()}@driveeasy.test`;
  return one<{ id: string; email: string }>(
    `insert into users (name, email, role) values ($1, $2, $3) returning id, email`,
    ["QA User", email, opts.role ?? "customer"],
  );
}

export async function makeBranch(opts: { oneWayFeeFils?: number; timeZone?: string } = {}) {
  return one<{ id: string; code: string }>(
    `insert into branches (code, name, city, emirate, address, one_way_fee_fils, time_zone)
     values ($1, 'QA Branch', 'Dubai', 'Dubai', '1 Test St', $2, $3) returning id, code`,
    [uniqueCode("QA"), opts.oneWayFeeFils ?? 15000, opts.timeZone ?? "Asia/Dubai"],
  );
}

export async function makeCategory(opts: { depositFils?: number; dailyRateFils?: number } = {}) {
  const cat = await one<{ id: string; code: string }>(
    `insert into vehicle_categories (code, name, deposit_fils) values ($1, 'QA Category', $2) returning id, code`,
    [uniqueCode("CAT"), opts.depositFils ?? 100000],
  );
  if (opts.dailyRateFils) {
    await testPool().query(
      `insert into pricing_rules (name, category_id, daily_rate_fils) values ('QA base', $1, $2)`,
      [cat.id, opts.dailyRateFils],
    );
  }
  return cat;
}

export async function makeVehicle(opts: { branchId?: string; categoryId?: string; dailyRateFils?: number } = {}) {
  const branchId = opts.branchId ?? (await makeBranch()).id;
  const categoryId = opts.categoryId ?? (await makeCategory({ dailyRateFils: opts.dailyRateFils ?? 20000 })).id;
  const v = await one<{ id: string; plate: string }>(
    `insert into vehicles (branch_id, category_id, make, model, year, plate, vin, transmission, fuel_type, seats)
     values ($1, $2, 'Toyota', 'Corolla', 2024, $3, $4, 'AUTOMATIC', 'PETROL', 5) returning id, plate`,
    [branchId, categoryId, uniqueCode("P"), uniqueVin()],
  );
  return { ...v, branchId, categoryId };
}

export const DRIVER = {
  fullName: "QA Driver",
  phone: "+971500000000",
  dateOfBirth: "1990-01-01",
  licenceNumber: "L123456",
  licenceCountry: "AE",
  licenceExpiry: "2035-01-01",
};

export type ResStatus = "PENDING" | "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED" | "EXPIRED" | "REFUNDED";

/** Insert a reservation row directly (bypassing the reserve transaction). */
export async function insertReservation(
  args: {
    userId: string;
    vehicleId: string;
    branchId: string;
    pickupAt: Date;
    returnAt: Date;
    status?: ResStatus;
    holdExpiresAt?: Date;
  },
  client?: Exec,
) {
  const status = args.status ?? "CONFIRMED";
  const hold = args.holdExpiresAt ?? (status === "PENDING" ? new Date(Date.now() + 15 * 60_000) : null);
  const r = await ex(client).query<{ id: string; reference: string }>(
    `insert into reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id,
        pickup_at, return_at, status, hold_expires_at, idempotency_key, driver,
        days, daily_rate_fils, rental_fils, vat_fils, total_fils, deposit_fils)
     values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, 1, 20000, 20000, 1000, 21000, 100000)
     returning id, reference`,
    [
      `QA-${randomBytes(4).toString("hex").toUpperCase()}`,
      args.userId,
      args.vehicleId,
      args.branchId,
      args.pickupAt,
      args.returnAt,
      status,
      hold,
      randomUUID(),
      JSON.stringify(DRIVER),
    ],
  );
  return r.rows[0];
}

export async function insertMaintenance(
  args: { vehicleId: string; startsAt: Date; endsAt: Date },
  client?: Exec,
) {
  const r = await ex(client).query<{ id: string }>(
    `insert into maintenance_blocks (vehicle_id, starts_at, ends_at, reason) values ($1, $2, $3, 'QA service') returning id`,
    [args.vehicleId, args.startsAt, args.endsAt],
  );
  return r.rows[0];
}

/** Future instant aligned to the hour: days ahead + hour (UTC). */
export function at(daysAhead: number, hourUtc = 6, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hourUtc, minute);
  return d;
}

export const isExclusionViolation = (e: unknown) => (e as { code?: string }).code === "23P01";
