// Q6: [) boundaries, maintenance blocks and non-blocking statuses, enforced by
// the vehicle_blocks exclusion constraint (via reservation/maintenance triggers).
import { beforeAll, describe, expect, it } from "vitest";
import { tableExists, testPool } from "../support/db";
import {
  at,
  insertMaintenance,
  insertReservation,
  isExclusionViolation,
  makeUser,
  makeVehicle,
} from "../support/fixtures";

const ready = await tableExists("vehicle_blocks");

async function expectRejected(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, "expected an exclusion violation").not.toBeNull();
  expect(isExclusionViolation(err), `expected 23P01, got ${(err as Error).message}`).toBe(true);
}

describe.skipIf(!ready)("overlap rules (exclusion constraint)", () => {
  let user: { id: string };
  beforeAll(async () => {
    user = await makeUser();
  });

  async function setup() {
    const v = await makeVehicle();
    return { v, base: { userId: user.id, vehicleId: v.id, branchId: v.branchId } };
  }

  it("back-to-back rentals: one ends exactly when the next begins -> both succeed", async () => {
    const { base } = await setup();
    await insertReservation({ ...base, pickupAt: at(10, 6), returnAt: at(12, 6) });
    await expect(insertReservation({ ...base, pickupAt: at(12, 6), returnAt: at(14, 6) })).resolves.toBeTruthy();
    await expect(insertReservation({ ...base, pickupAt: at(8, 6), returnAt: at(10, 6) })).resolves.toBeTruthy();
  });

  it("an overlap of one minute is rejected (either end, inside, around)", async () => {
    const { base } = await setup();
    await insertReservation({ ...base, pickupAt: at(10, 6), returnAt: at(12, 6) });
    await expectRejected(insertReservation({ ...base, pickupAt: at(12, 5, 59), returnAt: at(14, 6) }));
    await expectRejected(insertReservation({ ...base, pickupAt: at(9, 6), returnAt: at(10, 6, 1) }));
    await expectRejected(insertReservation({ ...base, pickupAt: at(10, 12), returnAt: at(11, 6) }));
    await expectRejected(insertReservation({ ...base, pickupAt: at(9, 6), returnAt: at(13, 6) }));
  });

  it.each(["PENDING", "CONFIRMED", "PICKED_UP"] as const)("a %s reservation blocks", async (status) => {
    const { base } = await setup();
    await insertReservation({ ...base, pickupAt: at(10), returnAt: at(12), status });
    await expectRejected(insertReservation({ ...base, pickupAt: at(11), returnAt: at(13) }));
  });

  it.each(["RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"] as const)(
    "a %s reservation does not block",
    async (status) => {
      const { base } = await setup();
      await insertReservation({ ...base, pickupAt: at(10), returnAt: at(12), status });
      await expect(insertReservation({ ...base, pickupAt: at(11), returnAt: at(13) })).resolves.toBeTruthy();
    },
  );

  it("cancelling a reservation frees the slot", async () => {
    const { base } = await setup();
    const r = await insertReservation({ ...base, pickupAt: at(10), returnAt: at(12) });
    await expectRejected(insertReservation({ ...base, pickupAt: at(11), returnAt: at(13) }));
    await testPool().query("update reservations set status='CANCELLED', cancelled_at=now() where id=$1", [r.id]);
    await expect(insertReservation({ ...base, pickupAt: at(11), returnAt: at(13) })).resolves.toBeTruthy();
  });

  it("re-activating a cancelled reservation onto a taken slot is rejected", async () => {
    const { base } = await setup();
    const r = await insertReservation({ ...base, pickupAt: at(10), returnAt: at(12), status: "CANCELLED" });
    await insertReservation({ ...base, pickupAt: at(11), returnAt: at(13) });
    await expectRejected(testPool().query("update reservations set status='CONFIRMED' where id=$1", [r.id]));
  });

  it("moving a reservation's dates onto another booking is rejected", async () => {
    const { base } = await setup();
    const a = await insertReservation({ ...base, pickupAt: at(10), returnAt: at(12) });
    await insertReservation({ ...base, pickupAt: at(14), returnAt: at(16) });
    await expectRejected(testPool().query("update reservations set return_at=$2 where id=$1", [a.id, at(15)]));
  });

  it("maintenance overlapping a reservation is rejected (both directions); adjacent is fine", async () => {
    const { v, base } = await setup();
    await insertReservation({ ...base, pickupAt: at(10), returnAt: at(12) });
    await expectRejected(insertMaintenance({ vehicleId: v.id, startsAt: at(11), endsAt: at(13) }));
    await expect(insertMaintenance({ vehicleId: v.id, startsAt: at(12), endsAt: at(13) })).resolves.toBeTruthy();
    await expectRejected(insertReservation({ ...base, pickupAt: at(12, 12), returnAt: at(14) }));
    await expect(insertReservation({ ...base, pickupAt: at(13), returnAt: at(14) })).resolves.toBeTruthy();
  });

  it("different vehicles never conflict", async () => {
    const v1 = await makeVehicle();
    const v2 = await makeVehicle({ branchId: v1.branchId, categoryId: v1.categoryId });
    await insertReservation({ userId: user.id, vehicleId: v1.id, branchId: v1.branchId, pickupAt: at(10), returnAt: at(12) });
    await expect(
      insertReservation({ userId: user.id, vehicleId: v2.id, branchId: v1.branchId, pickupAt: at(10), returnAt: at(12) }),
    ).resolves.toBeTruthy();
  });
});
