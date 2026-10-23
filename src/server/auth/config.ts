import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";
import { accounts, sessions, users, verifications } from "../db/schema";
import { getEnv } from "../env";

export const ROLES = ["customer", "admin"] as const;
export type Role = (typeof ROLES)[number];

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "DriveEasy",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.APP_URL, env.BETTER_AUTH_URL],
    database: drizzleAdapter(db(), {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        // Clients can never set their own role (input: false); new users are customers.
        role: { type: "string", required: false, defaultValue: "customer", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      database: { generateId: "uuid" },
    },
    // nextCookies must be the last plugin: lets server actions set auth cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as { __auth?: Auth };

/** The Better Auth server instance (created lazily so builds don't need secrets at import time). */
export function getAuth(): Auth {
  g.__auth ??= createAuth();
  return g.__auth;
}
