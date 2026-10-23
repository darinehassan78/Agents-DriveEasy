// Reservation lifecycle: reserve (hold), read models, modify dates, cancel.
// Payment/confirmation lives in ../payments/service.ts; check-out/in in ./operations.ts.
import { randomInt } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audit, SYSTEM } from "../audit";
import { db, type Tx } from "../db";
import {
  branches,
  deposits,
  driverProfiles,
  extras,
  payments,
  rentalAgreements,
  reservationExtras,
  reservations,
  users,
  vehicleCategories,
  vehicles,
  type DriverSnapshot,
} from "../db/schema";
import { getEnv } from "../env";
import {
  DomainError,
  notAvailable,
  notFound,
  PG_EXCLUSION_VIOLATION,
  PG_UNIQUE_VIOLATION,
  pgConstraint,
  pgErrorCode,
} from "../errors";
import { log } from "../log";
import {
  actorOf,
  chargeAdditional,
  netPaidFils,
  refundReservation,
  releaseDeposit,
  type ActingUser,
  type FakeOutcome,
} from "../payments/service";
import { cancellationQuote, parseQuoteInput, quoteWith, type CancellationQuote, type Quote, type QuoteInput } from "../pricing";

export type { ActingUser } from "../payments/service";
type ReservationRow = typeof reservations.$inferSelect;

export const BLOCKING_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP"] as const;
const PG_DEADLOCK = "40P01";
const PG_SERIALIZATION = "40001";

// --- Validation ------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const driverSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  dateOfBirth: isoDate,
  licenceNumber: z.string().trim().min(3).max(40),
  licenceCountry: z.string().trim().min(2).max(60),
  licenceExpiry: isoDate,
  nationality: z.string().trim().max(60).nullish(),
});

export const MIN_DRIVER_AGE = 21;

/** Throws VALIDATION if the driver is under 21 at pick-up or the licence expires before return. */
export function assertDriverEligible(driver: DriverSnapshot, pickupAt: Date, returnAt: Date): void {
  const dob = new Date(`${driver.dateOfBirth}T00:00:00Z`);
  const ageLimit = new Date(Date.UTC(dob.getUTCFullYear() + MIN_DRIVER_AGE, dob.getUTCMonth(), dob.getUTCDate()));
  if (Number.isNaN(dob.getTime()) || ageLimit.getTime() > pickupAt.getTime()) {
    throw new DomainError("VALIDATION", `Drivers must be at least ${MIN_DRIVER_AGE} years old at pick-up.`);
  }
  const expiry = new Date(`${driver.licenceExpiry}T23:59:59Z`);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() < returnAt.getTime()) {
    throw new DomainError("VALIDATION", "The driving licence must be valid until the end of the rental.");
  }
}

export interface ReserveInput extends QuoteInput {
  userId: string;
  /** Stable per booking attempt (e.g. a UUID created when the checkout page loads). */
  idempotencyKey: string;
  /** Driver details; defaults to the user's saved driver profile. */
  driver?: z.input<typeof driverSchema>;
}

export interface ReserveResult {
  reservationId: string;
  reference: string;
  status: ReservationRow["status"];
  holdExpiresAt: Date | null;
  quote: Quote;
  /** True when this call returned an existing reservation for the same idempotency key. */
  replayed: boolean;
}

// --- Reserve -----------------------------------------------------------------------

/**
 * Creates a PENDING reservation that holds the vehicle for HOLD_TTL_MINUTES.
 *
 * In one transaction: lock the vehicle row (SELECT ... FOR UPDATE), expire stale
 * holds on that vehicle, check for overlapping reservations/maintenance,
 * price on the server, insert the reservation (+ extras). The exclusion
 * constraint on vehicle_blocks is the final guard: a conflicting insert fails
 * with 23P01 (or 40P01 under contention), mapped to NOT_AVAILABLE.
 */
