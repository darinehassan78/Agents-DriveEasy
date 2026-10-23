// Q10: migrations on a clean database.
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER, migrationJournal, q, resetTestDatabase, testPool } from "../support/db";

const hasMigrations = migrationJournal().length > 0;

const TABLES = [
  "users", "sessions", "accounts", "verifications", "driver_profiles", "branches", "vehicle_categories",
  "vehicles", "vehicle_features", "vehicle_feature_map", "pricing_rules", "extras", "reservations",
  "reservation_extras", "payments", "deposits", "rental_agreements", "damage_reports",
  "maintenance_blocks", "vehicle_blocks", "audit_logs",
];

describe.skipIf(!hasMigrations)("migrations on a clean database", () => {
  it("apply from scratch, record every journal entry; a second run is a no-op", async () => {
    const r = await resetTestDatabase({ requireMigrations: true });
    expect(r.migrationsApplied).toBeGreaterThan(0);
    const applied = await q<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(applied[0].n).toBe(migrationJournal().length);

    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(drizzle(testPool()), { migrationsFolder: MIGRATIONS_FOLDER });
    const again = await q<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(again[0].n).toBe(applied[0].n);
  });

  it("creates every required table", async () => {
    const rows = await q<{ t: string }>(
      "select table_name as t from information_schema.tables where table_schema='public'",
    );
    const names = rows.map((r) => r.t);
    for (const t of TABLES) expect(names, `missing table ${t}`).toContain(t);
  });

  it("has the overlap exclusion constraint using gist", async () => {
    const rows = await q<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where contype='x' and conrelid='public.vehicle_blocks'::regclass`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].def).toMatch(/EXCLUDE USING gist \(vehicle_id WITH =, period WITH &&\)/);
  });

  it("enforces unique plate, VIN and branch code", async () => {
    const uniq = await q<{ def: string; tbl: string }>(
      `select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def from pg_constraint
        where contype='u' and conrelid in ('public.vehicles'::regclass, 'public.branches'::regclass)`,
    );
    const defs = uniq.map((u) => `${u.tbl} ${u.def}`).join("\n");
    expect(defs).toMatch(/vehicles UNIQUE \(plate\)/);
    expect(defs).toMatch(/vehicles UNIQUE \(vin\)/);
    expect(defs).toMatch(/branches UNIQUE \(code\)/);
  });

  it("stores money as integers", async () => {
    const rows = await q<{ c: string; t: string }>(
      `select table_name||'.'||column_name as c, data_type as t from information_schema.columns
        where table_schema='public' and column_name like '%fils%'`,
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(["integer", "bigint"], r.c).toContain(r.t);
  });

  it("uses timestamptz for timestamps", async () => {
    const rows = await q<{ c: string }>(
      `select table_name||'.'||column_name as c from information_schema.columns
        where table_schema='public' and data_type='timestamp without time zone'`,
    );
    expect(rows.map((r) => r.c)).toEqual([]);
  });
});
