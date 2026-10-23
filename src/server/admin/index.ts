// Admin back-office mutations. Every function takes the acting admin (from
// requireAdmin()) and re-checks the role, validates input with Zod, and writes
// an audit log row in the same transaction.
import { and, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import {
  auditLogs,
  branches,
  extras,
  maintenanceBlocks,
  pricingRules,
  reservations,
  users,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "../db/schema";
import { DomainError, notFound, PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, pgConstraint, pgErrorCode } from "../errors";
import { actorOf, captureDeposit, releaseDeposit, type ActingUser } from "../payments/service";

function requireAdmin(user: ActingUser) {
  if (user.role !== "admin") throw new DomainError("FORBIDDEN", "Admins only.");
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new DomainError("VALIDATION", issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input", {
      issues: r.error.issues,
    });
  }
  return r.data;
}

/** Maps unique/exclusion violations to friendly domain errors. */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === PG_UNIQUE_VIOLATION) {
      const c = pgConstraint(err) ?? "";
      const what = c.includes("plate") ? "plate" : c.includes("vin") ? "VIN" : c.includes("code") ? "code" : "value";
      throw new DomainError("CONFLICT", `That ${what} is already in use.`);
    }
    if (code === PG_EXCLUSION_VIOLATION) {
      throw new DomainError("NOT_AVAILABLE", "That period overlaps an existing booking or maintenance block.");
    }
    if (code === "23503") throw new DomainError("CONFLICT", "This record is still referenced by other data.");
    if (code === "23514") throw new DomainError("VALIDATION", `Invalid value (${pgConstraint(err) ?? "check"}).`);
    throw err;
  }
}

const isUuid = (s: string) => z.uuid().safeParse(s).success;
const fils = z.number().int().min(0).max(1_000_000_000);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// --- Branches ----------------------------------------------------------------------

export const branchInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "2-12 letters, digits or dashes"),
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  emirate: z.string().trim().min(2).max(80),
  address: z.string().trim().min(3).max(300),
  phone: z.string().trim().max(40).nullish(),
  email: z.email().nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  timeZone: z
    .string()
    .default("Asia/Dubai")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA time zone"),
  openingHours: z.string().trim().max(60).default("08:00-22:00"),
  isAirport: z.boolean().default(false),
  oneWayFeeFils: fils.default(15000),
  isActive: z.boolean().default(true),
});

export type Branch = typeof branches.$inferSelect;

export async function createBranch(admin: ActingUser, input: z.input<typeof branchInputSchema>): Promise<Branch> {
  requireAdmin(admin);
  const data = parse(branchInputSchema, input);
  return friendly(() =>
    db().transaction(async (tx) => {
      const [row] = await tx.insert(branches).values(data).returning();
      await audit(tx, actorOf(admin), { action: "branch.created", entityType: "branch", entityId: row.id, after: row });
      return row;
    }),
  );
}

export async function updateBranch(admin: ActingUser, id: string, input: Partial<z.input<typeof branchInputSchema>>): Promise<Branch> {
  requireAdmin(admin);
  const data = parse(branchInputSchema.partial(), input);
  if (!isUuid(id)) throw notFound("Branch");
  return friendly(() =>
    db().transaction(async (tx) => {
      const [before] = await tx.select().from(branches).where(eq(branches.id, id)).for("update");
      if (!before) throw notFound("Branch");
      const [row] = await tx.update(branches).set(stripUndefined(data)).where(eq(branches.id, id)).returning();
      await audit(tx, actorOf(admin), { action: "branch.updated", entityType: "branch", entityId: id, before, after: row });
      return row;
    }),
  );
}

// --- Categories ----------------------------------------------------------------------

export const categoryInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).default(""),
  depositFils: fils,
  imageUrl: z.string().max(500).nullish(),
  sortOrder: z.number().int().default(0),
});

export type VehicleCategory = typeof vehicleCategories.$inferSelect;

