import { expect, it } from "vitest";
import type { TimeActivity } from "@talent-signal/contracts";
import { formatTodayArrangement } from "./today-context";
import { formatPursuitDeadline, formatPursuitDeadlineCompact } from "./pursuit-presentation";
import { formatDay } from "./time-workspace";
it("formats Today dates in the active locale while preserving the exclusive all-day end", () => {
  const row = { occurred_at: "2026-10-24T16:00:00Z", ends_at: "2026-10-26T16:00:00Z", time_zone: "Asia/Shanghai", all_day: true } as TimeActivity;
  expect(formatTodayArrangement(row, "en")).toBe("October 25, 2026 – October 26, 2026 · All day");
  expect(formatDay("2026-10-25", { month: "long", day: "numeric" }, "en")).toBe("October 25");
});
it("localizes deadline labels without changing the instant, zone or missing-data distinction", () => {
  expect(formatPursuitDeadline("2026-10-25T20:30:00Z", "Asia/Shanghai", "en")).toBe("October 26, 2026 04:30 · Asia/Shanghai");
  expect(formatPursuitDeadlineCompact("2026-10-25T20:30:00Z", "Asia/Shanghai", new Date("2026-10-25T00:00:00Z"), "en")).toBe("October 26 04:30");
  expect(formatPursuitDeadline(null, "UTC", "en")).toBe("No deadline set");
  expect(formatPursuitDeadline("bad", "UTC", "en")).toBe("Deadline needs review");
});
