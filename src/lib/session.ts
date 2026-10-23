import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { loginUrl } from "./safe-redirect";

// The UI's single entry point for "who is signed in". Role always comes from
// the database (db-agent's getCurrentUser), never from the client.

export type SessionUser = CurrentUser;

export async function getSessionUser(): Promise<SessionUser | null> {
  return getCurrentUser();
}

/** For pages: redirects to login (returning to `path`) when signed out. */
export async function requirePageUser(path: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(path));
  return user;
}

/** For admin pages: login redirect when signed out, 404 for non-admins (hides the area). */
export async function requirePageAdmin(path: string): Promise<SessionUser> {
  const user = await requirePageUser(path);
  if (user.role !== "admin") notFound();
  return user;
}
