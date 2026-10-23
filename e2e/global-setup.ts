// Resets driveeasy_test before the run (the webServer command also resets it
// before building, so a reused server still starts from known data).
import "../tests/support/env";
import { closeTestPool, resetTestDatabase } from "../tests/support/db";

export default async function globalSetup() {
  if (process.env.E2E_NO_RESET) return;
  await resetTestDatabase({ log: (m) => console.log(`[test-db] ${m}`) });
  await closeTestPool();
}
