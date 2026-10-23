// Payment + deposit orchestration on top of a PaymentProvider.
//
// Rules:
// - A reservation becomes CONFIRMED only when the rental charge is SUCCEEDED and
//   the deposit is HELD, as reported by a *verified* source: the provider's API
//   response to our own server-side call, or a signature-verified webhook.
// - Every provider call carries an idempotency key that is stored first in our
//   database (payments.idempotency_key / deposits.idempotency_key are UNIQUE),
//   so retries and double clicks reuse the same key and cannot double charge.
// - Webhooks are de-duplicated by (provider, event id) in payment_webhook_events,
//   inside the same transaction that applies them.
// - No database transaction is held open while calling the provider (the fake
//   provider delivers webhooks synchronously during the call).
// - Status updates are monotonic, so a late or duplicate event cannot move a
//   payment backwards (e.g. SUCCEEDED -> PENDING).
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, PROVIDER, SYSTEM, type Actor } from "../audit";
import { db, type Tx } from "../db";
import { deposits, paymentWebhookEvents, payments, reservations } from "../db/schema";
import { DomainError, notFound } from "../errors";
import { log } from "../log";
import { getPaymentProvider } from "./index";
import type { DepositHold, Payment, PaymentProvider } from "./types";

type PaymentRow = typeof payments.$inferSelect;
type DepositRow = typeof deposits.$inferSelect;
type ReservationRow = typeof reservations.$inferSelect;
type DbPaymentStatus = PaymentRow["status"];
type DbDepositStatus = DepositRow["status"];

export interface ActingUser {
  id: string;
  role: "customer" | "admin";
}

export const actorOf = (user: ActingUser): Actor => ({ userId: user.id, type: user.role });

const SEED_PROVIDER = "seed";
const isUuid = (s: unknown): s is string => typeof s === "string" && z.uuid().safeParse(s).success;

// --- Status mapping & monotonic transitions ------------------------------------

export function mapPaymentStatus(s: Payment["status"]): DbPaymentStatus {
  switch (s) {
    case "requires_action":
      return "REQUIRES_ACTION";
    case "processing":
      return "PENDING";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "canceled":
      return "CANCELED";
    case "refunded":
      return "REFUNDED";
    case "partially_refunded":
      return "PARTIALLY_REFUNDED";
  }
}

export function mapDepositStatus(s: DepositHold["status"]): DbDepositStatus {
  switch (s) {
    case "requires_action":
      return "PENDING";
    case "held":
      return "HELD";
    case "released":
      return "RELEASED";
    case "captured":
      return "CAPTURED";
    case "failed":
      return "FAILED";
  }
}

