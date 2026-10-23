import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareTestDatabase } from "../db/testing";

// Route handlers for the cron job and payment webhooks.
let cron: typeof import("@/app/api/cron/release-expired-holds/route");
let webhook: typeof import("@/app/api/webhooks/payments/route");
let dbm: typeof import("../db");

beforeAll(async () => {
  await prepareTestDatabase();
  process.env.PAYMENT_PROVIDER = "fake";
  cron = await import("@/app/api/cron/release-expired-holds/route");
  webhook = await import("@/app/api/webhooks/payments/route");
  dbm = await import("../db");
}, 120_000);
afterAll(async () => {
  await dbm?.closeDb();
});

const url = "http://localhost:3300/api/cron/release-expired-holds";

describe("cron route", () => {
  it("requires the CRON_SECRET bearer token", async () => {
    expect((await cron.GET(new Request(url))).status).toBe(401);
    expect((await cron.GET(new Request(url, { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await cron.POST(new Request(url, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}x` } }))).status).toBe(401);
  });
  it("runs the job when authorised (idempotent)", async () => {
    const req = () => new Request(url, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const a = await cron.GET(req());
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ ok: true });
    const b = await cron.GET(req());
    expect(b.status).toBe(200);
  });
});

describe("payments webhook route", () => {
  it("rejects unsigned or badly signed requests with 400", async () => {
    const r1 = await webhook.POST(new Request("http://x/api/webhooks/payments", { method: "POST", body: "{}" }));
    expect(r1.status).toBe(400);
    const r2 = await webhook.POST(
      new Request("http://x/api/webhooks/payments", { method: "POST", body: "{}", headers: { "x-fake-signature": "sha256=00" } }),
    );
    expect(r2.status).toBe(400);
  });
  it("accepts a correctly signed event and acknowledges duplicates", async () => {
    const { signFakeWebhook } = await import("../payments/fake");
    const body = JSON.stringify({
      id: `fevt_test_${Date.now()}`,
      type: "payment.succeeded",
      createdAt: new Date().toISOString(),
      data: { id: "fpay_unknown", amount: 1, currency: "aed", status: "succeeded", refundedAmount: 0, metadata: {} },
    });
    const send = () =>
      webhook.POST(
        new Request("http://x/api/webhooks/payments", {
          method: "POST",
          body,
          headers: { "x-fake-signature": signFakeWebhook(body, process.env.PAYMENT_WEBHOOK_SECRET!) },
        }),
      );
    const first = await send();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "ignored" });
    const second = await send();
    expect(await second.json()).toMatchObject({ status: "duplicate" });
  });
});
