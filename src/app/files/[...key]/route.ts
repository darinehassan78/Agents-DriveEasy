import { getCurrentUser } from "@/server/auth";
import { getFileStorage } from "@/server/storage";
import { parseFileKey } from "@/lib/uploads";
import { canViewDamagePhotos } from "@/lib/file-access";

// Private file route: licence uploads and damage photos. Served only to the
// owner and admins. Unknown keys and unauthorised requests both get 404 so the
// route never confirms that a file exists.

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, ctx: RouteContext<"/files/[...key]">) {
  const { key: parts } = await ctx.params;
  const key = parts.join("/"); // keys only contain [A-Za-z0-9_.-/], validated below
  const scope = parseFileKey(key);
  if (!scope) return notFound();

  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401, headers: { "Cache-Control": "no-store" } });

  const isAdmin = user.role === "admin";
  const allowed =
    isAdmin ||
    (scope.kind === "licence" && scope.userId === user.id) ||
    (scope.kind === "damage" && (await canViewDamagePhotos(scope.reservationId, user.id)));
  if (!allowed) return notFound();

  const file = await getFileStorage().get(key);
  if (!file) return notFound();

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