const PAYMENT_NEXT: Record<DbPaymentStatus, DbPaymentStatus[]> = {
  PENDING: ["REQUIRES_ACTION", "SUCCEEDED", "FAILED", "CANCELED", "PARTIALLY_REFUNDED", "REFUNDED"],
  REQUIRES_ACTION: ["SUCCEEDED", "FAILED", "CANCELED", "PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: ["REQUIRES_ACTION", "SUCCEEDED", "CANCELED"],
  SUCCEEDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REFUNDED: [],
  CANCELED: [],
};

const DEPOSIT_NEXT: Record<DbDepositStatus, DbDepositStatus[]> = {
  NONE: ["PENDING", "HELD", "FAILED", "RELEASED", "CAPTURED"],
  PENDING: ["HELD", "FAILED", "RELEASED", "CAPTURED"],
  FAILED: ["PENDING", "HELD", "RELEASED"],
  HELD: ["RELEASED", "CAPTURED"],
  RELEASED: [],
  CAPTURED: [],
};

export function canMovePayment(from: DbPaymentStatus, to: DbPaymentStatus): boolean {
  return from === to || PAYMENT_NEXT[from].includes(to);
}

export function canMoveDeposit(from: DbDepositStatus, to: DbDepositStatus): boolean {
  return from === to || DEPOSIT_NEXT[from].includes(to);
}

// --- Recording provider results --------------------------------------------------

/** Applies a verified provider payment state to our row (monotonic). Returns the updated row. */
export async function recordPaymentResult(tx: Tx, row: PaymentRow, p: Payment): Promise<PaymentRow> {
  const next = mapPaymentStatus(p.status);
  if (!canMovePayment(row.status, next)) {
    log.warn("payment status transition ignored", { paymentId: row.id, from: row.status, to: next });
    return row;
  }
  const refundedFils = Math.min(row.amountFils, Math.max(row.refundedFils, p.refundedAmount || 0));
  const [updated] = await tx
    .update(payments)
    .set({
      status: next,
      refundedFils,
      providerRef: row.providerRef ?? p.id,
      clientSecret: next === "REQUIRES_ACTION" ? (p.clientSecret ?? row.clientSecret) : null,
      failureReason: next === "FAILED" ? (p.failureReason ?? "payment_failed") : row.failureReason,
    })
    .where(eq(payments.id, row.id))
    .returning();
  if (updated.status !== row.status) {
    await audit(tx, PROVIDER, {
      action: `payment.${updated.status.toLowerCase()}`,
      entityType: "payment",
      entityId: row.id,
      before: { status: row.status },
      after: { status: updated.status, refundedFils: updated.refundedFils },
      metadata: { reservationId: row.reservationId, providerRef: updated.providerRef },
    });
  }
  return updated;
}

export async function recordDepositResult(tx: Tx, row: DepositRow, h: DepositHold): Promise<DepositRow> {
  const next = mapDepositStatus(h.status);
  if (!canMoveDeposit(row.status, next)) {
    log.warn("deposit status transition ignored", { depositId: row.id, from: row.status, to: next });
    return row;
  }
  const now = new Date();
  const [updated] = await tx
    .update(deposits)
    .set({
      status: next,
      providerRef: row.providerRef ?? h.id,
      capturedFils: next === "CAPTURED" ? Math.min(row.amountFils, h.capturedAmount || row.capturedFils) : row.capturedFils,
      heldAt: next === "HELD" && !row.heldAt ? now : row.heldAt,
      releasedAt: next === "RELEASED" && !row.releasedAt ? now : row.releasedAt,
      capturedAt: next === "CAPTURED" && !row.capturedAt ? now : row.capturedAt,
      failureReason: next === "FAILED" ? (h.failureReason ?? "deposit_failed") : row.failureReason,
    })
    .where(eq(deposits.id, row.id))
    .returning();
  if (updated.status !== row.status) {
    await audit(tx, PROVIDER, {
      action: `deposit.${updated.status.toLowerCase()}`,
      entityType: "deposit",
      entityId: row.id,
      before: { status: row.status },
      after: { status: updated.status, capturedFils: updated.capturedFils },
      metadata: { reservationId: row.reservationId },
    });
  }
  return updated;
}

/** Recomputes reservations.payment_status / deposit_status from the payment and deposit rows. */
export async function refreshReservationMoneyStatus(tx: Tx, reservationId: string): Promise<void> {
  const charges = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), eq(payments.kind, "CHARGE")));
  const settled = charges.filter((c) => ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(c.status));
  const paid = settled.reduce((s, c) => s + c.amountFils, 0);
  const refunded = settled.reduce((s, c) => s + c.refundedFils, 0);
  let paymentStatus: ReservationRow["paymentStatus"];
  if (paid > 0) paymentStatus = refunded === 0 ? "PAID" : refunded >= paid ? "REFUNDED" : "PARTIALLY_REFUNDED";
  else if (charges.some((c) => c.status === "PENDING" || c.status === "REQUIRES_ACTION")) paymentStatus = "PENDING";
  else if (charges.some((c) => c.status === "FAILED")) paymentStatus = "FAILED";
  else paymentStatus = "UNPAID";

  const [latestDeposit] = await tx
    .select()
    .from(deposits)
    .where(eq(deposits.reservationId, reservationId))
    .orderBy(desc(deposits.createdAt), desc(deposits.id))
    .limit(1);
  await tx
    .update(reservations)
    .set({ paymentStatus, depositStatus: latestDeposit?.status ?? "NONE" })
    .where(eq(reservations.id, reservationId));
}

/** Sum of successfully charged money (net of refunds) for a reservation. */
export async function netPaidFils(tx: Tx, reservationId: string): Promise<number> {
  const rows = await tx
    .select({ amount: payments.amountFils, refunded: payments.refundedFils })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.kind, "CHARGE"),
        inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"]),
      ),
    );
  return rows.reduce((s, r) => s + r.amount - r.refunded, 0);
}

export interface ConfirmOutcome {
  status: ReservationRow["status"];
  confirmedNow: boolean;
  /** Money arrived for a reservation that is no longer bookable: refund/release it. */
  needsCompensation: boolean;
}

/**
 * Confirms a PENDING reservation when the rental is fully paid and the deposit
 * is held. Locks the reservation row. Safe to call repeatedly.
 */
