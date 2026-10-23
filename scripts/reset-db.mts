// pnpm db:reset — drops and recreates the public schema of driveeasy_dev,
// re-applies all migrations and reseeds. Pass --test for TEST_DATABASE_URL.
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
if (!url) {
  console.error("Database URL is not set (see .env.example)");
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host) && !process.argv.includes("--force")) {
  console.error(`Refusing to reset non-local database host ${host} (pass --force to override)`);
  process.exit(1);
}

const { seed } = await import("../src/server/db/seed");
const pool = new Pool({ connectionString: url, max: 2 });
try {
  await pool.query("drop schema if exists drizzle cascade");
  await pool.query("drop schema if exists public cascade");
  await pool.query("create schema public");
  console.log("✓ schema dropped and recreated");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("✓ migrations applied");
  if (!process.argv.includes("--no-seed")) await seed(pool, { log: (m) => console.log(`✓ ${m}`) });
} finally {
  await pool.end();
}