export async function reserve(input: ReserveInput, opts: { now?: Date } = {}): Promise<ReserveResult> {
  const now = opts.now ?? new Date();
  const q = parseQuoteInput(input);
  if (!z.uuid().safeParse(input.userId).success) throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.");
  const key = z.string().trim().min(8).max(200).safeParse(input.idempotencyKey);
  if (!key.success) throw new DomainError("VALIDATION", "Missing booking request id.");
  if (q.pickupAt.getTime() <= now.getTime()) throw new DomainError("VALIDATION", "Pick-up time must be in the future.");

  const replay = await findByIdempotencyKey(input.userId, key.data);
  if (replay) return replay;

  const driver = await resolveDriver(input.userId, input.driver);
  assertDriverEligible(driver, q.pickupAt, q.returnAt);
  const ttlMs = getEnv().HOLD_TTL_MINUTES * 60_000;

  try {
    return await db().transaction(async (tx) => {
      const [vehicle] = await tx
        .select({ id: vehicles.id, status: vehicles.status })
        .from(vehicles)
        .where(eq(vehicles.id, q.vehicleId))
        .for("update");
      if (!vehicle) throw notFound("Vehicle");
      if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") throw notAvailable();

      await expireStaleHolds(tx, { vehicleId: vehicle.id, now });

      const overlap = await tx.execute(sql`
        SELECT 1 FROM vehicle_blocks
        WHERE vehicle_id = ${vehicle.id}
          AND period && tstzrange(${q.pickupAt.toISOString()}::timestamptz, ${q.returnAt.toISOString()}::timestamptz, '[)')
        LIMIT 1`);
      if (overlap.rows.length > 0) throw notAvailable();

      const quote = await quoteWith(tx, q);
      const [row] = await tx
        .insert(reservations)
        .values({
          reference: newReference(),
          userId: input.userId,
          vehicleId: quote.vehicleId,
          pickupBranchId: quote.pickupBranchId,
          returnBranchId: quote.returnBranchId,
          pickupAt: quote.pickupAt,
          returnAt: quote.returnAt,
          status: "PENDING",
          holdExpiresAt: new Date(now.getTime() + ttlMs),
          idempotencyKey: key.data,
          driver,
          days: quote.days,
          dailyRateFils: quote.dailyRateFils,
          rentalFils: quote.rentalFils,
          extrasFils: quote.extrasFils,
          oneWayFeeFils: quote.oneWayFeeFils,
          vatFils: quote.vatFils,
          totalFils: quote.totalFils,
          depositFils: quote.depositFils,
          pricingRuleId: quote.pricingRuleId,
          createdAt: now,
        })
        .returning();
      if (quote.extras.length) {
        await tx.insert(reservationExtras).values(
          quote.extras.map((e) => ({
            reservationId: row.id,
            extraId: e.extraId,
            quantity: e.quantity,
            pricing: e.pricing,
            unitPriceFils: e.unitPriceFils,
            totalFils: e.totalFils,
          })),
        );
      }
      await audit(tx, { userId: input.userId, type: "customer" }, {
        action: "reservation.created",
        entityType: "reservation",
        entityId: row.id,
        after: { status: row.status, totalFils: row.totalFils, pickupAt: row.pickupAt, returnAt: row.returnAt, vehicleId: row.vehicleId },
        metadata: { reference: row.reference, holdExpiresAt: row.holdExpiresAt },
      });
      log.info("reservation held", { reservationId: row.id, reference: row.reference, vehicleId: row.vehicleId });
      return {
        reservationId: row.id,
        reference: row.reference,
        status: row.status,
        holdExpiresAt: row.holdExpiresAt,
        quote,
        replayed: false,
      };
    });
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === PG_EXCLUSION_VIOLATION || code === PG_DEADLOCK || code === PG_SERIALIZATION) {
      log.info("reserve lost race", { vehicleId: q.vehicleId, code });
      throw notAvailable();
    }
    if (code === PG_UNIQUE_VIOLATION && pgConstraint(err) === "reservations_user_idempotency_uq") {
      const again = await findByIdempotencyKey(input.userId, key.data);
      if (again) return again;
    }
    throw err;
  }
}

async function findByIdempotencyKey(userId: string, key: string): Promise<ReserveResult | null> {
  const [row] = await db()
    .select()
    .from(reservations)
    .where(and(eq(reservations.userId, userId), eq(reservations.idempotencyKey, key)));
  if (!row) return null;
  const lines = await db()
    .select({ re: reservationExtras, code: extras.code, name: extras.name })
    .from(reservationExtras)
    .innerJoin(extras, eq(extras.id, reservationExtras.extraId))
    .where(eq(reservationExtras.reservationId, row.id));
  return {
    reservationId: row.id,
    reference: row.reference,
    status: row.status,
    holdExpiresAt: row.holdExpiresAt,
    quote: quoteFromRow(row, lines.map((l) => ({ ...l.re, code: l.code, name: l.name }))),
    replayed: true,
  };
}

