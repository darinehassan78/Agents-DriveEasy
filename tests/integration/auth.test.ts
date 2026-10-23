// Q2: registration, login, logout and role handling through the real Better
// Auth handler (same code path as /api/auth/[...all]).
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { one, q, tableExists } from "../support/db";

const ready = (await tableExists("users")) && existsSync("src/server/auth/config.ts");

describe.skipIf(!ready)("auth (Better Auth handler)", () => {
  let handler: (req: Request) => Promise<Response>;
  let base: string;

  beforeAll(async () => {
    const { getAuth } = await import("@/server/auth/config");
    const { getEnv } = await import("@/server/env");
    base = getEnv().BETTER_AUTH_URL;
    handler = (req) => getAuth().handler(req);
  });

  const post = (path: string, body: unknown, cookie?: string) =>
    handler(
      new Request(`${base}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const get = (path: string, cookie?: string) =>
    handler(new Request(`${base}/api/auth${path}`, { headers: { origin: base, ...(cookie ? { cookie } : {}) } }));
  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  const email = () => `qa-auth-${randomUUID().slice(0, 8)}@driveeasy.test`;

  it("registers a customer, stores a hashed password, and signs them in", async () => {
    const e = email();
    const res = await post("/sign-up/email", { email: e, password: "Passw0rd-QA", name: "QA" });
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(/session_token=/);
    const u = await one<{ role: string; id: string }>("select id, role from users where email=$1", [e]);
    expect(u.role).toBe("customer");
    const acc = await one<{ password: string }>("select password from accounts where user_id=$1", [u.id]);
    expect(acc.password).not.toContain("Passw0rd-QA");
  });

  it("rejects a duplicate email (case-insensitive) and a short password", async () => {
    const e = email();
    expect((await post("/sign-up/email", { email: e, password: "Passw0rd-QA", name: "QA" })).status).toBe(200);
    expect((await post("/sign-up/email", { email: e, password: "Passw0rd-QA", name: "QA" })).ok).toBe(false);
    expect((await post("/sign-up/email", { email: e.toUpperCase(), password: "Passw0rd-QA", name: "QA" })).ok).toBe(false);
    expect((await post("/sign-up/email", { email: email(), password: "short", name: "QA" })).ok).toBe(false);
    expect((await q("select 1 from users where lower(email)=lower($1)", [e])).length).toBe(1);
  });

  it("a client cannot register itself as admin", async () => {
    const e = email();
    const res = await post("/sign-up/email", { email: e, password: "Passw0rd-QA", name: "QA", role: "admin" });
    const rows = await q<{ role: string }>("select role from users where email=$1", [e]);
    // Either the request is rejected or the role is ignored. Never admin.
    if (res.ok) expect(rows[0].role).toBe("customer");
    else expect(rows).toHaveLength(0);
  });

  it("a client cannot promote itself via update-user", async () => {
    const e = email();
    const res = await post("/sign-up/email", { email: e, password: "Passw0rd-QA", name: "QA" });
    const cookie = cookieOf(res);
    await post("/update-user", { role: "admin", name: "Hacker" }, cookie);
    const u = await one<{ role: string }>("select role from users where email=$1", [e]);
    expect(u.role).toBe("customer");
  });

  it("logs in with the right password only; logout invalidates the session", async () => {
    const e = email();
    await post("/sign-up/email", { email: e, password: "Passw0rd-QA", name: "QA" });
    expect((await post("/sign-in/email", { email: e, password: "wrong-password" })).status).toBe(401);
    const ok = await post("/sign-in/email", { email: e, password: "Passw0rd-QA" });
    expect(ok.status).toBe(200);
    const cookie = cookieOf(ok);
    const s1 = await (await get("/get-session", cookie)).json();
    expect(s1?.user?.email).toBe(e);

    expect((await post("/sign-out", {}, cookie)).status).toBe(200);
    const s2 = await (await get("/get-session", cookie)).json();
    expect(s2).toBeNull();
  });

  it("seeded admin and customer can log in; admin has the admin role", async () => {
    const { SEED_PASSWORDS } = await import("@/server/db/seed");
    for (const k of ["admin", "customer"] as const) {
      const { email: e, password } = SEED_PASSWORDS[k];
      const res = await post("/sign-in/email", { email: e, password });
      expect(res.status, k).toBe(200);
    }
    const admin = await one<{ role: string }>("select role from users where email=$1", [SEED_PASSWORDS.admin.email]);
    expect(admin.role).toBe("admin");
  });
});
