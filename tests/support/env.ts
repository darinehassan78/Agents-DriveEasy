// Loads .env.local and points every DB consumer at driveeasy_test.
// Import this BEFORE anything under src/server/** (getEnv() and the pool cache
// their settings on first use).
import { config } from "dotenv";
import path from "node:path";

// All test commands run from the repo root (pnpm scripts, vitest, playwright).
const root = process.cwd();
config({ path: path.join(root, ".env.local"), quiet: true });

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set in .env.local");
  assertTestDatabase(url);
  return url;
}

/** Refuse to touch anything that is not a *_test database. */
export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.slice(1);
  if (!/_test$/.test(name)) {
    throw new Error(`Refusing to use database "${name}" for tests: name must end in _test`);
  }
}

export function useTestDatabaseEnv() {
  const url = testDatabaseUrl();
  process.env.DATABASE_URL = url;
  // Next/Vitest default NODE_ENV=test; keep it explicit for getEnv().
  (process.env as Record<string, string | undefined>).NODE_ENV ??= "test";
  return url;
}

export const repoRoot = root;