function quoteFromRow(
  row: ReservationRow,
  lines: { extraId: string; code: string; name: string; pricing: "PER_DAY" | "PER_RENTAL"; quantity: number; unitPriceFils: number; totalFils: number }[],
): Quote {
  return {
    currency: "AED",
    vehicleId: row.vehicleId,
    pickupBranchId: row.pickupBranchId,
    returnBranchId: row.returnBranchId,
    pickupAt: row.pickupAt,
    returnAt: row.returnAt,
    pricingRuleId: row.pricingRuleId ?? "",
    days: row.days,
    dailyRateFils: row.dailyRateFils,
    rentalFils: row.rentalFils,
    extras: lines.map((l) => ({
      extraId: l.extraId,
      code: l.code,
      name: l.name,
      pricing: l.pricing,
      quantity: l.quantity,
      unitPriceFils: l.unitPriceFils,
      totalFils: l.totalFils,
    })),
    extrasFils: row.extrasFils,
    oneWayFeeFils: row.oneWayFeeFils,
    subtotalFils: row.rentalFils + row.extrasFils + row.oneWayFeeFils,
    vatRateBps: getEnv().VAT_RATE_BPS,
    vatFils: row.vatFils,
    totalFils: row.totalFils,
    depositFils: row.depositFils,
  };
}

async function resolveDriver(userId: string, given: ReserveInput["driver"]): Promise<DriverSnapshot> {
  if (given) {
    const parsed = driverSchema.safeParse(given);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid driver details");
    return { ...parsed.data, nationality: parsed.data.nationality ?? null };
  }
  const [p] = await db().select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  if (!p) throw new DomainError("VALIDATION", "Please add your driver details before booking.");
  return {
    fullName: p.fullName,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    licenceNumber: p.licenceNumber,
    licenceCountry: p.licenceCountry,
    licenceExpiry: p.licenceExpiry,
    nationality: p.nationality,
  };
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReference(): string {
  let s = "DE-";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return s;
}

/**
 * Marks PENDING reservations whose hold has run out as EXPIRED (which removes
 * their block). Optionally limited to one vehicle. Uses SKIP LOCKED so it never
 * waits on a reservation being paid right now. Returns the expired ids.
 */
export async function expireStaleHolds(tx: Tx, opts: { vehicleId?: string; now: Date; limit?: number }): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string; reference: string }>(sql`
    UPDATE reservations SET status = 'EXPIRED', expired_at = ${opts.now.toISOString()}::timestamptz, updated_at = now()
    WHERE id IN (
      SELECT id FROM reservations
      WHERE status = 'PENDING' AND hold_expires_at <= ${opts.now.toISOString()}::timestamptz
        ${opts.vehicleId ? sql`AND vehicle_id = ${opts.vehicleId}` : sql``}
      ORDER BY hold_expires_at
      LIMIT ${opts.limit ?? 500}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, reference`);
  for (const r of rows) {
    await audit(tx, SYSTEM, {
      action: "reservation.expired",
      entityType: "reservation",
      entityId: r.id,
      before: { status: "PENDING" },
      after: { status: "EXPIRED" },
      metadata: { reference: r.reference },
    });
  }
  return rows.map((r) => r.id);
}

// --- Read models ---------------------------------------------------------------------

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  phone: string | null;
  timeZone: string;
  openingHours: string;
}

export interface ReservationDetails {
  id: string;
  reference: string;
  userId: string;
  status: ReservationRow["status"];
  paymentStatus: ReservationRow["paymentStatus"];
  depositStatus: ReservationRow["depositStatus"];
  pickupAt: Date;
  returnAt: Date;
  holdExpiresAt: Date | null;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  pickedUpAt: Date | null;
  returnedAt: Date | null;
  cancellationReason: string | null;
  currency: string;
  days: number;
  dailyRateFils: number;
  rentalFils: number;
  extrasFils: number;
  oneWayFeeFils: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
  cancellationFeeFils: number;
  lateFeeFils: number;
  /** Net amount the customer has paid (charges minus refunds). */
  paidFils: number;
  refundedFils: number;
  driver: DriverSnapshot;
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    plate: string;
    color: string | null;
    photoUrls: string[];
    transmission: string;
    fuelType: string;
    seats: number;
    categoryCode: string;
    categoryName: string;
  };
  pickupBranch: BranchSummary;
  returnBranch: BranchSummary;
  extras: { extraId: string; code: string; name: string; pricing: "PER_DAY" | "PER_RENTAL"; quantity: number; unitPriceFils: number; totalFils: number }[];
  agreement: {
    checkedOutAt: Date;
    pickupMileageKm: number;
    pickupFuelPct: number;
    checkedInAt: Date | null;
    returnMileageKm: number | null;
    returnFuelPct: number | null;
    lateHours: number;
    lateFeeFils: number;
    lateVatFils: number;
    notes: string | null;
  } | null;
  payments: {
    id: string;
    kind: "CHARGE" | "REFUND";
    purpose: string;
    amountFils: number;
    refundedFils: number;
    status: string;
    createdAt: Date;
  }[];
  deposit: { amountFils: number; capturedFils: number; status: string } | null;
  /** Admin views only. */
  customer?: { id: string; name: string; email: string };
}