export async function tryConfirmReservation(tx: Tx, reservationId: string, now = new Date()): Promise<ConfirmOutcome> {
  const [res] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
  if (!res) throw notFound("Reservation");
  await refreshReservationMoneyStatus(tx, reservationId);

  const charges = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), eq(payments.kind, "CHARGE"), eq(payments.purpose, "RENTAL")));
  const paidRental = charges.filter((c) => c.status === "SUCCEEDED").reduce((s, c) => s + c.amountFils, 0);
  const [deposit] = await tx
    .select()
    .from(deposits)
    .where(eq(deposits.reservationId, reservationId))
    .orderBy(desc(deposits.createdAt), desc(deposits.id))
    .limit(1);
  const depositOk = res.depositFils === 0 || deposit?.status === "HELD";
  const moneyIn = paidRental > 0 || deposit?.status === "HELD" || deposit?.status === "PENDING";

  if (res.status === "PENDING" && paidRental >= res.totalFils && depositOk) {
    await tx
      .update(reservations)
      .set({ status: "CONFIRMED", confirmedAt: now })
      .where(eq(reservations.id, reservationId));
    await audit(tx, SYSTEM, {
      action: "reservation.confirmed",
      entityType: "reservation",
      entityId: reservationId,
      before: { status: "PENDING" },
      after: { status: "CONFIRMED" },
      metadata: { paidRentalFils: paidRental, depositStatus: deposit?.status ?? "NONE" },
    });
    log.info("reservation confirmed", { reservationId, reference: res.reference });
    return { status: "CONFIRMED", confirmedNow: true, needsCompensation: false };
  }
  const dead = res.status === "EXPIRED" || (res.status === "CANCELLED" && res.cancellationFeeFils === 0);
  return { status: res.status, confirmedNow: false, needsCompensation: dead && moneyIn };
}

// --- Checkout --------------------------------------------------------------------

export type FakeOutcome = "succeed" | "fail" | "requires_action";

export interface CheckoutOptions {
  now?: Date;
  /** Fake provider only: force the card payment outcome. */
  fakeOutcome?: FakeOutcome;
  /** Fake provider only: force the deposit hold outcome. */
  depositFakeOutcome?: FakeOutcome;
}

export interface CheckoutResult {
  /** CONFIRMED: done. REQUIRES_ACTION: finish in the browser with clientSecret. FAILED: retry allowed while the hold lasts. */
  outcome: "CONFIRMED" | "REQUIRES_ACTION" | "FAILED" | "PENDING";
  reservationId: string;
  reference: string;
  reservationStatus: ReservationRow["status"];
  paymentStatus: ReservationRow["paymentStatus"];
  depositStatus: ReservationRow["depositStatus"];
  step?: "deposit" | "payment";
  clientSecret?: string;
  message: string;
}

/**
 * Takes payment for a PENDING reservation: holds the security deposit, then
 * charges the rental total, then confirms. Idempotent: calling it again resumes
 * where it stopped and never charges twice. A FAILED attempt can be retried
 * (a new idempotency key is used for the new attempt) while the hold lasts.
 */
