import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WEEKLY_ALLOWANCE_LABEL,
  WEEKLY_USAGE_LABEL,
  createWeeklyUsageStore,
  weeklyUsageSummary,
  isWeeklyUsageResponse,
  fetchWeeklyUsage,
} from "./weekly-usage";
import type { WeeklyUsageResponse } from "@talent-signal/contracts";
const { scopedFetch } = vi.hoisted(() => ({ scopedFetch: vi.fn() }));
vi.mock("@/components/workspace-session-request", () => ({ workspaceSessionFetch: scopedFetch }));
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-30T06:00:00Z")); });
afterEach(() => vi.useRealTimers());

function usage(count: number): WeeklyUsageResponse {
  return {
    contract_version: "2026-08-24.10",
    schema_version: "workspace-weekly-usage.v1",
    window: {
      start: "2026-09-27T16:00:00.000Z",
      end: "2026-10-04T16:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
    count,
    allowance: 1000,
    computed_at: "2026-09-30T02:00:00.000Z",
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("weekly usage store", () => {
  it("requires a rendered session binding and sends it through the scoped fetch", async () => {
    scopedFetch.mockResolvedValue(Response.json(usage(12)));
    await expect(fetchWeeklyUsage(new AbortController().signal)).rejects.toThrow("UNBOUND");
    await fetchWeeklyUsage(new AbortController().signal, "opaque-account-member-session");
    expect(scopedFetch).toHaveBeenCalledWith("/api/workspace/usage", expect.objectContaining({
      headers: { accept: "application/json", "X-Talent-Signal-Usage-Binding": "opaque-account-member-session" },
    }));
  });
  it("rejects invalid dates, stale weeks, wrong timezone and contract", () => {
    for (const invalid of [
      { ...usage(12), computed_at: "invalid" },
      { ...usage(12), contract_version: "unknown" },
      { ...usage(12), count: Number.MAX_SAFE_INTEGER + 1 },
      { ...usage(12), window: { ...usage(12).window, timezone: "UTC" } },
      { ...usage(12), window: { ...usage(12).window, start: "invalid" } },
    ]) expect(isWeeklyUsageResponse(invalid)).toBe(false);
    vi.setSystemTime(new Date("2026-10-04T16:00:00Z"));
    expect(isWeeklyUsageResponse(usage(12))).toBe(false);
  });
  it("disposal drops an in-flight old-session response", async () => {
    let complete!: (value: WeeklyUsageResponse) => void;
    const store = createWeeklyUsageStore(() => new Promise(resolve => { complete = resolve; }));
    store.dispose();
    complete(usage(99));
    await settled();
    expect(store.getSnapshot()).toEqual({ status: "loading" });
  });
  it("labels the count and allowance plainly without enforcement claims", () => {
    expect(WEEKLY_USAGE_LABEL).toBe("本周已记录运行");
    expect(WEEKLY_ALLOWANCE_LABEL).toBe("每周参考额度");
    expect(weeklyUsageSummary(usage(12))).toBe(
      "本周已记录运行 12 · 每周参考额度 1000",
    );
  });

  it("shows the real aggregate after loading and never a fabricated 0", async () => {
    const load = vi.fn().mockResolvedValue(usage(12));
    const store = createWeeklyUsageStore(load);
    expect(store.getSnapshot()).toEqual({ status: "loading" });
    await settled();
    expect(store.getSnapshot()).toEqual({ status: "ready", usage: usage(12) });
  });

  it("keeps a read failure as an error with retry instead of a 0 count", async () => {
    const load = vi.fn().mockRejectedValue(new Error("offline"));
    const store = createWeeklyUsageStore(load);
    await settled();
    expect(store.getSnapshot()).toEqual({ status: "error" });
    load.mockResolvedValue(usage(3));
    store.refresh();
    expect(store.getSnapshot()).toEqual({ status: "loading" });
    await settled();
    expect(store.getSnapshot()).toEqual({ status: "ready", usage: usage(3) });
  });

  it("hides the previous result while refreshing and drops superseded reads", async () => {
    let releaseFirst: (value: WeeklyUsageResponse) => void = () => {};
    const first = new Promise<WeeklyUsageResponse>((resolve) => {
      releaseFirst = resolve;
    });
    const load = vi.fn().mockReturnValueOnce(first).mockResolvedValue(usage(5));
    const store = createWeeklyUsageStore(load);
    await settled();
    store.refresh();
    // A newer scope/read started: the stale result must not reappear.
    expect(store.getSnapshot()).toEqual({ status: "loading" });
    releaseFirst(usage(99));
    await settled();
    expect(store.getSnapshot()).toEqual({ status: "ready", usage: usage(5) });
  });

  it("starts a fresh account scope from loading so an old account's count disappears", async () => {
    const stale = createWeeklyUsageStore(vi.fn().mockResolvedValue(usage(99)));
    await settled();
    expect(stale.getSnapshot().status).toBe("ready");
    // A new scope is a new store: no old result is observable in it.
    const fresh = createWeeklyUsageStore(
      vi.fn().mockRejectedValue(new Error("switched")),
    );
    expect(fresh.getSnapshot()).toEqual({ status: "loading" });
    await settled();
    expect(fresh.getSnapshot()).toEqual({ status: "error" });
    expect(JSON.stringify(fresh.getSnapshot())).not.toContain("99");
  });

  it("rejects a malformed payload instead of displaying it as truth", async () => {
    const store = createWeeklyUsageStore(
      vi.fn().mockResolvedValue({ schema_version: "other" } as never),
    );
    await settled();
    expect(store.getSnapshot()).toEqual({ status: "error" });
  });
});
