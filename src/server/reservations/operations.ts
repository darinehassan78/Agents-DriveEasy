// Branch operations (admin): check-out (pick-up), check-in (return) with late
// charges and deposit settlement, and damage reports.
import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import { db } from "../db";
import { damageReports, rentalAgreements, reservations, vehicles } from "../db/schema";
import { getEnv } from "../env";
import { DomainError, notFound } from "../errors";
import { log } from "../log";
import { actorOf, captureDeposit, chargeAdditional, releaseDeposit, type ActingUser } from "../payments/service";
import { computeLateFee, type LateFee } from "../pricing";

function requireAdmin(user: ActingUser) {
  if (user.role !== "admin") throw new DomainError("FORBIDDEN", "Admins only.");
}

const isUuid = (s: string) => z.uuid().safeParse(s).success;

/** Check-out may start this long before the scheduled pick-up time. */
export const EARLY_CHECKOUT_MS = 24 * 60 * 60 * 1000;

const checkOutSchema = z.object({
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelPct: z.number().int().min(0).max(100),
  notes: z.string().max(2000).optional(),
});

export interface CheckOutResult {
  reservationId: string;
  agreementId: string;
  status: "PICKED_UP";
  checkedOutAt: Date;
}

/**
 * Hands the car to the customer: CONFIRMED -> PICKED_UP, creates the rental
 * agreement with mileage and fuel, vehicle -> ON_RENT. Requires a held deposit.
 */
export async function checkOut(
  reservationId: string,
  admin: ActingUser,
  input: z.input<typeof checkOutSchema>,
  opts: { now?: Date } = {},
): Promise<CheckOutResult> {
  requireAdmin(admin);
  const now = opts.now ?? new Date();
  const data = parse(checkOutSchema, input);
  if (!isUuid(reservationId)) throw notFound("Reservation");
  return db().transaction(async (tx) => {
    const [res] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    if (!res) throw notFound("Reservation");
    if (res.status !== "CONFIRMED") throw new DomainError("INVALID_STATE", `Cannot check out a ${res.status} booking.`);
    if (res.depositFils > 0 && res.depositStatus !== "HELD") {
      throw new DomainError("INVALID_STATE", "The security deposit is not held.");
    }
    if (now.getTime() < res.pickupAt.getTime() - EARLY_CHECKOUT_MS) {
      throw new DomainError("POLICY", "Check-out opens 24 hours before the pick-up time.");
    }
    if (now.getTime() >= res.returnAt.getTime()) {
      throw new DomainError("POLICY", "The rental period has already ended.");
    }
    const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, res.vehicleId)).for("update");
    if (vehicle.status === "ON_RENT") throw new DomainError("INVALID_STATE", "This car is still on another rental.");
    if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") {
      throw new DomainError("INVALID_STATE", `This car is ${vehicle.status.toLowerCase()}.`);
    }
    if (data.mileageKm < vehicle.mileageKm) {
      throw new DomainError("VALIDATION", `Mileage cannot be lower than the recorded ${vehicle.mileageKm} km.`);
    }
    const [agreement] = await tx
      .insert(rentalAgreements)
      .values({
        reservationId,
        vehicleId: res.vehicleId,
        checkedOutBy: admin.id,
        checkedOutAt: now,
        pickupMileageKm: data.mileageKm,
        pickupFuelPct: data.fuelPct,
        notes: data.notes ?? null,
      })
      .returning();
    await tx.update(reservations).set({ status: "PICKED_UP", pickedUpAt: now }).where(eq(reservations.id, reservationId));
    await tx.update(vehicles).set({ status: "ON_RENT", mileageKm: data.mileageKm }).where(eq(vehicles.id, res.vehicleId));
    await audit(tx, actorOf(admin), {
      action: "reservation.checked_out",
      entityType: "reservation",
      entityId: reservationId,
      before: { status: "CONFIRMED" },
      after: { status: "PICKED_UP", mileageKm: data.mileageKm, fuelPct: data.fuelPct },
      metadata: { agreementId: agreement.id, vehicleId: res.vehicleId },
    });
    return { reservationId, agreementId: agreement.id, status: "PICKED_UP" as const, checkedOutAt: now };
  });
}

