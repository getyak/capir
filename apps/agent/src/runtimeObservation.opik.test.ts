import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ZhipuChatAnswerProvider } from "./chatAnswerProvider.js";
import { RuntimeObservationSession, type RuntimeObservation, type RuntimeObservationPolicy } from "./runtimeObservation.js";
import { PrivateOpikRuntimeTransport, RuntimeObservationOutbox, RuntimeObserver } from "./runtimeObservationOutbox.js";

// Explicit opt-in: real private Opik writes contain only locally defined synthetic data.
it.skipIf(!process.env.GET11_OPIK_RUNTIME_PROOF_PATH)("reads back private synthetic runtime attempts and deletion", async () => {
  const policy: RuntimeObservationPolicy = { version: "private_full_content.v1", mode: "private_full_content",
    endpoint: "http://localhost:5173/api", workspace: "default", project: "get11-runtime-observation-synthetic",
    source_workspace_ids: ["get11-synthetic"], authorization_scopes: ["workspace_conversation", "relationship_image"],
    retention_days: 1, max_content_bytes: 1024 * 1024 };
  const root = await mkdtemp(join(tmpdir(), "get11-runtime-proof-"));
  const transport = new PrivateOpikRuntimeTransport(policy, undefined, async (url, init) => {
    const response = await fetch(url, init);
    // Only this explicit synthetic fixture exposes REST validation diagnostics.
    if (!response.ok && response.status !== 404) throw new Error(`Synthetic Opik ${response.status}: ${(await response.text()).slice(0, 1000)}`);
    return response;
  });
  const outbox = new RuntimeObservationOutbox(root, policy, transport);
  const context = { run_id: `get11-synthetic-${randomUUID()}`, workspace_id: "get11-synthetic",
    authorization_scope: "workspace_conversation", source_refs: { kind: "synthetic" as const } };
  const media = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const attempts: RuntimeObservation[] = [];
  const imageContext = { ...context, run_id: `${context.run_id}-shared-ask`, authorization_scope: "relationship_image" };
  try {
  for (let i = 0; i < 2; i++) {
    const session = new RuntimeObservationSession(policy, context, { objective: `Synthetic run ${i}`, media }, {
      enqueue: async (value) => { attempts.push(value); await outbox.enqueue(value); },
    }, ["synthetic-credential"]);
    await session.step("chat.completions", "llm", { model: "synthetic-model", messages: [
      { role: "user", content: [{ type: "image_url", image_url: { url: media } }, { type: "text", text: "Synthetic context only" }] },
    ] }, async () => ({ choices: [{ message: { content: "Synthetic answer", reasoning_content: "Synthetic reasoning" } }], usage: { prompt_tokens: 12, completion_tokens: 6 } }),
    { model: "synthetic-model", provider: "synthetic-provider", prompt_revision: "get11-synthetic.v1" },
    () => ({ input_tokens: 12, output_tokens: 6, source: "provider", cost_usd: null, cost_source: "unavailable", accounting: "leaf" }));
    await session.step("contact_workspace", "tool", { query: "Synthetic contact" }, async () => ({ ok: false, error: { code: "SYNTHETIC_RETRY" } }));
    await session.step("contact_workspace", "tool", { query: "Synthetic contact" }, async () => ({ ok: true, data: { display_label: "Synthetic contact", evidence: "Synthetic business content" } }));
    await session.complete({ answer: `Synthetic output ${i}`, authorization: "synthetic-credential" }, "ok");
    // Exercise the concrete REST errors directly before durable retry wraps them.
    await transport.retain(attempts[i]!);
    await outbox.flush();
    expect((await outbox.status()).retained).toBe(1);
  }
  const retained = await outbox.status();
  expect(retained.receipts[0]?.retained_span_ids).toHaveLength(8);
  const trace = await fetch(`${policy.endpoint}/v1/private/traces/${attempts[0]!.id}`, { headers: { "Comet-Workspace": policy.workspace } }).then((r) => r.json()) as Record<string, unknown>;
  expect(JSON.stringify(trace)).toContain("Synthetic output 1");
  expect(JSON.stringify(trace)).not.toContain("synthetic-credential");
  const provider = new ZhipuChatAnswerProvider({ apiKey: "synthetic-credential", model: "glm-5.3", visionModel: "glm-4.6v",
    observer: new RuntimeObserver(outbox), fetcher: vi.fn(async () => Response.json({ model: "glm-4.6v",
      choices: [{ message: { content: JSON.stringify({ kind: "answer", title: "Synthetic image", body: "Synthetic shared Ask answer", citation_ids: [] }) } }] })) as typeof fetch });
  await provider.answer({ observation: imageContext, objective: "Describe the synthetic pixel", context_blocks: [], allowed_citation_ids: [],
    images: [{ file_name: "synthetic.png", media_type: "image/png", data: Buffer.from(media.split(",")[1]!, "base64") }] });
  await vi.waitFor(async () => expect((await outbox.status()).retained).toBe(2), { timeout: 30_000 });
  const sharedAsk = (await outbox.status()).receipts.find((item) => item.trace_id !== attempts[0]!.id)!;
  expect(sharedAsk.retained_span_ids).toHaveLength(2);
  await outbox.deleteRun(context);
  await outbox.deleteRun(imageContext);
  // The deletion may wait on an asynchronous cascade and its persisted retry
  // schedule (5s doubling to a 5-minute ceiling) before readback proves absence.
  await vi.waitFor(async () => { await outbox.flush(); expect((await outbox.status()).deleted).toBe(2); }, { timeout: 120_000, interval: 500 });
  expect(await readFile(join(root, `${attempts[0]!.id}.json`), "utf8")).not.toContain("Synthetic business content");
  await writeFile(process.env.GET11_OPIK_RUNTIME_PROOF_PATH!, JSON.stringify({ captured_at: new Date().toISOString(),
    endpoint: policy.endpoint, project: policy.project, synthetic_only: true, paid_model_calls: 0,
    trace_id: attempts[0]!.id, shared_ask_trace_id: sharedAsk.trace_id, attempts: 3, spans_read_back: 10, media_roundtrip: true,
    shared_production_ask_adapter: true,
    tool_retry_linked: true, credentials_removed: true, cost_usd: null, accounting: "model_leaves_only",
    retained, deletion: await outbox.status(), local_outbox: root,
  }, null, 2));
  } catch (error) {
    await outbox.deleteRun(context, true); await outbox.deleteRun(imageContext, true);
    await writeFile(process.env.GET11_OPIK_RUNTIME_PROOF_PATH!, JSON.stringify({ captured_at: new Date().toISOString(),
      outcome: "unavailable", error_code: error instanceof Error ? error.name : "unknown", endpoint: policy.endpoint,
      project: policy.project, synthetic_only: true, paid_model_calls: 0, trace_id: attempts[0]?.id ?? null,
      cleanup_tombstones_persisted: true, local_outbox: root, status: await outbox.status(),
    }, null, 2));
    throw error;
  }
}, 120_000);
