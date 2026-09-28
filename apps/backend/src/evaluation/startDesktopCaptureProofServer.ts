import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import type { AgentProviderRequest, AgentProviderResult } from "@talent-signal/agent";
import type { BackendConfig } from "../config.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerRequest } from "../modules/chatAnswerProvider.js";

/** Disposable loopback proof host. It can never contact a live model. */
const databaseURL = process.env.DESKTOP_CAPTURE_PROOF_DATABASE_URL;
assert(databaseURL && process.env.DESKTOP_CAPTURE_PROOF_DISPOSABLE === "true",
  "An explicitly disposable database is required.");
const database = new URL(databaseURL);
assert(database.protocol === "postgresql:" && database.hostname === "127.0.0.1" &&
  database.pathname === "/ts_capture_e2e" && !database.search && !database.hash,
  "The desktop capture proof can use only its disposable loopback database.");
assert(process.env.DATABASE_URL === databaseURL, "Backend and proof database URLs must match.");
assert(process.env.NODE_ENV !== "production", "The proof host cannot run in production.");
const webOrigin = new URL(process.env.DESKTOP_CAPTURE_PROOF_WEB_URL ?? "");
assert(webOrigin.protocol === "http:" && webOrigin.hostname === "127.0.0.1" &&
  !webOrigin.username && !webOrigin.password && !webOrigin.search && !webOrigin.hash,
  "The paired Web host must be an explicit disposable loopback origin.");
const port = Number(process.env.PORT);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, "An explicit loopback API port is required.");
// Do not let ambient credentials, telemetry policy, object storage or CI tokens
// turn this disposable proof into a live external integration. This process is
// intentionally independent of the operator's normal backend environment.
const externalPrefixes = [
  "TALENT_SIGNAL_", "OPIK_", "OTEL_", "AWS_", "RESEND_", "GITHUB_", "GH_",
  "ANTHROPIC_", "ZHIPU_", "DOUBAO_", "CHAT_MEDIA_", "OPENAI_", "OPENROUTER_",
  "ARK_", "HAO_", "GEMINI_", "GOOGLE_", "AZURE_", "AUTH_GOOGLE_", "AUTH_APPLE_",
];
for (const key of Object.keys(process.env)) {
  if (externalPrefixes.some(prefix => key.startsWith(prefix))) {
    delete process.env[key];
  }
}
process.env.LOG_LEVEL = "silent";
process.env.TALENT_SIGNAL_BACKEND_REVISION = "desktop-capture-disposable-proof";
const config: BackendConfig = {
  databaseUrl: databaseURL, host: "127.0.0.1", port, allowedOrigins: [webOrigin.origin],
  appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
  passwordRegistrationEnabled: false, simulatedAuthEnabled: true, internalLabEnabled: false,
  retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3600,
  chatMediaStorage: { provider: "local", directory: `/private/tmp/ts-capture-proof-media-${port}` },
};
const pool = new Pool({ connectionString: databaseURL, max: 8 });
const accounts = await pool.query<{ slug: string }>("SELECT slug FROM accounts");
assert(accounts.rows.length === 2 && accounts.rows.every(row =>
  ["fixture-alpha", "fixture-beta"].includes(row.slug)), "Only the seeded disposable fixture accounts are permitted.");
const existing = await pool.query<{ sessions: string; entries: string }>(
  "SELECT (SELECT count(*) FROM agent_sessions)::text AS sessions, " +
  "(SELECT count(*) FROM conversation_queue_entries)::text AS entries");
assert(existing.rows[0]?.sessions === "0" && existing.rows[0]?.entries === "0",
  "The proof requires a freshly seeded database with no prior Session or queue data.");
let imageRuns = 0;
const provider: RemoteChatAnswerProviding & {
  run(request: AgentProviderRequest, invokeTool: unknown, signal: AbortSignal): Promise<AgentProviderResult>;
} = {
  providerId: "claude-agent-sdk",
  model: "synthetic-desktop-capture-proof",
  supportsImageInput: true,
  async answer(_request: RemoteChatAnswerRequest) {
    throw new Error("The desktop capture proof requires the canonical governed queue runner.");
  },
  async run(request: AgentProviderRequest, _invokeTool: unknown, signal: AbortSignal): Promise<AgentProviderResult> {
    signal.throwIfAborted();
    const images = request.inputParts?.filter((part) => part.kind === "image") ?? [];
    assert.equal(images.length, 1, "Exactly one selected image must reach the Agent runner.");
    const image = images[0]!;
    const pixels = Buffer.from(image.dataBase64, "base64");
    assert.equal(pixels.length, image.byteSize);
    assert.equal(createHash("sha256").update(pixels).digest("hex"), image.contentHash);
    imageRuns += 1;
    process.stdout.write(JSON.stringify({ proof: "desktop-capture-image-run", imageRuns,
      byteSize: image.byteSize, contentHash: image.contentHash }) + "\n");
    return { structuredOutput: { outcome: "reply", title: "Synthetic capture received",
      body: "The local proof Agent received exactly the selected synthetic image." },
      inputTokens: 1, outputTokens: 1, estimatedUsd: 0, turns: 1, permissionDenials: [] };
  },
};

const { buildApp } = await import("../app.js");
const app = await buildApp({ config, pool, remoteChatProvider: provider,
  labProviders: new Map(), labCIVerifier: null, labJobWorkerEnabled: false,
  personResearchProvider: null, screenshotContact: null, privateConversationProvider: null,
  voiceTranscriber: { async transcribe() { throw new Error("Disposable proof has no voice service."); } },
  mail: { kind: "test-sink", async send() { throw new Error("Disposable proof has no mail service."); } },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void (async () => { await app.close(); await pool.end(); process.exit(0); })();
});
await app.listen({ host: config.host, port: config.port });
process.stdout.write(JSON.stringify({ proof: "desktop-capture-loopback", port: config.port,
  model: provider.model, realProvider: false }) + "\n");
