import { z } from "zod";

// Server-side settings. Swapping a local stand-in for a cloud service should only
// require changing these values (see .env.example).
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),

  PAYMENT_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  PAYMENT_WEBHOOK_URL: z.url().default("http://localhost:3000/api/webhooks/payments"),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  FAKE_PAYMENT_DUPLICATE_WEBHOOKS: z.stringbool().default(false),
  STRIPE_SECRET_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3", "vercel-blob"]).default("local"),
  LOCAL_UPLOADS_DIR: z.string().default("storage/uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  SCHEDULER: z.enum(["local", "cloud-cron"]).default("local"),
  CRON_SECRET: z.string().min(16),
  HOLD_TTL_MINUTES: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
