// pnpm test:db:reset  - rebuild driveeasy_test from migrations and seed it.
//   --no-seed           migrate only
//   --require-migrations  fail when ./drizzle has no migrations
import "./env";
import { closeTestPool, resetTestDatabase } from "./db";

const args = process.argv.slice(2);
try {
  const r = await resetTestDatabase({
    seed: !args.includes("--no-seed"),
    requireMigrations: args.includes("--require-migrations"),
    log: (m) => console.log(`[test-db] ${m}`),
  });
  console.log(`[test-db] done: ${r.migrationsApplied} migrations, seeded=${r.seeded}`);
} finally {
  await closeTestPool();
}
