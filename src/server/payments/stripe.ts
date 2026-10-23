import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreatePaymentInput,
  DepositHold,
  DepositStatus,
  HoldDepositInput,
  OperationOptions,
  Payment,
  PaymentEvent,
  PaymentEventType,
  PaymentProvider,
  PaymentStatus,
} from "./types";

// Stripe adapter (test mode) using the REST API directly (no SDK dependency).
// Selected with PAYMENT_PROVIDER=stripe plus STRIPE_SECRET_KEY (sk_test_...) and
// STRIPE_WEBHOOK_SECRET (whsec_...). Rental charges are PaymentIntents with
// automatic capture; deposits are PaymentIntents with capture_method=manual
// (an authorisation hold), released by cancelling and captured with
// /capture. The browser completes card entry / 3-D Secure with the returned
// clientSecret (Stripe.js), after which Stripe's webhook confirms the booking.
//
// STATUS: coded against the documented API, unit-tested with a mocked fetch;
// live verification against a Stripe test account is BLOCKED (no cloud
// accounts in this environment).

export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
const API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;

type StripeIntent = {
  id: string;
  object: "payment_intent";
  amount: number;
  amount_received?: number;
  amount_capturable?: number;
  currency: string;
  status:
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "requires_capture"
    | "canceled"
    | "succeeded";
  capture_method?: "automatic" | "automatic_async" | "manual";
  client_secret?: string;
  metadata: Record<string, string>;
  last_payment_error?: { code?: string; message?: string } | null;
  latest_charge?: string | { id: string; amount_refunded: number; amount_captured?: number } | null;
};

type StripeCharge = { id: string; object: "charge"; payment_intent: string; amount_refunded: number };

export interface StripeOptions {
  secretKey: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  /** For tests: current time in seconds. */
  nowSeconds?: () => number;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly signatureHeader = STRIPE_SIGNATURE_HEADER;
  private fetchImpl: typeof fetch;

  constructor(private opts: StripeOptions) {
    if (!opts.secretKey.startsWith("sk_")) throw new Error("STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_...)");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    const pi = await this.call<StripeIntent>("POST", "/payment_intents", {
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
      ...metadataParams({ ...input.metadata, kind: "payment" }),
    }, input.idempotencyKey);
    return this.toPayment(pi);
  }

  async getPayment(paymentId: string): Promise<Payment> {
    return this.toPayment(await this.call<StripeIntent>("GET", `/payment_intents/${paymentId}?expand[]=latest_charge`));
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    return this.toPayment(await this.call<StripeIntent>("POST", `/payment_intents/${paymentId}/cancel`, {}));
  }

  async refundPayment(paymentId: string, amount?: number, opts?: OperationOptions): Promise<Payment> {
    await this.call("POST", "/refunds", { payment_intent: paymentId, ...(amount ? { amount } : {}) }, opts?.idempotencyKey);
    return this.getPayment(paymentId);
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    const pi = await this.call<StripeIntent>("POST", "/payment_intents", {
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      capture_method: "manual",
      "automatic_payment_methods[enabled]": "true",
      ...metadataParams({ ...input.metadata, kind: "deposit" }),
    }, input.idempotencyKey);
    return this.toHold(pi);
  }

  async getDeposit(holdId: string): Promise<DepositHold> {
    return this.toHold(await this.call<StripeIntent>("GET", `/payment_intents/${holdId}?expand[]=latest_charge`));
  }

  async releaseDeposit(holdId: string, opts?: OperationOptions): Promise<DepositHold> {
    return this.toHold(await this.call<StripeIntent>("POST", `/payment_intents/${holdId}/cancel`, {}, opts?.idempotencyKey));
  }

  async captureDeposit(holdId: string, amount?: number, opts?: OperationOptions): Promise<DepositHold> {
    const pi = await this.call<StripeIntent>(
      "POST",
      `/payment_intents/${holdId}/capture`,
      amount ? { amount_to_capture: amount } : {},
      opts?.idempotencyKey,
    );
    return this.toHold(pi);
  }