export async function startCheckout(
  reservationId: string,
  user: ActingUser,
  opts: CheckoutOptions = {},
): Promise<CheckoutResult> {
  const now = opts.now ?? new Date();
  const provider = getPaymentProvider();

  const prepared = await db().transaction(async (tx) => {
    const [res] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    if (!res || (user.role !== "admin" && res.userId !== user.id)) throw notFound("Reservation");
    if (res.status !== "PENDING") return { res, deposit: null, payment: null };
    if (!res.holdExpiresAt || res.holdExpiresAt.getTime() <= now.getTime()) {
      throw new DomainError("HOLD_EXPIRED", "Your hold on this car has expired. Please search again.");
    }
    const deposit = res.depositFils > 0 ? await ensureDepositAttempt(tx, res, provider) : null;
    const payment = await ensureRentalChargeAttempt(tx, res, provider);
    return { res, deposit, payment };
  });

  if (!prepared.payment) return checkoutResult(reservationId, "Reservation is not awaiting payment.");
  const { res } = prepared;
  const fakeMeta = (o?: FakeOutcome): Record<string, string> =>
    provider.name === "fake" && o ? { fake_outcome: o } : {};

  // 1) Deposit authorisation (held, not charged).
  let deposit = prepared.deposit;
  if (deposit && deposit.status !== "HELD") {
    try {
      const hold = await provider.holdDeposit({
        amount: deposit.amountFils,
        currency: "aed",
        idempotencyKey: deposit.idempotencyKey,
        metadata: { reservationId, depositId: deposit.id, reference: res.reference, ...fakeMeta(opts.depositFakeOutcome) },
      });
      deposit = await db().transaction(async (tx) => {
        const d = await recordDepositResult(tx, await reloadDeposit(tx, deposit!.id), hold);
        await refreshReservationMoneyStatus(tx, reservationId);
        return d;
      });
      if (deposit.status === "PENDING") {
        return checkoutResult(reservationId, "Please authorise the security deposit.", {
          outcome: "REQUIRES_ACTION",
          step: "deposit",
          clientSecret: hold.clientSecret,
        });
      }
    } catch (err) {
      await markFailed("deposit", deposit.id, reservationId, err);
      return checkoutResult(reservationId, "The security deposit could not be authorised. Please try another card.", {
        outcome: "FAILED",
        step: "deposit",
      });
    }
    if (deposit.status !== "HELD") {
      return checkoutResult(reservationId, "The security deposit could not be authorised.", { outcome: "FAILED", step: "deposit" });
    }
  }

  // 2) Rental charge.
  let payment = prepared.payment;
  if (payment.status !== "SUCCEEDED") {
    try {
      const p = await provider.createPayment({
        amount: payment.amountFils,
        currency: "aed",
        idempotencyKey: payment.idempotencyKey,
        metadata: { reservationId, paymentId: payment.id, reference: res.reference, ...fakeMeta(opts.fakeOutcome) },
      });
      payment = await db().transaction(async (tx) => recordPaymentResult(tx, await reloadPayment(tx, payment.id), p));
      if (payment.status === "REQUIRES_ACTION") {
        await db().transaction((tx) => refreshReservationMoneyStatus(tx, reservationId));
        return checkoutResult(reservationId, "Please complete the payment.", {
          outcome: "REQUIRES_ACTION",
          step: "payment",
          clientSecret: p.clientSecret,
        });
      }
    } catch (err) {
      await markFailed("payment", payment.id, reservationId, err);
      return checkoutResult(reservationId, "The payment could not be processed. Please try again.", {
        outcome: "FAILED",
        step: "payment",
      });
    }
  }

  // 3) Confirm (or compensate if the hold expired meanwhile).
  const confirm = await db().transaction((tx) => tryConfirmReservation(tx, reservationId, now));
  if (confirm.needsCompensation) await compensateDeadReservation(reservationId);
  if (payment.status === "FAILED") {
    return checkoutResult(reservationId, "Your card was declined. Please try again.", { outcome: "FAILED", step: "payment" });
  }
  return checkoutResult(reservationId, confirm.status === "CONFIRMED" ? "Booking confirmed." : "Payment received.");
}

async function ensureDepositAttempt(tx: Tx, res: ReservationRow, provider: PaymentProvider): Promise<DepositRow> {
  const existing = await tx
    .select()
    .from(deposits)
    .where(eq(deposits.reservationId, res.id))
    .orderBy(desc(deposits.createdAt), desc(deposits.id));
  const latest = existing[0];
  if (latest && latest.status !== "FAILED" && latest.status !== "RELEASED") return latest;
  const [row] = await tx
    .insert(deposits)
    .values({
      reservationId: res.id,
      amountFils: res.depositFils,
      provider: provider.name,
      idempotencyKey: `res:${res.id}:deposit:${existing.length + 1}`,
      status: "PENDING",
    })
    .returning();
  return row;
}

async function ensureRentalChargeAttempt(tx: Tx, res: ReservationRow, provider: PaymentProvider): Promise<PaymentRow> {
  const existing = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, res.id), eq(payments.kind, "CHARGE"), eq(payments.purpose, "RENTAL")))
    .orderBy(desc(payments.createdAt), desc(payments.id));
  const latest = existing[0];
  if (latest && latest.status !== "FAILED" && latest.status !== "CANCELED" && latest.amountFils === res.totalFils) {
    return latest;
  }
  const [row] = await tx
    .insert(payments)
    .values({
      reservationId: res.id,
      kind: "CHARGE",
      purpose: "RENTAL",
      amountFils: res.totalFils,
      provider: provider.name,
      idempotencyKey: `res:${res.id}:pay:${existing.length + 1}`,
      status: "PENDING",
    })
    .returning();
  return row;
}

