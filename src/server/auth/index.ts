// Server-only auth entry point. Client code uses better-auth/react's
// createAuthClient() against /api/auth (src/app/api/auth/[...all]/route.ts).
export { getAuth, ROLES, type Auth, type Role } from "./config";
export { getCurrentUser, requireAdmin, requireUser, type CurrentUser } from "./session";