const checkInSchema = z.object({
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelPct: z.number().int().min(0).max(100),
  notes: z.string().max(2000).optional(),
  /** Extra amount to take for damage, captured from the deposit (fils, before VAT handling by staff). */
  damageChargeFils: z.number().int().min(0).default(0),
  /** Settle the deposit now (default). Set false to keep it held while damage is assessed. */
  settleDeposit: z.boolean().default(true),
});

export interface CheckInResult {
  reservationId: string;
  status: "RETURNED";
  checkedInAt: Date;
  lateFee: LateFee;
  /** Late fee (incl. VAT) + damage charge. */
  chargesFils: number;
  /** Taken from the deposit. */
  capturedFromDepositFils: number;
  /** Charged to the card because the deposit did not cover everything. */
  chargedToCardFils: number;
  depositStatus: string;
  distanceKm: number;
}

/**
 * Receives the car back: PICKED_UP -> RETURNED, completes the agreement with
 * mileage and fuel, computes the late fee, vehicle -> AVAILABLE. Then settles
 * the deposit: captures late fee + damage (the rest is released) or releases
 * it in full; anything above the deposit is charged separately.
 */
export async function checkIn(
  reservationId: string,
  admin: ActingUser,
  input: z.input<typeof checkInSchema>,
  opts: { now?: Date } = {},
): Promise<CheckInResult> {
  requireAdmin(admin);
  const now = opts.now ?? new Date();
  const data = parse(checkInSchema, input);
  if (!isUuid(reservationId)) throw notFound("Reservation");
  const actor = actorOf(admin);

  const done = await db().transaction(async (tx) => {
    const [res] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    if (!res) throw notFound("Reservation");
    if (res.status !== "PICKED_UP") throw new DomainError("INVALID_STATE", `Cannot check in a ${res.status} booking.`);
    const [agreement] = await tx
      .select()
      .from(rentalAgreements)
      .where(eq(rentalAgreements.reservationId, reservationId))
      .for("update");
    if (!agreement) throw new DomainError("INVALID_STATE", "No rental agreement found.");
    if (data.mileageKm < agreement.pickupMileageKm) {
      throw new DomainError("VALIDATION", `Return mileage cannot be lower than the pick-up mileage (${agreement.pickupMileageKm} km).`);
    }
    const checkedInAt = now.getTime() < agreement.checkedOutAt.getTime() ? agreement.checkedOutAt : now;
    const lateFee = computeLateFee(res.returnAt, checkedInAt, res.dailyRateFils, getEnv().VAT_RATE_BPS);
    await tx
      .update(rentalAgreements)
      .set({
        checkedInBy: admin.id,
        checkedInAt,
        returnMileageKm: data.mileageKm,
        returnFuelPct: data.fuelPct,
        lateHours: lateFee.lateHours,
        lateFeeFils: lateFee.feeFils,
        lateVatFils: lateFee.vatFils,
        notes: [agreement.notes, data.notes].filter(Boolean).join("\n") || null,
      })
      .where(eq(rentalAgreements.id, agreement.id));
    await tx
      .update(reservations)
      .set({ status: "RETURNED", returnedAt: checkedInAt, lateFeeFils: lateFee.totalFils })
      .where(eq(reservations.id, reservationId));
    await tx
      .update(vehicles)
      .set({ status: "AVAILABLE", mileageKm: data.mileageKm })
      .where(and(eq(vehicles.id, res.vehicleId), eq(vehicles.status, "ON_RENT")));
    await tx.update(vehicles).set({ mileageKm: data.mileageKm }).where(eq(vehicles.id, res.vehicleId));
    await audit(tx, actor, {
      action: "reservation.checked_in",
      entityType: "reservation",
      entityId: reservationId,
      before: { status: "PICKED_UP" },
      after: { status: "RETURNED", mileageKm: data.mileageKm, fuelPct: data.fuelPct, lateFee },
      metadata: { agreementId: agreement.id, damageChargeFils: data.damageChargeFils },
    });
    return { res, lateFee, checkedInAt, distanceKm: data.mileageKm - agreement.pickupMileageKm };
  });

  // Deposit settlement (outside the transaction: provider calls).
  const chargesFils = done.lateFee.totalFils + data.damageChargeFils;
  let captured = 0;
  let chargedToCard = 0;
  if (data.settleDeposit) {
    try {
      if (chargesFils > 0 && done.res.depositStatus === "HELD") {
        captured = await captureDeposit(reservationId, chargesFils, actor, `late fee ${done.lateFee.totalFils} + damage ${data.damageChargeFils}`);
      } else if (done.res.depositStatus === "HELD" || done.res.depositStatus === "PENDING") {
        await releaseDeposit(reservationId, actor, "returned without charges");
      }
      const remainder = chargesFils - captured;
      if (remainder > 0) {
        const p = await chargeAdditional(
          reservationId,
          done.lateFee.totalFils > 0 ? "LATE_FEE" : "DAMAGE",
          remainder,
          `checkin:${reservationId}:remainder`,
          actor,
        );
        if (p.status === "SUCCEEDED") chargedToCard = remainder;
      }
    } catch (err) {
      log.error("deposit settlement failed at check-in", { reservationId, err });
    }
  }
  const [after] = await db().select({ depositStatus: reservations.depositStatus }).from(reservations).where(eq(reservations.id, reservationId));
  return {
    reservationId,
    status: "RETURNED",
    checkedInAt: done.checkedInAt,
    lateFee: done.lateFee,
    chargesFils,
    capturedFromDepositFils: captured,
    chargedToCardFils: chargedToCard,
    depositStatus: after.depositStatus,
    distanceKm: done.distanceKm,
  };
}

