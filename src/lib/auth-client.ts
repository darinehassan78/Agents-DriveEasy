"use client";

import { createAuthClient } from "better-auth/react";

// Browser-side Better Auth client (sign in / sign up / sign out). It talks to
// the /api/auth route on the same origin; no secrets live here.
export const authClient = createAuthClient();
