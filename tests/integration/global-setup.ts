// Rebuilds driveeasy_test once before the integration run.
import "../support/env";
import { closeTestPool, resetTestDatabase } from "../support/db";

export default async function setup() {
  await resetTestDatabase({ log: (m) => console.log(`[test-db] ${m}`) });
  await closeTestPool();
}
