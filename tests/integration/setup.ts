// Runs in every test worker before test files import src/server/**.
import { afterAll } from "vitest";
import { useTestDatabaseEnv } from "../support/env";
import { closeTestPool } from "../support/db";

useTestDatabaseEnv();

afterAll(async () => {
  await closeTestPool();
  const g = globalThis as { __pgPool?: { end(): Promise<void> } };
  await g.__pgPool?.end().catch(() => {});
  g.__pgPool = undefined;
});
