import { isDomainError } from "@/server/errors";
import { log } from "@/server/log";
import { getPaymentProvider } from "@/server/payments";
import { handlePaymentWebhook } from "@/server/payments/service";

// Payment provider webhooks (fake provider locally, Stripe when
// PAYMENT_PROVIDER=stripe). The raw body is needed for signature checks.
// Returns 200 for processed, duplicate and ignored events so the provider
// stops retrying; 400 for bad signatures; 500 (provider retries) on errors.
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const provider = getPaymentProvider();
  const signature = request.headers.get(provider.signatureHeader);
  try {
    const result = await handlePaymentWebhook(rawBody, signature);
    return Response.json({ received: true, ...result });
  } catch (err) {
    if (isDomainError(err) && err.code === "VALIDATION") {
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }
    if (err instanceof Error && err.name === "UnhandledStripeEvent") {
      return Response.json({ received: true, status: "ignored" });
    }
    log.error("webhook processing failed", { err });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
