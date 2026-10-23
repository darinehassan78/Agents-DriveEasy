import { describe, expect, it } from "vitest";
import { addMonths, dayStatuses, daysInMonth, weekdayIndex } from "./calendar";

describe("calendar helpers", () => {
  it("lists days and weekdays", () => {
    expect(daysInMonth("2026-02")).toHaveLength(28);
    expect(weekdayIndex("2026-10-26")).toBe(0); // Monday
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("marks booked, partial and free days in the branch zone", () => {
    // 25 Oct 10:00 Dubai -> 27 Oct 10:00 Dubai
    const blocks = [{ start: new Date("2026-10-25T06:00:00Z"), end: new Date("2026-10-27T06:00:00Z") }];
    const s = dayStatuses(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"], blocks, "Asia/Dubai", "2026-10-20");
    expect(s.get("2026-10-24")).toBe("free");
    expect(s.get("2026-10-25")).toBe("partial");
    expect(s.get("2026-10-26")).toBe("booked");
    expect(s.get("2026-10-27")).toBe("partial");
    expect(s.get("2026-10-28")).toBe("free");
  });

  it("merges adjacent blocks to a full day and marks past days", () => {
    const blocks = [
      { start: new Date("2026-10-25T20:00:00Z"), end: new Date("2026-10-26T08:00:00Z") },
      { start: new Date("2026-10-26T08:00:00Z"), end: new Date("2026-10-26T20:00:00Z") },
    ];
    const s = dayStatuses(["2026-10-19", "2026-10-26"], blocks, "Asia/Dubai", "2026-10-20");
    expect(s.get("2026-10-19")).toBe("past");
    expect(s.get("2026-10-26")).toBe("booked");
  });
});