/** Preview of the late fee if the car were returned at `at`. */
export async function previewLateFee(reservationId: string, at = new Date()): Promise<LateFee> {
  if (!isUuid(reservationId)) throw notFound("Reservation");
  const [res] = await db().select().from(reservations).where(eq(reservations.id, reservationId));
  if (!res) throw notFound("Reservation");
  return computeLateFee(res.returnAt, at, res.dailyRateFils, getEnv().VAT_RATE_BPS);
}

// --- Damage reports -------------------------------------------------------------

const damageSchema = z
  .object({
    vehicleId: z.uuid().optional(),
    reservationId: z.uuid().optional(),
    stage: z.enum(["PICKUP", "RETURN", "OTHER"]).default("OTHER"),
    severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
    description: z.string().trim().min(3).max(4000),
    /** Private storage keys (app-agent's storage driver), e.g. "damage/<id>/1.jpg". */
    photoKeys: z.array(z.string().min(1).max(500)).max(20).default([]),
    estimatedCostFils: z.number().int().min(0).optional(),
  })
  .refine((d) => d.vehicleId || d.reservationId, "vehicleId or reservationId is required");

export type DamageReport = typeof damageReports.$inferSelect;

export async function createDamageReport(admin: ActingUser, input: z.input<typeof damageSchema>): Promise<DamageReport> {
  requireAdmin(admin);
  const data = parse(damageSchema, input);
  return db().transaction(async (tx) => {
    let vehicleId = data.vehicleId;
    if (data.reservationId) {
      const [res] = await tx.select({ vehicleId: reservations.vehicleId }).from(reservations).where(eq(reservations.id, data.reservationId));
      if (!res) throw notFound("Reservation");
      if (vehicleId && vehicleId !== res.vehicleId) throw new DomainError("VALIDATION", "Vehicle does not match the reservation.");
      vehicleId = res.vehicleId;
    }
    const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, vehicleId!));
    if (!v) throw notFound("Vehicle");
    const [row] = await tx
      .insert(damageReports)
      .values({
        vehicleId: vehicleId!,
        reservationId: data.reservationId ?? null,
        reportedBy: admin.id,
        stage: data.stage,
        severity: data.severity,
        description: data.description,
        photoKeys: data.photoKeys,
        estimatedCostFils: data.estimatedCostFils ?? null,
      })
      .returning();
    await audit(tx, actorOf(admin), {
      action: "damage_report.created",
      entityType: "damage_report",
      entityId: row.id,
      after: { severity: row.severity, stage: row.stage, vehicleId: row.vehicleId, estimatedCostFils: row.estimatedCostFils },
      metadata: { reservationId: row.reservationId },
    });
    return row;
  });
}

