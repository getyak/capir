import { createHash, randomUUID } from "node:crypto";

import {
  CONTACT_RESEARCH_CONTRACT,
  CONTACT_RESEARCH_EXA_CHANNELS,
  ContactResearchChannelSchema,
  ContactResearchToolRequestSchema,
  ContactResearchToolResponseSchema,
  AgentPersonResearchPolicyError,
  assertPersonResearchQuery,
  admitPublicContextAnchor,
  type ContactPublicSource,
  type ContactResearchChannel,
  type ContactResearchToolRequest,
  type ContactResearchToolResponse,
} from "@talent-signal/agent";

import {
  assertContactResearchResponseMatchesRequest,
  type ContactResearchClient,
} from "./contactResearchClient.js";

/**
 * Workspace public-subject research adapter.
 *
 * One bounded, independently testable bridge between the workspace conversation
 * runtime and the existing Agent Host research socket contract
 * (`ContactResearchClient`, contract `contact-research-tools.v3`). It exposes
 * exactly two read-only tools:
 *
 *   - `search_public_subject({ subject_id, channels? })` discovers public
 *     sources for ONE host-authorized public subject. The tool accepts only the
 *     host-owned subject id: names, ids, queries and context come from the host
 *     registry (an explicit public-topic objective, inspected image evidence,
 *     or the host's tentative first-contact subject), never from model-authored
 *     raw text. The outbound provider request carries ONLY the host-derived
 *     query built from the registered name plus its admitted source-grounded
 *     context anchors, those same anchors, the channel list, and per-call ids.
 *     The objective, conversation text, screenshots and private notes never
 *     cross the boundary.
 *   - `fetch_public_sources({ source_ids })` reads sources this same run
 *     discovered. Unknown or foreign ids are refused before any provider call.
 *
 * Usage (parent-owned integration):
 *
 *   const research = createWorkspacePublicResearch({
 *     client, taskID,
 *     authorizedSubjects: () => registry.publicSubjects(), // host-owned
 *     signal,
 *   });
 *   // Provider manifest: research.names + research.schemas (JSON-Schema input
 *   // contracts) plus research.tools entries (HarnessTool-shaped execute that
 *   // returns JSON text content blocks).
 *   // Or drive the governed seam directly:
 *   const result = await research.execute("search_public_subject", { subject_id: "sub-1" });
 *   // result.data carries full ContactPublicSource receipts (url, text,
 *   // content_hash, retrieved_at, stage, ...). Only these host tool receipts
 *   // can establish retrieved sources; prose is never a receipt.
 *
 * Trust rules preserved here:
 * - subject identity comes from the host registry callback; each subject's
 *   optional `isCurrent` guard is asserted immediately before and after every
 *   provider dispatch, and a stale subject fails the call without registering
 *   or returning any source;
 * - the host name and derived query are re-checked with the existing person-
 *   research query policy (no contact details, addresses, background checks,
 *   face matching, or protected-trait assessment) before anything can enter an
 *   outbound query; context anchors were admitted source-grounded and typed
 *   upstream and are re-bounded here;
 * - responses are re-parsed and bound to the exact request via the existing
 *   `assertContactResearchResponseMatchesRequest` readback assertion plus an
 *   inline search validation: exact channel list/order, unique source ids, each
 *   source on a successful channel with its expected provider and count, and no
 *   failed channel carrying sources;
 * - only sources actually registered in the same-run registry are returned;
 *   repeat receipts update their slot and the truncated flag stays accurate;
 * - search/fetch budgets are reserved synchronously immediately before the
 *   client dispatch and are never refunded, so failures and concurrent calls
 *   cannot widen the budget;
 * - one automatic retry is allowed per search tool invocation, only for
 *   genuinely transient transport/backend failures (explicit
 *   `CONTACT_RESEARCH_INJECTED_TRANSIENT` plus observed socket timeout/reset,
 *   refused, and HTTP 429/5xx codes), with a fresh call_id, rechecked subject
 *   currency and abort state, and identical anchors/query/channels provenance.
 *   Permanent injected unavailability, validation, security, readback, and
 *   abort failures never retry, and the retry itself dispatches only inside
 *   the remaining global budget;
 * - every search/fetch receipt carries sanitized per-dispatch attempt metadata
 *   (call_id, ok/failed, code-shaped error code) on success and failure paths;
 * - every failure is a sanitized tool failure: fixed messages plus at most a
 *   code-shaped detail, never raw provider text.
 */

export const WORKSPACE_PUBLIC_RESEARCH_TOOL_NAMES = [
  "search_public_subject",
  "fetch_public_sources",
] as const;
export type WorkspacePublicResearchToolName =
  (typeof WORKSPACE_PUBLIC_RESEARCH_TOOL_NAMES)[number];