export async function createCategory(admin: ActingUser, input: z.input<typeof categoryInputSchema>): Promise<VehicleCategory> {
  requireAdmin(admin);
  const data = parse(categoryInputSchema, input);
  return friendly(() =>
    db().transaction(async (tx) => {
      const [row] = await tx.insert(vehicleCategories).values(data).returning();
      await audit(tx, actorOf(admin), { action: "category.created", entityType: "vehicle_category", entityId: row.id, after: row });
      return row;
    }),
  );
}

export async function updateCategory(admin: ActingUser, id: string, input: Partial<z.input<typeof categoryInputSchema>>): Promise<VehicleCategory> {
  requireAdmin(admin);
  const data = parse(categoryInputSchema.partial(), input);
  if (!isUuid(id)) throw notFound("Category");
  return friendly(() =>
    db().transaction(async (tx) => {
      const [before] = await tx.select().from(vehicleCategories).where(eq(vehicleCategories.id, id)).for("update");
      if (!before) throw notFound("Category");
      const [row] = await tx.update(vehicleCategories).set(stripUndefined(data)).where(eq(vehicleCategories.id, id)).returning();
      await audit(tx, actorOf(admin), { action: "category.updated", entityType: "vehicle_category", entityId: id, before, after: row });
      return row;
    }),
  );
}

// --- Vehicles -------------------------------------------------------------------------

export const vehicleInputSchema = z.object({
  branchId: z.uuid(),
  categoryId: z.uuid(),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  plate: z.string().trim().toUpperCase().min(2).max(20),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q)"),
  color: z.string().trim().max(40).nullish(),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: z.number().int().min(1).max(20),
  doors: z.number().int().min(2).max(6).default(4),
  luggage: z.number().int().min(0).max(20).default(2),
  mileageKm: z.number().int().min(0).default(0),
  photoUrls: z.array(z.string().max(1000)).max(20).default([]),
  description: z.string().max(4000).default(""),
  /** Feature codes, e.g. ["AC", "BLUETOOTH"]. */
  featureCodes: z.array(z.string()).max(50).optional(),
});

export type Vehicle = typeof vehicles.$inferSelect;

export async function createVehicle(admin: ActingUser, input: z.input<typeof vehicleInputSchema>): Promise<Vehicle> {
  requireAdmin(admin);
  const { featureCodes, ...data } = parse(vehicleInputSchema, input);
  return friendly(() =>
    db().transaction(async (tx) => {
      const [row] = await tx.insert(vehicles).values(data).returning();
      if (featureCodes) await setFeatures(tx, row.id, featureCodes);
      await audit(tx, actorOf(admin), { action: "vehicle.created", entityType: "vehicle", entityId: row.id, after: { ...row, featureCodes } });
      return row;
    }),
  );
}

export async function updateVehicle(admin: ActingUser, id: string, input: Partial<z.input<typeof vehicleInputSchema>>): Promise<Vehicle> {
  requireAdmin(admin);
  const { featureCodes, ...data } = parse(vehicleInputSchema.partial(), input);
  if (!isUuid(id)) throw notFound("Vehicle");
  return friendly(() =>
    db().transaction(async (tx) => {
      const [before] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
      if (!before) throw notFound("Vehicle");
      if (data.branchId && data.branchId !== before.branchId) await assertNoFutureBookings(tx, id, "move this car to another branch");
      const patch = stripUndefined(data);
      const [row] = Object.keys(patch).length
        ? await tx.update(vehicles).set(patch).where(eq(vehicles.id, id)).returning()
        : [before];
      if (featureCodes) await setFeatures(tx, id, featureCodes);
      await audit(tx, actorOf(admin), { action: "vehicle.updated", entityType: "vehicle", entityId: id, before, after: { ...row, featureCodes } });
      return row;
    }),
  );
}

type TxLike = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