async function reloadPayment(tx: Tx, id: string): Promise<PaymentRow> {
  const [row] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
  if (!row) throw notFound("Payment");
  return row;
}

async function reloadDeposit(tx: Tx, id: string): Promise<DepositRow> {
  const [row] = await tx.select().from(deposits).where(eq(deposits.id, id)).for("update");
  if (!row) throw notFound("Deposit");
  return row;
}

async function markFailed(kind: "payment" | "deposit", id: string, reservationId: string, err: unknown) {
  const reason = err instanceof Error ? err.message.slice(0, 300) : String(err);
  log.warn(`${kind} attempt failed`, { reservationId, id, reason });
  await db().transaction(async (tx) => {
    if (kind === "payment") {
      const row = await reloadPayment(tx, id);
      if (canMovePayment(row.status, "FAILED") && row.status !== "SUCCEEDED") {
        await tx.update(payments).set({ status: "FAILED", failureReason: reason }).where(eq(payments.id, id));
      }
    } else {
      const row = await reloadDeposit(tx, id);
      if (row.status === "PENDING" || row.status === "NONE") {
        await tx.update(deposits).set({ status: "FAILED", failureReason: reason }).where(eq(deposits.id, id));
      }
    }
    await audit(tx, SYSTEM, {
      action: `${kind}.failed`,
      entityType: kind,
      entityId: id,
      metadata: { reservationId, reason },
    });
    await refreshReservationMoneyStatus(tx, reservationId);
  });
}

async function checkoutResult(
  reservationId: string,
  message: string,
  extra: Partial<Pick<CheckoutResult, "outcome" | "step" | "clientSecret">> = {},
): Promise<CheckoutResult> {
  const [res] = await db().select().from(reservations).where(eq(reservations.id, reservationId));
  const outcome = extra.outcome ?? (res.status === "CONFIRMED" ? "CONFIRMED" : res.status === "PENDING" ? "PENDING" : "FAILED");
  return {
    outcome,
    reservationId,
    reference: res.reference,
    reservationStatus: res.status,
    paymentStatus: res.paymentStatus,
    depositStatus: res.depositStatus,
    step: extra.step,
    clientSecret: extra.clientSecret,
    message,
  };
}

// --- Webhooks --------------------------------------------------------------------

export interface WebhookResult {
  status: "processed" | "duplicate" | "ignored";
  eventId: string;
  type: string;
}

/**
 * Verifies and applies a provider webhook. Throws DomainError("VALIDATION") on a
 * bad signature (route returns 400). Duplicate event ids are acknowledged and
 * ignored.
 */
export async function handlePaymentWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  const provider = getPaymentProvider();
  let event;
  try {
    event = provider.verifyWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof Error && err.name === "UnhandledStripeEvent") {
      return { status: "ignored", eventId: "", type: err.message };
    }
    log.warn("webhook rejected", { provider: provider.name, reason: (err as Error).message });
    throw new DomainError("VALIDATION", "Invalid webhook signature");
  }

  const outcome = await db().transaction(async (tx) => {
    const inserted = await tx
      .insert(paymentWebhookEvents)
      .values({ provider: provider.name, eventId: event.id, type: event.type, payload: event as unknown as object })
      .onConflictDoNothing()
      .returning({ eventId: paymentWebhookEvents.eventId });
    if (inserted.length === 0) return { status: "duplicate" as const, reservationId: null, confirm: null };

    const meta = event.data.metadata ?? {};
    let reservationId: string | null = null;
    if (event.type.startsWith("deposit.")) {
      const [row] = await tx
        .select()
        .from(deposits)
        .where(
          and(
            eq(deposits.provider, provider.name),
            isUuid(meta.depositId) ? eq(deposits.id, meta.depositId) : eq(deposits.providerRef, event.data.id),
          ),
        )
        .for("update");
      if (row) {
        await recordDepositResult(tx, row, event.data as DepositHold);
        reservationId = row.reservationId;
      }
    } else {
      const [row] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.provider, provider.name),
            eq(payments.kind, "CHARGE"),
            isUuid(meta.paymentId) ? eq(payments.id, meta.paymentId) : eq(payments.providerRef, event.data.id),
          ),
        )
        .for("update");
      if (row) {
        const data = event.data as Payment;
        // Some providers' refund events carry only the refunded amount; keep our known status otherwise.
        const p: Payment =
          event.type === "payment.refunded"
            ? { ...data, status: data.refundedAmount >= row.amountFils ? "refunded" : "partially_refunded" }
            : data;
        await recordPaymentResult(tx, row, p);
        reservationId = row.reservationId;
      }
    }
    await tx
      .update(paymentWebhookEvents)
      .set({ processedAt: new Date() })
      .where(and(eq(paymentWebhookEvents.provider, provider.name), eq(paymentWebhookEvents.eventId, event.id)));
    if (!reservationId) return { status: "ignored" as const, reservationId: null, confirm: null };
    const confirm = await tryConfirmReservation(tx, reservationId);
    return { status: "processed" as const, reservationId, confirm };
  });

  log.info("webhook handled", { provider: provider.name, eventId: event.id, type: event.type, status: outcome.status });
  // Only money *arriving* (a success or a new hold) for a dead booking needs undoing;
  // refund/release events are the result of undoing it.
  const arriving = event.type === "payment.succeeded" || event.type === "deposit.held";
  if (outcome.reservationId && outcome.confirm?.needsCompensation && arriving) {
    await compensateDeadReservation(outcome.reservationId).catch((err) =>
      log.error("compensation failed", { reservationId: outcome.reservationId, err }),
    );
  }
  return { status: outcome.status, eventId: event.id, type: event.type };
}