/** Same-run discovery registry cap; fetch accepts only these receipts. */
export const WORKSPACE_PUBLIC_RESEARCH_MAX_SOURCES = 5;
/** Global search dispatch budget: every dispatch, including retries, counts. */
export const WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS = 3;
/** Per-invocation dispatch cap: the initial attempt plus one transient retry. */
export const WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_DISPATCHES_PER_INVOCATION = 2;
export const WORKSPACE_PUBLIC_RESEARCH_MAX_FETCH_CALLS = 2;
export const WORKSPACE_PUBLIC_RESEARCH_MAX_CHANNELS = 4;
export const WORKSPACE_PUBLIC_RESEARCH_MAX_SUBJECT_ANCHORS = 5;
export const WORKSPACE_PUBLIC_RESEARCH_RESULTS_PER_CHANNEL = 3;
/** Bound for listing host subjects inside the tool description. */
export const WORKSPACE_PUBLIC_RESEARCH_MAX_LISTED_SUBJECTS = 10;

/**
 * Derive the ONLY query text that ever leaves the workspace for a public
 * subject: the host-owned name plus admitted source-grounded context (works,
 * roles, canonical public profiles/handles), bounded by the existing person-research query
 * length. With no admissible context the minimal biography query is kept. The
 * model cannot supply, edit, or widen this text.
 */
export function workspacePublicResearchQuery(
  name: string,
  contextAnchors: readonly WorkspacePublicResearchContextAnchor[] = [],
): string {
  const nameText = name.normalize("NFKC").trim();
  const parts = [nameText];
  for (const anchor of contextAnchors) {
    if (!admitPublicContextAnchor(anchor.kind, anchor.text, [anchor.text])) continue;
    const text = anchor.text.normalize("NFKC").trim();
    if (text.length < 2) continue;
    const candidate = [...parts, text].join(" ");
    if (candidate.length > WORKSPACE_PUBLIC_RESEARCH_QUERY_MAX_LENGTH) continue;
    parts.push(text);
  }
  if (parts.length === 1) {
    const fallback = `${nameText} biography official website`;
    return fallback.length <= WORKSPACE_PUBLIC_RESEARCH_QUERY_MAX_LENGTH
      ? fallback
      : nameText;
  }
  return parts.join(" ");
}

/** Existing person-research policy bounds an outbound query to 100 characters. */
export const WORKSPACE_PUBLIC_RESEARCH_QUERY_MAX_LENGTH = 100;

/** Typed, host-admitted public context; never model-authored text. */
export interface WorkspacePublicResearchContextAnchor {
  kind: "work" | "role" | "handle";
  text: string;
}

/** Host-owned public subject. Names and ids are never model-authored. */
export interface WorkspacePublicResearchSubject {
  /** Stable host id; the only subject reference the tools accept. */
  id: string;
  /** Host-owned public name; used verbatim in the derived outbound query. */
  name: string;
  /** Admitted source-grounded context entering the query and anchors. */
  contextAnchors?: readonly WorkspacePublicResearchContextAnchor[];
  /** Optional currency guard, asserted before and after every dispatch. */
  isCurrent?: () => Promise<boolean>;
}

/** Sanitized per-dispatch receipt: no provider text, only code-shaped codes. */
export interface WorkspacePublicResearchAttemptReceipt {
  call_id: string;
  status: "ok" | "failed";
  error_code?: string;
  channel_failures?: Array<{channel:ContactResearchChannel;error_code:string|null}>;
}

export interface WorkspacePublicResearchOptions {
  client: ContactResearchClient;
  /** One uuid per user turn/run; binds every provider request and response. */
  taskID: string;
  /**
   * Host-owned subject registry snapshot, re-read on every tool call so later
   * image inspection can add subjects and revocation can remove them.
   */
  authorizedSubjects: () => readonly WorkspacePublicResearchSubject[];
  signal?: AbortSignal;
}

export interface WorkspacePublicResearchToolSuccess {
  ok: true;
  callID: string;
  name: string;
  data?: unknown;
  attempts?: readonly WorkspacePublicResearchAttemptReceipt[];
}

export interface WorkspacePublicResearchToolFailure {
  ok: false;
  callID: string;
  name: string;
  error: { code: string; message: string; detail?: string };
  attempts?: readonly WorkspacePublicResearchAttemptReceipt[];
}

export type WorkspacePublicResearchToolResult =
  | WorkspacePublicResearchToolSuccess
  | WorkspacePublicResearchToolFailure;

/** HarnessTool-shaped entry minus zod (not a backend dependency). */
export interface WorkspacePublicResearchTool {
  name: WorkspacePublicResearchToolName;
  description: string;
  readOnly: true;
  alwaysLoad: true;
  /** JSON-Schema input contract for a provider manifest. */
  parameters: Record<string, unknown>;
  execute(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
  }>;
}

