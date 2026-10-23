// Display helpers shared by server and client components.
// Money is integer fils (1 AED = 100 fils). Times are UTC instants shown in a
// branch's IANA time zone. Nothing here touches the database or secrets.

export const DEFAULT_TIME_ZONE = "Asia/Dubai";

const aedFormatter = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const aedWholeFormatter = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats integer fils as AED, e.g. 123450 -> "AED 1,234.50". */
export function formatAED(fils: number, opts: { whole?: boolean } = {}): string {
  if (!Number.isFinite(fils)) return "—";
  const aed = fils / 100;
  // Normalise U+00A0 so tests and copy are predictable.
  const out = (opts.whole && Number.isInteger(aed) ? aedWholeFormatter : aedFormatter).format(aed);
  return out.replace(/ /g, " ");
}

/** Parses an AED amount typed by an admin ("1,234.5") into integer fils. */
export function parseAEDToFils(input: string): number | null {
  const clean = input.replace(/[,\s]|AED/gi, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

type DateInput = Date | string | number;
const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d));

/** "Fri, 24 Oct 2026, 10:00" in the branch's zone. */
export function formatDateTime(d: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(toDate(d));
}

/** "24 Oct 2026" in the branch's zone. */
export function formatDate(d: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    toDate(d),
  );
}

/** "10:00" in the branch's zone. */
export function formatTime(d: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    toDate(d),
  );
}

/** Short zone label, e.g. "GST" / "GMT+4". */
export function timeZoneLabel(timeZone = DEFAULT_TIME_ZONE, at: DateInput = Date.now()): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
    .formatToParts(toDate(at))
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

function zoneParts(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Offset of `timeZone` from UTC at instant `d`, in minutes (Dubai = +240). */
export function zoneOffsetMinutes(d: Date, timeZone: string): number {
  const p = zoneParts(d, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/**
 * Converts a wall-clock time at a branch ("2026-10-24T10:00" or "2026-10-24")
 * into the UTC instant. Returns null for malformed input.
 */
export function zonedLocalToUtc(local: string, timeZone = DEFAULT_TIME_ZONE): Date | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [y, mo, d, h = "00", mi = "00"] = m.slice(1);
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  if (Number.isNaN(naive)) return null;
  const check = new Date(naive);
  if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d) return null;
  // Two passes handle DST transitions in zones that have them.
  let utc = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  utc = naive - zoneOffsetMinutes(new Date(utc), timeZone) * 60000;
  return new Date(utc);
}

/** UTC instant -> "YYYY-MM-DDTHH:mm" wall-clock at the branch (for inputs/URLs). */
export function utcToZonedLocal(d: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  const p = zoneParts(toDate(d), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

/** UTC instant -> "YYYY-MM-DD" at the branch. */
export function utcToZonedDate(d: DateInput, timeZone = DEFAULT_TIME_ZONE): string {
  return utcToZonedLocal(d, timeZone).slice(0, 10);
}

/** Adds whole days to a "YYYY-MM-DD" string. */
export function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Rental days the same way the server prices them: ceil(duration / 24h), min 1. */
export function rentalDays(pickupAt: DateInput, returnAt: DateInput): number {
  const ms = toDate(returnAt).getTime() - toDate(pickupAt).getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1,234 km" */
export function formatKm(km: number): string {
  return `${new Intl.NumberFormat("en-AE").format(km)} km`;
}

export const FUEL_LEVELS = [
  { value: 0, label: "Empty" },
  { value: 1, label: "1/8" },
  { value: 2, label: "1/4" },
  { value: 3, label: "3/8" },
  { value: 4, label: "1/2" },
  { value: 5, label: "5/8" },
  { value: 6, label: "3/4" },
  { value: 7, label: "7/8" },
  { value: 8, label: "Full" },
] as const;

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
