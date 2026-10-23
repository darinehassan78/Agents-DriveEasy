import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  formatAED,
  formatDateTime,
  parseAEDToFils,
  rentalDays,
  utcToZonedLocal,
  zonedLocalToUtc,
} from "./format";

describe("formatAED", () => {
  it("formats fils as AED with two decimals", () => {
    expect(formatAED(123450)).toBe("AED 1,234.50");
    expect(formatAED(0)).toBe("AED 0.00");
    expect(formatAED(5)).toBe("AED 0.05");
  });
  it("can drop decimals for whole amounts", () => {
    expect(formatAED(15000, { whole: true })).toBe("AED 150");
    expect(formatAED(15050, { whole: true })).toBe("AED 150.50");
  });
});

describe("parseAEDToFils", () => {
  it("parses amounts without float error", () => {
    expect(parseAEDToFils("1,234.5")).toBe(123450);
    expect(parseAEDToFils("0.07")).toBe(7);
    expect(parseAEDToFils("AED 199")).toBe(19900);
    expect(parseAEDToFils("1.234")).toBeNull();
    expect(parseAEDToFils("-1")).toBeNull();
  });
});

describe("branch-local time", () => {
  it("converts Dubai wall-clock to UTC and back", () => {
    const utc = zonedLocalToUtc("2026-10-24T10:00", "Asia/Dubai");
    expect(utc?.toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(utcToZonedLocal(utc!, "Asia/Dubai")).toBe("2026-10-24T10:00");
  });
  it("handles zones with DST", () => {
    expect(zonedLocalToUtc("2026-07-01T12:00", "Europe/London")?.toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedLocalToUtc("2026-12-01T12:00", "Europe/London")?.toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });
  it("rejects invalid input", () => {
    expect(zonedLocalToUtc("2026-02-30T10:00")).toBeNull();
    expect(zonedLocalToUtc("tomorrow")).toBeNull();
  });
  it("formats in the branch zone", () => {
    expect(formatDateTime("2026-10-24T06:00:00Z", "Asia/Dubai")).toContain("10:00");
  });
  it("adds days to a date string across month ends", () => {
    expect(addDaysToDateString("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("rentalDays", () => {
  it("rounds up started days, minimum one", () => {
    expect(rentalDays("2026-10-24T06:00Z", "2026-10-25T06:00Z")).toBe(1);
    expect(rentalDays("2026-10-24T06:00Z", "2026-10-25T06:01Z")).toBe(2);
    expect(rentalDays("2026-10-24T06:00Z", "2026-10-24T08:00Z")).toBe(1);
  });
});