// --- Refunds, deposit release/capture, extra charges -------------------------------

/**
 * Refunds up to `amountFils` across the reservation's settled charges (newest
 * first). Each refund is recorded as a REFUND payment row whose idempotency key
 * is derived from `keyPrefix`, so calling again with the same prefix never
 * refunds twice. Returns the amount refunded by this call.
 */
export async function refundReservation(
  reservationId: string,
  amountFils: number,
  keyPrefix: string,
  actor: Actor,
  reason: string,
): Promise<number> {
  if (!Number.isSafeInteger(amountFils) || amountFils < 0) throw new DomainError("VALIDATION", "Invalid refund amount");
  if (amountFils === 0) return 0;
  const charges = await db()
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.kind, "CHARGE"),
        inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"]),
      ),
    )
    .orderBy(desc(payments.createdAt));
  let remaining = amountFils;
  let refunded = 0;
  for (const charge of charges) {
    if (remaining <= 0) break;
    const refundable = charge.amountFils - charge.refundedFils;
    // Check for an earlier refund with the same key (retry) before computing a new amount.
    const key = `${keyPrefix}:${charge.id}`;
    const [prior] = await db().select().from(payments).where(eq(payments.idempotencyKey, key));
    const amount = prior ? prior.amountFils : Math.min(remaining, refundable);
    if (amount <= 0) continue;
    const done = await refundCharge(charge, amount, key, actor, reason);
    refunded += done;
    remaining -= amount;
  }
  if (remaining > 0 && refunded < amountFils) {
    log.warn("refund requested exceeds refundable amount", { reservationId, amountFils, refunded });
  }
  return refunded;
}

async function refundCharge(charge: PaymentRow, amount: number, key: string, actor: Actor, reason: string): Promise<number> {
  const refundRow = await db().transaction(async (tx) => {
    await tx
      .insert(payments)
      .values({
        reservationId: charge.reservationId,
        kind: "REFUND",
        purpose: charge.purpose,
        parentPaymentId: charge.id,
        amountFils: amount,
        provider: charge.provider,
        idempotencyKey: key,
        status: "PENDING",
      })
      .onConflictDoNothing({ target: payments.idempotencyKey });
    const [row] = await tx.select().from(payments).where(eq(payments.idempotencyKey, key)).for("update");
    return row;
  });
  if (refundRow.status === "SUCCEEDED") return 0;

  let providerResult: Payment | null = null;
  try {
    if (charge.provider !== SEED_PROVIDER) {
      const provider = getPaymentProvider();
      if (provider.name !== charge.provider) throw new Error(`Charge was made with ${charge.provider}, not ${provider.name}`);
      if (!charge.providerRef) throw new Error("Charge has no provider reference");
      providerResult = await provider.refundPayment(charge.providerRef, amount, { idempotencyKey: key });
    }
  } catch (err) {
    const msg = (err as Error).message.slice(0, 300);
    await db().update(payments).set({ status: "FAILED", failureReason: msg }).where(eq(payments.id, refundRow.id));
    log.error("refund failed", { paymentId: charge.id, amount, err });
    throw new DomainError("PAYMENT_FAILED", "The refund could not be processed. Please try again.");
  }

  await db().transaction(async (tx) => {
    const moved = await tx
      .update(payments)
      .set({ status: "SUCCEEDED", failureReason: null })
      .where(and(eq(payments.id, refundRow.id), sql`${payments.status} <> 'SUCCEEDED'`))
      .returning({ id: payments.id });
    if (moved.length === 0) return;
    const current = await reloadPayment(tx, charge.id);
    const refundedFils = providerResult
      ? Math.max(current.refundedFils, providerResult.refundedAmount)
      : Math.min(current.amountFils, current.refundedFils + amount);
    await tx
      .update(payments)
      .set({ refundedFils, status: refundedFils >= current.amountFils ? "REFUNDED" : "PARTIALLY_REFUNDED" })
      .where(eq(payments.id, charge.id));
    await audit(tx, actor, {
      action: "payment.refunded",
      entityType: "payment",
      entityId: charge.id,
      after: { refundFils: amount, refundedFils },
      metadata: { reservationId: charge.reservationId, reason, refundPaymentId: refundRow.id },
    });
    await refreshReservationMoneyStatus(tx, charge.reservationId);
  });
  return amount;
}

