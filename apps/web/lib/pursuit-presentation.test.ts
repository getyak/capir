import { describe, expect, it } from "vitest";

import { formatPursuitDeadline } from "./pursuit-presentation";

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
