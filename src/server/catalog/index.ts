// Public read-side queries: branches, categories, extras, vehicle search and
// availability. Safe to call from server components for anonymous visitors.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  branches,
  extras,
  pricingRules,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "../db/schema";
import { getEnv } from "../env";
import { DomainError } from "../errors";
import { computeQuote, localDate, MAX_RENTAL_DAYS, rentalDays, selectPricingRule } from "../pricing";

export type Branch = typeof branches.$inferSelect;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type VehicleFeature = typeof vehicleFeatures.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;

export interface VehicleDetails extends VehicleRow {
  branch: Branch;
  category: VehicleCategory;
  features: VehicleFeature[];
}

const isUuid = (s: string) => z.uuid().safeParse(s).success;

export async function listBranches(opts: { includeInactive?: boolean } = {}): Promise<Branch[]> {
  return db()
    .select()
    .from(branches)
    .where(opts.includeInactive ? undefined : eq(branches.isActive, true))
    .orderBy(asc(branches.name));
}

/** Branch by UUID or by code (case-insensitive, e.g. "dxb"). */
export async function getBranch(idOrCode: string): Promise<Branch | null> {
  const where = isUuid(idOrCode) ? eq(branches.id, idOrCode) : eq(branches.code, idOrCode.toUpperCase());
  const [row] = await db().select().from(branches).where(where);
  return row ?? null;
}

export async function listCategories(): Promise<VehicleCategory[]> {
  return db().select().from(vehicleCategories).orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.name));
}

export async function listExtras(opts: { includeInactive?: boolean } = {}): Promise<Extra[]> {
  return db()
    .select()
    .from(extras)
    .where(opts.includeInactive ? undefined : eq(extras.isActive, true))
    .orderBy(asc(extras.sortOrder), asc(extras.name));
}

export async function listFeatures(): Promise<VehicleFeature[]> {
  return db().select().from(vehicleFeatures).orderBy(asc(vehicleFeatures.name));
}

export async function getVehicle(id: string): Promise<VehicleDetails | null> {
  if (!isUuid(id)) return null;
  const [row] = await db()
    .select({ v: vehicles, branch: branches, category: vehicleCategories })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, id));
  if (!row) return null;
  const features = await featuresFor([id]);
  return { ...row.v, branch: row.branch, category: row.category, features: features.get(id) ?? [] };
}

async function featuresFor(vehicleIds: string[]): Promise<Map<string, VehicleFeature[]>> {
  const map = new Map<string, VehicleFeature[]>();
  if (vehicleIds.length === 0) return map;
  const rows = await db()
    .select({ vehicleId: vehicleFeatureMap.vehicleId, f: vehicleFeatures })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(inArray(vehicleFeatureMap.vehicleId, vehicleIds))
    .orderBy(asc(vehicleFeatures.name));
  for (const r of rows) map.set(r.vehicleId, [...(map.get(r.vehicleId) ?? []), r.f]);
  return map;
}

/**
 * SQL condition: vehicle `vehicleIdCol` has no blocking period overlapping
 * [from, to). PENDING holds that have already expired (but were not released
 * yet) do not block.
 */
export function noBlockingOverlap(vehicleIdCol: unknown, from: Date, to: Date, now: Date) {
  return sql`NOT EXISTS (
    SELECT 1 FROM vehicle_blocks b
    LEFT JOIN reservations r ON r.id = b.reservation_id
    WHERE b.vehicle_id = ${vehicleIdCol}
      AND b.period && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')
      AND (r.id IS NULL OR NOT (r.status = 'PENDING' AND r.hold_expires_at <= ${now.toISOString()}::timestamptz))
  )`;
}

export const searchInputSchema = z
  .object({
    pickupBranchId: z.uuid(),
    returnBranchId: z.uuid().optional(),
    pickupAt: z.coerce.date(),
    returnAt: z.coerce.date(),
    categoryId: z.uuid().optional(),
    transmission: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
    fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]).optional(),
    minSeats: z.number().int().min(1).max(20).optional(),
    maxDailyRateFils: z.number().int().positive().optional(),
    featureCodes: z.array(z.string()).optional(),
    sort: z.enum(["price_asc", "price_desc", "seats_desc", "name"]).default("price_asc"),
  })
  .refine((q) => q.returnAt.getTime() > q.pickupAt.getTime(), { message: "Return must be after pick-up", path: ["returnAt"] })
  .refine((q) => rentalDays(q.pickupAt, q.returnAt) <= MAX_RENTAL_DAYS, {
    message: `Rentals are limited to ${MAX_RENTAL_DAYS} days`,
    path: ["returnAt"],
  });

