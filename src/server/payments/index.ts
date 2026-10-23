import { getEnv } from "../env";
import { FakePaymentProvider } from "./fake";
import type { PaymentProvider } from "./types";

export type * from "./types";

// Kept on globalThis so the in-memory fake survives Next.js hot reloads.
const g = globalThis as { __paymentProvider?: PaymentProvider };

export function getPaymentProvider(): PaymentProvider {
  if (g.__paymentProvider) return g.__paymentProvider;
  const env = getEnv();
  switch (env.PAYMENT_PROVIDER) {
    case "fake":
      g.__paymentProvider = new FakePaymentProvider({
        webhookUrl: env.PAYMENT_WEBHOOK_URL,
        webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
        duplicateWebhooks: env.FAKE_PAYMENT_DUPLICATE_WEBHOOKS,
      });
      return g.__paymentProvider;
    case "stripe":
      throw new Error("Stripe provider not implemented yet: add src/server/payments/stripe.ts");
  }
}
