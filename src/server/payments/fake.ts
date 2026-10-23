import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CreatePaymentInput,
  DepositHold,
  HoldDepositInput,
  OperationOptions,
  Payment,
  PaymentEvent,
  PaymentEventType,
  PaymentProvider,
} from "./types";

// Local test payment provider. State lives in memory, so it resets when the
// server restarts. Choose an outcome per request with metadata.fake_outcome:
//   "succeed" (default) | "fail" | "requires_action"
// requires_action payments/holds stay pending until completeAction() (a test
// helper standing in for the customer finishing 3-D Secure in the browser).
// Every state change is POSTed to the webhook URL, signed with HMAC-SHA256.

export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

export type WebhookSender = (url: string, body: string, signature: string) => Promise<void>;

export interface FakePaymentOptions {
  webhookUrl: string;
  webhookSecret: string;
  /** Deliver every webhook twice, like real providers sometimes do. */
  duplicateWebhooks?: boolean;
  send?: WebhookSender;
}

const defaultSend: WebhookSender = async (url, body, signature) => {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signature },
      body,
    });
  } catch (err) {
    console.warn(`[fake-payments] webhook delivery to ${url} failed:`, (err as Error).message);
  }
};

export function signFakeWebhook(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly signatureHeader = FAKE_SIGNATURE_HEADER;
  private payments = new Map<string, Payment>();
  private holds = new Map<string, DepositHold>();
  private byIdempotencyKey = new Map<string, string>();
  private refundKeys = new Map<string, Payment>();
  private depositOpKeys = new Map<string, DepositHold>();
  private events = new Map<string, PaymentEvent>();
  private send: WebhookSender;

  constructor(private opts: FakePaymentOptions) {
    this.send = opts.send ?? defaultSend;
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing && this.payments.has(existing)) return { ...this.payments.get(existing)! };

    const metadata = input.metadata ?? {};
    const fail = metadata.fake_outcome === "fail";
    const action = metadata.fake_outcome === "requires_action";
    const id = `fpay_${randomUUID()}`;
    const payment: Payment = {
      id,
      amount: input.amount,
      currency: input.currency,
      status: fail ? "failed" : action ? "requires_action" : "succeeded",
      refundedAmount: 0,
      failureReason: fail ? "card_declined" : undefined,
      clientSecret: action ? `${id}_secret` : undefined,
      metadata,
    };
    this.payments.set(payment.id, payment);
    this.byIdempotencyKey.set(input.idempotencyKey, payment.id);
    await this.emit(fail ? "payment.failed" : action ? "payment.requires_action" : "payment.succeeded", payment);
    return { ...payment };
  }

  async getPayment(paymentId: string): Promise<Payment> {
    return { ...this.getPaymentRecord(paymentId) };
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    const payment = this.getPaymentRecord(paymentId);
    if (payment.status !== "succeeded" && payment.status !== "requires_action") {
      throw new Error(`Cannot cancel a ${payment.status} payment`);
    }
    payment.status = "canceled";
    await this.emit("payment.canceled", payment);
    return { ...payment };
  }

  async refundPayment(paymentId: string, amount?: number, opts?: OperationOptions): Promise<Payment> {
    const key = opts?.idempotencyKey;
    if (key && this.refundKeys.has(key)) return { ...this.refundKeys.get(key)! };
    const payment = this.getPaymentRecord(paymentId);
    if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
      throw new Error(`Cannot refund a ${payment.status} payment`);
    }
    const refundable = payment.amount - payment.refundedAmount;
    const value = amount ?? refundable;
    if (value <= 0 || value > refundable) throw new Error(`Refund must be between 1 and ${refundable}`);
    payment.refundedAmount += value;
    payment.status = payment.refundedAmount === payment.amount ? "refunded" : "partially_refunded";
    if (key) this.refundKeys.set(key, { ...payment });
    await this.emit("payment.refunded", payment);
    return { ...payment };
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    const existing = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existing && this.holds.has(existing)) return { ...this.holds.get(existing)! };

    const metadata = input.metadata ?? {};
    if (metadata.fake_outcome === "fail") throw new Error("Deposit hold declined: card_declined");
    const action = metadata.fake_outcome === "requires_action";
    const id = `fhold_${randomUUID()}`;
    const hold: DepositHold = {
      id,
      amount: input.amount,
      currency: input.currency,
      status: action ? "requires_action" : "held",
      capturedAmount: 0,
      clientSecret: action ? `${id}_secret` : undefined,
      metadata,
    };
    this.holds.set(hold.id, hold);
    this.byIdempotencyKey.set(input.idempotencyKey, hold.id);
    if (!action) await this.emit("deposit.held", hold);
    return { ...hold };
  }

  async getDeposit(holdId: string): Promise<DepositHold> {
    return { ...this.getHold(holdId) };
  }

  async releaseDeposit(holdId: string, opts?: OperationOptions): Promise<DepositHold> {
    const key = opts?.idempotencyKey;
    if (key && this.depositOpKeys.has(key)) return { ...this.depositOpKeys.get(key)! };
    const hold = this.getHold(holdId);
    if (hold.status !== "held" && hold.status !== "requires_action") {
      throw new Error(`Cannot release a ${hold.status} deposit`);
    }
    hold.status = "released";
    if (key) this.depositOpKeys.set(key, { ...hold });
    await this.emit("deposit.released", hold);
    return { ...hold };
  }

  async captureDeposit(holdId: string, amount?: number, opts?: OperationOptions): Promise<DepositHold> {
    const key = opts?.idempotencyKey;
    if (key && this.depositOpKeys.has(key)) return { ...this.depositOpKeys.get(key)! };
    const hold = this.getHold(holdId);
    if (hold.status !== "held") throw new Error(`Cannot capture a ${hold.status} deposit`);
    const value = amount ?? hold.amount;
    if (value <= 0 || value > hold.amount) throw new Error(`Capture must be between 1 and ${hold.amount}`);
    hold.status = "captured";
    hold.capturedAmount = value;
    if (key) this.depositOpKeys.set(key, { ...hold });
    await this.emit("deposit.captured", hold);
    return { ...hold };
  }

  /** Test helper: the customer completes (or fails) a pending requires_action step. */
  async completeAction(id: string, outcome: "succeed" | "fail" = "succeed"): Promise<Payment | DepositHold> {
    const payment = this.payments.get(id);
    if (payment) {
      if (payment.status !== "requires_action") throw new Error(`Payment ${id} is ${payment.status}`);
      payment.status = outcome === "succeed" ? "succeeded" : "failed";
      if (outcome === "fail") payment.failureReason = "authentication_failed";
      await this.emit(outcome === "succeed" ? "payment.succeeded" : "payment.failed", payment);
      return { ...payment };
    }
    const hold = this.getHold(id);
    if (hold.status !== "requires_action") throw new Error(`Deposit ${id} is ${hold.status}`);
    hold.status = outcome === "succeed" ? "held" : "failed";
    if (outcome === "fail") hold.failureReason = "authentication_failed";
    await this.emit(outcome === "succeed" ? "deposit.held" : "deposit.failed", hold);
    return { ...hold };
  }

  verifyWebhook(rawBody: string, signature: string | null): PaymentEvent {
    const expected = Buffer.from(signFakeWebhook(rawBody, this.opts.webhookSecret));
    const given = Buffer.from(signature ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new Error("Invalid webhook signature");
    }
    return JSON.parse(rawBody) as PaymentEvent;
  }

  /** Test helper: deliver an already-sent event again. */
  async resendWebhook(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) throw new Error(`Unknown event ${eventId}`);
    await this.deliver(event);
  }

  listEvents(): PaymentEvent[] {
    return [...this.events.values()];
  }

  private async emit(type: PaymentEventType, data: Payment | DepositHold) {
    const event: PaymentEvent = {
      id: `fevt_${randomUUID()}`,
      type,
      createdAt: new Date().toISOString(),
      data: { ...data },
    };
    this.events.set(event.id, event);
    await this.deliver(event);
    if (this.opts.duplicateWebhooks) await this.deliver(event);
  }

  private async deliver(event: PaymentEvent) {
    const body = JSON.stringify(event);
    await this.send(this.opts.webhookUrl, body, signFakeWebhook(body, this.opts.webhookSecret));
  }

  private getPaymentRecord(id: string): Payment {
    const payment = this.payments.get(id);
    if (!payment) throw new Error(`Unknown payment ${id}`);
    return payment;
  }

  private getHold(id: string): DepositHold {
    const hold = this.holds.get(id);
    if (!hold) throw new Error(`Unknown deposit hold ${id}`);
    return hold;
  }
}
