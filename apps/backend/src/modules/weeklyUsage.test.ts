import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../app.js";
import type { BackendConfig } from "../config.js";
import {
  DEFAULT_WEEKLY_REFERENCE_ALLOWANCE,
  WEEKLY_REFERENCE_ALLOWANCE_ENV,
  readWeeklyUsage,
  registerWeeklyUsageRoutes,
  weeklyReferenceAllowance,
  weeklyUsageWindow,
} from "./weeklyUsage.js";
import type { AuthContext } from "./auth.js";

const config: BackendConfig = {
  allowedOrigins: ["http://localhost:3000"],
  appleSignInAudiences: ["com.talentsignal.app"],
  appleSignInEnabled: true,
  databaseUrl: "postgresql://synthetic-only",
  host: "127.0.0.1",
  passwordAuthEnabled: true,
  passwordRegistrationEnabled: true,
  port: 4317,
  retentionSweepIntervalMs: 60_000,
  sessionTtlSeconds: 28_800,
  simulatedAuthEnabled: true,
};

const authA: AuthContext = {
  accountId: "30000000-0000-4000-8000-00000000000a",
  accountSlug: "usage-a",
  userId: "40000000-0000-4000-8000-00000000000a",
  userEmail: "member-a@example.test",
  userKind: "simulated_human",
  sessionId: "50000000-0000-4000-8000-00000000000a",
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  delete process.env[WEEKLY_REFERENCE_ALLOWANCE_ENV];
  vi.useRealTimers();
});

describe("weekly usage window (Asia/Shanghai ISO week)", () => {
  it("spans Monday 00:00 to next Monday 00:00 with half-open bounds", () => {
    const midWeek = weeklyUsageWindow(new Date("2026-09-30T02:00:00Z"));
    expect(midWeek.start.toISOString()).toBe("2026-09-27T16:00:00.000Z");
    expect(midWeek.end.toISOString()).toBe("2026-10-04T16:00:00.000Z");
    expect(midWeek.timezone).toBe("Asia/Shanghai");
    expect(midWeek.end.getTime() - midWeek.start.getTime()).toBe(7 * 86_400_000);
  });

  it("keeps Sunday 23:59:59 in the current week and moves at Monday 00:00", () => {
    const sunday = weeklyUsageWindow(new Date("2026-10-04T15:59:59Z"));
    expect(sunday.start.toISOString()).toBe("2026-09-27T16:00:00.000Z");
    expect(sunday.end.toISOString()).toBe("2026-10-04T16:00:00.000Z");
    const monday = weeklyUsageWindow(new Date("2026-10-04T16:00:00Z"));
    expect(monday.start.toISOString()).toBe("2026-10-04T16:00:00.000Z");
    expect(monday.end.toISOString()).toBe("2026-10-11T16:00:00.000Z");
  });

  it("places the local year boundary inside the ISO week of its Shanghai date", () => {
    const newYear = weeklyUsageWindow(new Date("2026-01-01T00:00:00Z"));
    expect(newYear.start.toISOString()).toBe("2025-12-28T16:00:00.000Z");
    expect(newYear.end.toISOString()).toBe("2026-01-04T16:00:00.000Z");
  });
});

describe("weekly reference allowance", () => {
  it("defaults to 1000 and accepts a configured positive integer", () => {
    expect(weeklyReferenceAllowance({})).toBe(DEFAULT_WEEKLY_REFERENCE_ALLOWANCE);
    expect(
      weeklyReferenceAllowance({ [WEEKLY_REFERENCE_ALLOWANCE_ENV]: "2500" }),
    ).toBe(2500);
    expect(
      weeklyReferenceAllowance({ [WEEKLY_REFERENCE_ALLOWANCE_ENV]: " 12 " }),
    ).toBe(12);
  });

  it.each(["0", "-5", "12.5", "abc", "1e3", "9007199254740993", ""])(
    "falls back to the default for %j instead of inventing an allowance",
    value => {
      expect(
        weeklyReferenceAllowance({ [WEEKLY_REFERENCE_ALLOWANCE_ENV]: value }),
      ).toBe(DEFAULT_WEEKLY_REFERENCE_ALLOWANCE);
    },
  );
});

