import { getPool } from "../db";
import type { JobResult } from "./index";

// Releases booking holds whose time has run out, so the car becomes bookable
// again. Placeholder until the holds table exists: it checks the database is
// reachable and releases nothing.
export async function releaseExpiredHolds(now = new Date()): Promise<JobResult> {
  const { rows } = await getPool().query<{ db: string }>("select current_database() as db");
  // TODO: once the holds table exists, release rows where expires_at < now
  // (and release any deposit via getPaymentProvider().releaseDeposit).
  return { message: `Checked ${rows[0].db} at ${now.toISOString()}: 0 holds released (holds table not created yet)` };
}
