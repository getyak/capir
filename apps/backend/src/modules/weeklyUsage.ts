import {
  CONTRACT_VERSION,
  WEEKLY_USAGE_SCHEMA_VERSION,
  WEEKLY_USAGE_TIMEZONE,
  WeeklyUsageResponseSchema,
  type WeeklyUsageResponse,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

import type { AuthContext } from "./auth.js";

/**
 * Read-only weekly usage metadata for the signed-in account member.
 *
 * The count aggregates retained product run metadata only: unique admitted
 * run identifiers for the exact `auth.accountId` AND `auth.userId` within the
 * current ISO week in Asia/Shanghai. Retries on the same run count once and
 * failed runs still count as admitted work. No run content, model, token or
 * cost estimate is read or returned, and retention may have removed older
 * records, so this is not a billing ledger.
 */

export const WEEKLY_REFERENCE_ALLOWANCE_ENV =
  "TALENT_SIGNAL_WEEKLY_REFERENCE_ALLOWANCE";
export const DEFAULT_WEEKLY_REFERENCE_ALLOWANCE = 1000;

/**
 * The weekly reference allowance is a configurable positive finite integer.
 * An absent or malformed value falls back to the default; it never becomes 0,
 * negative, fractional or unbounded.
 */
export function weeklyReferenceAllowance(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = environment[WEEKLY_REFERENCE_ALLOWANCE_ENV]?.trim();
  if (!raw) return DEFAULT_WEEKLY_REFERENCE_ALLOWANCE;
  if (!/^[0-9]+$/.test(raw)) return DEFAULT_WEEKLY_REFERENCE_ALLOWANCE;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_WEEKLY_REFERENCE_ALLOWANCE;
}

const DAY_MS = 86_400_000;

/**
 * Wall-clock offset of `timeZone` at `at`, in milliseconds.
 *
 * Asia/Shanghai has observed a fixed +08:00 offset since 1991, so the offset
 * observed at `now` is exact for the whole current week.
 */
function timeZoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const wallAsUTC = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallAsUTC - (at.getTime() - at.getUTCMilliseconds());
}

/**
 * The current ISO week window in Asia/Shanghai: Monday 00:00 (inclusive) to
 * next Monday 00:00 (exclusive).
 */
export function weeklyUsageWindow(
  now: Date,
): { start: Date; end: Date; timezone: typeof WEEKLY_USAGE_TIMEZONE } {
  const offset = timeZoneOffsetMs(now, WEEKLY_USAGE_TIMEZONE);
  const wall = now.getTime() - now.getUTCMilliseconds() + offset;
  const localMidnightWall = wall - (wall % DAY_MS);
  const isoWeekday = new Date(localMidnightWall).getUTCDay();
  const daysSinceMonday = (isoWeekday + 6) % 7;
  const mondayWall = localMidnightWall - daysSinceMonday * DAY_MS;
  return {
    start: new Date(mondayWall - offset),
    end: new Date(mondayWall + 7 * DAY_MS - offset),
    timezone: WEEKLY_USAGE_TIMEZONE,
  };
}

function isoStart(date: Date): string {
  return new Date(date.getTime() - (date.getTime() % 1000)).toISOString();
}

/**
 * Count unique retained product run IDs for one exact account member inside
 * the current window. Future-dated rows are excluded at query time and the
 * half-open bounds never double count a week boundary.
 */
export async function readWeeklyUsage(
  pool: Pick<Pool, "query">,
  auth: Pick<AuthContext, "accountId" | "userId">,
  now: () => Date = () => new Date(),
): Promise<WeeklyUsageResponse> {
  const observedAt = now();
  const window = weeklyUsageWindow(observedAt);
  const result = await pool.query<{ count: number | string }>(
    `SELECT COUNT(DISTINCT product_runs.id)::int AS count
       FROM product_runs
      WHERE product_runs.account_id = $1
        AND product_runs.user_id = $2
        AND product_runs.created_at >= $3::timestamptz
        AND product_runs.created_at < LEAST($4::timestamptz, now())`,
    [auth.accountId, auth.userId, isoStart(window.start), isoStart(window.end)],
  );
  const raw = result.rows[0]?.count ?? 0;
  const count = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  return {
    contract_version: CONTRACT_VERSION,
    schema_version: WEEKLY_USAGE_SCHEMA_VERSION,
    window: {
      start: isoStart(window.start),
      end: isoStart(window.end),
      timezone: WEEKLY_USAGE_TIMEZONE,
    },
    count: Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0,
    allowance: weeklyReferenceAllowance(),
    computed_at: isoStart(observedAt),
  };
}

export function registerWeeklyUsageRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
): void {
  app.get(
    "/v1/workspace/usage/weekly",
    {
      preHandler: [authenticate],
      schema: {
        security: [{ bearerSession: [] }],
        response: {
          200: WeeklyUsageResponseSchema,
          "4xx": { type: "object" },
          "5xx": { type: "object" },
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      reply.header("pragma", "no-cache");
      return readWeeklyUsage(pool, request.auth);
    },
  );
}
