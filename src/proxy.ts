import { NextResponse, type NextRequest } from "next/server";

// Request-time gate for signed-in areas so unauthorised requests get a real
// redirect / 403 status before any HTML streams. Pages and server actions
// still check the session and role themselves (defence in depth).

const PROTECTED = [/^\/admin(\/|$)/, /^\/rentals(\/|$)/, /^\/profile(\/|$)/, /^\/book(\/|$)/];

async function sessionRole(req: NextRequest): Promise<string | null | undefined> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  try {
    const res = await fetch(new URL("/api/auth/get-session", req.nextUrl.origin), {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { user?: { role?: string } } | null;
    return data?.user ? (data.user.role ?? "customer") : null;
  } catch {
    return undefined; // auth service unreachable: let the page decide
  }
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!PROTECTED.some((re) => re.test(pathname))) return NextResponse.next();

  const role = await sessionRole(req);
  if (role === undefined) return NextResponse.next();
  if (role === null) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin") && role !== "admin") return forbidden(req);
  return NextResponse.next();
}

/** Renders /forbidden with a real 403 status (rewrite status isn't kept in every runtime). */
async function forbidden(req: NextRequest) {
  try {
    const page = await fetch(new URL("/forbidden", req.nextUrl.origin), {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    return new NextResponse(page.body, {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}

export const config = {
  matcher: ["/admin/:path*", "/rentals/:path*", "/profile/:path*", "/book/:path*"],
};
