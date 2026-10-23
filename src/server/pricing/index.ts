import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { branches, extras, pricingRules, vehicleCategories, vehicles } from "../db/schema";
import { getEnv } from "../env";
import { DomainError, notFound } from "../errors";
import { computeQuote, localDate, rentalDays, selectPricingRule, type PriceBreakdown } from "./engine";

export * from "./engine";

export const MAX_RENTAL_DAYS = 90;

const extraSelection = z
  .object({
    extraId: z.uuid().optional(),
    code: z.string().min(1).optional(),
    quantity: z.number().int().min(1).max(10).default(1),
  })
  .refine((e) => e.extraId || e.code, "extraId or code is required");

export const quoteInputSchema = z
  .object({
    vehicleId: z.uuid(),
    pickupBranchId: z.uuid(),
    returnBranchId: z.uuid(),
    pickupAt: z.coerce.date(),
    returnAt: z.coerce.date(),
    extras: z.array(extraSelection).max(20).default([]),
  })
  .refine((q) => q.returnAt.getTime() > q.pickupAt.getTime(), {
    message: "Return must be after pick-up",
    path: ["returnAt"],
  })
  .refine((q) => q.returnAt.getTime() <= q.pickupAt.getTime() || rentalDays(q.pickupAt, q.returnAt) <= MAX_RENTAL_DAYS, {
    message: `Rentals are limited to ${MAX_RENTAL_DAYS} days`,
    path: ["returnAt"],
  });

export type QuoteInput = z.input<typeof quoteInputSchema>;
export type ExtraSelection = z.input<typeof extraSelection>;

export interface Quote extends PriceBreakdown {
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  pricingRuleId: string;
}

export function parseQuoteInput(input: QuoteInput) {
  const parsed = quoteInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid booking details", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/**
 * Server-side price for a booking request. Never trust prices from the client;
 * reserve() recomputes this inside its transaction.
 */
export async function quote(input: QuoteInput): Promise<Quote> {
  return quoteWith(db(), parseQuoteInput(input));
}

/** Computes a quote using `tx` (so reserve/modify price inside their transaction). */
export async function quoteWith(tx: Tx, q: z.output<typeof quoteInputSchema>): Promise<Quote> {
  const [vehicle] = await tx
    .select({
      id: vehicles.id,
      branchId: vehicles.branchId,
      categoryId: vehicles.categoryId,
      status: vehicles.status,
      depositFils: vehicleCategories.depositFils,
    })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, q.vehicleId));
  if (!vehicle) throw notFound("Vehicle");

  const branchRows = await tx
    .select()
    .from(branches)
    .where(inArray(branches.id, [q.pickupBranchId, q.returnBranchId]));
  const pickupBranch = branchRows.find((b) => b.id === q.pickupBranchId);
  const returnBranch = branchRows.find((b) => b.id === q.returnBranchId);
  if (!pickupBranch || !pickupBranch.isActive) throw notFound("Pick-up branch");
  if (!returnBranch || !returnBranch.isActive) throw notFound("Return branch");
  if (vehicle.branchId !== pickupBranch.id) {
    throw new DomainError("VALIDATION", "This vehicle is not available at the selected pick-up branch.");
  }

  const days = rentalDays(q.pickupAt, q.returnAt);
  const rules = await tx
    .select()
    .from(pricingRules)
    .where(and(eq(pricingRules.categoryId, vehicle.categoryId), eq(pricingRules.isActive, true)));
  const rule = selectPricingRule(rules, {
    categoryId: vehicle.categoryId,
    vehicleId: vehicle.id,
    branchId: pickupBranch.id,
    pickupDate: localDate(q.pickupAt, pickupBranch.timeZone),
    days,
  });
  if (!rule) throw new DomainError("NOT_AVAILABLE", "No rate is available for this vehicle and dates.");

  const selected = await loadExtras(tx, q.extras);
  const breakdown = asValidation(() => computeQuote({
    pickupAt: q.pickupAt,
    returnAt: q.returnAt,
    dailyRateFils: rule.dailyRateFils,
    extras: selected,
    oneWay: pickupBranch.id !== returnBranch.id,
    oneWayFeeFils: returnBranch.oneWayFeeFils,
    depositFils: vehicle.depositFils,
    vatBps: getEnv().VAT_RATE_BPS,
  }));
  return {
    ...breakdown,
    vehicleId: vehicle.id,
    pickupBranchId: pickupBranch.id,
    returnBranchId: returnBranch.id,
    pickupAt: q.pickupAt,
    returnAt: q.returnAt,
    pricingRuleId: rule.id,
  };
}

async function loadExtras(tx: Tx, selection: z.output<typeof extraSelection>[]) {
  if (selection.length === 0) return [];
  const ids = selection.flatMap((s) => (s.extraId ? [s.extraId] : []));
  const codes = selection.flatMap((s) => (s.code ? [s.code] : []));
  const conds = [];
  if (ids.length) conds.push(inArray(extras.id, ids));
  if (codes.length) conds.push(inArray(extras.code, codes));
  const rows = await tx
    .select()
    .from(extras)
    .where(and(eq(extras.isActive, true), or(...conds)))
    .orderBy(asc(extras.sortOrder));
  return selection.map((s) => {
    const extra = rows.find((r) => (s.extraId ? r.id === s.extraId : r.code === s.code));
    if (!extra) throw new DomainError("VALIDATION", `Unknown extra ${s.extraId ?? s.code}`);
    if (s.quantity > extra.maxQuantity) {
      throw new DomainError("VALIDATION", `At most ${extra.maxQuantity} × ${extra.name} per rental`);
    }
    return { extra, quantity: s.quantity };
  });
}

function asValidation<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) throw new DomainError("VALIDATION", e.message);
    throw e;
  }
}
