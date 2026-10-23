import "server-only";

// Single place the UI reads the signed-in user from. Wraps db-agent's auth
// helpers so pages don't depend on their exact shape.

export type Role = "customer" | "admin";
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  // TODO(app-agent): switch to db-agent's getCurrentUser() from @/server/auth/session when it lands.
  return null;
}