async function setFeatures(tx: TxLike, vehicleId: string, codes: string[]) {
  const unique = [...new Set(codes.map((c) => c.toUpperCase()))];
  const found = unique.length ? await tx.select().from(vehicleFeatures).where(inArray(vehicleFeatures.code, unique)) : [];
  const missing = unique.filter((c) => !found.some((f) => f.code === c));
  if (missing.length) throw new DomainError("VALIDATION", `Unknown feature(s): ${missing.join(", ")}`);
  await tx.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, vehicleId));
  if (found.length) await tx.insert(vehicleFeatureMap).values(found.map((f) => ({ vehicleId, featureId: f.id })));
}

async function assertNoFutureBookings(tx: TxLike, vehicleId: string, what: string) {
  const rows = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.vehicleId, vehicleId),
        inArray(reservations.status, ["PENDING", "CONFIRMED", "PICKED_UP"]),
        gt(reservations.returnAt, new Date()),
      ),
    )
    .limit(1);
  if (rows.length) throw new DomainError("POLICY", `Cannot ${what}: it has active or upcoming bookings.`);
}

/**
 * Sets the fleet status. RETIRED and MAINTENANCE take the car out of search;
 * retiring is refused while it has active or upcoming bookings. ON_RENT is set
 * only by check-out.
 */
export async function setVehicleStatus(
  admin: ActingUser,
  id: string,
  status: "AVAILABLE" | "RESERVED" | "MAINTENANCE" | "RETIRED",
): Promise<Vehicle> {
  requireAdmin(admin);
  parse(z.enum(["AVAILABLE", "RESERVED", "MAINTENANCE", "RETIRED"]), status);
  if (!isUuid(id)) throw notFound("Vehicle");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
    if (!before) throw notFound("Vehicle");
    if (before.status === "ON_RENT") throw new DomainError("INVALID_STATE", "The car is on rent; check it in first.");
    if (status === "RETIRED") await assertNoFutureBookings(tx, id, "retire this car");
    const [row] = await tx.update(vehicles).set({ status }).where(eq(vehicles.id, id)).returning();
    await audit(tx, actorOf(admin), {
      action: "vehicle.status_changed",
      entityType: "vehicle",
      entityId: id,
      before: { status: before.status },
      after: { status },
    });
    return row;
  });
}

export async function listFleet(filters: { branchId?: string; status?: Vehicle["status"]; categoryId?: string } = {}) {
  const conds: SQL[] = [];
  if (filters.branchId) conds.push(eq(vehicles.branchId, filters.branchId));
  if (filters.status) conds.push(eq(vehicles.status, filters.status));
  if (filters.categoryId) conds.push(eq(vehicles.categoryId, filters.categoryId));
  return db()
    .select({
      vehicle: vehicles,
      branchName: branches.name,
      branchCode: branches.code,
      categoryName: vehicleCategories.name,
      featureCodes: sql<string[]>`coalesce((SELECT array_agg(f.code ORDER BY f.code) FROM vehicle_feature_map m JOIN vehicle_features f ON f.id = m.feature_id WHERE m.vehicle_id = ${vehicles.id}), '{}')`,
    })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(branches.name, vehicles.make, vehicles.model);
}

// --- Pricing rules ------------------------------------------------------------------

export const pricingRuleInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    categoryId: z.uuid(),
    vehicleId: z.uuid().nullish(),
    branchId: z.uuid().nullish(),
    dailyRateFils: z.number().int().positive().max(100_000_000),
    minDays: z.number().int().min(1).max(365).default(1),
    validFrom: dateStr.nullish(),
    validTo: dateStr.nullish(),
    priority: z.number().int().min(-1000).max(1000).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((r) => !r.validFrom || !r.validTo || r.validFrom <= r.validTo, { message: "validFrom must be on or before validTo", path: ["validTo"] });

export type PricingRule = typeof pricingRules.$inferSelect;

