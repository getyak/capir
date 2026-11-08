/** Private answer-only DTO, never execution authority. Store the exact `json`
 * as TEXT: JSONB reformatting is not this byte/digest protocol. */
import { createHash } from "node:crypto";
import { types } from "node:util";
import { CONTRACT_VERSION, type UnscopedChatTaskResponse } from "@talent-signal/contracts";

export const LEGACY_CHAT_CHECKPOINT_MAX_BYTES = 1_048_576;
type Code = "INVALID" | "UNSUPPORTED" | "TOO_LARGE" | "MISMATCH" | "CORRUPT";
export class LegacyChatCheckpointError extends Error {
  readonly code: `LEGACY_CHAT_CHECKPOINT_${Code}`;
  constructor(code: Code) {
    super(`LEGACY_CHAT_CHECKPOINT_${code}`);
    this.name = "LegacyChatCheckpointError";
    this.code = `LEGACY_CHAT_CHECKPOINT_${code}`;
  }
}
export interface LegacyChatCheckpointBinding {
  readonly taskID: string;
  readonly provider: { readonly providerID: "deepseek-chat-completions"; readonly model: string } | null;
}
export interface LegacyChatCheckpointPrompt {
  readonly name: string;
  readonly revision: string;
  readonly versionId: string | null;
  readonly source: "opik" | "cache" | "bundled";
}
export interface LegacyChatCheckpointUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  /** Absence, false, and true are distinct; zero never implies reported usage. */
  readonly usage_reported?: boolean;
  readonly cache_hit_tokens?: number | null;
  readonly cache_miss_tokens?: number | null;
  readonly reported_model?: string | null;
  readonly remote_requests_started?: number | null;
  readonly prompt_revision?: string;
}
export interface LegacyChatCheckpointCompletion {
  readonly remoteStatus: "completed" | "disabled" | "fallback";
  readonly provider: {
    readonly providerID: "deepseek-chat-completions";
    readonly model: string;
    readonly providerRequestID: string | null;
    readonly prompt: LegacyChatCheckpointPrompt | null;
  } | null;
  readonly usage: LegacyChatCheckpointUsage | null;
  readonly remoteFailureCode?: "MODEL_RUN_TIMEOUT" | "MODEL_RUN_TOKEN_BUDGET_EXHAUSTED" | "MODEL_PROVIDER_BILLING_REQUIRED";
}
type ReadonlyTree<T> = T extends object ? { readonly [K in keyof T]: ReadonlyTree<T[K]> } : T;
export interface LegacyChatCheckpoint {
  readonly version: 1;
  readonly taskID: string;
  readonly provider: LegacyChatCheckpointBinding["provider"];
  readonly body: ReadonlyTree<UnscopedChatTaskResponse>;
  readonly completion: LegacyChatCheckpointCompletion;
}
export interface EncodedLegacyChatCheckpoint {
  readonly json: string;
  readonly byteLength: number;
  readonly sha256: string;
}

function check(condition: unknown, code: Code = "INVALID"): asserts condition {
  if (!condition) throw new LegacyChatCheckpointError(code);
}
/** Snapshot each own data slot once. No accessors, symbols, custom prototypes
 * or Proxy traps run, including on known runtime fields excluded from storage. */
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value));
  check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const keys = Reflect.ownKeys(value), allowed = new Set([...required, ...optional]);
  check(keys.length <= allowed.size, "UNSUPPORTED");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    check(typeof key === "string" && allowed.has(key), "UNSUPPORTED");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && "value" in descriptor && descriptor.enumerable);
    result[key] = descriptor.value;
  }
  check(required.every(key => Object.hasOwn(result, key)));
  return result;
}
function list(value: unknown, count: number): unknown[] {
  check(Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype);
  check(Object.getOwnPropertyDescriptor(value, "length")?.value === count, "UNSUPPORTED");
  check(Reflect.ownKeys(value).length === count + 1);
  const result: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    check(descriptor && "value" in descriptor && descriptor.enumerable);
    result.push(descriptor.value);
  }
  return result;
}
function text(value: unknown, maxUnits: number, maxBytes = maxUnits * 4, jsonbDestination = true): string {
  check(typeof value === "string");
  check(value.length <= maxUnits, "TOO_LARGE");
  check(value.length > 0);
  // Checkpoint TEXT can escape NUL, but canonical 201/audit JSONB cannot
  // represent it. Reject before checkpointing; never normalize or delete it.
  // https://www.postgresql.org/docs/18/datatype-json.html
  check(!jsonbDestination || !value.includes("\0"));
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      check(next >= 0xdc00 && next <= 0xdfff);
    } else check(unit < 0xdc00 || unit > 0xdfff);
  }
  check(Buffer.byteLength(value, "utf8") <= maxBytes, "TOO_LARGE");
  return value;
}
const nullableText = (value: unknown, maxBytes: number, jsonbDestination = true) =>
  value === null ? null : text(value, maxBytes, maxBytes, jsonbDestination);
