// Creates the local DriveEasy database user and the dev/test databases, installs
// btree_gist in both, and checks the app user can connect. Safe to re-run.
// Connects as the "postgres" superuser; its password is read from pgpass
// (%APPDATA%\postgresql\pgpass.conf on Windows) or PG_ADMIN_URL.
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });

const adminUrl = process.env.PG_ADMIN_URL ?? "postgres://postgres@localhost:5432/postgres";
const targets = [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].map((u) => {
  if (!u) throw new Error("DATABASE_URL and TEST_DATABASE_URL must be set in .env.local");
  return new URL(u);
});
const user = decodeURIComponent(targets[0].username);
const password = decodeURIComponent(targets[0].password);
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
const role = await admin.query("select 1 from pg_roles where rolname = $1", [user]);
await admin.query(
  `${role.rowCount ? "alter" : "create"} role ${ident(user)} with login password ${literal(password)}`,
);
console.log(`✓ role ${user} ${role.rowCount ? "updated" : "created"}`);

for (const url of targets) {
  const name = url.pathname.slice(1);
  const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
  if (!exists.rowCount) await admin.query(`create database ${ident(name)} owner ${ident(user)}`);
  console.log(`✓ database ${name} ${exists.rowCount ? "exists" : "created"}`);

  const adminOnDb = new URL(adminUrl);
  adminOnDb.pathname = `/${name}`;
  const c = new Client({ connectionString: adminOnDb.toString() });
  await c.connect();
  await c.query("create extension if not exists btree_gist");
  await c.end();
  console.log(`✓ btree_gist installed in ${name}`);
}
await admin.end();

for (const url of targets) {
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  const { rows } = await c.query(
    "select current_user, current_database(), (select extversion from pg_extension where extname = 'btree_gist') as btree_gist",
  );
  await c.end();
  console.log(`✓ connected as ${rows[0].current_user} to ${rows[0].current_database} (btree_gist ${rows[0].btree_gist})`);
}
