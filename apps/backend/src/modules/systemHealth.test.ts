import Fastify from "fastify";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  observeSystemHealth,
  registerSystemHealthRoutes,
  REQUIRED_SYSTEM_MIGRATIONS,
} from "./systemHealth.js";

const observedAt = new Date("2026-09-14T09:00:00.000Z");

describe("system health observation", () => {
  it("separates the request handler, database query, and migration state", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ system_health_ready: 1 }] })
      .mockResolvedValueOnce({
        rows: REQUIRED_SYSTEM_MIGRATIONS.map((version) => ({ version })),
      });

    const result = await observeSystemHealth(
      { query } as unknown as Pick<Pool, "query">,
      () => observedAt,
    );

    expect(result).toMatchObject({
      schema_version: "system-health.v1",
      status: "healthy",
      observed_at: observedAt.toISOString(),
      components: [
        { id: "backend", status: "healthy" },
        { id: "database", status: "healthy" },
        { id: "migrations", status: "healthy" },
      ],
    });
    expect(query).toHaveBeenNthCalledWith(1, "SELECT 1 AS system_health_ready");
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("schema_migrations"),
      [REQUIRED_SYSTEM_MIGRATIONS],
    );
  });

  it("reports a missing required migration without blaming PostgreSQL", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ system_health_ready: 1 }] })
      .mockResolvedValueOnce({
        rows: REQUIRED_SYSTEM_MIGRATIONS.slice(1).map((version) => ({ version })),
      });

    const result = await observeSystemHealth(
      { query } as unknown as Pick<Pool, "query">,
      () => observedAt,
    );

    expect(result.status).toBe("degraded");
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "database", status: "healthy" }),
        expect.objectContaining({
          id: "migrations",
          status: "degraded",
          detail_code: "required_migrations_missing",
        }),
      ]),
    );
  });

  it("settles a hanging database observation within one bounded deadline", async () => {
    const query = vi.fn().mockReturnValue(new Promise(() => undefined));

    const startedAt = Date.now();
    const result = await observeSystemHealth(
      { query } as unknown as Pick<Pool, "query">,
      () => observedAt,
      25,
    );

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.status).toBe("unavailable");
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "database",
          status: "unavailable",
          detail_code: "dependency_unreachable",
        }),
        expect.objectContaining({
          id: "migrations",
          status: "unknown",
          detail_code: "not_observed",
        }),
      ]),
    );
  });

  it("settles a hanging migration observation without claiming schema health", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ system_health_ready: 1 }] })
      .mockReturnValueOnce(new Promise(() => undefined));

    const startedAt = Date.now();
    const result = await observeSystemHealth(
      { query } as unknown as Pick<Pool, "query">,
      () => observedAt,
      60,
    );

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.status).toBe("unavailable");
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "database", status: "healthy" }),
        expect.objectContaining({
          id: "migrations",
          status: "unavailable",
          detail_code: "dependency_unreachable",
        }),
      ]),
    );
  });

  it("keeps migrations unknown when PostgreSQL cannot be observed", async () => {
    const query = vi.fn().mockRejectedValue(new Error("synthetic outage"));

    const result = await observeSystemHealth(
      { query } as unknown as Pick<Pool, "query">,
      () => observedAt,
    );

    expect(result.status).toBe("unavailable");
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "database", status: "unavailable" }),
        expect.objectContaining({
          id: "migrations",
          status: "unknown",
          detail_code: "not_observed",
        }),
      ]),
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("backend release revision", () => {
  afterEach(() => vi.unstubAllEnvs());

  function healthyQuery() {
    return vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ system_health_ready: 1 }] })
      .mockResolvedValueOnce({
        rows: REQUIRED_SYSTEM_MIGRATIONS.map((version) => ({ version })),
      });
  }

  it("includes a sanitized deployed revision when configured", async () => {
    vi.stubEnv("TALENT_SIGNAL_BACKEND_REVISION", "  26a664bb  ");
    const result = await observeSystemHealth(
      { query: healthyQuery() } as unknown as Pick<Pool, "query">,
      () => observedAt,
    );
    expect(result.backend_revision).toBe("26a664bb");
  });

  it("omits the revision when the environment is absent or empty", async () => {
    vi.stubEnv("TALENT_SIGNAL_BACKEND_REVISION", "");
    const result = await observeSystemHealth(
      { query: healthyQuery() } as unknown as Pick<Pool, "query">,
      () => observedAt,
    );
    expect("backend_revision" in result).toBe(false);
  });

  it("refuses a malformed revision instead of echoing it", async () => {
    vi.stubEnv("TALENT_SIGNAL_BACKEND_REVISION", "bad value!; rm -rf /");
    const result = await observeSystemHealth(
      { query: healthyQuery() } as unknown as Pick<Pool, "query">,
      () => observedAt,
    );
    expect(result.backend_revision).toBeUndefined();
  });

  it("still reports the revision when a dependency is unavailable", async () => {
    vi.stubEnv("TALENT_SIGNAL_BACKEND_REVISION", "deadbeef");
    const result = await observeSystemHealth(
      {
        query: vi.fn().mockRejectedValue(new Error("synthetic outage")),
      } as unknown as Pick<Pool, "query">,
      () => observedAt,
    );
    expect(result.status).toBe("unavailable");
    expect(result.backend_revision).toBe("deadbeef");
  });

  it("refuses a dotted or label revision, not just an unsafe one", async () => {
    for (const value of ["26a664bb.dirty", "answer-feedback-native-proof-v1", "abc123"]) {
      vi.stubEnv("TALENT_SIGNAL_BACKEND_REVISION", value);
      const result = await observeSystemHealth(
        { query: healthyQuery() } as unknown as Pick<Pool, "query">,
        () => observedAt,
      );
      expect(result.backend_revision, value).toBeUndefined();
    }
  });
});

describe("system health route boundary", () => {
  it("requires authentication and returns a non-cacheable observation", async () => {
    const app = Fastify();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ system_health_ready: 1 }] })
      .mockResolvedValueOnce({
        rows: REQUIRED_SYSTEM_MIGRATIONS.map((version) => ({ version })),
      });
    registerSystemHealthRoutes(
      app,
      { query } as unknown as Pool,
      async (request, reply) => {
        if (request.headers.authorization !== "Bearer synthetic-session") {
          return reply.status(401).send({
            error: {
              code: "UNAUTHORIZED",
              message: "Authentication is required.",
              request_id: request.id,
            },
          });
        }
      },
    );

    const denied = await app.inject({ method: "GET", url: "/v1/system/health" });
    expect(denied.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();

    const allowed = await app.inject({
      method: "GET",
      url: "/v1/system/health",
      headers: { authorization: "Bearer synthetic-session" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["cache-control"]).toBe("private, no-store");
    expect(allowed.headers.vary).toBe("authorization");
    expect(allowed.json()).toMatchObject({ status: "healthy" });
    await app.close();
  });
});