function id(value: unknown): string {
  const result = text(value, 36, 36);
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(result));
  return result;
}
function count(value: unknown): number {
  check(typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return value;
}
const nullableCount = (value: unknown) => value === null ? null : count(value);
function readBinding(value: unknown): LegacyChatCheckpointBinding {
  const source = record(value, ["taskID", "provider"]), taskID = id(source.taskID);
  if (source.provider === null) return { taskID, provider: null };
  const provider = record(source.provider, ["providerID", "model"]);
  check(provider.providerID === "deepseek-chat-completions", "MISMATCH");
  return { taskID, provider: { providerID: provider.providerID, model: text(provider.model, 256, 256) } };
}
function sameBinding(value: unknown, expected: LegacyChatCheckpointBinding): void {
  const actual = readBinding(value);
  check(actual.taskID === expected.taskID && (actual.provider === null ? expected.provider === null
    : expected.provider?.providerID === actual.provider.providerID && expected.provider.model === actual.provider.model), "MISMATCH");
}
function sessionTitle(value: unknown): string {
  const title = text(value, 512, 1024);
  check(Array.from(title).length <= 256 && title.trim() === title && !/[\u0000-\u001f\u007f-\u009f]/u.test(title));
  let graphemes = 0;
  for (const _part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title))
    check(++graphemes <= 32, "TOO_LARGE");
  return title;
}
function body(value: unknown, binding: LegacyChatCheckpointBinding): UnscopedChatTaskResponse {
  const source = record(value, ["contract_version", "task_id", "disposition", "blocks", "agent_event", "external_effects", "created_at"], ["session_title"]);
  check(source.contract_version === CONTRACT_VERSION);
  check(id(source.task_id) === binding.taskID, "MISMATCH");
  check(source.agent_event === null, "UNSUPPORTED");
  list(source.external_effects, 0);
  const block = record(list(source.blocks, 1)[0], ["id", "kind", "title", "body", "status", "citation_dependency_ids", "requires_user_decision"]);
  check(block.kind === "answer" || block.kind === "clarification", "UNSUPPORTED");
  const clarification = block.kind === "clarification";
  check(source.disposition === (clarification ? "clarify" : "answer"));
  check(block.status === (clarification ? "needs_review" : "informational") && block.requires_user_decision === clarification, "UNSUPPORTED");
  list(block.citation_dependency_ids, 0);
  const title = text(block.title, 160), content = text(block.body, 4000);
  check(title.trim().length > 0 && content.trim().length > 0);
  const created = text(source.created_at, 24, 24);
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(created)
    && Number.isFinite(Date.parse(created)) && new Date(created).toISOString() === created);
  return { contract_version: CONTRACT_VERSION, task_id: binding.taskID, disposition: clarification ? "clarify" : "answer",
    blocks: [{ id: id(block.id), kind: block.kind, title, body: content,
      status: clarification ? "needs_review" : "informational", citation_dependency_ids: [], requires_user_decision: clarification }],
    agent_event: null, external_effects: [],
    ...(Object.hasOwn(source, "session_title") ? { session_title: sessionTitle(source.session_title) } : {}), created_at: created };
}
function prompt(value: unknown, runtime: boolean): LegacyChatCheckpointPrompt {
  const source = record(value, ["name", "revision", "versionId", "source", ...(runtime ? ["text"] : [])], runtime ? ["commit", "environment"] : []);
  check(source.source === "bundled" || source.source === "opik" || source.source === "cache");
  // Owning serializer governs runtime text. Do not copy, measure, stringify or
  // traverse it; only the four completion-audit reference fields persist.
  if (runtime) {
    check(typeof source.text === "string");
    for (const key of ["commit", "environment"]) if (Object.hasOwn(source, key)) nullableText(source[key], 256, false);
  }
  return { name: text(source.name, 128, 128), revision: text(source.revision, 256, 256),
    versionId: nullableText(source.versionId, 256), source: source.source };
}
const usageOptional = ["usage_reported", "cache_hit_tokens", "cache_miss_tokens", "reported_model", "remote_requests_started", "prompt_revision"] as const;
function usage(source: Record<string, unknown>): LegacyChatCheckpointUsage {
  const input = count(source.input_tokens), output = count(source.output_tokens);
  check(Number.isSafeInteger(input + output));
  if (Object.hasOwn(source, "usage_reported")) check(typeof source.usage_reported === "boolean");
  const hit = Object.hasOwn(source, "cache_hit_tokens") ? nullableCount(source.cache_hit_tokens) : undefined;
  const miss = Object.hasOwn(source, "cache_miss_tokens") ? nullableCount(source.cache_miss_tokens) : undefined;
  if (typeof hit === "number" && typeof miss === "number") check(Number.isSafeInteger(hit + miss) && hit + miss === input);
  return { input_tokens: input, output_tokens: output,
    ...(Object.hasOwn(source, "usage_reported") ? { usage_reported: source.usage_reported as boolean } : {}),
    ...(hit !== undefined ? { cache_hit_tokens: hit } : {}), ...(miss !== undefined ? { cache_miss_tokens: miss } : {}),
    ...(Object.hasOwn(source, "reported_model") ? { reported_model: nullableText(source.reported_model, 256) } : {}),
    ...(Object.hasOwn(source, "remote_requests_started") ? { remote_requests_started: nullableCount(source.remote_requests_started) } : {}),
    ...(Object.hasOwn(source, "prompt_revision") ? { prompt_revision: text(source.prompt_revision, 256, 256) } : {}) };
}
function failureCode(value: unknown): NonNullable<LegacyChatCheckpointCompletion["remoteFailureCode"]> {
  check(value === "MODEL_RUN_TIMEOUT" || value === "MODEL_RUN_TOKEN_BUDGET_EXHAUSTED" || value === "MODEL_PROVIDER_BILLING_REQUIRED");
  return value;
}
function completion(value: unknown, binding: LegacyChatCheckpointBinding, publicBody: UnscopedChatTaskResponse): LegacyChatCheckpointCompletion {
  const source = record(value, ["remoteStatus", "provider", "usage"], ["remoteFailureCode"]);
  check(source.remoteStatus === "completed" || source.remoteStatus === "disabled" || source.remoteStatus === "fallback", "UNSUPPORTED");
  const remoteStatus = source.remoteStatus;
  check((remoteStatus === "disabled") === (binding.provider === null), "MISMATCH");
  check(!Object.hasOwn(source, "remoteFailureCode") || remoteStatus === "fallback");
  const failure = Object.hasOwn(source, "remoteFailureCode") ? { remoteFailureCode: failureCode(source.remoteFailureCode) } : {};
  if (remoteStatus !== "completed") {
    check(source.provider === null && source.usage === null && publicBody.disposition === "answer");
    return { remoteStatus, provider: null, usage: null, ...failure };
  }
  const provider = record(source.provider, ["providerID", "model", "providerRequestID", "prompt"]);
  check(provider.providerID === binding.provider?.providerID && provider.model === binding.provider?.model, "MISMATCH");
  const fields = record(source.usage, ["input_tokens", "output_tokens"], usageOptional);
  return { remoteStatus, provider: { providerID: "deepseek-chat-completions", model: text(provider.model, 256, 256),
    providerRequestID: nullableText(provider.providerRequestID, 2048), prompt: provider.prompt === null ? null : prompt(provider.prompt, false) },
    usage: usage(fields), ...failure };
}
function project(execution: unknown, binding: LegacyChatCheckpointBinding): LegacyChatCheckpoint {
  const source = record(execution, ["body", "conversationMessageIDs", "previousTaskIDs", "remoteStatus", "providerResult", "agentProviderResult"],
    ["conversationSources", "remoteFailureCode", "remoteDiagnostics"]);
  list(source.conversationMessageIDs, 0); list(source.previousTaskIDs, 0);
  if (Object.hasOwn(source, "conversationSources")) list(source.conversationSources, 0);
  check(source.agentProviderResult === null, "UNSUPPORTED");
  const publicBody = body(source.body, binding);
  let provider: LegacyChatCheckpointCompletion["provider"] = null;
  let tokens: LegacyChatCheckpointUsage | null = null;
  if (source.providerResult !== null) {
    const answer = record(source.providerResult,
      ["kind", "title", "body", "citation_ids", "provider_id", "model", "provider_request_id", "input_tokens", "output_tokens"],
      [...usageOptional, "session_title", "prompt_snapshot"]);
    check(answer.provider_id === binding.provider?.providerID && answer.model === binding.provider?.model, "MISMATCH");
    list(answer.citation_ids, 0);
    const block = publicBody.blocks[0]!;
    check(answer.kind === block.kind && answer.title === block.title && answer.body === block.body, "MISMATCH");
    if (Object.hasOwn(answer, "session_title")) {
      const title = text(answer.session_title, 512, 1024, false);
      check(Array.from(title).length <= 256);
    }
    provider = { providerID: "deepseek-chat-completions", model: text(answer.model, 256, 256),
      providerRequestID: nullableText(answer.provider_request_id, 2048),
      prompt: Object.hasOwn(answer, "prompt_snapshot") ? prompt(answer.prompt_snapshot, true) : null };
    tokens = usage(answer);
  }
  const result = completion({ remoteStatus: source.remoteStatus, provider, usage: tokens,
    ...(Object.hasOwn(source, "remoteFailureCode") ? { remoteFailureCode: source.remoteFailureCode } : {}) }, binding, publicBody);
  // Known remoteDiagnostics is runtime-only operator metadata; arbitrary
  // nested fields are neither traversed nor promoted into stored audit prose.
  return { version: 1, taskID: binding.taskID, provider: binding.provider, body: publicBody, completion: result };
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function boundedJSON(value: LegacyChatCheckpoint): string {
  const json = JSON.stringify(value);
  check(Buffer.byteLength(json, "utf8") <= LEGACY_CHAT_CHECKPOINT_MAX_BYTES, "TOO_LARGE");
  return json;
}
function guarded<T>(action: () => T): T {
  try { return action(); }
  catch (error) {
    if (error instanceof LegacyChatCheckpointError) throw error;
    // Do not copy parser/getter/private errors into a durable failure reason.
    throw new LegacyChatCheckpointError("INVALID");
  }
}
export function encodeLegacyChatCheckpoint(execution: unknown, expected: LegacyChatCheckpointBinding): EncodedLegacyChatCheckpoint {
  return guarded(() => {
    const json = boundedJSON(project(execution, readBinding(expected)));
    return Object.freeze({ json, byteLength: Buffer.byteLength(json, "utf8"), sha256: createHash("sha256").update(json).digest("hex") });
  });
}
export function decodeLegacyChatCheckpoint(stored: unknown, expected: LegacyChatCheckpointBinding): LegacyChatCheckpoint {
  return guarded(() => {
    const binding = readBinding(expected), source = record(stored, ["json", "byteLength", "sha256"]);
    check(typeof source.json === "string");
    check(source.json.length <= LEGACY_CHAT_CHECKPOINT_MAX_BYTES, "TOO_LARGE");
    const bytes = Buffer.byteLength(source.json, "utf8");
    check(bytes <= LEGACY_CHAT_CHECKPOINT_MAX_BYTES, "TOO_LARGE");
    check(source.byteLength === bytes && bytes > 0 && typeof source.sha256 === "string"
      && /^[0-9a-f]{64}$/u.test(source.sha256) && createHash("sha256").update(source.json).digest("hex") === source.sha256, "CORRUPT");
    const decoded = record(JSON.parse(source.json) as unknown, ["version", "taskID", "provider", "body", "completion"]);
    check(decoded.version === 1);
    sameBinding({ taskID: decoded.taskID, provider: decoded.provider }, binding);
    const publicBody = body(decoded.body, binding);
    const result: LegacyChatCheckpoint = { version: 1, taskID: binding.taskID, provider: binding.provider,
      body: publicBody, completion: completion(decoded.completion, binding, publicBody) };
    // Reject duplicate keys/alternate encoding or DB rewriting, even if a hash
    // was recomputed. The exact canonical TEXT representation is the protocol.
    check(boundedJSON(result) === source.json, "CORRUPT");
    return freeze(result);
  });
}