export interface WorkspacePublicResearchToolDefinitions {
  readonly names: readonly WorkspacePublicResearchToolName[];
  /** JSON-Schema input contracts keyed by tool name. */
  readonly schemas: Record<
    WorkspacePublicResearchToolName,
    Record<string, unknown>
  >;
  readonly tools: readonly WorkspacePublicResearchTool[];
  /** Governed structured seam: sanitized results, never thrown provider errors. */
  execute(
    name: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<WorkspacePublicResearchToolResult>;
  /**
   * Same-run search state for one subject so host-driven first-contact search
   * can deduplicate a subject the model already searched this run.
   */
  subjectSearchState(subjectID: string): {
    searched: boolean;
    sources: readonly ContactPublicSource[];
  };
}

const CHANNELS = [
  "linkedin",
  "web",
  "xiaohongshu",
  "reddit",
  "douyin",
  "tiktok",
  "weibo",
  "threads",
  "instagram",
] as const satisfies readonly ContactResearchChannel[];

const SEARCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["subject_id"],
  properties: {
    subject_id: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description:
        "A host-authorized public subject id from the listed subjects. Never a raw name, contact, or conversation text.",
    },
    channels: {
      type: "array",
      minItems: 1,
      maxItems: WORKSPACE_PUBLIC_RESEARCH_MAX_CHANNELS,
      uniqueItems: true,
      items: { type: "string", enum: [...CHANNELS] },
      description:
        "Optional existing public channel allowlist. Defaults to web only.",
    },
  },
};

const FETCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["source_ids"],
  properties: {
    source_ids: {
      type: "array",
      minItems: 1,
      maxItems: WORKSPACE_PUBLIC_RESEARCH_MAX_SOURCES,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-f0-9]{64}$" },
      description:
        "Ordered, unique source_id receipts returned by search_public_subject in this same run.",
    },
  },
};

const CODE_SHAPED = /^[A-Z][A-Z0-9_]{2,63}$/u;
const SOURCE_ID = /^[a-f0-9]{64}$/u;

class WorkspacePublicResearchStaleSubjectError extends Error {
  constructor() {
    super("PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT");
  }
}

class WorkspacePublicResearchResponseError extends Error {
  constructor() {
    super("PUBLIC_RESEARCH_RESPONSE_MISMATCH");
  }
}

function failure(
  name: string,
  callID: string,
  code: string,
  message: string,
  detail?: string,
): WorkspacePublicResearchToolFailure {
  return {
    ok: false,
    callID,
    name,
    error: { code, message, ...(detail && CODE_SHAPED.test(detail) ? { detail } : {}) },
  };
}

function attachAttempts(
  result: WorkspacePublicResearchToolResult,
  attempts: readonly WorkspacePublicResearchAttemptReceipt[],
): WorkspacePublicResearchToolResult {
  return attempts.length > 0 ? { ...result, attempts: [...attempts] } : result;
}

function thrownCodes(error: unknown): string[] {
  const codes: string[] = [];
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  if (code && CODE_SHAPED.test(code)) codes.push(code);
  const message = error instanceof Error ? error.message : "";
  if (CODE_SHAPED.test(message) && !codes.includes(message)) codes.push(message);
  return codes;
}

function thrownDetail(error: unknown): string | undefined {
  return thrownCodes(error)[0];
}

/**
 * Genuinely transient transport/backend failures observed from the real
 * `LocalContactResearchClient` (socket timeout/reset/refused, HTTP 429/5xx)
 * plus the explicit `CONTACT_RESEARCH_INJECTED_TRANSIENT` test fault. Permanent
 * injected unavailability (`CONTACT_RESEARCH_UNAVAILABLE`), policy,
 * validation, security, readback-mismatch, abort, and stale-subject failures
 * are never in this set and never retry.
 */
export const WORKSPACE_PUBLIC_RESEARCH_TRANSIENT_ERROR_CODES: readonly string[] = [
  "CONTACT_RESEARCH_INJECTED_TRANSIENT",
  "CONTACT_RESEARCH_CHANNEL_TRANSIENT",
  "CONTACT_RESEARCH_TIMEOUT",
  "CONTACT_RESEARCH_HTTP_429",
  "CONTACT_RESEARCH_HTTP_500",
  "CONTACT_RESEARCH_HTTP_502",
  "CONTACT_RESEARCH_HTTP_503",
  "CONTACT_RESEARCH_HTTP_504",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
];

export function isWorkspacePublicResearchTransientError(error: unknown): boolean {
  const codes = thrownCodes(error);
  return codes.some((code) =>
    (WORKSPACE_PUBLIC_RESEARCH_TRANSIENT_ERROR_CODES as readonly string[]).includes(code),
  );
}

