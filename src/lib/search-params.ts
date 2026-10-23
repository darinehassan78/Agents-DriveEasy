import { z } from "zod";
import { addDaysToDateString, utcToZonedDate, zonedLocalToUtc } from "./format";

// URL contract for search / vehicle / booking pages. Times in the URL are the
// wall-clock times at the pick-up and return branches ("YYYY-MM-DDTHH:mm").

export const TRANSMISSIONS = ["AUTOMATIC", "MANUAL"] as const;
export const FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"] as const;
export const SORTS = ["price_asc", "price_desc", "seats_desc"] as const;

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const optText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const optInt = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

export const searchParamsSchema = z.object({
  pickupBranch: optText,
  returnBranch: optText,
  pickupAt: local.optional().catch(undefined),
  returnAt: local.optional().catch(undefined),
  category: optText,
  transmission: z.enum(TRANSMISSIONS).optional().catch(undefined),
  fuel: z.enum(FUEL_TYPES).optional().catch(undefined),
  seats: optInt.catch(undefined),
  maxPrice: optInt.catch(undefined), // whole AED per day
  sort: z.enum(SORTS).optional().catch(undefined),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;
type RawParams = Record<string, string | string[] | undefined>;

export function parseSearchParams(raw: RawParams): SearchParams {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) flat[k] = Array.isArray(v) ? v[0] : v;
  const parsed = searchParamsSchema.safeParse(flat);
  return parsed.success ? parsed.data : { pickupBranch: undefined, returnBranch: undefined, category: undefined };
}

export interface BranchTz {
  id: string;
  timeZone: string;
}

export type ResolvedTrip =
  | {
      ok: true;
      pickupBranchId: string;
      returnBranchId: string;
      pickupAt: Date;
      returnAt: Date;
    }
  | { ok: false; reason: "missing" | "invalid" | "order" | "past" | "branch"; message: string };

/** Validates the trip part of the params and converts branch-local times to UTC. */
export function resolveTrip(p: SearchParams, branches: BranchTz[], now: Date): ResolvedTrip {
  if (!p.pickupBranch || !p.pickupAt || !p.returnAt) {
    return { ok: false, reason: "missing", message: "Choose a pick-up branch, dates and times." };
  }
  const pickup = branches.find((b) => b.id === p.pickupBranch);
  const ret = branches.find((b) => b.id === (p.returnBranch ?? p.pickupBranch));
  if (!pickup || !ret) return { ok: false, reason: "branch", message: "That branch is not available." };
  const pickupAt = zonedLocalToUtc(p.pickupAt, pickup.timeZone);
  const returnAt = zonedLocalToUtc(p.returnAt, ret.timeZone);
  if (!pickupAt || !returnAt) return { ok: false, reason: "invalid", message: "Those dates aren't valid." };
  if (pickupAt.getTime() < now.getTime()) {
    return { ok: false, reason: "past", message: "Pick-up time must be in the future." };
  }
  if (returnAt.getTime() <= pickupAt.getTime()) {
    return { ok: false, reason: "order", message: "Return must be after pick-up." };
  }
  return { ok: true, pickupBranchId: pickup.id, returnBranchId: ret.id, pickupAt, returnAt };
}

/** Builds a query string, dropping empty values. */
export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Trip-only params to carry from search to vehicle and booking pages. */
export function tripQuery(p: SearchParams) {
  return toQuery({
    pickupBranch: p.pickupBranch,
    returnBranch: p.returnBranch && p.returnBranch !== p.pickupBranch ? p.returnBranch : undefined,
    pickupAt: p.pickupAt,
    returnAt: p.returnAt,
  });
}

/** Default trip: tomorrow 10:00 to three days later 10:00 at the branch. */
export function defaultTrip(now: Date, timeZone: string) {
  const today = utcToZonedDate(now, timeZone);
  return {
    pickupAt: `${addDaysToDateString(today, 1)}T10:00`,
    returnAt: `${addDaysToDateString(today, 4)}T10:00`,
  };
}