  verifyWebhook(rawBody: string, signature: string | null): PaymentEvent {
    if (!signature) throw new Error("Invalid webhook signature");
    const parts = Object.fromEntries(
      signature.split(",").map((kv) => {
        const i = kv.indexOf("=");
        return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
      }),
    );
    const t = Number(parts.t);
    const v1 = signature
      .split(",")
      .filter((kv) => kv.trim().startsWith("v1="))
      .map((kv) => kv.trim().slice(3));
    if (!Number.isFinite(t) || v1.length === 0) throw new Error("Invalid webhook signature");
    const now = this.opts.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - t) > TOLERANCE_SECONDS) throw new Error("Invalid webhook signature (timestamp outside tolerance)");
    const expected = Buffer.from(createHmac("sha256", this.opts.webhookSecret).update(`${t}.${rawBody}`).digest("hex"));
    const ok = v1.some((sig) => {
      const given = Buffer.from(sig);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (!ok) throw new Error("Invalid webhook signature");

    const event = JSON.parse(rawBody) as { id: string; type: string; created: number; data: { object: StripeIntent | StripeCharge } };
    const obj = event.data.object;
    const created = new Date(event.created * 1000).toISOString();
    if (obj.object === "charge") {
      // charge.refunded: report the payment's new refunded amount.
      return {
        id: event.id,
        type: "payment.refunded",
        createdAt: created,
        data: {
          id: obj.payment_intent,
          amount: 0,
          currency: "aed",
          status: "partially_refunded",
          refundedAmount: obj.amount_refunded,
          metadata: {},
        },
      };
    }
    const isDeposit = obj.metadata?.kind === "deposit" || obj.capture_method === "manual";
    const data = isDeposit ? this.toHold(obj) : this.toPayment(obj);
    const type = mapEventType(event.type, isDeposit, data.status);
    if (!type) throw new UnhandledStripeEvent(event.type);
    return { id: event.id, type, createdAt: created, data };
  }

  private toPayment(pi: StripeIntent): Payment {
    const refunded = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge.amount_refunded : 0;
    let status: PaymentStatus;
    switch (pi.status) {
      case "succeeded":
        status = refunded === 0 ? "succeeded" : refunded >= pi.amount ? "refunded" : "partially_refunded";
        break;
      case "processing":
        status = "processing";
        break;
      case "canceled":
        status = "canceled";
        break;
      case "requires_payment_method":
        status = pi.last_payment_error ? "failed" : "requires_action";
        break;
      default:
        status = "requires_action";
    }
    return {
      id: pi.id,
      amount: pi.amount,
      currency: pi.currency,
      status,
      refundedAmount: refunded,
      failureReason: pi.last_payment_error?.code ?? pi.last_payment_error?.message,
      clientSecret: status === "requires_action" ? pi.client_secret : undefined,
      metadata: pi.metadata ?? {},
    };
  }

  private toHold(pi: StripeIntent): DepositHold {
    let status: DepositStatus;
    switch (pi.status) {
      case "requires_capture":
        status = "held";
        break;
      case "succeeded":
        status = "captured";
        break;
      case "canceled":
        status = "released";
        break;
      case "requires_payment_method":
        status = pi.last_payment_error ? "failed" : "requires_action";
        break;
      default:
        status = "requires_action";
    }
    return {
      id: pi.id,
      amount: pi.amount,
      currency: pi.currency,
      status,
      capturedAmount: pi.status === "succeeded" ? (pi.amount_received ?? pi.amount) : 0,
      clientSecret: status === "requires_action" ? pi.client_secret : undefined,
      failureReason: pi.last_payment_error?.code,
      metadata: pi.metadata ?? {},
    };
  }

  private async call<T = unknown>(
    method: "GET" | "POST",
    path: string,
    params?: Record<string, string | number>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.opts.secretKey}`,
      "stripe-version": "2024-06-20",
    };
    let body: string | undefined;
    if (method === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])).toString();
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    }
    const res = await this.fetchImpl(`${API}${path}`, { method, headers, body });
    const json = (await res.json()) as T & { error?: { message?: string; code?: string } };
    if (!res.ok) throw new Error(`Stripe ${method} ${path} failed: ${json.error?.message ?? res.status}`);
    return json;
  }
}

export class UnhandledStripeEvent extends Error {
  constructor(readonly stripeType: string) {
    super(`Unhandled Stripe event type ${stripeType}`);
    this.name = "UnhandledStripeEvent";
  }
}

function metadataParams(meta: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v]));
}

function mapEventType(stripeType: string, isDeposit: boolean, status: string): PaymentEventType | null {
  if (isDeposit) {
    if (stripeType === "payment_intent.amount_capturable_updated" || status === "held") return "deposit.held";
    if (stripeType === "payment_intent.canceled") return "deposit.released";
    if (stripeType === "payment_intent.succeeded") return "deposit.captured";
    if (stripeType === "payment_intent.payment_failed") return "deposit.failed";
    return null;
  }
  switch (stripeType) {
    case "payment_intent.succeeded":
      return "payment.succeeded";
    case "payment_intent.payment_failed":
      return "payment.failed";
    case "payment_intent.canceled":
      return "payment.canceled";
    case "payment_intent.requires_action":
      return "payment.requires_action";
    default:
      return null;
  }
}

/** Builds a valid Stripe-Signature header (for tests). */
export function signStripeWebhook(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}
