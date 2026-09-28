import {
  CONTRACT_VERSION,
  ErrorResponseSchema,
  isGitRevision,
  SystemHealthResponseSchema,
  type SystemHealthComponent,
  type SystemHealthResponse,
} from "@talent-signal/contracts";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";

export const REQUIRED_SYSTEM_MIGRATIONS = [
  "058_account_management",
  "065_screenshot_directory_authority",
  "069_account_access_event_details",
  "070_meeting_drafts",
  "071_agent_session_list_snapshots",
  "072_mcp_extensions",
  "073_conversation_queue",
  "073_account_onboarding",
  "074_time_workspace",
  "075_conversation_message_images",
  "076_memory_review",
  "077_memory_review_corrections",
  "078_memory_review_hardening",
  "079_memory_source_authority",
] as const;

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/**
 * One overall observation budget, matching the Web server-to-backend bound in
 * `docs/operations/system-health.md`. A stalled dependency (an unreachable
 * PostgreSQL host can block `pool.connect()` forever) must never leave the
 * health surface permanently pending.
 */
export const SYSTEM_HEALTH_OBSERVATION_TIMEOUT_MS = 4_000;

export function boundedHealthObservation<T>(
  work: Promise<T>,
  deadlineAt: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      work.then(() => undefined, () => undefined);
      reject(new Error("SYSTEM_HEALTH_OBSERVATION_TIMEOUT"));
      return;
    }
    const timer = setTimeout(
      () => reject(new Error("SYSTEM_HEALTH_OBSERVATION_TIMEOUT")),
      remaining,
    );
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function component(
  value: Omit<SystemHealthComponent, "required">,
): SystemHealthComponent {
  return { ...value, required: true };
}

/**
 * The deployed revision is optional. A missing or nonstandard value stays
 * unknown instead of being echoed into an authenticated response.
 */
export function backendRevisionFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = environment.TALENT_SIGNAL_BACKEND_REVISION?.trim();
  return isGitRevision(value) ? value.toLowerCase() : undefined;
}

function healthResponse(
  status: SystemHealthResponse["status"],
  components: SystemHealthComponent[],
  observedAt: string,
  backendRevision: string | undefined,
): SystemHealthResponse {
  return {
    contract_version: CONTRACT_VERSION,
    schema_version: "system-health.v1",
    status,
    observed_at: observedAt,
    ...(backendRevision ? { backend_revision: backendRevision } : {}),
    components,
  };
}

export async function observeSystemHealth(
  pool: Pick<Pool, "query">,
  now: () => Date = () => new Date(),
  timeoutMs: number = SYSTEM_HEALTH_OBSERVATION_TIMEOUT_MS,
): Promise<SystemHealthResponse> {
  const deadlineAt = Date.now() + timeoutMs;
  const backendRevision = backendRevisionFromEnvironment();
  const components: SystemHealthComponent[] = [
    component({
      id: "backend",
      label: "Backend API",
      kind: "service",
      status: "healthy",
      duration_ms: 0,
      detail_code: "request_completed",
    }),
  ];

  const databaseStartedAt = performance.now();
  try {
    await boundedHealthObservation(
      pool.query("SELECT 1 AS system_health_ready"),
      deadlineAt,
    );
    components.push(
      component({
        id: "database",
        label: "PostgreSQL",
        kind: "database",
        status: "healthy",
        duration_ms: elapsedMilliseconds(databaseStartedAt),
        detail_code: "query_completed",
      }),
    );
  } catch {
    components.push(
      component({
        id: "database",
        label: "PostgreSQL",
        kind: "database",
        status: "unavailable",
        duration_ms: elapsedMilliseconds(databaseStartedAt),
        detail_code: "dependency_unreachable",
      }),
      component({
        id: "migrations",
        label: "Database schema",
        kind: "schema",
        status: "unknown",
        duration_ms: null,
        detail_code: "not_observed",
      }),
    );
    return healthResponse("unavailable", components, now().toISOString(), backendRevision);
  }

  const migrationsStartedAt = performance.now();
  try {
    const result = await boundedHealthObservation(
      pool.query<{ version: string }>(
        `SELECT version
       FROM schema_migrations
       WHERE version = ANY($1::text[])`,
        [REQUIRED_SYSTEM_MIGRATIONS],
      ),
      deadlineAt,
    );
    const applied = new Set(result.rows.map((row) => row.version));
    const complete = REQUIRED_SYSTEM_MIGRATIONS.every((version) =>
      applied.has(version),
    );
    components.push(
      component({
        id: "migrations",
        label: "Database schema",
        kind: "schema",
        status: complete ? "healthy" : "degraded",
        duration_ms: elapsedMilliseconds(migrationsStartedAt),
        detail_code: complete
          ? "required_migrations_applied"
          : "required_migrations_missing",
      }),
    );
    return healthResponse(
      complete ? "healthy" : "degraded",
      components,
      now().toISOString(),
      backendRevision,
    );
  } catch {
    components.push(
      component({
        id: "migrations",
        label: "Database schema",
        kind: "schema",
        status: "unavailable",
        duration_ms: elapsedMilliseconds(migrationsStartedAt),
        detail_code: "dependency_unreachable",
      }),
    );
    return healthResponse("unavailable", components, now().toISOString(), backendRevision);
  }
}

export function registerSystemHealthRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
): void {
  app.get(
    "/v1/system/health",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags: ["operations"],
        security: [{ bearerSession: [] }],
        response: {
          200: SystemHealthResponseSchema,
          "4xx": ErrorResponseSchema,
          "5xx": ErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
      reply.header("pragma", "no-cache");
      reply.header("vary", "authorization");
      return observeSystemHealth(pool);
    },
  );
}