export type SearchInput = z.input<typeof searchInputSchema>;

export interface SearchResult {
  vehicle: VehicleDetails;
  days: number;
  dailyRateFils: number;
  rentalFils: number;
  oneWayFeeFils: number;
  vatFils: number;
  /** Estimated total without extras, VAT included. */
  estimatedTotalFils: number;
  depositFils: number;
}

/** Vehicles at the pick-up branch that are free for the whole period, with prices. */
export async function searchAvailableVehicles(input: SearchInput, now = new Date()): Promise<SearchResult[]> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid search");
  const q = parsed.data;
  if (q.pickupAt.getTime() < now.getTime() - 5 * 60 * 1000) {
    throw new DomainError("VALIDATION", "Pick-up time must be in the future.");
  }

  const branchRows = await db()
    .select()
    .from(branches)
    .where(inArray(branches.id, [q.pickupBranchId, q.returnBranchId ?? q.pickupBranchId]));
  const pickupBranch = branchRows.find((b) => b.id === q.pickupBranchId);
  const returnBranch = branchRows.find((b) => b.id === (q.returnBranchId ?? q.pickupBranchId));
  if (!pickupBranch?.isActive || !returnBranch?.isActive) throw new DomainError("NOT_FOUND", "Branch not found");

  const conds = [
    eq(vehicles.branchId, q.pickupBranchId),
    inArray(vehicles.status, ["AVAILABLE", "RESERVED", "ON_RENT"]),
    noBlockingOverlap(vehicles.id, q.pickupAt, q.returnAt, now),
  ];
  if (q.categoryId) conds.push(eq(vehicles.categoryId, q.categoryId));
  if (q.transmission) conds.push(eq(vehicles.transmission, q.transmission));
  if (q.fuelType) conds.push(eq(vehicles.fuelType, q.fuelType));
  if (q.minSeats) conds.push(sql`${vehicles.seats} >= ${q.minSeats}`);
  if (q.featureCodes?.length) {
    conds.push(sql`(
      SELECT count(DISTINCT f.code) FROM vehicle_feature_map m JOIN vehicle_features f ON f.id = m.feature_id
      WHERE m.vehicle_id = ${vehicles.id} AND f.code IN ${q.featureCodes}
    ) = ${new Set(q.featureCodes).size}`);
  }

  const rows = await db()
    .select({ v: vehicles, category: vehicleCategories })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(and(...conds));
  if (rows.length === 0) return [];

  const categoryIds = [...new Set(rows.map((r) => r.v.categoryId))];
  const rules = await db()
    .select()
    .from(pricingRules)
    .where(and(inArray(pricingRules.categoryId, categoryIds), eq(pricingRules.isActive, true)));
  const features = await featuresFor(rows.map((r) => r.v.id));
  const days = rentalDays(q.pickupAt, q.returnAt);
  const pickupDate = localDate(q.pickupAt, pickupBranch.timeZone);
  const vatBps = getEnv().VAT_RATE_BPS;

  const results: SearchResult[] = [];
  for (const { v, category } of rows) {
    const rule = selectPricingRule(rules, {
      categoryId: v.categoryId,
      vehicleId: v.id,
      branchId: pickupBranch.id,
      pickupDate,
      days,
    });
    if (!rule) continue;
    const price = computeQuote({
      pickupAt: q.pickupAt,
      returnAt: q.returnAt,
      dailyRateFils: rule.dailyRateFils,
      extras: [],
      oneWay: pickupBranch.id !== returnBranch.id,
      oneWayFeeFils: returnBranch.oneWayFeeFils,
      depositFils: category.depositFils,
      vatBps,
    });
    if (q.maxDailyRateFils && price.dailyRateFils > q.maxDailyRateFils) continue;
    results.push({
      vehicle: { ...v, branch: pickupBranch, category, features: features.get(v.id) ?? [] },
      days,
      dailyRateFils: price.dailyRateFils,
      rentalFils: price.rentalFils,
      oneWayFeeFils: price.oneWayFeeFils,
      vatFils: price.vatFils,
      estimatedTotalFils: price.totalFils,
      depositFils: price.depositFils,
    });
  }
  const name = (r: SearchResult) => `${r.vehicle.make} ${r.vehicle.model}`;
  results.sort((a, b) =>
    q.sort === "name"
      ? name(a).localeCompare(name(b))
      : q.sort === "seats_desc"
        ? b.vehicle.seats - a.vehicle.seats || a.estimatedTotalFils - b.estimatedTotalFils
      : q.sort === "price_desc"
        ? b.estimatedTotalFils - a.estimatedTotalFils || name(a).localeCompare(name(b))
        : a.estimatedTotalFils - b.estimatedTotalFils || name(a).localeCompare(name(b)),
  );
  return results;
}

