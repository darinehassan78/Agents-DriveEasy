import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "../support/env";
import { migrationJournal, one, resetTestDatabase } from "../support/db";

describe("test harness", () => {
  it("refuses non-test databases", () => {
    expect(() => assertTestDatabase("postgres://u:p@localhost:5432/driveeasy_dev")).toThrow(/Refusing/);
    expect(() => assertTestDatabase("postgres://u:p@localhost:5432/driveeasy_test")).not.toThrow();
  });

  it("points the app at driveeasy_test", async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toBe("/driveeasy_test");
    const { getPool } = await import("@/server/db");
    const row = (await getPool().query("select current_database() as db")).rows[0];
    expect(row.db).toBe("driveeasy_test");
  });

  it("resets to a clean schema with btree_gist", async () => {
    await resetTestDatabase({ seed: false });
    const ext = await one<{ v: string }>("select extversion as v from pg_extension where extname='btree_gist'");
    expect(ext.v).toBeTruthy();
    const r = await one<{ n: string }>(
      "select count(*)::text as n from drizzle.__drizzle_migrations",
    ).catch(() => ({ n: "0" }));
    expect(Number(r.n)).toBe(migrationJournal().length);
  });
});
