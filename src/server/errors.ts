// Domain errors thrown by src/server/** functions. UI code can switch on `code`
// and show `message` to the user (messages are safe to display).
export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "NOT_AVAILABLE"
  | "HOLD_EXPIRED"
  | "INVALID_STATE"
  | "POLICY"
  | "PAYMENT_FAILED"
  | "CONFLICT";

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} not found`);
export const notAvailable = () =>
  new DomainError("NOT_AVAILABLE", "Sorry, this vehicle is no longer available for the selected dates.");

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/** Postgres SQLSTATE of an error (walks Drizzle's `cause` chain). */
export function pgErrorCode(e: unknown): string | undefined {
  for (let cur = e as { code?: unknown; cause?: unknown } | undefined, i = 0; cur && i < 5; i++) {
    if (typeof cur.code === "string" && /^[0-9A-Z]{5}$/.test(cur.code)) return cur.code;
    cur = cur.cause as typeof cur;
  }
  return undefined;
}

export function pgConstraint(e: unknown): string | undefined {
  for (let cur = e as { constraint?: unknown; cause?: unknown } | undefined, i = 0; cur && i < 5; i++) {
    if (typeof cur.constraint === "string") return cur.constraint;
    cur = cur.cause as typeof cur;
  }
  return undefined;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_UNIQUE_VIOLATION = "23505";