function expectedProvider(channel: ContactResearchChannel): "exa" | "tikhub" {
  return CONTACT_RESEARCH_EXA_CHANNELS.includes(channel as "linkedin" | "web")
    ? "exa"
    : "tikhub";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSearchInput(
  raw: unknown,
): { subjectID: string; channels: ContactResearchChannel[] | null } | null {
  if (!isPlainObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.some((key) => key !== "subject_id" && key !== "channels")) return null;
  const subjectID = raw.subject_id;
  if (typeof subjectID !== "string" || subjectID.length < 1 || subjectID.length > 200) {
    return null;
  }
  if (raw.channels === undefined) return { subjectID, channels: null };
  const channels = raw.channels;
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > WORKSPACE_PUBLIC_RESEARCH_MAX_CHANNELS) {
    return null;
  }
  const parsed: ContactResearchChannel[] = [];
  for (const channel of channels) {
    const validated = ContactResearchChannelSchema.safeParse(channel);
    if (!validated.success || parsed.includes(validated.data)) return null;
    parsed.push(validated.data);
  }
  return { subjectID, channels: parsed };
}

function parseFetchInput(raw: unknown): { sourceIDs: string[] } | null {
  if (!isPlainObject(raw)) return null;
  if (Object.keys(raw).some((key) => key !== "source_ids")) return null;
  const sourceIDs = raw.source_ids;
  if (!Array.isArray(sourceIDs) || sourceIDs.length < 1 || sourceIDs.length > WORKSPACE_PUBLIC_RESEARCH_MAX_SOURCES) {
    return null;
  }
  if (
    sourceIDs.some((id) => typeof id !== "string" || !SOURCE_ID.test(id)) ||
    new Set(sourceIDs).size !== sourceIDs.length
  ) {
    return null;
  }
  return { sourceIDs: sourceIDs as string[] };
}

/**
 * Inline search-response binding (kept here so the shared client assertion
 * stays untouched): exact requested channel list and order, unique source ids,
 * every source on a successful channel with its expected provider, per-channel
 * counts matching returned sources, and no failed channel carrying sources.
 */
function validateSearchResponse(
  channels: readonly ContactResearchChannel[],
  response: ContactResearchToolResponse,
): void {
  const outcomeChannels = response.channels.map((outcome) => outcome.channel);
  if (
    outcomeChannels.length !== channels.length ||
    outcomeChannels.some((channel, index) => channel !== channels[index])
  ) {
    throw new WorkspacePublicResearchResponseError();
  }
  const seen = new Set<string>();
  const counts = new Map<ContactResearchChannel, number>();
  for (const source of response.sources) {
    if (!channels.includes(source.channel) || source.stage !== (source.provider_id === "exa" ? "discovered" : "profile_observation")
      || source.source_id !== createHash("sha256").update(`${source.provider_id}:${source.url}`).digest("hex")) throw new WorkspacePublicResearchResponseError();
    if (seen.has(source.source_id)) throw new WorkspacePublicResearchResponseError();
    seen.add(source.source_id);
    if (
      source.provider_id === "browser" ||
      source.provider_id !== expectedProvider(source.channel)
    ) {
      throw new WorkspacePublicResearchResponseError();
    }
    counts.set(source.channel, (counts.get(source.channel) ?? 0) + 1);
  }
  for (const outcome of response.channels) {
    const returned = counts.get(outcome.channel) ?? 0;
    if (outcome.status === "ok") {
      if (outcome.provider !== expectedProvider(outcome.channel) || outcome.result_count !== returned || returned > WORKSPACE_PUBLIC_RESEARCH_RESULTS_PER_CHANNEL) {
        throw new WorkspacePublicResearchResponseError();
      }
    } else if (returned !== 0 || outcome.result_count !== 0) {
      // A failed channel never carries sources.
      throw new WorkspacePublicResearchResponseError();
    }
  }
}

