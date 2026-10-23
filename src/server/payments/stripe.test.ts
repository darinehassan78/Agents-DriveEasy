import { describe, expect, it } from "vitest";
import { signStripeWebhook, StripePaymentProvider } from "./stripe";

// Unit tests with a mocked fetch. Live Stripe test-mode verification is BLOCKED
// (no cloud accounts in this environment).
const secret = "whsec_test_secret";

function provider(responses: unknown[] = []) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responses.shift() ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { p: new StripePaymentProvider({ secretKey: "sk_test_123", webhookSecret: secret, fetch: fetchMock, nowSeconds: () => 1_900_000_000 }), calls };
}

describe("StripePaymentProvider", () => {
  it("creates a PaymentIntent with an idempotency key and maps requires_payment_method to requires_action", async () => {
    const { p, calls } = provider([
      { id: "pi_1", object: "payment_intent", amount: 5000, currency: "aed", status: "requires_payment_method", client_secret: "pi_1_secret", metadata: { reservationId: "r" } },
    ]);
    const pay = await p.createPayment({ amount: 5000, currency: "AED", idempotencyKey: "k1", metadata: { reservationId: "r" } });
    expect(pay).toMatchObject({ id: "pi_1", status: "requires_action", clientSecret: "pi_1_secret" });
    expect(calls[0].url).toBe("https://api.stripe.com/v1/payment_intents");
    expect((calls[0].init.headers as Record<string, string>)["idempotency-key"]).toBe("k1");
    expect(String(calls[0].init.body)).toContain("currency=aed");
    expect(String(calls[0].init.body)).toContain("metadata%5Bkind%5D=payment");
  });

  it("holds deposits with manual capture and maps requires_capture to held", async () => {
    const { p, calls } = provider([{ id: "pi_2", object: "payment_intent", amount: 100000, currency: "aed", status: "requires_capture", metadata: {} }]);
    const hold = await p.holdDeposit({ amount: 100000, currency: "aed", idempotencyKey: "d1" });
    expect(hold.status).toBe("held");
    expect(String(calls[0].init.body)).toContain("capture_method=manual");
  });

  it("verifies webhook signatures (and rejects tampering or stale timestamps)", () => {
    const { p } = provider();
    const body = JSON.stringify({
      id: "evt_1",
      type: "payment_intent.succeeded",
      created: 1_900_000_000,
      data: { object: { id: "pi_1", object: "payment_intent", amount: 5000, currency: "aed", status: "succeeded", metadata: { kind: "payment", paymentId: "x" } } },
    });
    const sig = signStripeWebhook(body, secret, 1_900_000_000);
    expect(p.verifyWebhook(body, sig)).toMatchObject({ id: "evt_1", type: "payment.succeeded", data: { status: "succeeded" } });
    expect(() => p.verifyWebhook(body + " ", sig)).toThrow();
    expect(() => p.verifyWebhook(body, signStripeWebhook(body, "whsec_other", 1_900_000_000))).toThrow();
    expect(() => p.verifyWebhook(body, signStripeWebhook(body, secret, 1_900_000_000 - 3600))).toThrow();
    expect(() => p.verifyWebhook(body, null)).toThrow();
  });

  it("maps deposit webhook events", () => {
    const { p } = provider();
    const body = JSON.stringify({
      id: "evt_2",
      type: "payment_intent.amount_capturable_updated",
      created: 1_900_000_000,
      data: { object: { id: "pi_2", object: "payment_intent", amount: 100000, currency: "aed", status: "requires_capture", capture_method: "manual", metadata: { kind: "deposit" } } },
    });
    expect(p.verifyWebhook(body, signStripeWebhook(body, secret, 1_900_000_000))).toMatchObject({ type: "deposit.held", data: { status: "held" } });
  });

  it("refuses non-secret keys", () => {
    expect(() => new StripePaymentProvider({ secretKey: "pk_test_x", webhookSecret: secret })).toThrow();
  });
});
