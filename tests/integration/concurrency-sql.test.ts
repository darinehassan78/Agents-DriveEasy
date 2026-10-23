// Q5 (database layer): separate connections inserting overlapping blocking
// reservations for the same vehicle at the same moment -> exactly one commits.
import { describe, expect, it } from "vitest";
import { clients, q, tableExists } from "../support/db";
import { at, insertReservation, isExclusionViolation, makeUser, makeVehicle } from "../support/fixtures";

const ready = await tableExists("vehicle_blocks");
const ITERATIONS = Number(process.env.QA_RACE_ITERATIONS ?? 50);

async function race(n: number, iterations: number) {
  const user = await makeUser();
  for (let i = 0; i < iterations; i++) {
    const v = await makeVehicle();
    const cs = await clients(n);
    try {
      // Open all transactions first, then fire the inserts together.
      await Promise.all(cs.map((c) => c.query("begin")));
      const results = await Promise.allSettled(
        cs.map((c, k) =>
          insertReservation(
            {
              userId: user.id,
              vehicleId: v.id,
              branchId: v.branchId,
              pickupAt: at(10, 6 + k),
              returnAt: at(12, 6 + k),
              status: "PENDING",
            },
            c,
          ).then(async (r) => {
            await c.query("commit");
            return r;
          }),
        ),
      );
      for (const [k, r] of results.entries()) {
        if (r.status === "rejected") {
          await cs[k].query("rollback");
          // Without an explicit row lock, PostgreSQL may report a deadlock (40P01)
          // instead of 23P01 when both inserts see each other's uncommitted rows.
          // Either way the loser is aborted. (The app's reserve() locks the
          // vehicle first; that path is tested in reserve-concurrency.test.ts.)
          const code = (r.reason as { code?: string }).code;
          expect(isExclusionViolation(r.reason) || code === "40P01", String(r.reason)).toBe(true);
        }
      }
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await q("select 1 from reservations where vehicle_id=$1", [v.id])).toHaveLength(1);
      expect(await q("select 1 from vehicle_blocks where vehicle_id=$1", [v.id])).toHaveLength(1);
    } finally {
      cs.forEach((c) => c.release());
    }
  }
}

describe.skipIf(!ready)("concurrent overlapping inserts (separate pool clients)", () => {
  it(`2 connections x ${ITERATIONS} iterations: exactly one wins each time`, () => race(2, ITERATIONS), 300_000);
  it("10 connections x 10 iterations: exactly one wins each time", () => race(10, 10), 300_000);
});
