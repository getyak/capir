import "server-only";
import type { WeeklyUsageResponse } from "@talent-signal/contracts";

import { accountBackend } from "./accountBackend";

/**
 * Read-only weekly usage metadata for the signed-in backend session.
 *
 * The backend aggregates retained product run metadata only; this loader adds
 * no fallback count, so an outage surfaces as an error instead of a 0.
 */
export async function loadWeeklyUsage(
  signal?: AbortSignal,
): Promise<WeeklyUsageResponse> {
  return (await accountBackend()).getWeeklyUsage(signal);
}
