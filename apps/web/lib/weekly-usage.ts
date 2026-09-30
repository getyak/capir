"use client";

import {
  WeeklyUsageResponseSchema,
  type WeeklyUsageResponse,
} from "@talent-signal/contracts";
import { matchesTypeBox } from "./typebox-validation";
import { workspaceSessionFetch } from "@/components/workspace-session-request";

/**
 * Weekly usage display state for the workspace account menu.
 *
 * The store never invents a number: a failed or stale read stays an error (or
 * disappears) instead of becoming 0, and switching accounts hides the previous
 * scope's result before any new read settles.
 */

export const WEEKLY_USAGE_LABEL = "本周已记录运行";
export const WEEKLY_ALLOWANCE_LABEL = "每周参考额度";

export function weeklyUsageSummary(usage: WeeklyUsageResponse): string {
  return `${WEEKLY_USAGE_LABEL} ${usage.count} · ${WEEKLY_ALLOWANCE_LABEL} ${usage.allowance}`;
}

export type WeeklyUsageView =
  | { status: "loading" }
  | { status: "ready"; usage: WeeklyUsageResponse }
  | { status: "error" };

export type WeeklyUsageStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WeeklyUsageView;
  refresh(): void;
  dispose(): void;
};

export function isWeeklyUsageResponse(value: unknown): value is WeeklyUsageResponse {
  if (!matchesTypeBox(WeeklyUsageResponseSchema, value)) return false;
  const usage = value as WeeklyUsageResponse;
  const start = Date.parse(usage.window.start);
  const end = Date.parse(usage.window.end);
  const computed = Date.parse(usage.computed_at);
  const now = Date.now();
  const monday = new Date(start + 8 * 3_600_000);
  return Number.isSafeInteger(usage.count) && Number.isSafeInteger(usage.allowance) &&
    Number.isFinite(computed) && start <= computed && computed <= now + 60_000 &&
    start <= now && now < end && end - start === 7 * 86_400_000 &&
    monday.getUTCDay() === 1 && monday.getUTCHours() === 0 &&
    monday.getUTCMinutes() === 0 && monday.getUTCSeconds() === 0 && monday.getUTCMilliseconds() === 0;
}

export async function fetchWeeklyUsage(
  signal: AbortSignal,
  binding: string | null = null,
): Promise<WeeklyUsageResponse> {
  if (!binding) throw new Error("WEEKLY_USAGE_UNBOUND");
  const response = await workspaceSessionFetch("/api/workspace/usage", {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json", "X-Talent-Signal-Usage-Binding": binding },
    signal,
  });
  if (!response.ok) throw new Error(`WEEKLY_USAGE_HTTP_${response.status}`);
  const payload: unknown = await response.json();
  if (!isWeeklyUsageResponse(payload)) throw new Error("WEEKLY_USAGE_INVALID");
  return payload;
}

/**
 * A store per account scope: creating a store for a new scope starts in
 * loading, so an account switch can never keep showing the old result.
 */
export function createWeeklyUsageStore(
  load: (signal: AbortSignal) => Promise<WeeklyUsageResponse> = fetchWeeklyUsage,
): WeeklyUsageStore {
  let snapshot: WeeklyUsageView = { status: "loading" };
  const listeners = new Set<() => void>();
  let controller: AbortController | null = null;
  let generation = 0;
  let expiry: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function publish(next: WeeklyUsageView) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function refresh() {
    if (disposed) return;
    if (expiry) clearTimeout(expiry);
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    // A refresh starts from loading so a stale count is never displayed.
    publish({ status: "loading" });
    try {
      const usage = await load(controller.signal);
      // A malformed payload is a failed read, never a displayed truth.
      if (!isWeeklyUsageResponse(usage)) throw new Error("WEEKLY_USAGE_INVALID");
      if (current === generation) {
        publish({ status: "ready", usage });
        expiry = setTimeout(() => void refresh(), Date.parse(usage.window.end) - Date.now());
        if (typeof expiry === "object") expiry.unref?.();
      }
    } catch {
      // An aborted request is superseded, not a failure to display.
      if (current === generation) publish({ status: "error" });
    }
  }

  void refresh();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refresh,
    dispose() {
      disposed = true;
      ++generation;
      controller?.abort();
      if (expiry) clearTimeout(expiry);
      listeners.clear();
    },
  };
}
