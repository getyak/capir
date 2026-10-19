import { createHash } from "node:crypto";
import {
  CONTACT_RESEARCH_CONTRACT, CONTACT_RESEARCH_EXA_CHANNELS, CONTACT_RESEARCH_MAX_RESULTS,
  ContactResearchToolRequestSchema, ContactResearchToolResponseSchema,
  type ContactPublicSource, type ContactResearchChannel, type ContactResearchChannelOutcome,
  type ContactResearchFailureCode, type ContactResearchFetchOutcome, type ContactResearchToolResponse,
} from "@talent-signal/agent";
import { ExaProvider, type ExaSource } from "./exaProvider.js";
import { TikHubProvider } from "./tikHubProvider.js";
import { browseDiscoveredPublicPage } from "./isolatedPublicBrowser.js";
import { browseViaExecutor } from "./browserExecutorClient.js";

export interface ContactResearchDependencies {
  exa?: Pick<ExaProvider, "searchProfiles" | "searchWeb" | "fetchContents">;
  tikhub?: Pick<TikHubProvider, "searchProfiles">;
  browse?: typeof browseDiscoveredPublicPage;
}

function sourceID(provider: string, url: string): string {
  return createHash("sha256").update(`${provider}:${url}`).digest("hex");
}

function fromExa(source: ExaSource, channel: ContactPublicSource["channel"], stage: ContactPublicSource["stage"], sourceIDOverride?: string): ContactPublicSource {
  return {
    source_id: sourceIDOverride ?? sourceID("exa", source.url), url: source.url, title: source.title,
    text: source.text, channel, provider_id: "exa", provider_request_id: source.providerRequestID,
    content_hash: source.contentHash, retrieved_at: source.retrievedAt, stage,
  };
}

function normalize(value: string) { return value.normalize("NFKC").toLowerCase().trim(); }

function failureCode(error: unknown): ContactResearchFailureCode {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : error instanceof Error ? error.message : "";
  if (code.endsWith("AUTH_FAILED") || code.endsWith("CREDENTIAL_MISSING")) return "AUTH_FAILED";
  if (code.endsWith("RATE_LIMITED")) return "RATE_LIMITED";
  if (code.endsWith("CREDIT_UNAVAILABLE")) return "REJECTED";
  if (code.endsWith("UNAVAILABLE")) return "UNAVAILABLE";
  if (code.includes("RESPONSE")) return "RESPONSE_INVALID";
  if (code.includes("LIMIT")) return "LIMIT_INVALID";
  if (code.includes("QUERY") || code.includes("PRIVATE_LOOKUP") || code.includes("SENSITIVE")) return "QUERY_REJECTED";
  if (code.includes("REJECTED") || code.includes("REQUEST_FAILED") || code.includes("CREDIT")) return "REJECTED";
  return "FAILED";
}

function tikhubSource(source: Awaited<ReturnType<TikHubProvider["searchProfiles"]>>[number], channel: ContactResearchChannel): ContactPublicSource {
  return {
    source_id: sourceID("tikhub", source.profileUrl), url: source.profileUrl,
    title: source.displayName, text: [source.displayName, source.handle, source.biography].filter(Boolean).join("\n").slice(0, 16_000),
    channel, provider_id: "tikhub", provider_request_id: source.providerRequestID,
    content_hash: source.contentHash, retrieved_at: source.retrievedAt, stage: "profile_observation",
  };
}

/** One bounded per-source outcome; never widens a provider error into text. */
function failedFetch(source: ContactPublicSource, batchError: unknown): ContactResearchFetchOutcome {
  if (source.provider_id !== "exa") {
    return { source_id: source.source_id, channel: source.channel, provider: source.provider_id,
      status: "unsupported", error_code: "UNSUPPORTED" };
  }
  return { source_id: source.source_id, channel: source.channel, provider: "exa",
    status: "failed", error_code: batchError ? failureCode(batchError) : "UNAVAILABLE" };
}

