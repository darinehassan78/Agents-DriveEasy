import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../env";
import * as schema from "./schema";

const g = globalThis as { __pgPool?: Pool };

export function getPool(): Pool {
  g.__pgPool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
  return g.__pgPool;
}

export const db = () => drizzle(getPool(), { schema });
