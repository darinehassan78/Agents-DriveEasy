import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { isDomainError } from "@/server/errors";

// Shared result shape for server actions used with useActionState.

import type { ActionState } from "./action-types";
export type { ActionState } from "./action-types";

export const ok = (message?: string): ActionState => ({ status: "success", message, at: Date.now() });
export const fail = (message: string, fieldErrors?: Record<string, string[]>): ActionState => ({
  status: "error",
  message,
  fieldErrors,
  at: Date.now(),
});

export function zodFail(error: z.ZodError, message = "Please check the highlighted fields."): ActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const k = String(issue.path[0] ?? "_");
    (fieldErrors[k] ??= []).push(issue.message);
  }
  return fail(message, fieldErrors);
}

/**
 * Runs an action body and turns domain errors into a displayable state.
 * Next.js control-flow errors (redirect, notFound) are rethrown.
 */
export async function guard(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (err) {
    unstable_rethrow(err);
    if (isDomainError(err)) {
      if (err.code === "UNAUTHENTICATED") return fail("Your session has ended. Please log in again.");
      if (err.code === "FORBIDDEN") return fail("You don't have permission to do that.");
      return fail(err.message);
    }
    console.error("[action] unexpected error", err);
    return fail("Something went wrong. Please try again.");
  }
}

/** FormData -> plain object of strings (first value per key). */
export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !(k in out) && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}
