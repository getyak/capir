import { describe, expect, it } from "vitest";

import { formatPursuitDeadline, formatPursuitDeadlineCompact } from "./pursuit-presentation";

describe("pursuit deadline presentation", () => {
  it("shows the device-zone time and names the zone instead of leaking an ISO timestamp", () => {
    expect(formatPursuitDeadline("2026-09-28T09:00:00.000Z", "Asia/Shanghai"))
      .toBe("2026年9月28日 17:00 · Asia/Shanghai");
  });

  it("preserves the instant when the local calendar day crosses midnight", () => {
    expect(formatPursuitDeadline("2026-09-28T20:30:00.000Z", "Asia/Shanghai"))
      .toBe("2026年9月29日 04:30 · Asia/Shanghai");
  });

  it("uses an explicit UTC fallback when the device zone cannot be resolved", () => {
    expect(formatPursuitDeadline("2026-09-28T09:00:00.000Z", "invalid-zone"))
      .toBe("2026年9月28日 09:00 · UTC");
  });

  it("does not invent a deadline for missing or malformed data", () => {
    expect(formatPursuitDeadline(null, "UTC")).toBe("未设置截止时间");
    expect(formatPursuitDeadline("invalid", "UTC")).toBe("截止时间待核对");
  });
});

describe("pursuit deadline glance labels", () => {
  const now = new Date("2026-09-27T00:00:00.000Z");

  it("folds the year away within the same year but keeps the instant and zone", () => {
    expect(formatPursuitDeadlineCompact("2026-09-28T09:00:00.000Z", "Asia/Shanghai", now))
      .toBe("9 月 28 日 17:00");
    expect(formatPursuitDeadlineCompact("2026-09-28T20:30:00.000Z", "Asia/Shanghai", now))
      .toBe("9 月 29 日 04:30");
  });

  it("keeps the year across calendar years and falls back to UTC on a bad zone", () => {
    expect(formatPursuitDeadlineCompact("2027-01-03T01:00:00.000Z", "Asia/Shanghai", now))
      .toBe("2027 年 1 月 3 日 09:00");
    expect(formatPursuitDeadlineCompact("2026-09-28T09:00:00.000Z", "invalid-zone", now))
      .toBe("9 月 28 日 09:00");
  });

  it("does not invent a glance label for missing or malformed data", () => {
    expect(formatPursuitDeadlineCompact(null, "UTC", now)).toBe("未设置截止时间");
    expect(formatPursuitDeadlineCompact("invalid", "UTC", now)).toBe("截止时间待核对");
  });
});
