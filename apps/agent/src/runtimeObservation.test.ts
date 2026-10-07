import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { ZhipuChatAnswerProvider } from "./chatAnswerProvider.js";
import { RuntimeObservationPolicySchema, RuntimeObservationSchema, RuntimeObservationSession, captureObservationContent, observationHash, observationID,
  type RuntimeObservation, type RuntimeObservationPolicy } from "./runtimeObservation.js";
import { RuntimeObservationOutbox, RuntimeObserver, PrivateOpikRuntimeTransport, createEnvironmentRuntimeObserver,
  type RuntimeObservationTransport } from "./runtimeObservationOutbox.js";
const policy: RuntimeObservationPolicy = {
  version: "private_full_content.v1", mode: "private_full_content", endpoint: "http://localhost:5173/api",
  workspace: "default", project: "get11-runtime-test", source_workspace_ids: ["workspace-test"],
  authorization_scopes: ["relationship_text", "workspace_conversation"], retention_days: 1, max_content_bytes: 1024 * 1024,
};
const context = { run_id: "run-test", workspace_id: "workspace-test", authorization_scope: "relationship_text", source_refs: { kind: "synthetic" as const } };
const projectID = "10000000-0000-4000-8000-000000000042";
// A realistic Opik 2.2.45 deletion surface: paged partial project search, the
// project-scoped batch trace delete, and an asynchronous child cascade. The
// unimplemented (501) individual span delete is present and must never be used.
function opikDeleteAPI(options: { projects?: Array<{ id: string; name: string }>; cascadeAfterReads?: number;
  leaveSpan?: string; traceAbsent?: boolean; failDelete?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  let deletedAtReads: number | null = null;
  let reads = 0;
  const cascadeVisible = () => deletedAtReads !== null && reads >= deletedAtReads + (options.cascadeAfterReads ?? 0);
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const path = target.split("/v1/private/").at(-1)!;
    const method = init?.method ?? "GET";
    requests.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (path.startsWith("projects?")) {
      const query = new URL(target).searchParams;
      const name = query.get("name") ?? "";
      const page = Number(query.get("page")), size = Number(query.get("size"));
      const content = (options.projects ?? []).filter((item) => item.name.toLowerCase().includes(name.toLowerCase()))
        .map((item) => ({ id: item.id, name: item.name, description: null, created_at: "2026-01-01T00:00:00.000Z",
          created_by: "synthetic@example.test", last_updated_at: "2026-01-01T00:00:00.000Z",
          last_updated_by: "synthetic@example.test", visibility: "private" }))
        .slice((page - 1) * size, page * size);
      return Response.json({ page, size, total: (options.projects ?? []).length, content });
    }
    if (path === "traces/delete" && method === "POST") {
      if (options.failDelete) return new Response(null, { status: 503 });
      if (deletedAtReads === null) deletedAtReads = reads;
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && path.startsWith("traces/")) {
      reads++;
      return options.traceAbsent || cascadeVisible() ? new Response(null, { status: 404 })
        : Response.json({ id: path.slice("traces/".length) });
    }
    if (method === "GET" && path.startsWith("spans/")) {
      reads++;
      const id = path.slice("spans/".length);
      return !cascadeVisible() || id === options.leaveSpan ? Response.json({ id, trace_id: "synthetic-trace" })
        : new Response(null, { status: 404 });
    }
    if (method === "DELETE" && path.startsWith("spans/")) return new Response(null, { status: 501 });
    return new Response(null, { status: 500 });
  }) as typeof fetch;
  return { fetcher, requests };
}
async function observation(): Promise<RuntimeObservation> {
  let value: RuntimeObservation | undefined;
  const session = new RuntimeObservationSession(policy, context, { objective: "synthetic input" }, { enqueue: async (result) => { value = result; } });
  await session.step("model", "llm", { content: "synthetic message" }, async () => ({ content: "synthetic answer" }));
  await session.complete({ answer: "synthetic answer" }, "ok");
  return value!;
}
async function setup(transport: RuntimeObservationTransport = { retain: async () => {}, remove: async () => {} }) {
  const root = await mkdtemp(join(tmpdir(), "runtime-observation-"));
  return { root, outbox: new RuntimeObservationOutbox(root, policy, transport) };
}
describe("private runtime observation", () => {
  it("is disabled by default and rejects cloud, redirect-shaped, and out-of-scope destinations", () => {
    expect(createEnvironmentRuntimeObserver({})).toBeNull();
    expect(RuntimeObservationPolicySchema.safeParse({ ...policy, endpoint: "http://host.docker.internal:5173/api" }).success).toBe(true);
    expect(RuntimeObservationPolicySchema.safeParse({ ...policy, endpoint: "http://opik-frontend:5173/api" }).success).toBe(true);
    for (const endpoint of ["http://opik-frontend:80/api", "http://opik-frontend.evil:5173/api", "https://www.comet.com/opik/api", "http://localhost:5173/api?forward=cloud", "http://user:secret@localhost:5173/api", "http://internal.example/api", "http://host.docker.internal.example/api"]) {
      expect(RuntimeObservationPolicySchema.safeParse({ ...policy, endpoint }).success).toBe(false);
    }
    expect(() => new RuntimeObservationSession(policy, { ...context, workspace_id: "another-account" }, {}, { enqueue: async () => {} })).toThrow("SCOPE_DENIED");
  });
  it("reuses the process transport only for the same credential and stops its timer on rotation or disable", () => {
    const flush = vi.spyOn(RuntimeObservationOutbox.prototype, "flush").mockResolvedValue(undefined);
    const dispose = vi.spyOn(RuntimeObserver.prototype, "dispose");
    vi.stubEnv("TALENT_SIGNAL_OPIK_RUNTIME_POLICY", JSON.stringify(policy));
    vi.stubEnv("TALENT_SIGNAL_OPIK_RUNTIME_OUTBOX", join(tmpdir(), "synthetic-cache-only"));
    vi.stubEnv("OPIK_API_KEY", "synthetic-credential-one");
    try {
      const first = createEnvironmentRuntimeObserver()!;
      expect(createEnvironmentRuntimeObserver()).toBe(first);
      expect(flush).toHaveBeenCalledOnce();
      vi.stubEnv("OPIK_API_KEY", "synthetic-credential-two");
      const rotated = createEnvironmentRuntimeObserver()!;
      expect(rotated).not.toBe(first);
      expect(dispose).toHaveBeenCalledOnce();
      expect(dispose.mock.instances[0]).toBe(first);
      expect(createEnvironmentRuntimeObserver()).toBe(rotated);
      vi.stubEnv("OPIK_API_KEY", undefined);
      const noCredential = createEnvironmentRuntimeObserver()!;
      expect(noCredential).not.toBe(rotated);
      expect(dispose.mock.instances[1]).toBe(rotated);
      expect(createEnvironmentRuntimeObserver()).toBe(noCredential);
      vi.stubEnv("TALENT_SIGNAL_OPIK_RUNTIME_POLICY", "");
      expect(createEnvironmentRuntimeObserver()).toBeNull();
      expect(dispose.mock.instances[2]).toBe(noCredential);
      vi.stubEnv("TALENT_SIGNAL_OPIK_RUNTIME_POLICY", JSON.stringify(policy));
      expect(createEnvironmentRuntimeObserver()).not.toBe(noCredential);
    } finally {
      vi.stubEnv("TALENT_SIGNAL_OPIK_RUNTIME_POLICY", "");
      createEnvironmentRuntimeObserver();
      vi.unstubAllEnvs(); dispose.mockRestore(); flush.mockRestore();
    }
  });
  it("retains authorized business content but removes credentials and marks omitted media explicitly", () => {
    const value = captureObservationContent({ text: "salary discussion", api_key: "credential", nested: { authorization: "Bearer hidden" }, output: "known-api-key" }, 1024, ["known-api-key"]);
    expect(value.status).toBe("redacted");
    expect(JSON.stringify(value)).toContain("salary discussion");
    expect(JSON.stringify(value)).not.toContain("known-api-key");
    expect(JSON.stringify(value)).not.toContain('"credential"');
    const media = captureObservationContent({ image: "x".repeat(2000) }, 1024);
    expect(media).toMatchObject({ status: "truncated", retained_bytes: 0 });
    expect(media.value).toBeUndefined();
  });
  it("does not capture a product request without host-owned source lineage", async () => {
    const { outbox } = await setup(); const observer = new RuntimeObserver(outbox);
    expect(observer.start({ run_id: context.run_id, workspace_id: context.workspace_id,
      authorization_scope: context.authorization_scope }, { raw: "must not persist" })).toBeNull();
    expect(observer.last_error_code).toBe("RUNTIME_OBSERVATION_SOURCE_LINEAGE_REQUIRED");
    expect(await outbox.sourceRuns()).toEqual([]);
  });
  it("tombstones a source revoked during export instead of retaining a stale body", async () => {
    let available = true;
    const retain = vi.fn(async () => { available = false; }), remove = vi.fn();
    const { root, outbox } = await setup({ retain, remove });
    outbox.setSourceValidator(async () => available);
    const session = new RuntimeObservationSession(policy, { ...context, source_session_id: "session-test", source_refs: {
      kind: "product", capture_ids: [], fragment_ids: [], media_ids: [], person_ids: [], relationship_context_ids: [],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } }, { text: "synthetic revocable content" }, outbox);
    await session.complete({ text: "synthetic derived output" }, "ok"); await outbox.flush();
    expect((await outbox.status()).deletion_pending).toBe(1);
    expect(await readFile(join(root, `${session.id}.json`), "utf8")).not.toContain("synthetic revocable content");
    await outbox.flush(); expect((await outbox.status()).deleted).toBe(1);
    expect(retain).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
  });
  it("revalidates retained sources during the background flush without another product request", async () => {
    let available = true;
    const remove = vi.fn(); const { outbox } = await setup({ retain: async () => {}, remove });
    outbox.setSourceValidator(async () => available);
    const session = new RuntimeObservationSession(policy, { ...context, source_regression_id: "10000000-0000-4000-8000-000000000001",
      source_refs: { kind: "product", capture_ids: [], fragment_ids: [], media_ids: [], person_ids: [], relationship_context_ids: [],
        expires_at: new Date(Date.now() + 60_000).toISOString() } }, { text: "synthetic source" }, outbox);
    await session.complete({ answer: "synthetic output" }, "ok"); await outbox.flush();
    expect((await outbox.status()).retained).toBe(1);
    available = false; await outbox.flush();
    expect((await outbox.status()).deleted).toBe(1); expect(remove).toHaveBeenCalledOnce();
  });
  it("records actual model turns, rejected tools and successful retry as child spans with nullable cost", async () => {
    const { outbox } = await setup(); const observer = new RuntimeObserver(outbox);
    const bodies: Record<string, unknown>[] = [];
    let turn = 0;
    const provider = new ZhipuChatAnswerProvider({ apiKey: "synthetic-key", model: "glm-5.3", observer,
      fetcher: vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>); turn++;
        return Response.json({ id: `response-${turn}`, model: "glm-5.3",
          choices: [{ message: turn < 3 ? { content: null, tool_calls: [{ id: `call-${turn}`, type: "function",
            function: { name: "contact_workspace_search", arguments: JSON.stringify({ query: "synthetic person", maximum_results: 4 }) } }] }
            : { content: JSON.stringify({ outcome: "answer", title: "Done", body: "synthetic answer" }) } }],
          ...(turn === 1 ? { usage: { prompt_tokens: 10, completion_tokens: 4 } } : {}) });
      }) as typeof fetch });
    let calls = 0;
    await provider.run({ runID: "run-tool-retry", objective: "Review the available workspace context",
      observation: { ...context, run_id: "run-tool-retry", authorization_scope: "workspace_conversation" },
      systemPrompt: "Synthetic system", scopeSummary: { kind: "workspace_conversation", workspaceID: "workspace-test", sessionID: null, currentPersonID: null, currentRelationshipContextID: null },
      toolManifest: ["contact_workspace"], budget: { maxTurns: 4, maxToolCalls: 4, maxDurationMs: 30000, maxTaskTokens: 1000, maxEstimatedUsd: 1 } },
      async (name) => { calls++; return calls === 1 ? { ok: false, callID: "tool-failure", name, error: { code: "TEMPORARY", message: "synthetic failure" } }
        : { ok: true, callID: "tool-success", name, data: { operation: "search", results: [] } }; }, AbortSignal.timeout(5000));
    await outbox.flush();
    await vi.waitFor(async () => expect((await outbox.status()).retained).toBe(1));
    const states = await outbox.status();
    const retained = states.receipts[0]!;
    // Complete() triggers asynchronous export; a concurrent inspection may see pending.
    expect(retained.content_states.complete).toBeGreaterThan(0);
    const entries = await readdir((outbox as unknown as { root: string }).root);
    const data = JSON.parse(await readFile(join((outbox as unknown as { root: string }).root, entries.find((name) => name.endsWith(".json"))!), "utf8")) as { observation: RuntimeObservation };
    const spans = data.observation.spans;
    const models = spans.filter((span) => span.kind === "llm"), tools = spans.filter((span) => span.kind === "tool");
    expect(models).toHaveLength(3); expect(tools).toHaveLength(2);
    expect(models[0]?.input.value).toEqual(bodies[0]);
    expect(models[0]?.usage).toMatchObject({ input_tokens: 10, output_tokens: 4, source: "provider", cost_usd: null, accounting: "leaf" });
    expect(models[1]?.usage).toMatchObject({ input_tokens: null, output_tokens: null, source: "unavailable" });
    expect(tools[0]?.status).toBe("error"); expect(tools[1]?.retry_of).toBe(tools[0]?.id);
    expect(tools[0]?.parent_span_id).toBe(models[0]?.id); expect(tools[1]?.parent_span_id).toBe(models[1]?.id);
    expect(spans[0]?.usage.accounting).toBe("none");
    expect(JSON.stringify(data)).not.toContain("synthetic-key");
  });
  it("persists before export, retries with stable ids after restart, and reports actual backlog", async () => {
    const retain = vi.fn().mockRejectedValueOnce(new Error("network secret payload")).mockResolvedValue(undefined);
    const { root, outbox } = await setup({ retain, remove: async () => {} });
    const value = await observation(); await outbox.enqueue(value); await outbox.flush();
    expect((await outbox.status()).pending).toBe(1);
    expect(JSON.stringify(await outbox.status())).not.toContain("network secret payload");
    const restarted = new RuntimeObservationOutbox(root, policy, { retain, remove: async () => {} });
    await restarted.flush(); expect((await restarted.status()).retained).toBe(1);
    expect(retain.mock.calls[0]?.[0].spans.map((span: { id: string }) => span.id)).toEqual(retain.mock.calls[1]?.[0].spans.map((span: { id: string }) => span.id));
  });
  it("spools completion durably while another process holds the export lock", async () => {
    const { root, outbox } = await setup(); const value = await observation();
    await writeFile(join(root, `${value.id}.json.lock`), JSON.stringify({ pid: process.pid, namespace: hostname() }));
    await outbox.enqueue(value);
    expect((await outbox.status()).spooled).toBe(1);
    expect((await outbox.status()).locks).toBe(1);
  });
  it("recovers an exited exporter and resumes its durable queue", async () => {
    const { root, outbox } = await setup(); const value = await observation();
    await writeFile(join(root, `${value.id}.json.lock`), JSON.stringify({ pid: 2147483647, namespace: hostname() }));
    await outbox.enqueue(value); await outbox.flush();
    expect((await outbox.status()).retained).toBe(1);
  });
  it("recovers pre-protocol empty locks and crashed recovery claims", async () => {
    const { root, outbox } = await setup(); const value = await observation();
    await outbox.enqueue(value);
    const lock = join(root, `${value.id}.json.lock`);
    await writeFile(lock, "");
    await writeFile(join(root, `recovery-${observationHash([lock, ""])}.lock`), JSON.stringify({ pid: 2147483647, namespace: hostname() }));
    await outbox.flush();
    expect((await outbox.status()).retained).toBe(1);
    expect((await outbox.status()).locks).toBe(0);
  });
  it("never displaces a lock from another process namespace or an unproven legacy owner", async () => {
    const { root, outbox } = await setup(); const value = await observation(); await outbox.enqueue(value);
    for (const namespace of ["foreign-container", undefined]) {
      await writeFile(join(root, `${value.id}.json.lock`), JSON.stringify({ pid: 2147483647, namespace }));
      await outbox.flush();
      expect((await outbox.status()).spooled).toBe(1);
      expect((await outbox.status()).retained).toBe(0);
    }
  });
  it("keeps attempts independent above 500 total spans and deletes every retained span", async () => {
    const retain = vi.fn(), remove = vi.fn(); const { outbox } = await setup({ retain, remove });
    const first = await observation(), second = await observation();
    for (const item of [first, second]) {
      const leaf = item.spans[1]!;
      item.spans.push(...Array.from({ length: 249 }, (_, i) => ({ ...leaf, id: observationID(`${item.attempt_id}:${i}`) })));
      RuntimeObservationSchema.parse(item); await outbox.enqueue(item);
    }
    await outbox.flush();
    expect(retain).toHaveBeenCalledTimes(2);
    expect((await outbox.status()).receipts[0]?.retained_span_ids).toHaveLength(502);
    await outbox.deleteRun(context);
    expect(remove.mock.calls[0]?.[1]).toHaveLength(502);
    expect((await outbox.status()).deleted).toBe(1);
  });
  it("deletes malformed pending bodies and crash temporary files without merging them", async () => {
    const { root, outbox } = await setup(); const value = await observation();
    await outbox.enqueue(value); await outbox.flush();
    await writeFile(join(root, `${value.id}.broken.pending`), "synthetic private corrupt body");
    await writeFile(join(root, `${value.id}.crash.tmp`), "synthetic private crash body");
    await outbox.deleteRun(context);
    expect((await readdir(root)).some((name) => /\.(?:pending|tmp)$/u.test(name))).toBe(false);
    expect((await outbox.status()).deleted).toBe(1);
  });
  it("cleans temporary bodies when atomic rename fails", async () => {
    const { root, outbox } = await setup(); const value = await observation();
    const original = fs.rename;
    const rename = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(".pending")) throw new Error("synthetic rename failure");
      return original(from, to);
    });
    try { await expect(outbox.enqueue(value)).rejects.toThrow("rename failure"); }
    finally { rename.mockRestore(); }
    expect((await readdir(root)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
  it("expires an existing run despite poison pending and continues past another run failure", async () => {
    const { root, outbox } = await setup(); const value = await observation();
    await outbox.enqueue(value); await outbox.flush();
    await writeFile(join(root, `${value.id}.broken.pending`), "corrupt");
    const otherID = observationID("other run");
    await writeFile(join(root, `${otherID}.broken.pending`), "corrupt");
    await expect(outbox.flush(Date.parse(value.retention_expires_at) + 1)).rejects.toThrow();
    expect((await outbox.status()).deleted).toBe(1);
    expect(await readdir(root)).not.toContain(`${value.id}.broken.pending`);
  });
  it("rejects path-shaped attempt identifiers and unbound run identities", async () => {
    const { outbox } = await setup(); const value = await observation();
    await expect(outbox.enqueue({ ...value, attempt_id: "../../../escape" })).rejects.toThrow();
    await expect(outbox.enqueue({ ...value, run_id: "another-run" })).rejects.toThrow();
  });
  it("deletion tombstones remove bodies and prevent late retry or resume resurrection", async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const retain = vi.fn().mockResolvedValue(undefined);
    const { root, outbox } = await setup({ retain, remove }); const value = await observation();
    await outbox.enqueue(value); await outbox.flush(); await outbox.deleteRun(context);
    const scheduled = (await outbox.status()).receipts[0]!;
    expect(scheduled.state).toBe("deletion_pending"); expect(scheduled.retry_after).not.toBeNull();
    const disk = await readFile(join(root, `${value.id}.json`), "utf8");
    expect(disk).not.toContain("synthetic message");
    await expect(outbox.enqueue(value)).rejects.toThrow("DELETED");
    // The failed delete waits for its persisted retry schedule instead of the
    // next flush tick, then recovers at the scheduled instant.
    await outbox.flush(); expect(remove).toHaveBeenCalledTimes(1);
    await outbox.flush(Date.parse(scheduled.retry_after!)); const receipt = (await outbox.status()).receipts[0]!;
    expect(receipt.state).toBe("deleted"); expect(receipt.deleted_span_ids).toHaveLength(value.spans.length);
    expect(receipt.retained_span_ids).toEqual([]); expect(retain).toHaveBeenCalledTimes(1);
    const resumed = new RuntimeObservationOutbox(root, policy, { retain, remove });
    await expect(resumed.enqueue(await observation())).rejects.toThrow("DELETED");
  });
  it("durably records deletion during an active export and prevents stale exporter persistence", async () => {
    let finish!: () => void, started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const finishing = new Promise<void>((resolve) => { finish = resolve; });
    const retain = vi.fn(async () => { started(); await finishing; });
    const remove = vi.fn(); const { root, outbox } = await setup({ retain, remove });
    const value = await observation(); await outbox.enqueue(value);
    const exporting = outbox.flush(); await startedPromise;
    await outbox.deleteRun(context);
    expect((await outbox.status()).deletion_pending).toBe(1);
    await expect(outbox.enqueue(await observation())).rejects.toThrow("DELETED");
    finish(); await exporting; await outbox.flush();
    expect((await outbox.status()).deleted).toBe(1);
    expect(await readFile(join(root, `${value.id}.json`), "utf8")).not.toContain("synthetic message");
    expect(remove).toHaveBeenCalledOnce();
  });
  it("expires local and remote content through the same deletion path", async () => {
    const remove = vi.fn(); const { outbox } = await setup({ retain: async () => {}, remove });
    const value = await observation(); await outbox.enqueue(value);
    await outbox.flush(Date.parse(value.retention_expires_at) + 1);
    expect((await outbox.status()).deleted).toBe(1); expect(remove).toHaveBeenCalledOnce();
    // Expiry-driven deletion reaches the same durable terminal semantics.
    const receipt = (await outbox.status()).receipts[0]!;
    await outbox.flush(Date.parse(value.retention_expires_at) + 2);
    await outbox.deleteRun(context);
    expect(JSON.stringify((await outbox.status()).receipts[0]!)).toBe(JSON.stringify(receipt));
    expect(remove).toHaveBeenCalledOnce();
  });
  it("never reroutes an old outbox to a different private target", async () => {
    const { root, outbox } = await setup(); const value = await observation(); await outbox.enqueue(value);
    const transport = { retain: vi.fn(), remove: vi.fn() };
    const redirected = new RuntimeObservationOutbox(root, { ...policy, project: "different-project" }, transport);
    await expect(redirected.flush()).rejects.toThrow("TARGET_MISMATCH"); expect(transport.retain).not.toHaveBeenCalled();
  });
  it("finishes existing deletion after source scope changes without exporting old content", async () => {
    const retain=vi.fn(),remove=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const {root,outbox}=await setup({retain,remove}),value=await observation();
    try {
      await outbox.enqueue(value);await outbox.flush();await outbox.deleteRun(context);
      const expanded=new RuntimeObservationOutbox(root,{...policy,source_workspace_ids:[...policy.source_workspace_ids,"new-account"]},{retain,remove});
      await expanded.flush(Date.parse((await outbox.status()).receipts[0]!.retry_after!));
      expect((await expanded.status()).deleted).toBe(1);
      await expanded.deleteRun(context);await expanded.flush();
      expect(retain).toHaveBeenCalledOnce();
      await expect(expanded.enqueue(value)).rejects.toThrow("POLICY_MISMATCH");
    } finally {await fs.rm(root,{recursive:true,force:true});}
  });
  it.each([{endpoint:"http://localhost:5174/api"},{workspace:"other"},{project:"other"}])("rejects changed deletion target %j",async changed=>{
    const {root,outbox}=await setup(),value=await observation();
    try {
      await outbox.enqueue(value);await outbox.flush();await outbox.deleteRun(context,true);
      const remove=vi.fn(),redirected=new RuntimeObservationOutbox(root,{...policy,...changed},{retain:vi.fn(),remove});
      await expect(redirected.flush()).rejects.toThrow("TARGET_MISMATCH");
      await expect(redirected.deleteRun(context)).rejects.toThrow("TARGET_MISMATCH");
      expect(remove).not.toHaveBeenCalled();
    } finally {await fs.rm(root,{recursive:true,force:true});}
  });
  it("requires the frozen digest for orphan tombstones and pending content",async()=>{
    const {root,outbox}=await setup(),value=await observation();
    try {
      await outbox.enqueue(value);await outbox.flush();await outbox.deleteRun(context,true);
      await fs.unlink(join(root,`${value.id}.json`));
      const transport={retain:vi.fn(),remove:vi.fn()};
      const expanded=new RuntimeObservationOutbox(root,{...policy,source_workspace_ids:[...policy.source_workspace_ids,"new-account"]},transport);
      await expect(expanded.flush()).rejects.toThrow("TARGET_MISMATCH");
      await expect(expanded.deleteRun(context)).rejects.toThrow("TARGET_MISMATCH");
      expect(transport.remove).not.toHaveBeenCalled();
      await fs.unlink(join(root,`${value.id}.json.tombstone`));
      await outbox.enqueue(value);
      await expect(expanded.flush()).rejects.toThrow("TARGET_MISMATCH");
      expect(transport.retain).not.toHaveBeenCalled();
    } finally {await fs.rm(root,{recursive:true,force:true});}
  });
  it("requires full trace and child readback before retained receipts, and disables redirects", async () => {
    const value = await observation(); const stored = new Map<string, Record<string, unknown>>();
    const fetcher = vi.fn(async (url, init) => {
      expect(init?.redirect).toBe("error"); expect((init?.headers as Record<string, string>)["Comet-Workspace"]).toBe("default");
      if (init?.method === "POST") { const body = JSON.parse(String(init.body)) as Record<string, unknown>; stored.set(String(body.id), body); return new Response(null, { status: 201 }); }
      const id = String(url).split("/").at(-1)!; return stored.has(id) ? Response.json(stored.get(id)) : new Response(null, { status: 404 });
    }) as typeof fetch;
    const transport = new PrivateOpikRuntimeTransport(policy, "synthetic-opik-key", fetcher);
    await transport.retain(value);
    const corrupted = vi.fn(async (url, init) => {
      const response = await fetcher(url, init);
      if (init?.method === "GET" && String(url).includes("/spans/")) return Response.json({ ...(await response.json()), output: { tampered: true } });
      return response;
    }) as typeof fetch;
    await expect(new PrivateOpikRuntimeTransport(policy, undefined, corrupted).retain(value)).rejects.toThrow("READBACK_MISMATCH");
    const root = stored.get(value.spans[0]!.id)!; expect(root.usage).toBeUndefined();
  });
  it("keeps completed deletion terminal across repeated flush, deletion and reload", async () => {
    const retain = vi.fn(), remove = vi.fn();
    const { root, outbox } = await setup({ retain, remove });
    const value = await observation(); await outbox.enqueue(value); await outbox.flush();
    await outbox.deleteRun(context);
    const receipt = (await outbox.status()).receipts[0]!;
    expect(receipt.state).toBe("deleted"); expect(receipt.retry_streak).toBe(0); expect(receipt.retry_after).toBeNull();
    await outbox.flush(); await outbox.flush();
    await outbox.deleteRun(context); await outbox.deleteRun(context, true);
    // The receipt and its historical attempts survive byte-identical.
    expect(JSON.stringify((await outbox.status()).receipts[0]!)).toBe(JSON.stringify(receipt));
    expect(retain).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    const reloaded = new RuntimeObservationOutbox(root, policy, { retain: vi.fn(), remove: vi.fn() });
    await reloaded.flush(); await reloaded.deleteRun(context); await reloaded.flush();
    expect(JSON.stringify((await reloaded.status()).receipts[0]!)).toBe(JSON.stringify(receipt));
    // The tombstone still blocks every late attempt and resume.
    await expect(reloaded.enqueue(await observation())).rejects.toThrow("DELETED");
  });
  it("acquires a terminal receipt for orphan tombstones without entries", async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { root, outbox } = await setup({ retain: async () => {}, remove });
    const value = await observation(); await outbox.enqueue(value); await outbox.flush();
    await outbox.deleteRun(context, true);
    // A crash between the tombstone and receipt writes leaves an orphan tombstone.
    await fs.unlink(join(root, `${value.id}.json`));
    expect((await outbox.status()).receipts).toEqual([]);
    await outbox.flush();
    const waiting = (await outbox.status()).receipts[0]!;
    expect(waiting.state).toBe("deletion_pending"); expect(waiting.retry_after).not.toBeNull();
    await outbox.flush(); expect(remove).toHaveBeenCalledTimes(1);
    await outbox.flush(Date.parse(waiting.retry_after!));
    const done = (await outbox.status()).receipts[0]!;
    expect(done.state).toBe("deleted"); expect(done.deleted_span_ids).toEqual(value.spans.map((span) => span.id));
    expect(done.retry_streak).toBe(0); expect(done.retry_after).toBeNull();
    await outbox.flush(); expect(remove).toHaveBeenCalledTimes(2);
  });
  it("migrates pre-scheduling receipts and keeps historical attempts out of the retry delay", async () => {
    const remove = vi.fn();
    const { root, outbox } = await setup({ retain: async () => {}, remove });
    const value = await observation(); await outbox.enqueue(value); await outbox.flush();
    await outbox.deleteRun(context, true);
    const path = join(root, `${value.id}.json`);
    const legacy = JSON.parse(await readFile(path, "utf8")) as { receipt: Record<string, unknown> };
    delete legacy.receipt.retry_streak; delete legacy.receipt.retry_after;
    legacy.receipt.attempts = 103_000;
    await writeFile(path, JSON.stringify(legacy));
    const now = Date.now() + 60_000;
    remove.mockRejectedValueOnce(new Error("offline"));
    await outbox.flush(now);
    const failed = (await outbox.status()).receipts[0]!;
    expect(failed.state).toBe("deletion_pending"); expect(failed.attempts).toBe(103_001);
    // The fresh retry streak, not the 103k historical attempts, drives the delay.
    expect(failed.retry_streak).toBe(1);
    expect(failed.retry_after).toBe(new Date(now + 5_000).toISOString());
    remove.mockResolvedValue(undefined);
    await outbox.flush(now + 4_999); expect(remove).toHaveBeenCalledTimes(1);
    await outbox.flush(now + 5_000);
    const done = (await outbox.status()).receipts[0]!;
    expect(done.state).toBe("deleted"); expect(done.attempts).toBe(103_002);
    expect(done.retry_streak).toBe(0); expect(done.retry_after).toBeNull();
  });
  it("backs off failed deletions by retry streak with a bounded persisted schedule", async () => {
    const remove = vi.fn();
    const { root, outbox } = await setup({ retain: async () => {}, remove });
    const value = await observation(); await outbox.enqueue(value); await outbox.flush();
    await outbox.deleteRun(context, true);
    const path = join(root, `${value.id}.json`);
    const t0 = Date.now() + 60_000;
    remove.mockRejectedValue(new Error("offline"));
    await outbox.flush(t0);
    expect((await outbox.status()).receipts[0]!.retry_after).toBe(new Date(t0 + 5_000).toISOString());
    await outbox.flush(t0 + 5_000);
    expect((await outbox.status()).receipts[0]!.retry_after).toBe(new Date(t0 + 15_000).toISOString());
    expect(remove).toHaveBeenCalledTimes(2);
    // Even a runaway streak can only ever wait the bounded ceiling.
    const long = JSON.parse(await readFile(path, "utf8")) as { receipt: Record<string, unknown> };
    long.receipt.retry_streak = 1_000_000;
    await writeFile(path, JSON.stringify(long));
    await outbox.flush(t0 + 15_000);
    expect((await outbox.status()).receipts[0]!.retry_after).toBe(new Date(t0 + 315_000).toISOString());
    expect(remove).toHaveBeenCalledTimes(3);
    // Recovery clears the schedule; the terminal receipt then costs zero transport.
    remove.mockResolvedValue(undefined);
    await outbox.flush(t0 + 315_000);
    const done = (await outbox.status()).receipts[0]!;
    expect(done.state).toBe("deleted"); expect(done.retry_streak).toBe(0); expect(done.retry_after).toBeNull();
    await outbox.flush(t0 + 2_000_000);
    expect(remove).toHaveBeenCalledTimes(4);
  });
  it("reopens a completed deletion only for genuinely new known spans", async () => {
    const remove = vi.fn(); const { root, outbox } = await setup({ retain: async () => {}, remove });
    const value = await observation(); await outbox.enqueue(value); await outbox.flush();
    await outbox.deleteRun(context);
    expect(remove).toHaveBeenCalledTimes(1);
    // Without new known spans the completed deletion never reopens.
    await outbox.deleteRun(context); await outbox.flush();
    expect((await outbox.status()).receipts[0]!.state).toBe("deleted");
    expect(remove).toHaveBeenCalledTimes(1);
    // Recovered or legacy state can surface a genuinely new recorded child.
    const tombstonePath = join(root, `${value.id}.json.tombstone`);
    const tombstone = JSON.parse(await readFile(tombstonePath, "utf8")) as { span_ids: string[] };
    tombstone.span_ids.push(observationID("recovered child span"));
    await writeFile(tombstonePath, JSON.stringify(tombstone));
    await outbox.deleteRun(context, true);
    expect((await outbox.status()).receipts[0]!.state).toBe("deletion_pending");
    await outbox.flush();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls[1]?.[1]).toEqual(tombstone.span_ids);
    const done = (await outbox.status()).receipts[0]!;
    expect(done.state).toBe("deleted"); expect(done.deleted_span_ids).toEqual(tombstone.span_ids);
    await outbox.deleteRun(context); await outbox.flush();
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it("never steals a same-namespace lock on age alone", async () => {
    const { root, outbox } = await setup(); const value = await observation(); await outbox.enqueue(value);
    await writeFile(join(root, `${value.id}.json.lock`), JSON.stringify({ pid: process.pid, namespace: hostname(),
      created_at: "2020-01-01T00:00:00.000Z" }));
    await outbox.flush();
    expect((await outbox.status()).spooled).toBe(1);
    expect((await outbox.status()).retained).toBe(0);
  });
  it("deletes through the exact project-scoped batch delete and verifies every recorded child", async () => {
    const value = await observation();
    const { fetcher, requests } = opikDeleteAPI({ projects: [
      { id: projectID, name: policy.project },
      { id: "20000000-0000-4000-8000-000000000043", name: `${policy.project}-child` },
      { id: "20000000-0000-4000-8000-000000000044", name: `prefix-${policy.project}` }] });
    const transport = new PrivateOpikRuntimeTransport(policy, undefined, fetcher);
    await transport.remove(value.id, value.spans.map((span) => span.id));
    // Exactly one batch delete against the exact name's UUID: the partial name
    // homonyms are never selected, and the unsupported span delete is unused.
    expect(requests.filter(({ method }) => method === "POST")).toEqual([
      { method: "POST", path: "traces/delete", body: { ids: [value.id], project_id: projectID } }]);
    expect(requests.some(({ method }) => method === "DELETE")).toBe(false);
    const reads = requests.filter(({ method }) => method === "GET").map(({ path }) => path);
    expect(reads[0]).toBe(`projects?name=${encodeURIComponent(policy.project)}&page=1&size=100`);
    expect(reads).toContain(`traces/${value.id}`);
    for (const span of value.spans) expect(reads).toContain(`spans/${span.id}`);
  });
  it("removes orphan children through the project cascade an individual delete would skip", async () => {
    const value = await observation();
    const { fetcher, requests } = opikDeleteAPI({ projects: [{ id: projectID, name: policy.project }],
      traceAbsent: true, cascadeAfterReads: 1 });
    const transport = new PrivateOpikRuntimeTransport(policy, undefined, fetcher);
    await transport.remove(value.id, value.spans.map((span) => span.id));
    // The batch delete keeps its explicit project even with the trace already
    // absent, so the unconditional TracesDeleted cascade reaches orphan children.
    expect(requests.find(({ path }) => path === "traces/delete")?.body).toEqual({ ids: [value.id], project_id: projectID });
    expect(requests.some(({ method }) => method === "DELETE")).toBe(false);
  });
  it("fails closed on missing, ambiguous or malformed project identity before any batch delete", async () => {
    const value = await observation(); const spanIDs = value.spans.map((span) => span.id);
    const paginated = Array.from({ length: 1050 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: index === 0 ? policy.project : `${policy.project}-${index}` }));
    for (const projects of [
      [{ id: projectID, name: `${policy.project}-child` }],
      [{ id: projectID, name: policy.project }, { id: "20000000-0000-4000-8000-000000000043", name: policy.project }],
      [{ id: "not-a-uuid", name: policy.project }],
      // Bounded pagination cannot prove a single exact name across 10 full pages.
      paginated,
    ]) {
      const { fetcher, requests } = opikDeleteAPI({ projects });
      const transport = new PrivateOpikRuntimeTransport(policy, undefined, fetcher);
      await expect(transport.remove(value.id, spanIDs)).rejects.toThrow("OPIK_RUNTIME_PROJECT_UNRESOLVED");
      expect(requests.some(({ path }) => path === "traces/delete")).toBe(false);
    }
  });
  it("keeps unverified, orphaned and unknown deletion results pending", async () => {
    const value = await observation(); const spanIDs = value.spans.map((span) => span.id);
    // The cascade is asynchronous: a still visible trace stays unverified until
    // a later read proves the absence, and nothing is guessed as deleted.
    const eventual = opikDeleteAPI({ projects: [{ id: projectID, name: policy.project }], cascadeAfterReads: 2 });
    const transport = new PrivateOpikRuntimeTransport(policy, undefined, eventual.fetcher);
    await expect(transport.remove(value.id, spanIDs)).rejects.toThrow("DELETE_UNVERIFIED");
    await expect(transport.remove(value.id, spanIDs)).resolves.toBeUndefined();
    // A child that never cascades keeps the whole deletion unverified.
    const orphan = opikDeleteAPI({ projects: [{ id: projectID, name: policy.project }], leaveSpan: spanIDs[1]! });
    await expect(new PrivateOpikRuntimeTransport(policy, undefined, orphan.fetcher).remove(value.id, spanIDs)).rejects.toThrow("DELETE_UNVERIFIED");
    // Remote failures stay unknown and pending; none of them reads back absent.
    const refused = opikDeleteAPI({ projects: [{ id: projectID, name: policy.project }], failDelete: true });
    await expect(new PrivateOpikRuntimeTransport(policy, undefined, refused.fetcher).remove(value.id, spanIDs)).rejects.toThrow("OPIK_RUNTIME_HTTP_503");
    const dead = (async () => { throw new Error("network down"); }) as typeof fetch;
    await expect(new PrivateOpikRuntimeTransport(policy, undefined, dead).remove(value.id, spanIDs)).rejects.toThrow("network down");
  });
});