const isUuid = (s: string) => z.uuid().safeParse(s).success;

async function loadDetails(rows: ReservationRow[], withCustomer: boolean): Promise<ReservationDetails[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const vehicleIds = [...new Set(rows.map((r) => r.vehicleId))];
  const branchIds = [...new Set(rows.flatMap((r) => [r.pickupBranchId, r.returnBranchId]))];
  const [vrows, brows, xrows, arows, prows, drows, urows] = await Promise.all([
    db()
      .select({ v: vehicles, c: vehicleCategories })
      .from(vehicles)
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .where(inArray(vehicles.id, vehicleIds)),
    db().select().from(branches).where(inArray(branches.id, branchIds)),
    db()
      .select({ re: reservationExtras, code: extras.code, name: extras.name })
      .from(reservationExtras)
      .innerJoin(extras, eq(extras.id, reservationExtras.extraId))
      .where(inArray(reservationExtras.reservationId, ids)),
    db().select().from(rentalAgreements).where(inArray(rentalAgreements.reservationId, ids)),
    db().select().from(payments).where(inArray(payments.reservationId, ids)).orderBy(payments.createdAt),
    db().select().from(deposits).where(inArray(deposits.reservationId, ids)).orderBy(desc(deposits.createdAt)),
    withCustomer
      ? db().select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]))
      : Promise.resolve([] as { id: string; name: string; email: string }[]),
  ]);
  const branch = (id: string): BranchSummary => {
    const b = brows.find((x) => x.id === id)!;
    return { id: b.id, code: b.code, name: b.name, address: b.address, city: b.city, phone: b.phone, timeZone: b.timeZone, openingHours: b.openingHours };
  };
  return rows.map((r) => {
    const v = vrows.find((x) => x.v.id === r.vehicleId)!;
    const a = arows.find((x) => x.reservationId === r.id);
    const ps = prows.filter((p) => p.reservationId === r.id);
    const charges = ps.filter((p) => p.kind === "CHARGE" && ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
    const d = drows.find((x) => x.reservationId === r.id);
    const u = urows.find((x) => x.id === r.userId);
    return {
      id: r.id,
      reference: r.reference,
      userId: r.userId,
      status: r.status,
      paymentStatus: r.paymentStatus,
      depositStatus: r.depositStatus,
      pickupAt: r.pickupAt,
      returnAt: r.returnAt,
      holdExpiresAt: r.holdExpiresAt,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
      cancelledAt: r.cancelledAt,
      pickedUpAt: r.pickedUpAt,
      returnedAt: r.returnedAt,
      cancellationReason: r.cancellationReason,
      currency: r.currency,
      days: r.days,
      dailyRateFils: r.dailyRateFils,
      rentalFils: r.rentalFils,
      extrasFils: r.extrasFils,
      oneWayFeeFils: r.oneWayFeeFils,
      vatFils: r.vatFils,
      totalFils: r.totalFils,
      depositFils: r.depositFils,
      cancellationFeeFils: r.cancellationFeeFils,
      lateFeeFils: r.lateFeeFils,
      paidFils: charges.reduce((s, p) => s + p.amountFils - p.refundedFils, 0),
      refundedFils: charges.reduce((s, p) => s + p.refundedFils, 0),
      driver: r.driver,
      vehicle: {
        id: v.v.id,
        make: v.v.make,
        model: v.v.model,
        year: v.v.year,
        plate: v.v.plate,
        color: v.v.color,
        photoUrls: v.v.photoUrls,
        transmission: v.v.transmission,
        fuelType: v.v.fuelType,
        seats: v.v.seats,
        categoryCode: v.c.code,
        categoryName: v.c.name,
      },
      pickupBranch: branch(r.pickupBranchId),
      returnBranch: branch(r.returnBranchId),
      extras: xrows
        .filter((x) => x.re.reservationId === r.id)
        .map((x) => ({
          extraId: x.re.extraId,
          code: x.code,
          name: x.name,
          pricing: x.re.pricing,
          quantity: x.re.quantity,
          unitPriceFils: x.re.unitPriceFils,
          totalFils: x.re.totalFils,
        })),
      agreement: a
        ? {
            checkedOutAt: a.checkedOutAt,
            pickupMileageKm: a.pickupMileageKm,
            pickupFuelPct: a.pickupFuelPct,
            checkedInAt: a.checkedInAt,
            returnMileageKm: a.returnMileageKm,
            returnFuelPct: a.returnFuelPct,
            lateHours: a.lateHours,
            lateFeeFils: a.lateFeeFils,
            lateVatFils: a.lateVatFils,
            notes: a.notes,
          }
        : null,
      payments: ps.map((p) => ({
        id: p.id,
        kind: p.kind,
        purpose: p.purpose,
        amountFils: p.amountFils,
        refundedFils: p.refundedFils,
        status: p.status,
        createdAt: p.createdAt,
      })),
      deposit: d ? { amountFils: d.amountFils, capturedFils: d.capturedFils, status: d.status } : null,
      ...(withCustomer && u ? { customer: u } : {}),
    };
  });
}

