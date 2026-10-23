// Contract every payment provider (fake now, Stripe test mode later) must satisfy.
// Amounts are integer minor units (fils for AED).

export type PaymentStatus =
  | "requires_action" // the customer must complete a step (3-D Secure, card entry); see clientSecret
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "refunded"
  | "partially_refunded";
export type DepositStatus = "requires_action" | "held" | "released" | "captured" | "failed";

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  refundedAmount: number;
  failureReason?: string;
  /** For requires_action: secret the browser uses to finish the payment (Stripe client_secret). */
  clientSecret?: string;
  metadata: Record<string, string>;
}

export interface DepositHold {
  id: string;
  amount: number;
  currency: string;
  status: DepositStatus;
  capturedAmount: number;
  clientSecret?: string;
  failureReason?: string;
  metadata: Record<string, string>;
}

export type PaymentEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "payment.requires_action"
  | "deposit.held"
  | "deposit.released"
  | "deposit.captured"
  | "deposit.failed";

export interface PaymentEvent {
  id: string; // unique per event; duplicates reuse the same id so handlers can dedupe
  type: PaymentEventType;
  createdAt: string;
  data: Payment | DepositHold;
}

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface HoldDepositInput {
  amount: number;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface OperationOptions {
  /** Retries with the same key must not repeat the operation. */
  idempotencyKey?: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** HTTP header that carries the webhook signature. */
  readonly signatureHeader: string;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  /** Current state from the provider (used to verify results). */
  getPayment(paymentId: string): Promise<Payment>;
  cancelPayment(paymentId: string): Promise<Payment>;
  refundPayment(paymentId: string, amount?: number, opts?: OperationOptions): Promise<Payment>;
  /** Authorises (holds) a security deposit on the card without charging it. */
  holdDeposit(input: HoldDepositInput): Promise<DepositHold>;
  getDeposit(holdId: string): Promise<DepositHold>;
  releaseDeposit(holdId: string, opts?: OperationOptions): Promise<DepositHold>;
  captureDeposit(holdId: string, amount?: number, opts?: OperationOptions): Promise<DepositHold>;
  /** Verifies a webhook request and returns the parsed event, or throws. */
  verifyWebhook(rawBody: string, signature: string | null): PaymentEvent;
}
