import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DeepSeekRelationshipTextProvider } from "../../../agent/src/deepSeekRelationshipTextProvider.js";
import { executeUnscopedChatTask, type UnscopedChatExecution } from "./unscopedChat.js";
import {
  decodeLegacyChatCheckpoint, encodeLegacyChatCheckpoint, LegacyChatCheckpointError,
  type LegacyChatCheckpointBinding,
} from "./legacyChatCheckpoint.js";

const taskID = "11111111-1111-4111-8111-111111111111";
const model = "deepseek-flash";
const binding: LegacyChatCheckpointBinding = { taskID, provider: { providerID: "deepseek-chat-completions", model } };
const objective = "Synthetic checkpoint compatibility verification, with PRIVATE_OBJECTIVE_TAIL_NOT_FOR_CHECKPOINT";
const createdAt = new Date("2026-11-08T12:34:56.123Z");

async function execution(options: { usage?: unknown; noUsage?: boolean; fail?: boolean; disabled?: boolean;
  title?: string; body?: string; kind?: "answer" | "clarification"; sessionTitle?: string; requestID?: string } = {}) {
  let calls = 0;
  let privateSystemPrompt = "";
  const provider = options.disabled ? null : new DeepSeekRelationshipTextProvider({ apiKey: "synthetic-not-a-credential", model,
    fetcher: async (_url, init) => {
      calls += 1;
      const payload = JSON.parse(String(init?.body));
      privateSystemPrompt = payload.messages[0].content;
      if (options.fail) throw new Error("PRIVATE_REMOTE_FAILURE_NOT_FOR_CHECKPOINT");
      return new Response(JSON.stringify({ id: options.requestID ?? "synthetic-request", model,
        choices: [{ message: { content: JSON.stringify({ kind: options.kind ?? "answer", title: options.title ?? "Synthetic answer",
          body: options.body ?? "A literal bounded answer. 👩🏽‍💻\nSecond line.", citation_ids: [],
          session_title: options.sessionTitle ?? "Checkpoint retrieval label" }) } }],
        ...(options.noUsage ? {} : { usage: options.usage ?? { prompt_tokens: 7, completion_tokens: 3, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 7 } }),
      }), { status: 200, headers: { "content-type": "application/json" } });
    } });
  if (provider) expect("run" in provider).toBe(false);
  const result = await executeUnscopedChatTask({ request: { idempotency_key: "synthetic:checkpoint", objective },
    taskID, createdAt, provider });
  // The real registry snapshot is frozen and shared. Mutations below target a
  // fixture-owned clone, never the registry or another test's source objects.
  if (result.providerResult?.prompt_snapshot)
    result.providerResult.prompt_snapshot = { ...result.providerResult.prompt_snapshot };
  return { result, calls, privateSystemPrompt };
}

function storedJSON(value: unknown) {
  const json = JSON.stringify(value);
  return { json, byteLength: Buffer.byteLength(json, "utf8"), sha256: createHash("sha256").update(json).digest("hex") };
}

function reject(action: () => unknown) {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(LegacyChatCheckpointError);
  expect((caught as Error).message).toMatch(/^LEGACY_CHAT_CHECKPOINT_(?:INVALID|UNSUPPORTED|TOO_LARGE|MISMATCH|CORRUPT)$/);
  expect((caught as Error).message).not.toContain("PRIVATE");
}

