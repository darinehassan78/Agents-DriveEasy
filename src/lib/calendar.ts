import { addDaysToDateString, zonedLocalToUtc } from "./format";

export type DayStatus = "free" | "partial" | "booked" | "past";

export interface Block {
  start: Date;
  end: Date;
}

/** Days of `month` ("YYYY-MM") as YYYY-MM-DD strings. */
export function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 0 = Monday … 6 = Sunday, for laying out a Monday-first grid. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Status of each local day at the branch: booked when blocking periods cover
 * the whole day, partial when they cover part of it, past before `today`.
 */
export function dayStatuses(days: string[], blocks: Block[], timeZone: string, today: string): Map<string, DayStatus> {
  const out = new Map<string, DayStatus>();
  for (const day of days) {
    if (day < today) {
      out.set(day, "past");
      continue;
    }
    const start = zonedLocalToUtc(`${day}T00:00`, timeZone)!.getTime();
    const end = zonedLocalToUtc(`${addDaysToDateString(day, 1)}T00:00`, timeZone)!.getTime();
    const overlaps = blocks
      .map((b) => [Math.max(start, b.start.getTime()), Math.min(end, b.end.getTime())] as const)
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    if (!overlaps.length) {
      out.set(day, "free");
      continue;
    }
    let covered = start;
    for (const [s, e] of overlaps) {
      if (s > covered) break;
      covered = Math.max(covered, e);
    }
    out.set(day, covered >= end ? "booked" : "partial");
  }
  return out;
}

export const MONTH_LABEL = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
