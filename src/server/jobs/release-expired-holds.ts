import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { reservations } from "../db/schema";
import { log } from "../log";
import { compensateDeadReservation } from "../payments/service";
import { expireStaleHolds } from "../reservations";
import type { JobResult } from "./index";

export interface ReleaseExpiredHoldsResult extends JobResult {
  expired: string[];
  compensated: number;
}

/**
 * Idempotent: marks PENDING reservations whose hold has run out as EXPIRED
 * (removing their vehicle block), then refunds/releases any money that reached
 * an expired (or fee-free cancelled) booking. Running it twice does nothing
 * more the second time.
 */
export async function releaseExpiredHolds(now = new Date()): Promise<ReleaseExpiredHoldsResult> {
  const expired = await db().transaction((tx) => expireStaleHolds(tx, { now, limit: 1000 }));

  // Money sweep: expired bookings that still have a charge or a held/pending deposit.
  const stuck = await db()
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, "EXPIRED"),
        or(
          inArray(reservations.paymentStatus, ["PAID", "PARTIALLY_REFUNDED", "PENDING"]),
          inArray(reservations.depositStatus, ["HELD", "PENDING"]),
        ),
      ),
    )
    .limit(200);
  let compensated = 0;
  for (const r of stuck) {
    try {
      const c = await compensateDeadReservation(r.id);
      if (c.refundedFils > 0 || c.released) compensated++;
    } catch (err) {
      log.error("compensation failed", { reservationId: r.id, err });
    }
  }
  const message = `${expired.length} hold(s) expired, ${compensated} expired booking(s) refunded/released at ${now.toISOString()}`;
  log.info("release-expired-holds", { expired: expired.length, compensated });
  return { message, expired, compensated };
}
