import { CONTRACT_VERSION, type SystemHealthComponent } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";

import {
  parseSystemHealth,
  summarizeSystemHealth,
  systemHealthIsStale,
} from "./system-health";

const components: SystemHealthComponent[] = [
  { id: "web", label: "Web", kind: "service", required: true, status: "healthy", duration_ms: null, detail_code: "request_completed" },
  { id: "backend", label: "Backend", kind: "service", required: true, status: "healthy", duration_ms: 2, detail_code: "request_completed" },
  { id: "database", label: "Database", kind: "database", required: true, status: "healthy", duration_ms: 3, detail_code: "query_completed" },
  { id: "migrations", label: "Migrations", kind: "schema", required: true, status: "healthy", duration_ms: 1, detail_code: "required_migrations_applied" },
];

describe("system health client boundary", () => {
  it("derives the summary from components instead of trusting a healthy claim", () => {
    const parsed = parseSystemHealth({
      contract_version: CONTRACT_VERSION,
      schema_version: "system-health.v1",
      status: "healthy",
      observed_at: "2026-09-14T09:00:00.000Z",
      components: components.map((item) =>
        item.id === "migrations" ? { ...item, status: "degraded" } : item,
      ),
    });
    expect(parsed?.status).toBe("degraded");
  });

  it("rejects missing, duplicated, and malformed component observations", () => {
    const base = {
      contract_version: CONTRACT_VERSION,
      schema_version: "system-health.v1",
      status: "healthy",
      observed_at: "2026-09-14T09:00:00.000Z",
    };
    expect(parseSystemHealth({ ...base, components: components.slice(1) })).toBeNull();
    expect(parseSystemHealth({ ...base, components: [...components.slice(0, 3), components[0]] })).toBeNull();
    expect(parseSystemHealth({ ...base, components: components.map((item, index) => index ? item : { ...item, duration_ms: -1 }) })).toBeNull();
  });

  it("preserves a sanitized backend revision and omits an invalid one", () => {
    const base = {
      contract_version: CONTRACT_VERSION,
      schema_version: "system-health.v1",
      status: "healthy",
      observed_at: "2026-09-14T09:00:00.000Z",
      components,
    };
    expect(parseSystemHealth({ ...base, backend_revision: "26a664bb" })?.backend_revision).toBe("26a664bb");
    expect(parseSystemHealth({ ...base, backend_revision: "ABCDEF0" })?.backend_revision).toBe("abcdef0");
    expect(parseSystemHealth(base)?.backend_revision).toBeUndefined();
    for (const invalid of ["bad value!", "26a664bb.dirty", "not-a-sha", "abc123", "a".repeat(41)]) {
      const parsed = parseSystemHealth({ ...base, backend_revision: invalid });
      expect(parsed?.backend_revision, invalid).toBeUndefined();
      // A malformed optional revision must not fail the whole observation.
      expect(parsed?.status).toBe("healthy");
    }
  });

  it("keeps unknown and unavailable distinct and detects stale evidence", () => {
    expect(summarizeSystemHealth(components.map((item) => item.id === "database" ? { ...item, status: "unknown" } : item))).toBe("degraded");
    expect(summarizeSystemHealth(components.map((item) => item.id === "database" ? { ...item, status: "unavailable" } : item))).toBe("unavailable");
    expect(systemHealthIsStale("2026-09-14T09:00:00.000Z", Date.parse("2026-09-14T09:01:59.000Z"))).toBe(false);
    expect(systemHealthIsStale("2026-09-14T09:00:00.000Z", Date.parse("2026-09-14T09:02:01.000Z"))).toBe(true);
    expect(systemHealthIsStale("2026-09-14T09:00:31.000Z", Date.parse("2026-09-14T09:00:00.000Z"))).toBe(true);
  });
});
