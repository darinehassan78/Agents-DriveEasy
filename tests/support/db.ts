// Test database harness: reset driveeasy_test (drop + recreate schemas, run the
// drizzle migrations from ./drizzle, seed) and small query helpers.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { assertTestDatabase, repoRoot, testDatabaseUrl } from "./env";

export const MIGRATIONS_FOLDER = path.join(repoRoot, "drizzle");

let pool: Pool | undefined;

/** A pool on driveeasy_test that the harness owns (separate from the app pool). */
export function testPool(): Pool {
  pool ??= new Pool({ connectionString: testDatabaseUrl(), max: 20 });
  return pool;
}

export async function closeTestPool() {
  await pool?.end();
  pool = undefined;
}

export interface ResetOptions {
  /** Run src/server/db/seed.ts after migrating (default true). */
  seed?: boolean;
  /** Clock passed to the seed so seeded future reservations are deterministic. */
  now?: Date;
  /** Fail if there are no migrations yet (default false: warn and continue). */
  requireMigrations?: boolean;
  log?: (msg: string) => void;
}

export interface ResetResult {
  migrationsApplied: number;
  seeded: boolean;
}

export function migrationJournal(): { tag: string }[] {
  const journal = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  if (!existsSync(journal)) return [];
  return (JSON.parse(readFileSync(journal, "utf8")) as { entries: { tag: string }[] }).entries;
}

/** Drop everything in driveeasy_test and rebuild it from migrations (+ seed). */
export async function resetTestDatabase(opts: ResetOptions = {}): Promise<ResetResult> {
  const log = opts.log ?? (() => {});
  const url = testDatabaseUrl();
  assertTestDatabase(url);
  const p = testPool();

  // Idle connections (e.g. a running e2e server) hold no locks, so no need to
  // terminate them; doing so could crash a server whose pool lacks an error handler.
  await p.query("drop schema if exists drizzle cascade");
  await p.query("drop schema if exists public cascade");
  await p.query("create schema public");
  // btree_gist is a trusted extension: the database owner may create it.
  await p.query("create extension if not exists btree_gist with schema public");
  await p.query("create extension if not exists pgcrypto with schema public").catch(() => {});
  log("schema reset");

  const entries = migrationJournal();
  if (entries.length === 0) {
    if (opts.requireMigrations) throw new Error(`No migrations found in ${MIGRATIONS_FOLDER}`);
    log("no migrations yet (drizzle/meta/_journal.json missing) - skipped");
  } else {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(drizzle(p), { migrationsFolder: MIGRATIONS_FOLDER });
    log(`applied ${entries.length} migration(s)`);
  }

  let seeded = false;
  if (opts.seed !== false && entries.length > 0) {
    const seedFile = path.join(repoRoot, "src/server/db/seed.ts");
    if (existsSync(seedFile)) {
      const mod = (await import(seedFile)) as {
        seed?: (pool: Pool, o?: { now?: Date }) => Promise<unknown>;
      };
      if (typeof mod.seed !== "function") throw new Error("src/server/db/seed.ts must export seed(pool, opts)");
      await mod.seed(p, { now: opts.now });
      seeded = true;
      log("seeded");
    } else {
      log("no seed yet (src/server/db/seed.ts missing) - skipped");
    }
  }
  return { migrationsApplied: entries.length, seeded };
}

export async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await testPool().query<T>(sql, params)).rows;
}

export async function one<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await q<T>(sql, params);
  if (rows.length !== 1) throw new Error(`Expected 1 row, got ${rows.length}: ${sql}`);
  return rows[0];
}

/** Check out N distinct clients (separate connections) for concurrency tests. */
export async function clients(n: number): Promise<PoolClient[]> {
  return Promise.all(Array.from({ length: n }, () => testPool().connect()));
}

export async function tableExists(name: string): Promise<boolean> {
  const rows = await q<{ t: string | null }>("select to_regclass($1)::text as t", [`public.${name}`]);
  return rows[0].t !== null;
}
