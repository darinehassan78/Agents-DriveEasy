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
  if (pathname.startsWith("/admin") && role !== "admin") {
    return NextResponse.rewrite(new URL("/forbidden", req.url), { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/rentals/:path*", "/profile/:path*", "/book/:path*"],
};
