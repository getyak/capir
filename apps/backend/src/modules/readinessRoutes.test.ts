import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { registerReadinessRoutes } from "./readinessRoutes.js";
import { REQUIRED_SYSTEM_MIGRATIONS } from "./systemHealth.js";
import migrationManifest from "../database/migration-manifest.json" with { type: "json" };

describe("renewable-login schema readiness", () => {
  const required = ["107_persistent_user_sessions", "108_capir_persistent_login"];
  const databaseWith = (versions: readonly string[]) => {
    const applied = new Set(versions);
    return { query: vi.fn(async (_sql: string, [requested]: [readonly string[]]) => ({
      rows: requested.filter(version => applied.has(version)).map(version => ({ version })),
    })) } as unknown as Pool;
  };

  it.each(required)("returns 503 when %s is missing from the applied manifest", async missing => {
    const app = Fastify();
    registerReadinessRoutes(app, databaseWith(migrationManifest.migrations.filter(version => version !== missing)));
    try {
      const response = await app.inject({ url: "/health/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json().status).toBe("not_ready");
    } finally { await app.close(); }
  });

  it("reports the actual login schema revision after the complete manifest is applied", async () => {
    const app = Fastify();
    registerReadinessRoutes(app, databaseWith(migrationManifest.migrations));
    try {
      const response = await app.inject({ url: "/health/ready" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready", database: "ready", migration: "108_capir_persistent_login" });
    } finally { await app.close(); }
  });
});

describe.each(["072_mcp_extensions", "073_conversation_queue", "073_account_onboarding", "074_time_workspace", "075_conversation_message_images"])("schema readiness: %s", (required) => {
  it.each([false, true])("requires migration when applied=%s", async (applied) => {
    const migrations = REQUIRED_SYSTEM_MIGRATIONS.filter((version) => version !== required);
    const query = vi.fn().mockResolvedValue({
      rows: [...migrations, ...(applied ? [required] : [])].map((version) => ({ version })),
    });
    const app = Fastify();
    registerReadinessRoutes(app, { query } as unknown as Pool);
    try {
      const response = await app.inject({ method: "GET", url: "/health/ready" });
      expect(response.statusCode).toBe(applied ? 200 : 503);
      if (applied) expect(response.json().migration).toBe(REQUIRED_SYSTEM_MIGRATIONS.at(-1));
      else expect(response.json().status).toBe("not_ready");
    } finally {
      await app.close();
    }
  });
});

describe("readiness bounded failure", () => {
  it("settles a hanging readiness probe with 503 within its observation budget", async () => {
    const query = vi.fn().mockReturnValue(new Promise(() => undefined));
    const app = Fastify();
    registerReadinessRoutes(app, { query } as unknown as Pool, 25);
    try {
      const startedAt = Date.now();
      const response = await app.inject({ method: "GET", url: "/health/ready" });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ status: "not_ready" });
    } finally {
      await app.close();
    }
  });
});
