import {
  CONTRACT_VERSION,
  isGitRevision,
  type SystemHealthComponent,
  type SystemHealthResponse,
  type SystemHealthStatus,
} from "@talent-signal/contracts";

const componentIds = new Set(["web", "backend", "database", "migrations"]);
const statuses = new Set(["healthy", "degraded", "unavailable", "unknown"]);
const kinds = new Set(["service", "database", "schema"]);
const detailCodes = new Set([
  "request_completed",
  "query_completed",
  "required_migrations_applied",
  "required_migrations_missing",
  "dependency_unreachable",
  "not_observed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isComponent(value: unknown): value is SystemHealthComponent {
  const item = record(value);
  return Boolean(
    item &&
      typeof item.id === "string" &&
      componentIds.has(item.id) &&
      typeof item.label === "string" &&
      item.label.length > 0 &&
      kinds.has(String(item.kind)) &&
      item.required === true &&
      statuses.has(String(item.status)) &&
      (item.duration_ms === null ||
        (Number.isInteger(item.duration_ms) && Number(item.duration_ms) >= 0)) &&
      detailCodes.has(String(item.detail_code)),
  );
}

export function summarizeSystemHealth(
  components: SystemHealthComponent[],
): Exclude<SystemHealthStatus, "unknown"> {
  if (components.some((item) => item.status === "unavailable")) {
    return "unavailable";
  }
  if (
    components.some(
      (item) => item.status === "degraded" || item.status === "unknown",
    )
  ) {
    return "degraded";
  }
  return "healthy";
}

export function parseSystemHealth(value: unknown): SystemHealthResponse | null {
  const payload = record(value);
  if (
    !payload ||
    payload.schema_version !== "system-health.v1" ||
    payload.contract_version !== CONTRACT_VERSION ||
    typeof payload.observed_at !== "string" ||
    Number.isNaN(Date.parse(payload.observed_at)) ||
    !Array.isArray(payload.components) ||
    payload.components.length !== 4 ||
    !payload.components.every(isComponent)
  ) {
    return null;
  }
  const components = payload.components as SystemHealthComponent[];
  if (new Set(components.map((item) => item.id)).size !== 4) return null;
  const backendRevision = isGitRevision(payload.backend_revision)
    ? payload.backend_revision.toLowerCase()
    : undefined;
  return {
    contract_version: CONTRACT_VERSION,
    schema_version: "system-health.v1",
    status: summarizeSystemHealth(components),
    observed_at: payload.observed_at,
    ...(backendRevision ? { backend_revision: backendRevision } : {}),
    components,
  };
}

export function unavailableSystemHealth(
  observedAt = new Date(),
): SystemHealthResponse {
  return {
    contract_version: CONTRACT_VERSION,
    schema_version: "system-health.v1",
    status: "unavailable",
    observed_at: observedAt.toISOString(),
    components: [
      { id: "web", label: "Talent Signal Web", kind: "service", required: true, status: "healthy", duration_ms: null, detail_code: "request_completed" },
      { id: "backend", label: "Backend API", kind: "service", required: true, status: "unavailable", duration_ms: null, detail_code: "dependency_unreachable" },
      { id: "database", label: "PostgreSQL", kind: "database", required: true, status: "unknown", duration_ms: null, detail_code: "not_observed" },
      { id: "migrations", label: "Database schema", kind: "schema", required: true, status: "unknown", duration_ms: null, detail_code: "not_observed" },
    ],
  };
}

export function systemHealthIsStale(
  observedAt: string,
  now = Date.now(),
  thresholdMs = 2 * 60_000,
  futureSkewMs = 30_000,
): boolean {
  const observed = Date.parse(observedAt);
  return (
    Number.isNaN(observed) ||
    now - observed > thresholdMs ||
    observed - now > futureSkewMs
  );
}
