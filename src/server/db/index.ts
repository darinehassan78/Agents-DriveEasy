import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A Drizzle transaction (or the root db) — functions taking `Tx` work with either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

const g = globalThis as { __pgPool?: Pool; __db?: Db };

/**
 * The app's connection pool. In production DATABASE_URL should be the *pooled*
 * connection string (e.g. Neon "-pooler" host); migrations use
 * DATABASE_URL_UNPOOLED instead (scripts/migrate.mts). The URL is read when the
 * pool is first created, so tests can point DATABASE_URL at the test database
 * before first use.
 */
export function getPool(): Pool {
  if (!g.__pgPool) {
    const env = getEnv();
    g.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL,
      max: env.DB_POOL_MAX,
    });
    g.__pgPool.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "pg pool error", err: err.message })));
  }
  return g.__pgPool;
}

export function db(): Db {
  g.__db ??= drizzle(getPool(), { schema });
  return g.__db;
}

/** Closes the pool (scripts and tests). */
export async function closeDb(): Promise<void> {
  const pool = g.__pgPool;
  g.__pgPool = undefined;
  g.__db = undefined;
  await pool?.end();
}

export { schema };
