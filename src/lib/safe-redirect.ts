/** Returns `next` if it is a same-site relative path, otherwise `fallback`. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Login URL that returns the user to `path` afterwards. */
export function loginUrl(path: string) {
  return `/login?next=${encodeURIComponent(path)}`;
}
