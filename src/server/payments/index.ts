import { getEnv } from "../env";
import { FakePaymentProvider } from "./fake";
import { StripePaymentProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export type * from "./types";

// Kept on globalThis so the in-memory fake survives Next.js hot reloads.
const g = globalThis as { __paymentProvider?: PaymentProvider };

/** The configured provider (PAYMENT_PROVIDER=fake | stripe). Switching is settings-only. */
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
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        throw new Error("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET");
      }
      g.__paymentProvider = new StripePaymentProvider({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      });
      return g.__paymentProvider;
  }
}

/** Tests: install a specific provider instance (or undefined to reset). */
export function setPaymentProvider(provider: PaymentProvider | undefined): void {
  g.__paymentProvider = provider;
}