export async function listPricingRules(categoryId?: string): Promise<PricingRule[]> {
  return db()
    .select()
    .from(pricingRules)
    .where(categoryId ? eq(pricingRules.categoryId, categoryId) : undefined)
    .orderBy(pricingRules.categoryId, desc(pricingRules.priority), pricingRules.minDays);
}

export async function createPricingRule(admin: ActingUser, input: z.input<typeof pricingRuleInputSchema>): Promise<PricingRule> {
  requireAdmin(admin);
  const data = parse(pricingRuleInputSchema, input);
  return friendly(() =>
    db().transaction(async (tx) => {
      const [row] = await tx.insert(pricingRules).values(data).returning();
      await audit(tx, actorOf(admin), { action: "pricing_rule.created", entityType: "pricing_rule", entityId: row.id, after: row });
      return row;
    }),
  );
}

export async function updatePricingRule(
  admin: ActingUser,
  id: string,
  input: Partial<z.input<typeof pricingRuleInputSchema>>,
): Promise<PricingRule> {
  requireAdmin(admin);
  if (!isUuid(id)) throw notFound("Pricing rule");
  return friendly(() =>
    db().transaction(async (tx) => {
      const [before] = await tx.select().from(pricingRules).where(eq(pricingRules.id, id)).for("update");
      if (!before) throw notFound("Pricing rule");
      const merged = parse(pricingRuleInputSchema, { ...before, ...input });
      const [row] = await tx.update(pricingRules).set(merged).where(eq(pricingRules.id, id)).returning();
      await audit(tx, actorOf(admin), { action: "pricing_rule.updated", entityType: "pricing_rule", entityId: id, before, after: row });
      return row;
    }),
  );
}

/** Deletes a rule. Existing reservations keep their stored prices. */
export async function deletePricingRule(admin: ActingUser, id: string): Promise<void> {
  requireAdmin(admin);
  if (!isUuid(id)) throw notFound("Pricing rule");
  await db().transaction(async (tx) => {
    const [before] = await tx.delete(pricingRules).where(eq(pricingRules.id, id)).returning();
    if (!before) throw notFound("Pricing rule");
    await audit(tx, actorOf(admin), { action: "pricing_rule.deleted", entityType: "pricing_rule", entityId: id, before });
  });
}

// --- Extras -----------------------------------------------------------------------------