export async function runContactResearchTool(
  raw: unknown,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: ContactResearchDependencies = {},
  executionSignal?: AbortSignal,
): Promise<ContactResearchToolResponse> {
  const request = ContactResearchToolRequestSchema.parse(raw);
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(executionSignal ? [executionSignal] : [])]);
  signal.throwIfAborted();
  const exa = () => dependencies.exa ?? new ExaProvider({ apiKey: environment.EXA_API_KEY ?? "" });
  let sources: ContactPublicSource[] = [];
  let channels: ContactResearchChannelOutcome[] = [];
  let fetchOutcomes: ContactResearchFetchOutcome[] = [];
  const input = request.input;
  if (input.operation === "fetch") {
    // Every provider/URL identity is schema-checked before dispatch. The caller
    // owns same-task discovery resolution before constructing this request.
    for (const source of input.sources) {
      if (source.source_id !== sourceID(source.provider_id, source.url)) {
        throw new Error("CONTACT_RESEARCH_SOURCE_ID_MISMATCH");
      }
    }
    // Only discovered Exa sources are batchable; a TikHub observation can never
    // fall through to Exa and receives an explicit bounded outcome.
    const requested = input.sources;
    const exaRequested = requested.filter((source) => source.provider_id === "exa");
    const fetched = new Map<string, ExaSource>();
    if (exaRequested.length > 0) {
      let batch: ExaSource[] | null = null;
      let batchError: unknown = null;
      try {
        batch = await exa().fetchContents(exaRequested.map((source) => source.url), signal);
        signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        batchError = error;
      }
      for (const source of batch ?? []) fetched.set(source.url, source);
      fetchOutcomes = requested.map((source) => {
        if (source.provider_id !== "exa") return failedFetch(source, null);
        return fetched.has(source.url)
          ? { source_id: source.source_id, channel: source.channel, provider: "exa", status: "ok", error_code: null }
          : failedFetch(source, batchError);
      });
    } else {
      fetchOutcomes = requested.map((source) => failedFetch(source, null));
    }
    // Preserve the requested order and every original source identity.
    sources = requested.flatMap((source) => {
      const page = fetched.get(source.url);
      return page ? [fromExa(page, source.channel, "fetched", source.source_id)] : [];
    });
  } else if (input.operation === "browse") {
    const source = input.source;
    if (source.source_id !== sourceID(source.provider_id, source.url)) {
      throw new Error("CONTACT_RESEARCH_SOURCE_ID_MISMATCH");
    }
    const page = dependencies.browse
      ? await dependencies.browse(source.url, signal, environment)
      : environment.TALENT_SIGNAL_BROWSER_EXECUTOR_URL || environment.NODE_ENV === "production"
        ? await browseViaExecutor({ version: 1, task_id: request.task_id, call_id: request.call_id,
          source_id: source.source_id, provider_id: source.provider_id,
          url: source.url, deadline: Date.now() + 28_000 }, signal, environment)
        : await browseDiscoveredPublicPage(source.url, signal, environment);
    signal.throwIfAborted();
    sources = [{ source_id: sourceID("browser", page.url), url: page.url,
      title: page.title || source.title, text: page.text, channel: source.channel,
      provider_id: "browser", provider_request_id: request.call_id,
      content_hash: createHash("sha256").update(page.text).digest("hex"),
      retrieved_at: new Date().toISOString(), stage: "fetched",
      browser_observation: { engine: page.engine, engine_version: page.engineVersion,
        initial_url: source.url, final_url: page.url, requests: page.requests,
        blocked_requests: page.blockedRequests, http_requests: page.httpRequests,
        response_bytes: page.responseBytes, discovered_source_id: source.source_id } }];
  }
  if (input.operation === "search") {
    const query = normalize(input.query);
    if (!request.anchors.some((anchor) => query.includes(normalize(anchor)))) {
      throw new Error("CONTACT_RESEARCH_QUERY_OUT_OF_SCOPE");
    }
    // Contact research admits public career context, not sensitive or private lookup.
    if (/\b(?:email|phone|home address|background check|religion|ethnicity|medical|sexual orientation)\b|邮箱|手机号|家庭住址|背调|宗教|民族|病史|性取向/iu.test(query) ||
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(query)) {
      throw new Error("CONTACT_RESEARCH_PRIVATE_LOOKUP_PROHIBITED");
    }
    const tikhub = () => dependencies.tikhub ?? new TikHubProvider({
      apiKey: environment.TIKHUB_API_KEY ?? "",
      ...(environment.TIKHUB_BASE_URL ? { baseUrl: environment.TIKHUB_BASE_URL } : {}),
    });
    const searched = await Promise.all(input.channels.map(async (channel) => {
      const provider = CONTACT_RESEARCH_EXA_CHANNELS.includes(channel as "linkedin" | "web") ? "exa" as const : "tikhub" as const;
      try {
        const observations = provider === "exa"
          ? channel === "linkedin"
            ? await exa().searchProfiles(input.query, input.maximum_results_per_channel, signal)
            : await exa().searchWeb(input.query, input.maximum_results_per_channel, signal)
          : await tikhub().searchProfiles({
              platform: channel as Exclude<ContactResearchChannel, "linkedin" | "web">,
              query: input.query, maximumResults: input.maximum_results_per_channel,
            }, signal);
        signal.throwIfAborted();
        const found = provider === "exa"
          ? (observations as ExaSource[]).map((source) => fromExa(source, channel, "discovered"))
          : (observations as Awaited<ReturnType<TikHubProvider["searchProfiles"]>>).map((source) => tikhubSource(source, channel));
        return { sources: found, outcome: { channel, provider, status: "ok" as const,
          result_count: found.length, truncated: false, error_code: null } };
      } catch (error) {
        signal.throwIfAborted();
        return { sources: [] as ContactPublicSource[], outcome: { channel, provider, status: "failed" as const,
          result_count: 0 as const, truncated: false as const, error_code: failureCode(error) } };
      }
    }));
    const seen = new Set<string>();
    sources = searched.flatMap((item) => item.sources).filter((source) => {
      const identity = source.url.toLowerCase();
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    }).slice(0, CONTACT_RESEARCH_MAX_RESULTS);
    const returnedByChannel = new Map<ContactResearchChannel, number>();
    for (const source of sources) {
      returnedByChannel.set(source.channel, (returnedByChannel.get(source.channel) ?? 0) + 1);
    }
    channels = searched.map((item) => {
      if (item.outcome.status === "failed") return item.outcome;
      const returned = returnedByChannel.get(item.outcome.channel) ?? 0;
      return {
        ...item.outcome,
        result_count: returned,
        truncated: returned < item.sources.length,
      };
    });
  }
  signal.throwIfAborted();
  return ContactResearchToolResponseSchema.parse({
    contract_version: CONTACT_RESEARCH_CONTRACT, task_id: request.task_id,
    call_id: request.call_id, sources, channels, fetch_outcomes: fetchOutcomes, external_effects: [],
  });
}
