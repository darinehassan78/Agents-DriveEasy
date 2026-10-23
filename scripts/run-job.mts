import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const name = process.argv[2];
const { jobs } = await import("../src/server/jobs");
const { getPool } = await import("../src/server/db");

if (!name || !jobs[name]) {
  console.error(`Usage: pnpm job <name>\nJobs: ${Object.keys(jobs).join(", ")}`);
  process.exit(1);
}

try {
  const result = await jobs[name]();
  console.log(`[${name}] ${result.message}`);
} finally {
  await getPool().end();
}