export function createWorkspacePublicResearch(
  options: WorkspacePublicResearchOptions,
): WorkspacePublicResearchToolDefinitions {
  if (!ContactResearchToolRequestSchema.shape.task_id.safeParse(options.taskID).success) {
    throw new Error("WORKSPACE_PUBLIC_RESEARCH_TASK_ID_INVALID");
  }
  interface RegistryEntry {
    source: ContactPublicSource;
    subjectID: string;
  }
  const discoveredSources = new Map<string, RegistryEntry>();
  const subjectSources = new Map<string, Set<string>>();
  const searchedSubjects = new Set<string>();
  let searchCalls = 0;
  let fetchCalls = 0;

  const subjectAnchors = (subject: WorkspacePublicResearchSubject): string[] => {
    const texts = [
      subject.name,
      ...(subject.contextAnchors ?? []).filter(anchor => admitPublicContextAnchor(anchor.kind, anchor.text, [anchor.text])).map((anchor) => anchor.text),
    ];
    const bounded: string[] = [];
    for (const text of texts) {
      const value = text.normalize("NFKC").trim();
      if (value.length < 2 || value.length > 200 || bounded.includes(value)) continue;
      bounded.push(value);
      if (bounded.length >= WORKSPACE_PUBLIC_RESEARCH_MAX_SUBJECT_ANCHORS) break;
    }
    return bounded;
  };
  const subjectQuery = (subject: WorkspacePublicResearchSubject): string =>
    workspacePublicResearchQuery(subject.name, subject.contextAnchors ?? []);

  const resolveSubject = (subjectID: string): WorkspacePublicResearchSubject | null =>
    options.authorizedSubjects().find((subject) => subject.id === subjectID) ?? null;

  const assertSubjectCurrent = async (
    subject: WorkspacePublicResearchSubject,
  ): Promise<void> => {
    if (subject.isCurrent && !(await subject.isCurrent())) {
      throw new WorkspacePublicResearchStaleSubjectError();
    }
  };

  const runSearch = async (
    rawInput: unknown,
    callID: string,
    runSignal: AbortSignal | undefined,
  ): Promise<WorkspacePublicResearchToolResult> => {
    const name = "search_public_subject";
    if (searchCalls >= WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS) {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_BUDGET_EXHAUSTED",
        "This turn reached its public research search limit.",
      );
    }
    const input = parseSearchInput(rawInput);
    if (!input) {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_TOOL_INPUT_INVALID",
        "The public-subject request did not match its typed contract.",
      );
    }
    const subject = resolveSubject(input.subjectID);
    if (!subject) {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_SUBJECT_NOT_AUTHORIZED",
        "Only host-authorized public subjects can be researched.",
      );
    }
    if (typeof subject.name !== "string") {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_SUBJECT_NOT_AUTHORIZED",
        "Only host-authorized public subjects can be researched.",
      );
    }
    try {
      // Defense in depth on the host-owned name and derived query: no contact
      // details, addresses, background checks, face matching, or sensitive
      // assessment may ever enter an outbound public query.
      assertPersonResearchQuery(subject.name);
      assertPersonResearchQuery(subjectQuery(subject));
    } catch (error) {
      if (error instanceof AgentPersonResearchPolicyError) {
        return failure(
          name,
          callID,
          error.code === "PERSON_RESEARCH_QUERY_INVALID"
            ? "PUBLIC_RESEARCH_QUERY_INVALID"
            : "PUBLIC_RESEARCH_QUERY_PROHIBITED",
          "Public subject research cannot search private details or sensitive attributes.",
          error.code,
        );
      }
      throw error;
    }
    const channels = input.channels ?? ["web"];
    // Deterministic provenance: every dispatch (initial or retry) carries
    // identical anchors, query, and channels. Only the per-dispatch call_id is
    // fresh; there is no arbitrary query broadening.
    const buildRequest = (attemptCallID: string): ContactResearchToolRequest =>
      ContactResearchToolRequestSchema.parse({
        contract_version: CONTACT_RESEARCH_CONTRACT,
        task_id: options.taskID,
        call_id: attemptCallID,
        // Only minimal host-owned public identity clues cross the boundary:
        // the registered name and its admitted source-grounded context. The
        // objective, screenshots, and conversation text are never included.
        anchors: subjectAnchors(subject),
        input: {
          operation: "search",
          channels,
          query: subjectQuery(subject),
          maximum_results_per_channel: WORKSPACE_PUBLIC_RESEARCH_RESULTS_PER_CHANNEL,
        },
      });
    const attempts: WorkspacePublicResearchAttemptReceipt[] = [];
    let response: ContactResearchToolResponse | null = null;
    let lastDetail: string | undefined;
    // At most one automatic retry per invocation (two dispatches), and only for
    // genuinely transient transport/backend failures, inside the global search
    // dispatch budget. Each dispatch rechecks subject currency and abort state
    // and reserves its budget synchronously before awaiting.
    for (
      let dispatch = 1;
      dispatch <= WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_DISPATCHES_PER_INVOCATION;
      dispatch += 1
    ) {
      const attemptCallID = dispatch === 1 ? callID : randomUUID();
      try {
        await assertSubjectCurrent(subject);
      } catch {
        return attachAttempts(
          failure(name, callID, "PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT",
            "The public subject is no longer current."),
          attempts,
        );
      }
      if (runSignal?.aborted) {
        return attachAttempts(
          failure(name, callID, "PUBLIC_RESEARCH_CANCELLED", "The public research call was cancelled."),
          attempts,
        );
      }
      // Reserve synchronously, immediately before awaiting. Failures are never
      // refunded, so failures, retries, and concurrent calls cannot widen the
      // global dispatch budget.
      if (searchCalls >= WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS) {
        if (attempts.length === 0) {
          return failure(
            name,
            callID,
            "PUBLIC_RESEARCH_BUDGET_EXHAUSTED",
            "This turn reached its public research search limit.",
          );
        }
        // No dispatch budget remains for the one permitted retry: report the
        // actual failure below with its attempt receipts.
        break;
      }
      searchCalls += 1;
      const request = buildRequest(attemptCallID);
      let channelFailures: WorkspacePublicResearchAttemptReceipt["channel_failures"];
      try {
        const parsed = ContactResearchToolResponseSchema.parse(
          await options.client.execute(request, runSignal ?? new AbortController().signal),
        );
        runSignal?.throwIfAborted();
        assertContactResearchResponseMatchesRequest(request, parsed);
        validateSearchResponse(channels, parsed);
        await assertSubjectCurrent(subject);
        if (parsed.channels.length && parsed.channels.every(channel => channel.status !== "ok")) {
          channelFailures = parsed.channels.map(channel => ({channel:channel.channel,error_code:channel.error_code}));
          const transient = parsed.channels.every(channel => channel.status === "failed"
            && (channel.error_code === "UNAVAILABLE" || channel.error_code === "RATE_LIMITED"));
          throw new Error(transient ? "CONTACT_RESEARCH_CHANNEL_TRANSIENT" : "CONTACT_RESEARCH_CHANNEL_FAILED");
        }
        attempts.push({ call_id: attemptCallID, status: "ok" });
        response = parsed;
        break;
      } catch (error) {
        const detail = thrownDetail(error);
        attempts.push({
          call_id: attemptCallID,
          status: "failed",
          ...(detail ? { error_code: detail } : {}),
          ...(channelFailures ? {channel_failures:channelFailures} : {}),
        });
        lastDetail = detail;
        if (runSignal?.aborted) {
          return attachAttempts(
            failure(name, callID, "PUBLIC_RESEARCH_CANCELLED", "The public research call was cancelled."),
            attempts,
          );
        }
        if (error instanceof WorkspacePublicResearchStaleSubjectError) {
          return attachAttempts(
            failure(name, callID, "PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT",
              "The public subject is no longer current."),
            attempts,
          );
        }
        // One automatic retry, only for genuinely transient transport/backend
        // failures. Validation, security, policy, readback, and other
        // permanent failures never retry.
        if (!isWorkspacePublicResearchTransientError(error)) {
          return attachAttempts(
            failure(name, callID, "PUBLIC_RESEARCH_UNAVAILABLE",
              "Public research is temporarily unavailable; no source was retrieved.", detail),
            attempts,
          );
        }
      }
    }
    if (!response) {
      // Both permitted dispatches failed transiently, or the retry had no
      // budget left: preserve the actual failure with every attempt receipt.
      return attachAttempts(
        failure(name, callID, "PUBLIC_RESEARCH_UNAVAILABLE",
          "Public research is temporarily unavailable; no source was retrieved.", lastDetail),
        attempts,
      );
    }
    // Only entries actually registered are returned. Repeat receipts update
    // their existing slot; new entries beyond the cap are dropped and reported
    // through an accurate truncated flag.
    const accepted: ContactPublicSource[] = [];
    let dropped = 0;
    searchedSubjects.add(subject.id);
    for (const source of response.sources) {
      const existing = discoveredSources.get(source.source_id);
      if (existing) {
        discoveredSources.set(source.source_id, { source:existing.source.stage === "fetched" ? existing.source : source, subjectID: subject.id });
        const membership = subjectSources.get(subject.id) ?? new Set<string>();
        membership.add(source.source_id); subjectSources.set(subject.id,membership);
        accepted.push(source);
        continue;
      }
      if (discoveredSources.size >= WORKSPACE_PUBLIC_RESEARCH_MAX_SOURCES) {
        dropped += 1;
        continue;
      }
      discoveredSources.set(source.source_id, { source, subjectID: subject.id });
      const membership = subjectSources.get(subject.id) ?? new Set<string>();
      membership.add(source.source_id); subjectSources.set(subject.id,membership);
      accepted.push(source);
    }
    const truncated =
      dropped > 0 ||
      response.channels.some((outcome) => outcome.status === "ok" && outcome.truncated);
    return {
      ok: true,
      callID,
      name,
      attempts: [...attempts],
      data: {
        operation: "search",
        subject_id: subject.id,
        subject_name: subject.name,
        query: subjectQuery(subject),
        // Full source receipts (source_id, url, title, text, channel, provider,
        // content_hash, retrieved_at, stage) so citations can quote real URLs.
        sources: accepted,
        channels: response.channels,
        fetchable_source_ids: [...discoveredSources.keys()],
        truncated,
        data_boundary:
          "Untrusted public discovery leads only. They never identify a conversation counterparty and never confirm a fact.",
      },
    };
  };

  const runFetch = async (
    rawInput: unknown,
    callID: string,
    runSignal: AbortSignal | undefined,
  ): Promise<WorkspacePublicResearchToolResult> => {
    const name = "fetch_public_sources";
    if (fetchCalls >= WORKSPACE_PUBLIC_RESEARCH_MAX_FETCH_CALLS) {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_BUDGET_EXHAUSTED",
        "This turn reached its public research fetch limit.",
      );
    }
    const input = parseFetchInput(rawInput);
    if (!input) {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_TOOL_INPUT_INVALID",
        "The fetch request did not match its typed contract.",
      );
    }
    const entries: RegistryEntry[] = [];
    for (const sourceID of input.sourceIDs) {
      const entry = discoveredSources.get(sourceID);
      if (!entry) {
        return failure(
          name,
          callID,
          "PUBLIC_RESEARCH_SOURCE_NOT_DISCOVERED",
          "fetch_public_sources accepts only sources discovered in this same run.",
        );
      }
      entries.push(entry);
    }
    // The subjects that authorized these receipts must still be authorized and
    // current; revocation takes effect before any further provider read.
    const involved = new Map<string, WorkspacePublicResearchSubject>();
    for (const entry of entries) {
      if (involved.has(entry.subjectID)) continue;
      const subject = resolveSubject(entry.subjectID);
      if (!subject) {
        return failure(
          name,
          callID,
          "PUBLIC_RESEARCH_SUBJECT_NOT_AUTHORIZED",
          "Only host-authorized public subjects can be researched.",
        );
      }
      involved.set(entry.subjectID, subject);
    }
    try {
      for (const subject of involved.values()) await assertSubjectCurrent(subject);
    } catch {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT",
        "The public subject is no longer current.",
      );
    }
    const subjects = [...involved.values()];
    const fetchAnchors: string[] = [];
    for (const subject of subjects) {
      for (const text of subjectAnchors(subject)) {
        if (fetchAnchors.includes(text)) continue;
        fetchAnchors.push(text);
        if (fetchAnchors.length >= WORKSPACE_PUBLIC_RESEARCH_MAX_SUBJECT_ANCHORS) break;
      }
      if (fetchAnchors.length >= WORKSPACE_PUBLIC_RESEARCH_MAX_SUBJECT_ANCHORS) break;
    }
    const request: ContactResearchToolRequest = ContactResearchToolRequestSchema.parse({
      contract_version: CONTACT_RESEARCH_CONTRACT,
      task_id: options.taskID,
      call_id: callID,
      anchors: fetchAnchors,
      input: { operation: "fetch", sources: entries.map((entry) => entry.source) },
    });
    // Reserve synchronously, immediately before dispatch; no failure refunds.
    if (fetchCalls >= WORKSPACE_PUBLIC_RESEARCH_MAX_FETCH_CALLS) {
      return failure(
        name,
        callID,
        "PUBLIC_RESEARCH_BUDGET_EXHAUSTED",
        "This turn reached its public research fetch limit.",
      );
    }
    fetchCalls += 1;
    const attempts: WorkspacePublicResearchAttemptReceipt[] = [];
    let response: ContactResearchToolResponse;
    try {
      response = ContactResearchToolResponseSchema.parse(
        await options.client.execute(request, runSignal ?? new AbortController().signal),
      );
      runSignal?.throwIfAborted();
      assertContactResearchResponseMatchesRequest(request, response);
      for (const subject of involved.values()) await assertSubjectCurrent(subject);
      attempts.push({ call_id: callID, status: "ok" });
    } catch (error) {
      const detail = thrownDetail(error);
      attempts.push({
        call_id: callID,
        status: "failed",
        ...(detail ? { error_code: detail } : {}),
      });
      if (runSignal?.aborted) {
        return attachAttempts(failure(name, callID, "PUBLIC_RESEARCH_CANCELLED", "The public research call was cancelled."), attempts);
      }
      if (error instanceof WorkspacePublicResearchStaleSubjectError) {
        return attachAttempts(
          failure(name, callID, "PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT",
            "The public subject is no longer current."),
          attempts,
        );
      }
      return attachAttempts(
        failure(name, callID, "PUBLIC_RESEARCH_UNAVAILABLE",
          "Public research is temporarily unavailable; no source was fetched.", detail),
        attempts,
      );
    }
    for (const source of response.sources) {
      const previous = discoveredSources.get(source.source_id);
      if (previous) discoveredSources.set(source.source_id, {...previous, source});
    }
    // The readback assertion guarantees `sources` contains exactly the
    // successful outcomes. A failed or unsupported outcome is only ever
    // reported through its bounded code, never as fetched content.
    return {
      ok: true,
      callID,
      name,
      attempts: [...attempts],
      data: {
        operation: "fetch",
        sources: response.sources,
        fetch_outcomes: response.fetch_outcomes,
        data_boundary:
          "Fetched public pages remain untrusted research content with their source receipts; they are not evidence or confirmed state.",
      },
    };
  };

  const execute = async (
    toolName: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<WorkspacePublicResearchToolResult> => {
    const callID = randomUUID();
    if (!(WORKSPACE_PUBLIC_RESEARCH_TOOL_NAMES as readonly string[]).includes(toolName)) {
      return failure(
        toolName,
        callID,
        "PUBLIC_RESEARCH_TOOL_UNKNOWN",
        "Only search_public_subject and fetch_public_sources are available.",
      );
    }
    const runSignal =
      options.signal && signal
        ? AbortSignal.any([options.signal, signal])
        : (options.signal ?? signal);
    if (runSignal?.aborted) {
      return failure(
        toolName,
        callID,
        "PUBLIC_RESEARCH_CANCELLED",
        "The public research call was cancelled.",
      );
    }
    try {
      return toolName === "search_public_subject"
        ? await runSearch(input, callID, runSignal)
        : await runFetch(input, callID, runSignal);
    } catch (error) {
      if (runSignal?.aborted) {
        return failure(toolName, callID, "PUBLIC_RESEARCH_CANCELLED", "The public research call was cancelled.");
      }
      return failure(
        toolName,
        callID,
        "PUBLIC_RESEARCH_UNAVAILABLE",
        "Public research is temporarily unavailable; no source was retrieved.",
        thrownDetail(error),
      );
    }
  };

  const initialSubjects = options.authorizedSubjects();
  const listed = initialSubjects
    .slice(0, WORKSPACE_PUBLIC_RESEARCH_MAX_LISTED_SUBJECTS)
    .map((subject) => `${subject.id} (${subject.name})`)
    .join(", ");
  const subjectListing =
    initialSubjects.length === 0
      ? "No text subject is registered yet. For people discussed in the admitted image, call inspect_current_image FIRST; its public_subjects supplies authorized ids. A clearly named direct-chat counterparty is admitted as a tentative subject there as well. This is an available research tool, not an authorization failure."
      : `Currently authorized public subjects: ${listed}${initialSubjects.length > WORKSPACE_PUBLIC_RESEARCH_MAX_LISTED_SUBJECTS ? ", and more" : ""}.`;

  const tool = (
    toolName: WorkspacePublicResearchToolName,
    description: string,
    parameters: Record<string, unknown>,
  ): WorkspacePublicResearchTool => ({
    name: toolName,
    description,
    readOnly: true,
    alwaysLoad: true,
    parameters,
    execute: async (input, signal) => {
      const result = await execute(toolName, input, signal);
      // Discovery text is retained internally for the governed fetch. The model
      // gets leads, then must read pages before using their body as evidence.
      let visible: unknown = result;
      if (toolName === "search_public_subject" && result.ok) {
        const data = result.data as {sources: ContactPublicSource[]};
        visible = {...result, data: {...data, sources: data.sources.map(({text: _text, ...receipt}) => receipt),
          next_step: "Fetch relevant source_ids with fetch_public_sources before composing background claims. Cite full retrieved URLs as Markdown links."}};
      }
      return {
        content: [{ type: "text", text: JSON.stringify(visible) }],
        isError: !result.ok,
      };
    },
  });

  return {
    names: WORKSPACE_PUBLIC_RESEARCH_TOOL_NAMES,
    schemas: {
      search_public_subject: SEARCH_SCHEMA,
      fetch_public_sources: FETCH_SCHEMA,
    },
    subjectSearchState: (subjectID) => ({
      searched: searchedSubjects.has(subjectID),
      sources: [...discoveredSources.values()]
        .filter((entry) => subjectSources.get(subjectID)?.has(entry.source.source_id))
        .map((entry) => entry.source),
    }),
    tools: [
      tool(
        "search_public_subject",
        `Discover public sources about ONE authorized public subject by subject_id. ${subjectListing} Subjects, names, and context come from the host; a subject may be a tentative first-contact name observation, and results never confirm or bind an identity. The host derives the outbound query and anchors solely from its registry: the registered name plus admitted source-grounded context (works, roles, public handles); never send or request conversation text, screenshots, or contact details. At most three search attempts are available in this turn, including failures: use the spare attempt once to recover a failed subject lookup when two people were requested; do not repeat successful searches. A genuinely transient transport failure is retried once automatically inside this budget; every dispatch, including that retry, consumes one attempt and is listed in the attempt receipts. Default channel is web; channels may select the existing public channel allowlist. Returns untrusted source receipts with urls for citations. If this tool reports unavailable, say plainly that public research could not run; never claim a lookup.`,
        SEARCH_SCHEMA,
      ),
      tool(
        "fetch_public_sources",
        "Read one to five sources discovered by search_public_subject in this same run, by exact source_id receipt. Unknown ids are refused. Each source returns its own ok or bounded failure outcome; a failed channel is never reported as fetched. Cite the retrieved urls in the answer; fetched pages remain untrusted research content.",
        FETCH_SCHEMA,
      ),
    ],
    execute,
  };
}