export const extraInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).default(""),
  pricing: z.enum(["PER_DAY", "PER_RENTAL"]),
  priceFils: fils,
  maxQuantity: z.number().int().min(1).max(10).default(1),
  maxChargeFils: z.number().int().positive().nullish(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type Extra = typeof extras.$inferSelect;

export async function createExtra(admin: ActingUser, input: z.input<typeof extraInputSchema>): Promise<Extra> {
  requireAdmin(admin);
  const data = parse(extraInputSchema, input);
  return friendly(() =>
    db().transaction(async (tx) => {
      const [row] = await tx.insert(extras).values(data).returning();
      await audit(tx, actorOf(admin), { action: "extra.created", entityType: "extra", entityId: row.id, after: row });
      return row;
    }),
  );
}

export async function updateExtra(admin: ActingUser, id: string, input: Partial<z.input<typeof extraInputSchema>>): Promise<Extra> {
  requireAdmin(admin);
  const data = parse(extraInputSchema.partial(), input);
  if (!isUuid(id)) throw notFound("Extra");
  return friendly(() =>
    db().transaction(async (tx) => {
      const [before] = await tx.select().from(extras).where(eq(extras.id, id)).for("update");
      if (!before) throw notFound("Extra");
      const [row] = await tx.update(extras).set(stripUndefined(data)).where(eq(extras.id, id)).returning();
      await audit(tx, actorOf(admin), { action: "extra.updated", entityType: "extra", entityId: id, before, after: row });
      return row;
    }),
  );
}

// --- Maintenance blocks -------------------------------------------------------------------

export const maintenanceInputSchema = z
  .object({
    vehicleId: z.uuid(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((m) => m.endsAt.getTime() > m.startsAt.getTime(), { message: "End must be after start", path: ["endsAt"] });

export type MaintenanceBlock = typeof maintenanceBlocks.$inferSelect;

/** Blocks a vehicle for maintenance. Fails with NOT_AVAILABLE if it overlaps a booking. */
export async function createMaintenanceBlock(admin: ActingUser, input: z.input<typeof maintenanceInputSchema>): Promise<MaintenanceBlock> {
  requireAdmin(admin);
  const data = parse(maintenanceInputSchema, input);
  return friendly(() =>
    db().transaction(async (tx) => {
      // Same lock order as reserve(): vehicle row first.
      const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, data.vehicleId)).for("update");
      if (!v) throw notFound("Vehicle");
      const [row] = await tx.insert(maintenanceBlocks).values({ ...data, createdBy: admin.id }).returning();
      await audit(tx, actorOf(admin), { action: "maintenance.created", entityType: "maintenance_block", entityId: row.id, after: row });
      return row;
    }),
  );
}

export async function deleteMaintenanceBlock(admin: ActingUser, id: string): Promise<void> {
  requireAdmin(admin);
  if (!isUuid(id)) throw notFound("Maintenance block");
  await db().transaction(async (tx) => {
    const [before] = await tx.delete(maintenanceBlocks).where(eq(maintenanceBlocks.id, id)).returning();
    if (!before) throw notFound("Maintenance block");
    await audit(tx, actorOf(admin), { action: "maintenance.deleted", entityType: "maintenance_block", entityId: id, before });
  });
}

export async function listMaintenanceBlocks(vehicleId?: string): Promise<MaintenanceBlock[]> {
  return db()
    .select()
    .from(maintenanceBlocks)
    .where(vehicleId ? eq(maintenanceBlocks.vehicleId, vehicleId) : undefined)
    .orderBy(maintenanceBlocks.startsAt);
}

// --- Users & audit -------------------------------------------------------------------------

export async function listUsers() {
  return db()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(users.createdAt);
}

export async function setUserRole(admin: ActingUser, userId: string, role: "customer" | "admin") {
  requireAdmin(admin);
  parse(z.enum(["customer", "admin"]), role);
  if (userId === admin.id && role !== "admin") throw new DomainError("POLICY", "You cannot remove your own admin role.");
  return db().transaction(async (tx) => {
    const [before] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).for("update");
    if (!before) throw notFound("User");
    await tx.update(users).set({ role }).where(eq(users.id, userId));
    await audit(tx, actorOf(admin), { action: "user.role_changed", entityType: "user", entityId: userId, before, after: { role } });
  });
}

export type AuditLog = typeof auditLogs.$inferSelect;

export async function listAuditLogs(filters: { entityType?: string; entityId?: string; limit?: number } = {}): Promise<AuditLog[]> {
  const conds: SQL[] = [];
  if (filters.entityType) conds.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.entityId && isUuid(filters.entityId)) conds.push(eq(auditLogs.entityId, filters.entityId));
  return db()
    .select()
    .from(auditLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(filters.limit ?? 100, 500));
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export { adminRefund } from "../payments/service";

/** Admin: release the held deposit in full. */
export async function adminReleaseDeposit(admin: ActingUser, reservationId: string) {
  requireAdmin(admin);
  return releaseDeposit(reservationId, actorOf(admin), "released by admin");
}

/** Admin: capture part of the held deposit (the rest is released). Returns captured fils. */
export async function adminCaptureDeposit(admin: ActingUser, reservationId: string, amountFils: number, reason: string) {
  requireAdmin(admin);
  return captureDeposit(reservationId, amountFils, actorOf(admin), reason);
}
export { getReservationAdmin, listReservations, cancelReservation, type ReservationFilters } from "../reservations";
export {
  checkIn,
  checkOut,
  chargeDamage,
  createDamageReport,
  getDamageReport,
  listDamageReports,
  previewLateFee,
  updateDamageReport,
} from "../reservations/operations";