/** Releases the reservation's held (or pending) deposit. Idempotent. */
export async function releaseDeposit(reservationId: string, actor: Actor, reason = "released"): Promise<DbDepositStatus | null> {
  const [dep] = await db()
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, reservationId), inArray(deposits.status, ["HELD", "PENDING"])))
    .orderBy(desc(deposits.createdAt))
    .limit(1);
  if (!dep) return null;
  let hold: DepositHold | null = null;
  if (dep.provider !== SEED_PROVIDER && dep.providerRef) {
    const provider = getPaymentProvider();
    try {
      hold = await provider.releaseDeposit(dep.providerRef, { idempotencyKey: `release:${dep.id}` });
    } catch (err) {
      log.error("deposit release failed", { depositId: dep.id, err });
      throw new DomainError("PAYMENT_FAILED", "The deposit could not be released. Please try again.");
    }
  }
  return db().transaction(async (tx) => {
    const row = await reloadDeposit(tx, dep.id);
    const updated = await recordDepositResult(
      tx,
      row,
      hold ?? { id: dep.providerRef ?? dep.id, amount: dep.amountFils, currency: "aed", status: "released", capturedAmount: 0, metadata: {} },
    );
    await audit(tx, actor, {
      action: "deposit.release",
      entityType: "deposit",
      entityId: dep.id,
      metadata: { reservationId, reason },
    });
    await refreshReservationMoneyStatus(tx, reservationId);
    return updated.status;
  });
}

/**
 * Captures part (or all) of the held deposit, e.g. for late return or damage;
 * the rest is released by the provider. Returns the captured amount.
 */
export async function captureDeposit(
  reservationId: string,
  amountFils: number,
  actor: Actor,
  reason: string,
): Promise<number> {
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) throw new DomainError("VALIDATION", "Invalid capture amount");
  const [dep] = await db()
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "HELD")))
    .orderBy(desc(deposits.createdAt))
    .limit(1);
  if (!dep) throw new DomainError("INVALID_STATE", "No deposit is currently held for this reservation.");
  const amount = Math.min(amountFils, dep.amountFils);
  let hold: DepositHold | null = null;
  if (dep.provider !== SEED_PROVIDER && dep.providerRef) {
    try {
      hold = await getPaymentProvider().captureDeposit(dep.providerRef, amount, { idempotencyKey: `capture:${dep.id}` });
    } catch (err) {
      log.error("deposit capture failed", { depositId: dep.id, err });
      throw new DomainError("PAYMENT_FAILED", "The deposit could not be captured. Please try again.");
    }
  }
  await db().transaction(async (tx) => {
    const row = await reloadDeposit(tx, dep.id);
    await recordDepositResult(
      tx,
      row,
      hold ?? { id: dep.providerRef ?? dep.id, amount: dep.amountFils, currency: "aed", status: "captured", capturedAmount: amount, metadata: {} },
    );
    await tx.update(deposits).set({ captureReason: reason }).where(eq(deposits.id, dep.id));
    await audit(tx, actor, {
      action: "deposit.capture",
      entityType: "deposit",
      entityId: dep.id,
      after: { capturedFils: amount },
      metadata: { reservationId, reason },
    });
    await refreshReservationMoneyStatus(tx, reservationId);
  });
  return amount;
}

/**
 * Charges an additional amount (date change, late fee, damage) with a stable
 * idempotency key. Returns the payment row. Note: with Stripe this needs a
 * saved payment method (off-session); the fake provider charges directly.
 */