const damageUpdateSchema = z.object({
  description: z.string().trim().min(3).max(4000).optional(),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).optional(),
  photoKeys: z.array(z.string().min(1).max(500)).max(20).optional(),
  estimatedCostFils: z.number().int().min(0).nullable().optional(),
  resolved: z.boolean().optional(),
});

export async function updateDamageReport(
  admin: ActingUser,
  id: string,
  input: z.input<typeof damageUpdateSchema>,
  opts: { now?: Date } = {},
): Promise<DamageReport> {
  requireAdmin(admin);
  const data = parse(damageUpdateSchema, input);
  if (!isUuid(id)) throw notFound("Damage report");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(damageReports).where(eq(damageReports.id, id)).for("update");
    if (!before) throw notFound("Damage report");
    const [row] = await tx
      .update(damageReports)
      .set({
        description: data.description,
        severity: data.severity,
        photoKeys: data.photoKeys,
        estimatedCostFils: data.estimatedCostFils,
        resolvedAt: data.resolved === undefined ? undefined : data.resolved ? (opts.now ?? new Date()) : null,
      })
      .where(eq(damageReports.id, id))
      .returning();
    await audit(tx, actorOf(admin), {
      action: "damage_report.updated",
      entityType: "damage_report",
      entityId: id,
      before: { severity: before.severity, estimatedCostFils: before.estimatedCostFils, resolvedAt: before.resolvedAt },
      after: { severity: row.severity, estimatedCostFils: row.estimatedCostFils, resolvedAt: row.resolvedAt },
    });
    return row;
  });
}

/**
 * Charges a damage report: captures from a held deposit when possible,
 * otherwise charges the card. Records charged_fils on the report.
 */
export async function chargeDamage(admin: ActingUser, damageReportId: string, amountFils: number): Promise<{ capturedFils: number; chargedFils: number }> {
  requireAdmin(admin);
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) throw new DomainError("VALIDATION", "Invalid amount");
  const [report] = await db().select().from(damageReports).where(eq(damageReports.id, damageReportId));
  if (!report) throw notFound("Damage report");
  if (!report.reservationId) throw new DomainError("INVALID_STATE", "This report is not linked to a reservation.");
  const actor = actorOf(admin);
  const [res] = await db().select().from(reservations).where(eq(reservations.id, report.reservationId));
  let captured = 0;
  if (res.depositStatus === "HELD") captured = await captureDeposit(res.id, amountFils, actor, `damage report ${report.id}`);
  let charged = 0;
  if (amountFils - captured > 0) {
    const p = await chargeAdditional(res.id, "DAMAGE", amountFils - captured, `damage:${report.id}:${amountFils}`, actor);
    if (p.status === "SUCCEEDED") charged = amountFils - captured;
  }
  await db().transaction(async (tx) => {
    await tx
      .update(damageReports)
      .set({ chargedFils: report.chargedFils + captured + charged })
      .where(eq(damageReports.id, report.id));
    await audit(tx, actor, {
      action: "damage_report.charged",
      entityType: "damage_report",
      entityId: report.id,
      after: { capturedFils: captured, chargedFils: charged },
      metadata: { reservationId: res.id },
    });
  });
  return { capturedFils: captured, chargedFils: charged };
}

export async function listDamageReports(filters: { vehicleId?: string; reservationId?: string; openOnly?: boolean } = {}): Promise<DamageReport[]> {
  const conds: SQL[] = [];
  if (filters.vehicleId) conds.push(eq(damageReports.vehicleId, filters.vehicleId));
  if (filters.reservationId) conds.push(eq(damageReports.reservationId, filters.reservationId));
  const rows = await db()
    .select()
    .from(damageReports)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(damageReports.createdAt));
  return filters.openOnly ? rows.filter((r) => !r.resolvedAt) : rows;
}

export async function getDamageReport(id: string): Promise<DamageReport | null> {
  if (!isUuid(id)) return null;
  const [row] = await db().select().from(damageReports).where(eq(damageReports.id, id));
  return row ?? null;
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues[0]?.message ?? "Invalid input", { issues: r.error.issues });
  return r.data;
}
