// Contract every payment provider (fake now, a real one later) must satisfy.
// Amounts are integer minor units (e.g. cents).

export type PaymentStatus = "succeeded" | "failed" | "canceled" | "refunded" | "partially_refunded";
export type DepositStatus = "held" | "released" | "captured";

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  refundedAmount: number;
  failureReason?: string;
  metadata: Record<string, string>;
}

export interface DepositHold {
  id: string;
  amount: number;
  currency: string;
  status: DepositStatus;
  capturedAmount: number;
  metadata: Record<string, string>;
}

export type PaymentEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "deposit.held"
  | "deposit.released"
  | "deposit.captured";

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

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  cancelPayment(paymentId: string): Promise<Payment>;
  refundPayment(paymentId: string, amount?: number): Promise<Payment>;
  holdDeposit(input: HoldDepositInput): Promise<DepositHold>;
  releaseDeposit(holdId: string): Promise<DepositHold>;
  captureDeposit(holdId: string, amount?: number): Promise<DepositHold>;
  /** Verifies a webhook request and returns the parsed event, or throws. */
  verifyWebhook(rawBody: string, signature: string | null): PaymentEvent;
}