function byIdOrReference(idOrReference: string): SQL {
  return isUuid(idOrReference)
    ? eq(reservations.id, idOrReference)
    : eq(reservations.reference, idOrReference.trim().toUpperCase());
}

/** A reservation the user owns (by id or reference), or null. Never returns other users' bookings. */
export async function getReservationForUser(idOrReference: string, userId: string): Promise<ReservationDetails | null> {
  const rows = await db()
    .select()
    .from(reservations)
    .where(and(byIdOrReference(idOrReference), eq(reservations.userId, userId)));
  return (await loadDetails(rows, false))[0] ?? null;
}

/** Admin read (includes customer name/email). Callers must check the admin role. */
export async function getReservationAdmin(idOrReference: string): Promise<ReservationDetails | null> {
  const rows = await db().select().from(reservations).where(byIdOrReference(idOrReference));
  return (await loadDetails(rows, true))[0] ?? null;
}

export async function listMyReservations(userId: string): Promise<ReservationDetails[]> {
  const rows = await db()
    .select()
    .from(reservations)
    .where(eq(reservations.userId, userId))
    .orderBy(desc(reservations.pickupAt));
  return loadDetails(rows, false);
}

export interface ReservationFilters {
  status?: ReservationRow["status"] | ReservationRow["status"][];
  branchId?: string;
  vehicleId?: string;
  userId?: string;
  /** Reference, customer email or plate (partial match). */
  search?: string;
  pickupFrom?: Date;
  pickupTo?: Date;
  limit?: number;
  offset?: number;
}

/** Admin list. Callers must check the admin role. */
export async function listReservations(filters: ReservationFilters = {}): Promise<ReservationDetails[]> {
  const conds: SQL[] = [];
  if (filters.status) {
    conds.push(inArray(reservations.status, Array.isArray(filters.status) ? filters.status : [filters.status]));
  }
  if (filters.branchId) conds.push(or(eq(reservations.pickupBranchId, filters.branchId), eq(reservations.returnBranchId, filters.branchId))!);
  if (filters.vehicleId) conds.push(eq(reservations.vehicleId, filters.vehicleId));
  if (filters.userId) conds.push(eq(reservations.userId, filters.userId));
  if (filters.pickupFrom) conds.push(gte(reservations.pickupAt, filters.pickupFrom));
  if (filters.pickupTo) conds.push(lte(reservations.pickupAt, filters.pickupTo));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        ilike(reservations.reference, term),
        sql`${reservations.userId} IN (SELECT id FROM users WHERE email ILIKE ${term} OR name ILIKE ${term})`,
        sql`${reservations.vehicleId} IN (SELECT id FROM vehicles WHERE plate ILIKE ${term})`,
      )!,
    );
  }
  const rows = await db()
    .select()
    .from(reservations)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(reservations.pickupAt))
    .limit(Math.min(filters.limit ?? 50, 200))
    .offset(filters.offset ?? 0);
  return loadDetails(rows, true);
}

// --- Cancel ----------------------------------------------------------------------------