describe("answer-only legacy checkpoint", () => {
  it.each(["body", "title", "requestID"])("rejects JSONB-incompatible NUL from the real answer-only producer: %s", async field => {
    const value = "Synthetic before\0after";
    const { result, calls } = await execution({ [field]: value });
    expect(calls).toBe(1);
    expect(result.remoteStatus).toBe("completed");
    expect(field === "requestID" ? result.providerResult!.provider_request_id
      : field === "title" ? result.body.blocks[0]!.title : result.body.blocks[0]!.body).toBe(value);
    const original = structuredClone(result);
    reject(() => encodeLegacyChatCheckpoint(result, binding));
    expect(result).toEqual(original);
  });

  it("rejects NUL in an otherwise byte-valid historical TEXT checkpoint", async () => {
    const { result } = await execution();
    const original = JSON.parse(encodeLegacyChatCheckpoint(result, binding).json);
    original.body.blocks[0].body = "Synthetic before\0after";
    reject(() => decodeLegacyChatCheckpoint(storedJSON(original), binding));
  });

  it.each(["prompt_name", "prompt_revision", "prompt_version", "reported_model", "usage_revision", "bound_model"])("rejects NUL in persisted audit/usage metadata: %s", async field => {
    const { result } = await execution();
    const value = "Synthetic before\0after";
    let expected = binding;
    if (field === "prompt_name") result.providerResult!.prompt_snapshot!.name = value;
    if (field === "prompt_revision") result.providerResult!.prompt_snapshot!.revision = value;
    if (field === "prompt_version") result.providerResult!.prompt_snapshot!.versionId = value;
    if (field === "reported_model") result.providerResult!.reported_model = value;
    if (field === "usage_revision") result.providerResult!.prompt_revision = value;
    if (field === "bound_model") {
      result.providerResult!.model = value;
      expected = { taskID, provider: { providerID: "deepseek-chat-completions", model: value } };
    }
    reject(() => encodeLegacyChatCheckpoint(result, expected));
  });

  it("projects the actual producer body/audit refs, not runtime prompt or objective", async () => {
    const { result, calls, privateSystemPrompt } = await execution();
    expect(calls).toBe(1);
    expect(result.remoteStatus).toBe("completed");
    const stored = encodeLegacyChatCheckpoint(result, binding);
    const decoded = decodeLegacyChatCheckpoint(stored, binding);
    expect(decoded.body).toEqual(result.body);
    expect(decoded.completion.remoteStatus).toBe("completed");
    expect(decoded.completion.provider).toEqual({ providerID: "deepseek-chat-completions", model,
      providerRequestID: "synthetic-request", prompt: { name: result.providerResult!.prompt_snapshot!.name,
        revision: result.providerResult!.prompt_snapshot!.revision, versionId: null, source: "bundled" } });
    expect(decoded.completion.usage).toMatchObject({ input_tokens: 7, output_tokens: 3,
      usage_reported: true, cache_hit_tokens: 0, cache_miss_tokens: 7 });
    expect(stored.json).not.toContain(privateSystemPrompt);
    expect(stored.json).not.toContain("PRIVATE_OBJECTIVE_TAIL_NOT_FOR_CHECKPOINT");
    expect(stored.json).not.toContain("agentProviderResult");
    expect(stored.json).not.toContain('"text"');
    expect(Object.keys(JSON.parse(stored.json))).toEqual(["version", "taskID", "provider", "body", "completion"]);
  });

  it.each(["unknown", "zero", "absent_flag", "nullable"] as const)("preserves honest usage state: %s", async state => {
    const { result } = await execution(state === "unknown" ? { noUsage: true } : { usage: { prompt_tokens: 0, completion_tokens: 0 } });
    if (state === "absent_flag") delete result.providerResult!.usage_reported;
    if (state === "nullable") result.providerResult!.remote_requests_started = null;
    const decoded = decodeLegacyChatCheckpoint(encodeLegacyChatCheckpoint(result, binding), binding);
    expect(decoded.completion.usage!.input_tokens).toBe(0);
    expect(decoded.completion.usage!.output_tokens).toBe(0);
    if (state === "absent_flag") expect(decoded.completion.usage).not.toHaveProperty("usage_reported");
    else expect(decoded.completion.usage!.usage_reported).toBe(state !== "unknown");
    expect(decoded.completion.usage!.cache_hit_tokens).toBeNull();
    expect(decoded.completion.usage!.cache_miss_tokens).toBeNull();
    if (state === "nullable") expect(decoded.completion.usage).toHaveProperty("remote_requests_started", null);
    else expect(decoded.completion.usage).not.toHaveProperty("remote_requests_started");
  });

  it.each([false, true])("retains actual local 201 body for disabled=%s without fictitious usage", async disabled => {
    const { result, calls } = await execution({ disabled, fail: !disabled });
    expect(calls).toBe(disabled ? 0 : 1);
    expect(result.remoteStatus).toBe(disabled ? "disabled" : "fallback");
    const expected = { taskID, provider: disabled ? null : binding.provider };
    const decoded = decodeLegacyChatCheckpoint(encodeLegacyChatCheckpoint(result, expected), expected);
    expect(decoded.body).toEqual(result.body);
    expect(decoded.completion.provider).toBeNull();
    expect(decoded.completion.usage).toBeNull();
    expect(decoded.body.session_title).toBe(result.body.session_title);
    expect(JSON.stringify(decoded)).not.toContain("PRIVATE_REMOTE_FAILURE_NOT_FOR_CHECKPOINT");
    expect(decoded.completion).not.toHaveProperty("remoteDiagnostics");
  });

  it("preserves clarification and known bounded terminal diagnostic codes", async () => {
    const { result } = await execution({ kind: "clarification" });
    const decoded = decodeLegacyChatCheckpoint(encodeLegacyChatCheckpoint(result, binding), binding);
    expect(decoded.body.disposition).toBe("clarify");
    expect(decoded.body.blocks[0]!.requires_user_decision).toBe(true);
    const fallback = (await execution({ fail: true })).result;
    for (const code of ["MODEL_RUN_TIMEOUT", "MODEL_RUN_TOKEN_BUDGET_EXHAUSTED", "MODEL_PROVIDER_BILLING_REQUIRED"] as const) {
      fallback.remoteFailureCode = code;
      expect(decodeLegacyChatCheckpoint(encodeLegacyChatCheckpoint(fallback, binding), binding).completion.remoteFailureCode).toBe(code);
    }
  });

  it("preserves actual optional-field absence without mutating or aliasing original objects", async () => {
    const { result } = await execution();
    delete result.providerResult!.prompt_snapshot;
    delete result.providerResult!.prompt_revision;
    delete result.body.session_title;
    const original = structuredClone(result);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    };
    freeze(result);
    const stored = encodeLegacyChatCheckpoint(result, binding);
    const one = decodeLegacyChatCheckpoint(stored, binding);
    const two = decodeLegacyChatCheckpoint(stored, binding);
    expect(result).toEqual(original);
    expect(one).toEqual(two); expect(one).not.toBe(two); expect(one.body).not.toBe(two.body);
    expect(one.body).not.toBe(result.body); expect(one.body.blocks[0]).not.toBe(result.body.blocks[0]);
    expect(one.body).not.toHaveProperty("session_title");
    expect(one.completion.provider!.prompt).toBeNull();
    expect(one.completion.usage).not.toHaveProperty("prompt_revision");
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => { (one.body.blocks[0] as { title: string }).title = "mutated"; }).toThrow(TypeError);
  });

  it.each(["wrong_task", "wrong_provider", "wrong_model", "session", "previous_task", "sources", "agent", "capture", "memory", "calendar", "citations", "public_sources", "effects", "unknown_execution", "unknown_body", "unknown_provider"])("rejects unsupported authority/effect metadata: %s", async kind => {
    const { result } = await execution();
    const bad = result as unknown as Record<string, unknown>;
    const body = bad.body as Record<string, unknown>;
    const block = (body.blocks as Array<Record<string, unknown>>)[0]!;
    const provider = bad.providerResult as Record<string, unknown>;
    switch (kind) {
      case "wrong_task": body.task_id = "22222222-2222-4222-8222-222222222222"; break;
      case "wrong_provider": provider.provider_id = "claude-agent-sdk"; break;
      case "wrong_model": provider.model = "different-model"; break;
      case "session": bad.conversationMessageIDs = ["source-message"]; break;
      case "previous_task": bad.previousTaskIDs = [taskID]; break;
      case "sources": bad.conversationSources = [{}]; break;
      case "agent": bad.agentProviderResult = {}; break;
      case "capture": bad.captureImageObservation = {}; break;
      case "memory": body.memory_proposal = { proposal_id: taskID, revision: 1 }; break;
      case "calendar": block.calendar_draft = {}; break;
      case "citations": block.citation_dependency_ids = [taskID]; break;
      case "public_sources": block.public_source_refs = []; break;
      case "effects": body.external_effects = [{}]; break;
      case "unknown_execution": bad.objective = "PRIVATE_UNKNOWN_OBJECTIVE"; break;
      case "unknown_body": body.source = "PRIVATE_SOURCE"; break;
      case "unknown_provider": provider.memoryProposal = {}; break;
    }
    reject(() => encodeLegacyChatCheckpoint(result, binding));
  });

  it.each(["title", "body", "session_title", "request_id", "model", "usage", "negative", "surrogate", "prompt_ref", "null", "missing", "kind", "status", "date"])("rejects wrong type/range/size without truncation: %s", async kind => {
    const { result } = await execution();
    const bad = result as unknown as Record<string, unknown>;
    const body = bad.body as Record<string, unknown>;
    const block = (body.blocks as Array<Record<string, unknown>>)[0]!;
    const provider = bad.providerResult as Record<string, unknown>;
    switch (kind) {
      case "title": block.title = "x".repeat(161); break;
      case "body": block.body = "x".repeat(4001); break;
      case "session_title": body.session_title = "x".repeat(33); break;
      case "request_id": provider.provider_request_id = "👩".repeat(513); break;
      case "model": provider.model = "m".repeat(257); break;
      case "usage": provider.input_tokens = NaN; break;
      case "negative": provider.output_tokens = -1; break;
      case "surrogate": block.body = "PRIVATE\ud800"; break;
      case "prompt_ref": (provider.prompt_snapshot as Record<string, unknown>).versionId = "v".repeat(257); break;
      case "null": body.blocks = null; break;
      case "missing": delete provider.input_tokens; break;
      case "kind": block.kind = "question_set"; break;
      case "status": block.status = "confirmed"; break;
      case "date": body.created_at = "not-a-date"; break;
    }
    reject(() => encodeLegacyChatCheckpoint(result, binding));
  });

  it.each(["execution", "block", "prompt", "toJSON", "proxy"])("does not execute user accessors/proxies: %s", async location => {
    const { result } = await execution();
    let calls = 0;
    let input: unknown = result;
    const get = () => { calls += 1; throw new Error("PRIVATE_ACCESSOR_FAILURE"); };
    if (location === "execution") Object.defineProperty(result, "body", { get });
    if (location === "block") Object.defineProperty(result.body.blocks[0]!, "body", { get });
    if (location === "prompt") Object.defineProperty(result.providerResult!.prompt_snapshot!, "versionId", { get });
    if (location === "toJSON") Object.defineProperty(result, "toJSON", { get });
    if (location === "proxy") input = new Proxy(result, { ownKeys: get, get });
    reject(() => encodeLegacyChatCheckpoint(input, binding));
    expect(calls).toBe(0);
  });

  it.each(["hash", "bytes", "version", "task", "provider", "model", "extra", "duplicate", "whitespace", "lone_surrogate", "oversized", "null"])("strictly decodes DB bytes/binding, rejecting %s", async kind => {
    const { result } = await execution();
    let stored = encodeLegacyChatCheckpoint(result, binding);
    const data = JSON.parse(stored.json);
    switch (kind) {
      case "hash": stored = { ...stored, sha256: "0".repeat(64) }; break;
      case "bytes": stored = { ...stored, byteLength: stored.byteLength + 1 }; break;
      case "version": data.version = 2; stored = storedJSON(data); break;
      case "task": data.taskID = "22222222-2222-4222-8222-222222222222"; stored = storedJSON(data); break;
      case "provider": data.provider.providerID = "claude-agent-sdk"; stored = storedJSON(data); break;
      case "model": data.provider.model = "other-model"; stored = storedJSON(data); break;
      case "extra": data.completion.privateText = "PRIVATE"; stored = storedJSON(data); break;
      case "duplicate": {
        const json = stored.json.replace('"version":1', '"version":1,"version":1');
        stored = { json, byteLength: Buffer.byteLength(json), sha256: createHash("sha256").update(json).digest("hex") }; break;
      }
      case "whitespace": {
        const json = stored.json + " "; stored = { json, byteLength: Buffer.byteLength(json), sha256: createHash("sha256").update(json).digest("hex") }; break;
      }
      case "lone_surrogate": data.body.blocks[0].body = "\udfff"; stored = storedJSON(data); break;
      case "oversized": stored = { json: " ".repeat(1_048_577), byteLength: 1_048_577, sha256: "0".repeat(64) }; break;
      case "null": stored = null as never; break;
    }
    reject(() => decodeLegacyChatCheckpoint(stored, binding));
  });

  it("measures worst escaped body and finite metadata bytes without altering Unicode or real zero", async () => {
    const { result } = await execution({ sessionTitle: "👩🏽‍💻".repeat(32),
      usage: { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 } });
    // The provider's separate 16K wire parser rejects a 4K all-control JSON
    // string earlier. This derivative tests the codec's larger structural
    // title/body limits and worst JSON expansion, not a claimed wire response.
    result.body.blocks[0]!.title = result.providerResult!.title = "t" + "\u0001".repeat(159);
    result.body.blocks[0]!.body = result.providerResult!.body = "b" + "\u0001".repeat(3999);
    result.providerResult!.provider_request_id = "r" + "\u0001".repeat(2047);
    result.providerResult!.model = "m".repeat(256);
    result.providerResult!.reported_model = "\u0001".repeat(256);
    result.providerResult!.prompt_revision = "\u0001".repeat(256);
    result.providerResult!.prompt_snapshot = { ...result.providerResult!.prompt_snapshot!, name: "\u0001".repeat(128),
      revision: "\u0001".repeat(256), versionId: "\u0001".repeat(256) };
    const upperBoundBinding = { taskID, provider: { providerID: "deepseek-chat-completions" as const, model: result.providerResult!.model } };
    const stored = encodeLegacyChatCheckpoint(result, upperBoundBinding);
    expect(stored.byteLength).toBe(Buffer.byteLength(stored.json, "utf8"));
    expect(stored.byteLength).toBeLessThan(65_536);
    expect(stored.sha256).toBe(createHash("sha256").update(stored.json).digest("hex"));
    const decoded = decodeLegacyChatCheckpoint(stored, upperBoundBinding);
    expect(decoded.body).toEqual(result.body);
    expect(decoded.completion.usage).toMatchObject({ input_tokens: 0, output_tokens: 0, usage_reported: true, cache_hit_tokens: 0, cache_miss_tokens: 0 });
    console.info("LEGACY_CHAT_CHECKPOINT_JSONB_SAFE_MAX_FIXTURE", { byteLength: stored.byteLength, cap: 1_048_576 });
  });

  it("intentionally excludes runtime prompt/diagnostics even when larger than the DTO budget", async () => {
    const { result } = await execution();
    result.providerResult!.prompt_snapshot!.text = "PRIVATE_RUNTIME_PROMPT\0".repeat(70_000);
    let reads = 0;
    result.remoteDiagnostics = Object.defineProperty({}, "ignored", { get() { reads += 1; throw new Error("PRIVATE_DIAGNOSTIC"); } });
    const stored = encodeLegacyChatCheckpoint(result, binding);
    expect(reads).toBe(0);
    expect(stored.byteLength).toBeLessThan(65_536);
    expect(stored.json).not.toContain("PRIVATE_RUNTIME_PROMPT");
    expect(decodeLegacyChatCheckpoint(stored, binding).body).toEqual(result.body);
  });

  it("keeps valid non-NUL controls and does not extend JSONB restrictions to discarded runtime metadata", async () => {
    const value = "Synthetic\u0001\n\t\r\u001f before";
    const { result } = await execution({ body: value, requestID: value, sessionTitle: "Synthetic\0label" });
    expect(result.remoteStatus).toBe("completed");
    expect(result.providerResult!.session_title).toBe("Synthetic\0label");
    expect(result.body.session_title).toBe("Synthetic label"); // Existing title owner, not codec normalization.
    result.providerResult!.prompt_snapshot!.commit = "discarded\0commit";
    result.providerResult!.prompt_snapshot!.environment = "discarded\0environment";
    const original = structuredClone(result);
    const decoded = decodeLegacyChatCheckpoint(encodeLegacyChatCheckpoint(result, binding), binding);
    expect(decoded.body).toEqual(result.body);
    expect(decoded.body.blocks[0]!.body).toBe(value);
    expect(decoded.completion.provider!.providerRequestID).toBe(value);
    expect(result).toEqual(original);
    expect(decoded.completion.provider!.prompt).not.toHaveProperty("commit");
    expect(decoded.completion.provider!.prompt).not.toHaveProperty("environment");
  });

  it.each(["task", "provider", "model"])("uses only the server binding: %s", async key => {
    const { result } = await execution();
    const expected = structuredClone(binding);
    if (key === "task") Object.assign(expected, { taskID: "22222222-2222-4222-8222-222222222222" });
    if (key === "provider") Object.assign(expected, { provider: null });
    if (key === "model") Object.assign(expected, { provider: { providerID: "deepseek-chat-completions", model: "other" } });
    reject(() => encodeLegacyChatCheckpoint(result, expected));
    const stored = encodeLegacyChatCheckpoint(result, binding);
    reject(() => decodeLegacyChatCheckpoint(stored, expected));
  });

  it.each([null, undefined, 0, false, [], new Date(0)])("rejects non-execution input %s", value => {
    reject(() => encodeLegacyChatCheckpoint(value, binding));
  });
});
