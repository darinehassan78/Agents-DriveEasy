// Applies the SQL migrations in ./drizzle (schema + custom SQL such as the
// overlap exclusion constraint). Uses the *unpooled* connection when set
// (DATABASE_URL_UNPOOLED), because migrations should not run through a
// transaction-mode pooler.
//   pnpm db:migrate          -> DATABASE_URL_UNPOOLED ?? DATABASE_URL
//   pnpm db:migrate:test     -> TEST_DATABASE_URL
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
if (!url) {
  console.error(useTest ? "TEST_DATABASE_URL is not set" : "DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const started = Date.now();
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  const { rows } = await pool.query<{ db: string; n: string }>(
    "select current_database() as db, (select count(*) from drizzle.__drizzle_migrations)::text as n",
  );
  console.log(`✓ migrations applied to ${rows[0].db} (${rows[0].n} total) in ${Date.now() - started} ms`);
} finally {
  await pool.end();
}
