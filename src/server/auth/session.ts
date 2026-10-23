import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { DomainError } from "../errors";
import { getAuth, type Role } from "./config";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Session user for the current request, or null. Role is read from the database, not the cookie. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const [row] = await db()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id));
  return row ?? null;
}

/** Same as getCurrentUser but throws DomainError("UNAUTHENTICATED") when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.");
  return user;
}

/** Throws UNAUTHENTICATED / FORBIDDEN unless the current user is an admin. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new DomainError("FORBIDDEN", "Admins only.");
  return user;
}
