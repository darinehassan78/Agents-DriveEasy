import { describe, expect, it } from "vitest";
import { FakePaymentProvider } from "./fake";

function setup(duplicateWebhooks = false) {
  const sent: { body: string; signature: string }[] = [];
  const provider = new FakePaymentProvider({
    webhookUrl: "http://localhost/webhook",
    webhookSecret: "test-secret-0123456789",
    duplicateWebhooks,
    send: async (_url, body, signature) => {
      sent.push({ body, signature });
    },
  });
  const events = () => sent.map((s) => provider.verifyWebhook(s.body, s.signature));
  return { provider, sent, events };
}

describe("FakePaymentProvider", () => {
  it("succeeds, and is idempotent", async () => {
    const { provider, events } = setup();
    const a = await provider.createPayment({ amount: 5000, currency: "gbp", idempotencyKey: "k1" });
    const b = await provider.createPayment({ amount: 5000, currency: "gbp", idempotencyKey: "k1" });
    expect(a.status).toBe("succeeded");
    expect(b.id).toBe(a.id);
    expect(events().map((e) => e.type)).toEqual(["payment.succeeded"]);
  });

  it("fails on request", async () => {
    const { provider, events } = setup();
    const p = await provider.createPayment({
      amount: 5000,
      currency: "gbp",
      idempotencyKey: "k2",
      metadata: { fake_outcome: "fail" },
    });
    expect(p.status).toBe("failed");
    expect(events()[0].type).toBe("payment.failed");
  });

  it("cancels and refunds", async () => {
    const { provider } = setup();
    const p1 = await provider.createPayment({ amount: 1000, currency: "gbp", idempotencyKey: "c" });
    expect((await provider.cancelPayment(p1.id)).status).toBe("canceled");

    const p2 = await provider.createPayment({ amount: 1000, currency: "gbp", idempotencyKey: "r" });
    expect((await provider.refundPayment(p2.id, 400)).status).toBe("partially_refunded");
    expect((await provider.refundPayment(p2.id)).status).toBe("refunded");
    await expect(provider.refundPayment(p2.id, 1)).rejects.toThrow();
  });

  it("holds, releases and captures deposits", async () => {
    const { provider, events } = setup();
    const h1 = await provider.holdDeposit({ amount: 20000, currency: "gbp", idempotencyKey: "d1" });
    expect(h1.status).toBe("held");
    expect((await provider.releaseDeposit(h1.id)).status).toBe("released");
    await expect(provider.captureDeposit(h1.id)).rejects.toThrow();

    const h2 = await provider.holdDeposit({ amount: 20000, currency: "gbp", idempotencyKey: "d2" });
    expect((await provider.captureDeposit(h2.id, 5000)).capturedAmount).toBe(5000);
    expect(events().map((e) => e.type)).toEqual([
      "deposit.held",
      "deposit.released",
      "deposit.held",
      "deposit.captured",
    ]);
  });

  it("sends duplicate webhooks with the same event id", async () => {
    const { provider, events } = setup(true);
    await provider.createPayment({ amount: 100, currency: "gbp", idempotencyKey: "dup" });
    const [first, second] = events();
    expect(events()).toHaveLength(2);
    expect(second.id).toBe(first.id);

    await provider.resendWebhook(first.id);
    expect(events()).toHaveLength(3);
  });

  it("rejects webhooks with a bad signature", () => {
    const { provider } = setup();
    expect(() => provider.verifyWebhook("{}", "sha256=bad")).toThrow("Invalid webhook signature");
    expect(() => provider.verifyWebhook("{}", null)).toThrow();
  });
});
