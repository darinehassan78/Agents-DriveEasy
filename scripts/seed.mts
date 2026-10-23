// pnpm db:seed — wipes and reseeds DATABASE_URL (driveeasy_dev) with demo data.
// Pass --test to seed TEST_DATABASE_URL instead.
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

const useTest = process.argv.includes("--test");
const url = useTest ? process.env.TEST_DATABASE_URL : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
if (!url) {
  console.error("Database URL is not set (see .env.example)");
  process.exit(1);
}

const { seed, SEED_PASSWORDS } = await import("../src/server/db/seed");
const pool = new Pool({ connectionString: url, max: 2 });
try {
  await seed(pool, { log: (m) => console.log(`✓ ${m}`) });
  for (const [role, { email, password }] of Object.entries(SEED_PASSWORDS)) {
    console.log(`  ${role.padEnd(9)} ${email} / ${password}`);
  }
} finally {
  await pool.end();
}