export interface BlockedRange {
  start: Date;
  end: Date;
  kind: "reservation" | "maintenance";
}

export interface DayAvailability {
  /** Local date at the vehicle's branch, YYYY-MM-DD. */
  date: string;
  /** False if any blocking period touches this local day. */
  available: boolean;
}

export interface VehicleAvailability {
  vehicleId: string;
  timeZone: string;
  blocks: BlockedRange[];
  days: DayAvailability[];
}

/**
 * Blocking periods for a vehicle in [from, to), plus a per-day calendar in the
 * branch's time zone. Does not reveal who booked. Max range 400 days.
 */
export async function getVehicleAvailability(
  vehicleId: string,
  from: Date,
  to: Date,
  now = new Date(),
): Promise<VehicleAvailability> {
  if (!isUuid(vehicleId)) throw new DomainError("NOT_FOUND", "Vehicle not found");
  if (!(to.getTime() > from.getTime())) throw new DomainError("VALIDATION", "Invalid date range");
  if (to.getTime() - from.getTime() > 400 * 86_400_000) throw new DomainError("VALIDATION", "Date range too long");

  const [v] = await db()
    .select({ id: vehicles.id, status: vehicles.status, timeZone: branches.timeZone })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, vehicleId));
  if (!v) throw new DomainError("NOT_FOUND", "Vehicle not found");

  const { rows } = await db().execute<{ start: Date; end: Date; kind: "reservation" | "maintenance" }>(sql`
    SELECT lower(b.period) AS start, upper(b.period) AS "end",
           CASE WHEN b.maintenance_block_id IS NOT NULL THEN 'maintenance' ELSE 'reservation' END AS kind
    FROM vehicle_blocks b
    LEFT JOIN reservations r ON r.id = b.reservation_id
    WHERE b.vehicle_id = ${vehicleId}
      AND b.period && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, '[)')
      AND (r.id IS NULL OR NOT (r.status = 'PENDING' AND r.hold_expires_at <= ${now.toISOString()}::timestamptz))
    ORDER BY lower(b.period)
  `);
  const blocks = rows.map((r) => ({ start: new Date(r.start), end: new Date(r.end), kind: r.kind }));
  const outOfService = v.status === "RETIRED" || v.status === "MAINTENANCE";

  const days: DayAvailability[] = [];
  const seen = new Set<string>();
  for (let t = from.getTime(); t < to.getTime(); t += 3_600_000) {
    const date = localDate(new Date(t), v.timeZone);
    if (seen.has(date)) continue;
    seen.add(date);
    days.push({ date, available: true });
  }
  for (const b of blocks) {
    for (let t = b.start.getTime(); t < b.end.getTime(); t += 3_600_000) {
      const d = days.find((x) => x.date === localDate(new Date(t), v.timeZone));
      if (d) d.available = false;
    }
    const last = days.find((x) => x.date === localDate(new Date(b.end.getTime() - 1), v.timeZone));
    if (last) last.available = false;
  }
  if (outOfService) for (const d of days) d.available = false;
  return { vehicleId, timeZone: v.timeZone, blocks, days };
}