async function lockOwned(tx: Tx, id: string, user: ActingUser): Promise<ReservationRow> {
  if (!isUuid(id)) throw notFound("Reservation");
  const [row] = await tx.select().from(reservations).where(eq(reservations.id, id)).for("update");
  if (!row || (user.role !== "admin" && row.userId !== user.id)) throw notFound("Reservation");
  return row;
}

export interface CancellationPreview extends CancellationQuote {
  paidFils: number;
}

/** What cancelling now would cost (policy in docs/TEAM.md). */
export async function quoteCancellation(id: string, user: ActingUser, now = new Date()): Promise<CancellationPreview> {
  if (!isUuid(id)) throw notFound("Reservation");
  const [row] = await db().select().from(reservations).where(eq(reservations.id, id));
  if (!row || (user.role !== "admin" && row.userId !== user.id)) throw notFound("Reservation");
  const paidFils = await netPaidFils(db(), id);
  return {
    ...cancellationQuote({ status: row.status, pickupAt: row.pickupAt, now, dailyRateFils: row.dailyRateFils, paidFils, vatBps: getEnv().VAT_RATE_BPS }),
    paidFils,
  };
}

export interface CancelResult {
  status: ReservationRow["status"];
  feeFils: number;
  refundFils: number;
  refundedFils: number;
  depositReleased: boolean;
}

/**
 * Cancels per policy, then refunds (paid - fee) and releases the deposit.
 * Admins may pass waiveFee. Calling again on a cancelled booking retries any
 * refund that did not complete (idempotent keys) and returns the result.
 */
export async function cancelReservation(
  id: string,
  user: ActingUser,
  opts: { reason?: string; waiveFee?: boolean; now?: Date } = {},
): Promise<CancelResult> {
  const now = opts.now ?? new Date();
  const actor = actorOf(user);
  const result = await db().transaction(async (tx) => {
    const row = await lockOwned(tx, id, user);
    if (row.status === "CANCELLED" || row.status === "REFUNDED") {
      const paid = await netPaidFils(tx, id);
      return { already: true, feeFils: row.cancellationFeeFils, refundFils: Math.max(0, paid - row.cancellationFeeFils) };
    }
    const paidFils = await netPaidFils(tx, id);
    const q = cancellationQuote({ status: row.status, pickupAt: row.pickupAt, now, dailyRateFils: row.dailyRateFils, paidFils, vatBps: getEnv().VAT_RATE_BPS });
    if (!q.allowed) throw new DomainError("POLICY", q.reason);
    const feeFils = opts.waiveFee && user.role === "admin" ? 0 : q.feeFils;
    await tx
      .update(reservations)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancellationFeeFils: feeFils,
        cancellationReason: opts.reason?.slice(0, 500) ?? null,
      })
      .where(eq(reservations.id, id));
    await audit(tx, actor, {
      action: "reservation.cancelled",
      entityType: "reservation",
      entityId: id,
      before: { status: row.status },
      after: { status: "CANCELLED", feeFils },
      metadata: { reason: opts.reason, waived: opts.waiveFee && user.role === "admin" },
    });
    return { already: false, feeFils, refundFils: paidFils - feeFils };
  });

  const refundedFils = await refundReservation(id, result.refundFils, `cancel:${id}`, actor, "cancellation");
  const depositReleased = (await releaseDeposit(id, actor, "cancellation")) !== null;
  // Cancel any payment still waiting for customer action so it can't complete later.
  await cancelPendingProviderPayments(id);

  const status = await db().transaction(async (tx) => {
    const [row] = await tx.select().from(reservations).where(eq(reservations.id, id)).for("update");
    if (row.status === "CANCELLED" && result.refundFils > 0 && (await netPaidFils(tx, id)) <= row.cancellationFeeFils) {
      await tx.update(reservations).set({ status: "REFUNDED" }).where(eq(reservations.id, id));
      await audit(tx, actor, { action: "reservation.refunded", entityType: "reservation", entityId: id, before: { status: "CANCELLED" }, after: { status: "REFUNDED" } });
      return "REFUNDED" as const;
    }
    return row.status;
  });
  return { status, feeFils: result.feeFils, refundFils: result.refundFils, refundedFils, depositReleased };
}

