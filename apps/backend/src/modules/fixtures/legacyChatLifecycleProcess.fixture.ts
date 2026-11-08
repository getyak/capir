/** Test-only, real Node/HTTP/PG host. No product fault switch is introduced.
 * IPC carries only finite states, a loopback port and a synthetic RPC count.
 * stdout/stderr are discarded by the owning test, never archived as evidence. */
import { Pool, type PoolClient } from "pg";
import { buildApp } from "../../app.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "../chatAnswerProvider.js";

export type ProcessPhase = "normal" | "admission_committed" | "dispatch_committed"
  | "rpc_entered" | "ready_committed" | "final_committed";
export type ProcessState = ProcessPhase | "listening" | "calls" | "closed" | "fixture_error";
export interface ProcessNotice { state: ProcessState; port?: number; calls?: number }

const phases: readonly ProcessPhase[] = ["normal", "admission_committed", "dispatch_committed",
  "rpc_entered", "ready_committed", "final_committed"];
const fail = (): never => { throw new Error("Synthetic process fixture setup failed."); };
function setup() {
  if (!process.send) return fail();
  const database = process.env.GET449_PROCESS_DATABASE, phase = process.env.GET449_PROCESS_PHASE;
  if (!database || !phases.includes(phase as ProcessPhase)) return fail();
  let parsed: URL;
  try { parsed = new URL(database); } catch { return fail(); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci"
    || parsed.search || parsed.hash) return fail();
  return { database, phase: phase as ProcessPhase };
}
function notice(value: ProcessNotice): void {
  // Do not send auth, keys, request/response bodies, errors, SQL, IDs or proofs.
  if (process.connected) process.send?.(value);
}
function disconnect(): void {
  if (!process.disconnect) return fail();
  process.disconnect();
}
const never = () => new Promise<never>(() => {});

async function main(): Promise<void> {
  const { database, phase } = setup();
  const actualPool = new Pool({ connectionString: database, max: 1, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  // This is an unexpected failure, not something a test can count as a crash
  // window. Do not forward a PG error/detail containing private row material.
  actualPool.on("error", () => { notice({ state: "fixture_error" }); });
  let calls = 0, held = false;
  const pool = new Proxy(actualPool, { get(target, key) {
    if (key !== "connect") {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
    return async () => {
      const client = await target.connect();
      let transactionPhase: ProcessPhase | undefined;
      return new Proxy(client, { get(owner, name) {
        if (name !== "query") {
          const value = Reflect.get(owner, name, owner);
          return typeof value === "function" ? value.bind(owner) : value;
        }
        return (...args: unknown[]) => {
          const sql = typeof args[0] === "string" ? args[0] : "";
          if (sql === "BEGIN") transactionPhase = undefined;
          if (sql.startsWith("INSERT INTO legacy_chat_executions(")) transactionPhase = "admission_committed";
          if (sql.includes("SET state='dispatch_started',")) transactionPhase = "dispatch_committed";
          if (sql.includes("SET state='result_ready',checkpoint=")) transactionPhase = "ready_committed";
          if (sql.includes("SET state='completed',completed_at=")) transactionPhase = "final_committed";
          const result = Reflect.apply(owner.query, owner, args);
          if (sql === "COMMIT" && transactionPhase === phase && !held) {
            // A callback/Query object is not proof of an acknowledged COMMIT.
            // All production transactions exercised here await pg's Promise.
            if (!result || typeof result.then !== "function") return fail();
            return Promise.resolve(result).then(async value => {
              held = true;
              // PostgreSQL has actually committed before the parent is told.
              // The awaiting product owner never receives this ACK and will
              // be killed; no thrown COMMIT is mislabeled as rollback.
              notice({ state: phase, calls });
              await never();
              return value;
            });
          }
          return result;
        };
      } }) as PoolClient;
    };
  } });
  const provider: RemoteChatAnswerProviding = {
    providerId: "deepseek-chat-completions", model: "synthetic-process-recovery", supportsImageInput: false,
    answer: async (): Promise<RemoteChatAnswerResult> => {
      calls += 1;
      notice({ state: "rpc_entered", calls });
      if (phase === "rpc_entered") await never();
      return { kind: "answer", title: "Synthetic process reply", body: "Synthetic process durable answer.",
        citation_ids: [], provider_id: "deepseek-chat-completions", model: provider.model,
        provider_request_id: null, input_tokens: 1, output_tokens: 1 };
    },
  };
  const app = await buildApp({ pool, config: { databaseUrl: database, host: "127.0.0.1", port: 0,
    allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
    passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: false,
    retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
    remoteChatProvider: provider, personResearchProvider: null, privateConversationProvider: null,
    labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
    labCIVerifier: null, screenshotContact: null });
  // This runs the real application's onReady janitor before accepting HTTP.
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") return fail();
  notice({ state: "listening", port: address.port, calls });
  let closing = false;
  process.on("message", (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== 1 || !("state" in value)) return;
    if (value.state === "call_count") notice({ state: "calls", calls });
    if (value.state === "shutdown" && !closing) {
      closing = true;
      void app.close().then(() => actualPool.end()).then(() => {
        notice({ state: "closed", calls });
        disconnect();
      }).catch(() => { notice({ state: "fixture_error" }); process.exitCode = 1; disconnect(); });
    }
  });
}

void main().catch(() => {
  notice({ state: "fixture_error" });
  // A failed startup must not retain its own Pool/process. No private error is
  // printed; parent diagnoses only this finite classification and exit status.
  process.exit(1);
});
