// Helpers for db-agent integration tests (src/server/**/*.test.ts). They run
// against TEST_DATABASE_URL, apply migrations once (under an advisory lock so
// parallel test files don't race), and create uniquely-named fixtures so tests
// never need to truncate shared tables.
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const MIGRATION_LOCK = 72_011_001;

/** Point the app at the test database and make sure it is migrated. Call in beforeAll. */
export async function prepareTestDatabase(): Promise<void> {
  config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set (see .env.example)");
  if (!/test/i.test(new URL(url).pathname)) throw new Error(`Refusing to run tests against ${new URL(url).pathname}`);
  process.env.DATABASE_URL = url;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    const { rows } = await pool.query<{ ok: boolean }>(
      "SELECT to_regclass('public.vehicle_blocks') IS NOT NULL AS ok",
    );
    // Run the migrator unless the schema is present (migrate() is idempotent either way).
    if (!rows[0].ok) await pool.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await pool.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    await pool.end();
  }
}

const ALPHA = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
export function uniqueCode(prefix = "T", len = 8): string {
  const b = randomBytes(len);
  let s = prefix;
  for (let i = 0; i < len; i++) s += ALPHA[b[i] % ALPHA.length];
  return s;
}

export interface Fixture {
  pickupBranchId: string;
  returnBranchId: string;
  categoryId: string;
  vehicleId: string;
  vehicleIds: string[];
  extraId: string;
  extraCode: string;
  userId: string;
  otherUserId: string;
  adminId: string;
  dailyRateFils: number;
  depositFils: number;
  oneWayFeeFils: number;
}

/** Creates two branches, a category with a base rate, N vehicles, an extra and three users. */
export async function createFixture(opts: { vehicles?: number; dailyRateFils?: number; depositFils?: number } = {}): Promise<Fixture> {
  const { db } = await import("./index");
  const s = await import("./schema");
  const d = db();
  const dailyRateFils = opts.dailyRateFils ?? 10000;
  const depositFils = opts.depositFils ?? 100000;
  const [b1, b2] = await d
    .insert(s.branches)
    .values([
      { code: uniqueCode("A"), name: "Test A", city: "Dubai", emirate: "Dubai", address: "1 Test St" },
      { code: uniqueCode("B"), name: "Test B", city: "Abu Dhabi", emirate: "Abu Dhabi", address: "2 Test St", oneWayFeeFils: 20000 },
    ])
    .returning();
  const [cat] = await d
    .insert(s.vehicleCategories)
    .values({ code: uniqueCode("C"), name: "Test category", depositFils })
    .returning();
  await d.insert(s.pricingRules).values({ name: "base", categoryId: cat.id, dailyRateFils });
  const vehicles = await d
    .insert(s.vehicles)
    .values(
      Array.from({ length: opts.vehicles ?? 1 }, () => ({
        branchId: b1.id,
        categoryId: cat.id,
        make: "Test",
        model: "Car",
        year: 2025,
        plate: uniqueCode("P"),
        vin: uniqueCode("", 17),
        transmission: "AUTOMATIC" as const,
        fuelType: "PETROL" as const,
        seats: 5,
        mileageKm: 1000,
      })),
    )
    .returning();
  const extraCode = uniqueCode("X_");
  const [extra] = await d
    .insert(s.extras)
    .values({ code: extraCode, name: "Test seat", pricing: "PER_DAY", priceFils: 2500, maxQuantity: 2 })
    .returning();
  const mkUser = async (role: "customer" | "admin") => {
    const [u] = await d
      .insert(s.users)
      .values({ name: `Test ${role}`, email: `${randomUUID()}@test.driveeasy`, role })
      .returning();
    return u.id;
  };
  const userId = await mkUser("customer");
  const otherUserId = await mkUser("customer");
  const adminId = await mkUser("admin");
  for (const uid of [userId, otherUserId]) {
    await d.insert(s.driverProfiles).values({
      userId: uid,
      fullName: "Test Driver",
      phone: "+971500000000",
      dateOfBirth: "1990-01-01",
      licenceNumber: "L123456",
      licenceCountry: "AE",
      licenceExpiry: "2099-01-01",
    });
  }
  return {
    pickupBranchId: b1.id,
    returnBranchId: b2.id,
    categoryId: cat.id,
    vehicleId: vehicles[0].id,
    vehicleIds: vehicles.map((v) => v.id),
    extraId: extra.id,
    extraCode,
    userId,
    otherUserId,
    adminId,
    dailyRateFils,
    depositFils,
    oneWayFeeFils: 20000,
  };
}

/** A fixed future instant: `days` days and `hours` hours after 2030-01-01T06:00Z (10:00 Dubai). */
export function future(days: number, hours = 0): Date {
  return new Date(Date.UTC(2030, 0, 1, 6) + days * 86_400_000 + hours * 3_600_000);
}