async function cancelPendingProviderPayments(reservationId: string) {
  const pending = await db()
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), eq(payments.kind, "CHARGE"), inArray(payments.status, ["REQUIRES_ACTION"])));
  if (pending.length === 0) return;
  const { getPaymentProvider } = await import("../payments");
  const provider = getPaymentProvider();
  for (const p of pending) {
    if (p.provider !== provider.name || !p.providerRef) continue;
    try {
      await provider.cancelPayment(p.providerRef);
      await db().update(payments).set({ status: "CANCELED", clientSecret: null }).where(eq(payments.id, p.id));
    } catch (err) {
      log.warn("could not cancel pending payment", { paymentId: p.id, err });
    }
  }
}

// --- Modify dates ---------------------------------------------------------------------

export interface ModificationQuote {
  allowed: boolean;
  reason: string;
  available: boolean;
  current: { pickupAt: Date; returnAt: Date; totalFils: number };
  quote: Quote | null;
  /** Positive: customer pays this much more; negative: refunded. 0 if unpaid. */
  differenceFils: number;
}

function modifiable(row: ReservationRow, now: Date): { ok: boolean; reason: string } {
  if (row.status !== "PENDING" && row.status !== "CONFIRMED") {
    return { ok: false, reason: `A ${row.status.toLowerCase().replace("_", " ")} booking cannot be changed.` };
  }
  if (row.pickupAt.getTime() <= now.getTime()) return { ok: false, reason: "The pick-up time has passed." };
  if (row.status === "PENDING" && row.holdExpiresAt && row.holdExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "Your hold has expired. Please book again." };
  }
  return { ok: true, reason: "" };
}

async function extrasSelection(reservationId: string) {
  const rows = await db().select().from(reservationExtras).where(eq(reservationExtras.reservationId, reservationId));
  return rows.map((r) => ({ extraId: r.extraId, quantity: r.quantity }));
}

/** Prices new dates for an existing booking and checks availability (read-only). */
export async function quoteModification(
  id: string,
  user: ActingUser,
  dates: { pickupAt: Date; returnAt: Date },
  now = new Date(),
): Promise<ModificationQuote> {
  if (!isUuid(id)) throw notFound("Reservation");
  const [row] = await db().select().from(reservations).where(eq(reservations.id, id));
  if (!row || (user.role !== "admin" && row.userId !== user.id)) throw notFound("Reservation");
  const current = { pickupAt: row.pickupAt, returnAt: row.returnAt, totalFils: row.totalFils };
  const m = modifiable(row, now);
  if (!m.ok) return { allowed: false, reason: m.reason, available: false, current, quote: null, differenceFils: 0 };
  if (dates.pickupAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "Pick-up time must be in the future.", available: false, current, quote: null, differenceFils: 0 };
  }
  const q = parseQuoteInput({
    vehicleId: row.vehicleId,
    pickupBranchId: row.pickupBranchId,
    returnBranchId: row.returnBranchId,
    pickupAt: dates.pickupAt,
    returnAt: dates.returnAt,
    extras: await extrasSelection(id),
  });
  const quote = await quoteWith(db(), q);
  const { rows } = await db().execute(sql`
    SELECT 1 FROM vehicle_blocks b LEFT JOIN reservations r ON r.id = b.reservation_id
    WHERE b.vehicle_id = ${row.vehicleId}
      AND (b.reservation_id IS NULL OR b.reservation_id <> ${id})
      AND b.period && tstzrange(${q.pickupAt.toISOString()}::timestamptz, ${q.returnAt.toISOString()}::timestamptz, '[)')
      AND (r.id IS NULL OR NOT (r.status = 'PENDING' AND r.hold_expires_at <= ${now.toISOString()}::timestamptz))
    LIMIT 1`);
  const available = rows.length === 0;
  const paid = await netPaidFils(db(), id);
  return {
    allowed: true,
    reason: available ? "" : "The car is not available for the new dates.",
    available,
    current,
    quote,
    differenceFils: paid > 0 ? quote.totalFils - row.totalFils : 0,
  };
}

export interface ModifyResult {
  reservationId: string;
  status: ReservationRow["status"];
  pickupAt: Date;
  returnAt: Date;
  totalFils: number;
  differenceFils: number;
  /** Set when an extra charge was needed and it did not succeed (dates unchanged). */
  paymentFailed?: boolean;
}

/**
 * Changes the dates of a PENDING/CONFIRMED booking: reprice with the same
 * extras and re-check availability in one transaction (vehicle row lock +
 * exclusion constraint). For a paid booking a higher price is charged first
 * (idempotent key per requested dates) and refunded if the change then fails;
 * a lower price is refunded after the change commits.
 */
