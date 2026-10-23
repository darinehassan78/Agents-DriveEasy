import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/server/env";
import { releaseExpiredHolds } from "@/server/jobs/release-expired-holds";
import { log } from "@/server/log";

// Called by Vercel Cron (see vercel.json) or any scheduler with
//   Authorization: Bearer ${CRON_SECRET}
// Idempotent, so retries and overlapping runs are safe. Locally:
//   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3300/api/cron/release-expired-holds
// or `pnpm jobs:release-expired-holds`.

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${getEnv().CRON_SECRET}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) {
    log.warn("cron unauthorized", { path: "/api/cron/release-expired-holds" });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await releaseExpiredHolds();
    return Response.json({ ok: true, expired: result.expired.length, compensated: result.compensated, message: result.message });
  } catch (err) {
    log.error("cron release-expired-holds failed", { err });
    return Response.json({ ok: false, error: "job failed" }, { status: 500 });
  }
}

// Vercel Cron sends GET; POST is accepted for other schedulers.
export const GET = handle;
export const POST = handle;