it.each(["traces/", "spans/"].flatMap(target => ["malformed", "null", "empty"].map(kind => ({ target, kind }))))(
  "keeps $target $kind readbacks pending instead of declaring remote evidence deleted", async ({ target, kind }) => {
    const value = await observation();
    const api = opikDeleteAPI({ projects: [{ id: projectID, name: policy.project }] });
    const fetcher = vi.fn(async (url, init) => {
      if (init?.method === "GET" && String(url).includes(`/v1/private/${target}`)) {
        if (kind === "malformed") return new Response("upstream response truncated", { status: 200 });
        if (kind === "null") return Response.json(null);
        return new Response(null, { status: 204 });
      }
      return api.fetcher(url, init);
    }) as typeof fetch;
    const transport = new PrivateOpikRuntimeTransport(policy, undefined, fetcher);
    const { root, outbox } = await setup({ retain: async () => {}, remove: (...args) => transport.remove(...args) });
    try {
      await outbox.enqueue(value); await outbox.flush(); await outbox.deleteRun(context);
      const failed = (await outbox.status()).receipts[0]!;
      expect(failed.state).toBe("deletion_pending");
      expect(failed.error_code).toBe("OPIK_RUNTIME_DELETE_RETRY_REQUIRED");
      expect(failed.deleted_span_ids).toEqual([]);
      const count = vi.mocked(fetcher).mock.calls.length;
      await outbox.flush();
      expect(vi.mocked(fetcher).mock.calls).toHaveLength(count);
      expect((await outbox.status()).receipts[0]!.attempts).toBe(failed.attempts);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

it("waits the full retry delay after a slow failure, including after reload", async () => {
  const remove = vi.fn();
  const { root, outbox } = await setup({ retain: async () => {}, remove });
  const value = await observation(); await outbox.enqueue(value); await outbox.flush();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  remove.mockImplementationOnce(async () => {
    clock.mockReturnValue(now + 10_000);
    throw new Error("synthetic timeout");
  }).mockResolvedValue(undefined);
  try {
    await outbox.deleteRun(context, true); await outbox.flush(now);
    const failed = (await outbox.status()).receipts[0]!;
    expect(failed.retry_after).toBe(new Date(now + 15_000).toISOString());
    const reloaded = new RuntimeObservationOutbox(root, policy, { retain: async () => {}, remove });
    await reloaded.flush(); await reloaded.flush(now + 14_999);
    expect(remove).toHaveBeenCalledOnce();
    expect((await reloaded.status()).receipts[0]!.attempts).toBe(failed.attempts);
    await reloaded.flush(now + 15_000);
    expect(remove).toHaveBeenCalledTimes(2);
    expect((await reloaded.status()).receipts[0]!.state).toBe("deleted");
  } finally { clock.mockRestore(); await fs.rm(root, { recursive: true, force: true }); }
});

it("accounts repeated SDK messages once, distinguishes tool rejection and never invents model request timing", async () => {
  let retained: RuntimeObservation | undefined;
  const session = new RuntimeObservationSession(policy, context, { objective: "Synthetic SDK input" },
    { enqueue: async value => { retained = value; } }, ["synthetic-credential"]);
  const message = { id: "sdk-message-1", model: "claude-sonnet-5", usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 4 } };
  session.recordSDKAssistant(message, { ...message, text: "synthetic-credential" }, "revision");
  session.recordSDKAssistant(message, { ...message, text: "synthetic-credential" }, "revision");
  await session.step("read_memory", "tool", {}, async () => ({ isError: true, content: [{ type: "text", text: "SOURCE_UNAVAILABLE" }] }));
  await session.complete({ inputTokens: 24, outputTokens: 7 }, "ok");
  const modelSpans = retained!.spans.filter(span => span.kind === "llm");
  expect(modelSpans).toHaveLength(1);
  expect(modelSpans[0]!.usage).toMatchObject({ input_tokens: 24, output_tokens: 7, accounting: "leaf", cost_usd: null });
  expect(modelSpans[0]!.started_at).toBe(modelSpans[0]!.ended_at);
  expect(modelSpans[0]!.input.status).toBe("unavailable");
  expect(retained!.spans.find(span => span.kind === "tool")).toMatchObject({ status: "error", parent_span_id: modelSpans[0]!.id });
  expect(JSON.stringify(retained)).not.toContain("synthetic-credential");
});