export async function modifyReservationDates(
  id: string,
  user: ActingUser,
  dates: { pickupAt: Date; returnAt: Date },
  opts: { now?: Date; fakeOutcome?: FakeOutcome } = {},
): Promise<ModifyResult> {
  const now = opts.now ?? new Date();
  const actor = actorOf(user);
  const preview = await quoteModification(id, user, dates, now);
  if (!preview.allowed) throw new DomainError("POLICY", preview.reason);
  if (!preview.available) throw notAvailable();
  const changeKey = `modify:${id}:${dates.pickupAt.toISOString()}:${dates.returnAt.toISOString()}`;

  // Pay the difference first (if any), so dates only change once money is in.
  let extraCharge: { id: string; amountFils: number } | null = null;
  if (preview.differenceFils > 0) {
    const charge = await chargeAdditional(id, "MODIFICATION", preview.differenceFils, changeKey, actor, { fakeOutcome: opts.fakeOutcome });
    if (charge.status !== "SUCCEEDED") {
      const [row] = await db().select().from(reservations).where(eq(reservations.id, id));
      return { reservationId: id, status: row.status, pickupAt: row.pickupAt, returnAt: row.returnAt, totalFils: row.totalFils, differenceFils: preview.differenceFils, paymentFailed: true };
    }
    extraCharge = { id: charge.id, amountFils: charge.amountFils };
  }

  let applied: ModifyResult;
  try {
    applied = await db().transaction(async (tx) => {
      const [current] = await tx.select({ vehicleId: reservations.vehicleId }).from(reservations).where(eq(reservations.id, id));
      if (!current) throw notFound("Reservation");
      await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, current.vehicleId)).for("update");
      const row = await lockOwned(tx, id, user);
      const m = modifiable(row, now);
      if (!m.ok) throw new DomainError("POLICY", m.reason);
      await expireStaleHolds(tx, { vehicleId: row.vehicleId, now });
      const quote = await quoteWith(
        tx,
        parseQuoteInput({
          vehicleId: row.vehicleId,
          pickupBranchId: row.pickupBranchId,
          returnBranchId: row.returnBranchId,
          pickupAt: dates.pickupAt,
          returnAt: dates.returnAt,
          extras: await extrasSelection(id),
        }),
      );
      await tx
        .update(reservations)
        .set({
          pickupAt: quote.pickupAt,
          returnAt: quote.returnAt,
          days: quote.days,
          dailyRateFils: quote.dailyRateFils,
          rentalFils: quote.rentalFils,
          extrasFils: quote.extrasFils,
          oneWayFeeFils: quote.oneWayFeeFils,
          vatFils: quote.vatFils,
          totalFils: quote.totalFils,
          pricingRuleId: quote.pricingRuleId,
        })
        .where(eq(reservations.id, id));
      for (const line of quote.extras) {
        await tx
          .update(reservationExtras)
          .set({ totalFils: line.totalFils, unitPriceFils: line.unitPriceFils })
          .where(and(eq(reservationExtras.reservationId, id), eq(reservationExtras.extraId, line.extraId)));
      }
      await audit(tx, actor, {
        action: "reservation.dates_changed",
        entityType: "reservation",
        entityId: id,
        before: { pickupAt: row.pickupAt, returnAt: row.returnAt, totalFils: row.totalFils },
        after: { pickupAt: quote.pickupAt, returnAt: quote.returnAt, totalFils: quote.totalFils },
      });
      // A PENDING booking whose price changed still needs its (new) total paid in checkout.
      return {
        reservationId: id,
        status: row.status,
        pickupAt: quote.pickupAt,
        returnAt: quote.returnAt,
        totalFils: quote.totalFils,
        differenceFils: preview.differenceFils,
      };
    });
  } catch (err) {
    if (extraCharge) {
      await refundReservation(id, extraCharge.amountFils, `${changeKey}:undo`, actor, "date change failed").catch((e) =>
        log.error("could not refund failed modification charge", { reservationId: id, err: e }),
      );
    }
    const code = pgErrorCode(err);
    if (code === PG_EXCLUSION_VIOLATION || code === PG_DEADLOCK || code === PG_SERIALIZATION) throw notAvailable();
    throw err;
  }

  if (preview.differenceFils < 0) {
    await refundReservation(id, -preview.differenceFils, changeKey, actor, "date change (cheaper)");
  }
  return applied;
}