describe("weekly usage aggregation", () => {
  it("counts unique admitted runs for the exact account member with half-open future-safe bounds", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: 3 }] });
    const response = await readWeeklyUsage(
      { query } as unknown as Pool,
      authA,
      () => new Date("2026-09-30T02:00:00Z"),
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    // Retained product_runs metadata only; unique run IDs so retries count once.
    expect(sql).toContain("COUNT(DISTINCT product_runs.id)");
    expect(sql).toContain("FROM product_runs");
    expect(sql).not.toMatch(/JOIN|objective|input|output|token|cost/);
    // Exact auth scope and half-open bounds; future rows excluded at query time.
    expect(params).toEqual([
      authA.accountId,
      authA.userId,
      "2026-09-27T16:00:00.000Z",
      "2026-10-04T16:00:00.000Z",
    ]);
    expect(sql).toContain("created_at >= $3");
    expect(sql).toContain("created_at < LEAST($4");
    expect(sql).toContain("now()");
    expect(response).toEqual({
      contract_version: expect.any(String),
      schema_version: "workspace-weekly-usage.v1",
      window: {
        start: "2026-09-27T16:00:00.000Z",
        end: "2026-10-04T16:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
      count: 3,
      allowance: DEFAULT_WEEKLY_REFERENCE_ALLOWANCE,
      computed_at: "2026-09-30T02:00:00.000Z",
    });
  });

  it("isolates members: a different user or account never shares another scope's count", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: 0 }] });
    await readWeeklyUsage({ query } as unknown as Pool, authA);
    await readWeeklyUsage(
      { query } as unknown as Pool,
      { accountId: authA.accountId, userId: "40000000-0000-4000-8000-00000000000b" },
    );
    await readWeeklyUsage(
      { query } as unknown as Pool,
      { accountId: "30000000-0000-4000-8000-00000000000b", userId: authA.userId },
    );
    const scopes = query.mock.calls.map(([, params]) => params.slice(0, 2));
    expect(scopes).toEqual([
      [authA.accountId, authA.userId],
      [authA.accountId, "40000000-0000-4000-8000-00000000000b"],
      ["30000000-0000-4000-8000-00000000000b", authA.userId],
    ]);
    expect(new Set(scopes.map((scope) => scope.join("|"))).size).toBe(3);
  });
});

describe("registered weekly usage endpoint", () => {
  function sessionRows(auth: AuthContext) {
    return [
      {
        session_id: auth.sessionId,
        account_id: auth.accountId,
        account_slug: auth.accountSlug,
        user_id: auth.userId,
        user_email: auth.userEmail,
        user_kind: auth.userKind,
      },
    ];
  }

  function usagePool(auth: AuthContext, count: number) {
    const query = vi.fn().mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes("FROM sessions")
          ? { rows: sessionRows(auth) }
          : { rows: [{ count }] },
      ),
    );
    return { pool: { query } as unknown as Pool, query };
  }

  it("denies unauthenticated access before reading any usage", async () => {
    const { pool, query } = usagePool(authA, 7);
    const app = await buildApp({ config, pool, conversationQueueWorkerEnabled: false });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/v1/workspace/usage/weekly" });
    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns the exact usage contract for the authenticated member with private no-store caching", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T02:00:00Z"));
    process.env[WEEKLY_REFERENCE_ALLOWANCE_ENV] = "1800";
    const { pool, query } = usagePool(authA, 7);
    const app = await buildApp({ config, pool, conversationQueueWorkerEnabled: false });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/workspace/usage/weekly",
      headers: { authorization: "Bearer synthetic-session" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.json()).toEqual({
      contract_version: expect.any(String),
      schema_version: "workspace-weekly-usage.v1",
      window: {
        start: "2026-09-27T16:00:00.000Z",
        end: "2026-10-04T16:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
      count: 7,
      allowance: 1800,
      computed_at: expect.any(String),
    });
    const usageCall = query.mock.calls.find(([sql]) => sql.includes("product_runs"));
    expect(usageCall?.[1].slice(0, 2)).toEqual([authA.accountId, authA.userId]);
  });

  it("scopes the aggregate to the session's own account and user", async () => {
    const other: AuthContext = {
      ...authA,
      accountId: "30000000-0000-4000-8000-00000000000c",
      userId: "40000000-0000-4000-8000-00000000000c",
    };
    const { pool, query } = usagePool(other, 1);
    const app = await buildApp({ config, pool, conversationQueueWorkerEnabled: false });
    apps.push(app);
    await app.inject({
      method: "GET",
      url: "/v1/workspace/usage/weekly",
      headers: { authorization: "Bearer synthetic-session" },
    });
    const usageCall = query.mock.calls.find(([sql]) => sql.includes("product_runs"));
    expect(usageCall?.[1].slice(0, 2)).toEqual([other.accountId, other.userId]);
    expect(usageCall?.[1].slice(0, 2)).not.toEqual([authA.accountId, authA.userId]);
  });
});

describe("weekly usage route registration", () => {
  it("keeps the endpoint read-only and behind the shared authenticate guard", () => {
    const get = vi.fn();
    const app = {
      get,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as Parameters<typeof registerWeeklyUsageRoutes>[0];
    const authenticate = vi.fn() as unknown as Parameters<
      typeof registerWeeklyUsageRoutes
    >[2];
    registerWeeklyUsageRoutes(app, {} as Pool, authenticate);
    expect(get).toHaveBeenCalledTimes(1);
    const [path, options] = get.mock.calls[0] as [string, { preHandler: unknown[] }];
    expect(path).toBe("/v1/workspace/usage/weekly");
    expect(options.preHandler).toEqual([authenticate]);
  });
});