export async function chargeAdditional(
  reservationId: string,
  purpose: "MODIFICATION" | "LATE_FEE" | "DAMAGE" | "OTHER",
  amountFils: number,
  idempotencyKey: string,
  actor: Actor,
  opts: { fakeOutcome?: FakeOutcome } = {},
): Promise<PaymentRow> {
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) throw new DomainError("VALIDATION", "Invalid charge amount");
  const provider = getPaymentProvider();
  const row = await db().transaction(async (tx) => {
    await tx
      .insert(payments)
      .values({ reservationId, kind: "CHARGE", purpose, amountFils, provider: provider.name, idempotencyKey, status: "PENDING" })
      .onConflictDoNothing({ target: payments.idempotencyKey });
    const [r] = await tx.select().from(payments).where(eq(payments.idempotencyKey, idempotencyKey));
    return r;
  });
  if (row.status === "SUCCEEDED" || row.status === "REQUIRES_ACTION") return row;
  try {
    const p = await provider.createPayment({
      amount: row.amountFils,
      currency: "aed",
      idempotencyKey,
      metadata: {
        reservationId,
        paymentId: row.id,
        purpose,
        ...(provider.name === "fake" && opts.fakeOutcome ? { fake_outcome: opts.fakeOutcome } : {}),
      },
    });
    return await db().transaction(async (tx) => {
      const updated = await recordPaymentResult(tx, await reloadPayment(tx, row.id), p);
      await audit(tx, actor, {
        action: "payment.charge_additional",
        entityType: "payment",
        entityId: row.id,
        after: { amountFils: row.amountFils, purpose, status: updated.status },
        metadata: { reservationId },
      });
      await refreshReservationMoneyStatus(tx, reservationId);
      return updated;
    });
  } catch (err) {
    await markFailed("payment", row.id, reservationId, err);
    const [failed] = await db().select().from(payments).where(eq(payments.id, row.id));
    return failed;
  }
}

/**
 * For reservations that died (EXPIRED, or CANCELLED without fee) while money
 * was in flight: refund all charges, release deposits, cancel pending actions.
 * Idempotent (stable keys + status checks).
 */
export async function compensateDeadReservation(reservationId: string): Promise<{ refundedFils: number; released: boolean }> {
  const [res] = await db().select().from(reservations).where(eq(reservations.id, reservationId));
  if (!res) throw notFound("Reservation");
  const dead = res.status === "EXPIRED" || (res.status === "CANCELLED" && res.cancellationFeeFils === 0);
  if (!dead) return { refundedFils: 0, released: false };
  const net = await netPaidFils(db(), reservationId);
  const refundedFils = net > 0 ? await refundReservation(reservationId, net, `compensate:${reservationId}`, SYSTEM, `reservation ${res.status.toLowerCase()}`) : 0;
  const released = (await releaseDeposit(reservationId, SYSTEM, `reservation ${res.status.toLowerCase()}`)) !== null;
  if (refundedFils > 0 || released) {
    log.info("compensated dead reservation", { reservationId, status: res.status, refundedFils, released });
  }
  return { refundedFils, released };
}

/** Admin: refund money to the customer (e.g. goodwill or after cancellation). */
export async function adminRefund(
  reservationId: string,
  admin: ActingUser,
  input: { amountFils?: number; reason: string; requestId: string },
): Promise<{ refundedFils: number }> {
  if (admin.role !== "admin") throw new DomainError("FORBIDDEN", "Admins only.");
  const net = await netPaidFils(db(), reservationId);
  const amount = input.amountFils ?? net;
  if (amount > net) throw new DomainError("VALIDATION", `At most ${net} fils can be refunded.`);
  const refundedFils = await refundReservation(reservationId, amount, `admin-refund:${input.requestId}`, actorOf(admin), input.reason);
  // A cancelled booking whose money has been returned is REFUNDED.
  await db().transaction(async (tx) => {
    const [res] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    if (res?.status === "CANCELLED" && res.paymentStatus === "REFUNDED") {
      await tx.update(reservations).set({ status: "REFUNDED" }).where(eq(reservations.id, reservationId));
      await audit(tx, actorOf(admin), {
        action: "reservation.refunded",
        entityType: "reservation",
        entityId: reservationId,
        before: { status: "CANCELLED" },
        after: { status: "REFUNDED" },
      });
    }
  });
  return { refundedFils };
}
