import type { ContactPublicSource } from "@talent-signal/agent";
import type { MemoryProposalCandidateInput } from "@talent-signal/agent";

type MemoryProposalSourceLocator = MemoryProposalCandidateInput["source_locator"];

import type { WorkspacePublicResearchToolDefinitions } from "./workspacePublicResearch.js";

/**
 * First-contact public research.
 *
 * Every first-contact proposal in the workspace conversation path (the host
 * default screenshot Memory card, a model memory_review contact_decision
 * "new", and a contact_workspace propose_create) attempts one bounded public
 * search plus a fetch of the relevant discovered sources BEFORE the proposal is
 * presented, or returns one explicit honest status. The host derives the
 * subject and query from its own registry; the model cannot invent raw query or
 * context, and disabled/unconfigured runs never pretend context was searched.
 *
 * The result is an unconfirmed, cited public-source draft bound to a tentative
 * identity. It never confirms identity, auto-binds a contact, promotes a
 * canonical biography, or authorizes any external action.
 */

export type FirstContactResearchStatus =
  /** Search ran and at least one discovered source was fetched. */
  | "searched"
  /** Search ran and returned no sources. */
  | "no_results"
  /** The provider/budget/socket could not run the lookup. */
  | "unavailable"
  /** Public research is not configured or not opted in for this Run. */
  | "disabled"
  /** The current user explicitly declined searching. */
  | "opted_out"
  /** No admissible tentative public subject exists for this proposal. */
  | "no_subject"
  /** The lookup was rejected or failed permanently (policy, stale, fetch). */
  | "failed";

export type FirstContactResearchIdentityStatus = "tentative";

export interface FirstContactResearchCitation {
  source_id: string;
  url: string;
  title: string;
  content_hash: string;
  retrieved_at: string;
  stage: "discovered" | "fetched" | "profile_observation";
  /** Bounded excerpt of actually fetched page text; never invented prose. */
  excerpt?: string;
}

/** Sanitized same-run receipt: real provider receipts only, no provider text. */
export interface FirstContactResearchReceipt {
  status: FirstContactResearchStatus;
  identity_status: FirstContactResearchIdentityStatus;
  subject_id: string | null;
  subject_name: string | null;
  searched_at: string | null;
  /** Discovered and fetched source receipts from this same run. */
  citations: FirstContactResearchCitation[];
  /** Short tool-call summary proving whether research actually ran. */
  summary: string;
  detail?: string;
}

export interface FirstContactResearchSubject {
  id: string;
  name: string;
}

const MAX_RENDERED_CITATIONS = 3;
const MAX_EXCERPT_LENGTH = 160;
const MAX_TITLE_LENGTH = 80;

function citation(source: ContactPublicSource): FirstContactResearchCitation {
  return {
    source_id: source.source_id,
    url: source.url,
    title: source.title.slice(0, MAX_TITLE_LENGTH),
    content_hash: source.content_hash,
    retrieved_at: source.retrieved_at,
    stage: source.stage,
    ...(source.text.trim()
      ? { excerpt: source.text.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, MAX_EXCERPT_LENGTH) }
      : {}),
  };
}

const STATUS_SUMMARY: Record<FirstContactResearchStatus, string> = {
  searched: "Public search ran and fetched sources",
  no_results: "Public search ran with no results",
  unavailable: "Public search was unavailable; no context was searched",
  disabled: "Public search is not enabled in this run; no context was searched",
  opted_out: "Public search was declined by the user; no context was searched",
  no_subject: "No admissible public subject; no context was searched",
  failed: "Public search failed; no fetched context is available",
};

function receipt(
  status: FirstContactResearchStatus,
  subject: FirstContactResearchSubject | null,
  searchedAt: string | null,
  citations: FirstContactResearchCitation[],
  detail?: string,
): FirstContactResearchReceipt {
  return {
    status,
    identity_status: "tentative",
    subject_id: subject?.id ?? null,
    subject_name: subject?.name ?? null,
    searched_at: searchedAt,
    citations,
    summary: `${STATUS_SUMMARY[status]}${citations.length ? ` (${citations.length} source${citations.length === 1 ? "" : "s"}, tentative identity)` : " (tentative identity)"}`,
    ...(detail ? { detail } : {}),
  };
}

function failureStatus(code: string | undefined): FirstContactResearchStatus {
  if (!code) return "unavailable";
  if (
    code === "PUBLIC_RESEARCH_QUERY_INVALID" ||
    code === "PUBLIC_RESEARCH_QUERY_PROHIBITED" ||
    code === "PUBLIC_RESEARCH_TOOL_INPUT_INVALID" ||
    code === "PUBLIC_RESEARCH_SOURCE_NOT_DISCOVERED"
  ) {
    return "failed";
  }
  if (code === "PUBLIC_RESEARCH_SUBJECT_NOT_AUTHORIZED" || code === "PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT") {
    return "failed";
  }
  // Unavailability, cancellation and exhausted budgets are honest "could not
  // run" outcomes: nothing was searched and nothing is pretended.
  return "unavailable";
}

export interface FirstContactResearchOptions {
  /** Same-run governed research seam, or null when the opt-in gate is off. */
  research: WorkspacePublicResearchToolDefinitions | null;
  /** Explicit current-user no-search decision. */
  searchOptedOut: () => boolean;
  now?: () => Date;
  onToolCompletion?: (receipt: {name:string;completedAt:string}) => void;
}

export interface FirstContactResearchRunner {
  /**
   * Attempt bounded search + fetch for one tentative subject before a
   * first-contact proposal is presented. Repeated attempts for the same
   * current subject in one run deduplicate; a subject the model already
   * searched this run reuses that same-run discovery.
   */
  attempt(subject: FirstContactResearchSubject | null): Promise<FirstContactResearchReceipt>;
}

export function createFirstContactResearch(
  options: FirstContactResearchOptions,
): FirstContactResearchRunner {
  const now = options.now ?? (() => new Date());
  const attempts = new Map<string, Promise<FirstContactResearchReceipt>>();
  const execute: WorkspacePublicResearchToolDefinitions["execute"] = async (name, input, signal) => {
    const result = await options.research!.execute(name, input, signal);
    if (result.attempts?.length) options.onToolCompletion?.({name,completedAt:now().toISOString()});
    if (!result.ok && ["PUBLIC_RESEARCH_CANCELLED","PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT"].includes(result.error.code)) {
      throw new Error(result.error.code);
    }
    return result;
  };

  const run = async (
    subject: FirstContactResearchSubject,
  ): Promise<FirstContactResearchReceipt> => {
    const research = options.research!;
    const searchedAt = now().toISOString();
    const state = research.subjectSearchState(subject.id);
    let discovered = state.sources as readonly ContactPublicSource[];
    if (!state.searched) {
      const result = await execute("search_public_subject", {
        subject_id: subject.id,
      });
      if (!result.ok) {
        return receipt(failureStatus(result.error.code), subject, null, [], result.error.code);
      }
      const data = result.data as {
        sources?: ContactPublicSource[];
      };
      discovered = data.sources ?? [];
    }
    if (discovered.length === 0) {
      return receipt("no_results", subject, searchedAt, []);
    }
    // Fetch every relevant discovered source in one bounded call before the
    // proposal may present any background.
    const alreadyFetched = discovered.filter((source) => source.stage === "fetched");
    const pending = discovered.filter((source) => source.stage !== "fetched");
    let fetched: ContactPublicSource[] = [...alreadyFetched];
    let fetchFailure: string | undefined;
    if (pending.length > 0) {
      const result = await execute("fetch_public_sources", {
        source_ids: pending.map((source) => source.source_id),
      });
      if (!result.ok) {
        fetchFailure = result.error.code;
      } else {
        const data = result.data as { sources?: ContactPublicSource[] };
        fetched = [...fetched, ...(data.sources ?? [])];
      }
    }
    const citations = discovered.map((source) => {
      const read = fetched.find((entry) => entry.source_id === source.source_id);
      return citation(read ?? source);
    });
    if (fetched.length === 0) {
      // Discovery leads exist but nothing was fetched: never present unfetched
      // page bodies as background.
      return receipt("failed", subject, searchedAt, citations, fetchFailure ?? "FETCH_FAILED");
    }
    return receipt("searched", subject, searchedAt, citations);
  };

  return {
    attempt: async (subject) => {
      if (options.searchOptedOut()) {
        return receipt("opted_out", subject, null, [], "PUBLIC_SEARCH_DECLINED");
      }
      if (!options.research) {
        return receipt("disabled", subject, null, [], "PUBLIC_RESEARCH_DISABLED");
      }
      if (!subject) {
        return receipt("no_subject", subject, null, [], "PUBLIC_RESEARCH_NO_SUBJECT");
      }
      const pending = attempts.get(subject.id) ?? run(subject);
      attempts.set(subject.id, pending);
      return pending;
    },
  };
}

/**
 * Host-owned source-grounded person-name Memory candidate for a first-contact
 * proposal. The exact current screenshot header/message name excerpt is the
 * only provenance; the wording keeps the displayed name and tentative identity
 * distinct from any verified legal identity.
 */
export function firstContactNameCandidate(input: {
  name: string;
  nameExcerpt: string;
  sourceLocator: MemoryProposalSourceLocator;
  sourceWarning?: "ai_generated_or_fictional";
}): MemoryProposalCandidateInput | null {
  const name = input.name.normalize("NFKC").trim();
  const excerpt = input.nameExcerpt.normalize("NFKC").trim();
  if (!name || !excerpt || !excerpt.includes(name) || name.length > 200) return null;
  return {
    scope: "person",
    operation: "add",
    statement_kind: "source_statement",
    dependence_kind: "contact",
    display_text:
      `对方（未确认）在${input.sourceLocator.kind === "image_region" ? "截图" : "消息"}中显示的名字是「${name}」` +
      (input.sourceWarning === "ai_generated_or_fictional"
        ? "。该图片可能为 AI 生成或虚构内容，不代表真实关系。"
        : ""),
    time_status: "unknown",
    sensitivity: "normal",
    source_excerpt: input.nameExcerpt,
    source_locator: input.sourceLocator,
    reason: "保留对方显示名字的来源，便于称呼与同名核对；身份未确认，等待人工审阅。",
  };
}

/** Apply the host name candidate once per proposal; never duplicate a name. */
export function withFirstContactNameCandidate(
  items: readonly MemoryProposalCandidateInput[],
  candidate: MemoryProposalCandidateInput | null,
): MemoryProposalCandidateInput[] {
  if (!candidate) return [...items];
  const name = candidate.source_excerpt.normalize("NFKC").trim();
  const duplicate = items.some((item) => {
    const excerpt = item.source_excerpt.normalize("NFKC").trim();
    return item.scope === "person" && item.statement_kind === "source_statement"
      && excerpt === name && item.display_text === candidate.display_text;
  });
  return duplicate ? [...items] : [...items, candidate];
}

const STATUS_ANSWER: Record<FirstContactResearchStatus, string> = {
  searched: "",
  no_results: "公开检索没有找到可用来源。",
  unavailable: "公开检索暂时不可用，本次没有检索任何背景。",
  disabled: "本会话未启用公开背景检索。",
  opted_out: "按你的要求，本次没有做公开检索。",
  no_subject: "本次没有可检索的公开对象。",
  failed: "公开检索未能完成，本次没有可引用的检索结果。",
};

/**
 * Bounded answer section so fetched citations, retrieved_at and tentative
 * identity status survive replay in the durable Session answer. Only actually
 * fetched receipts are rendered; discovered-only leads never appear as
 * background.
 */
export function firstContactResearchAnswerSection(
  receipts: readonly FirstContactResearchReceipt[],
): string {
  const lines: string[] = [];
  for (const receipt of receipts) {
    const fetched = receipt.citations.filter((citation) => citation.stage === "fetched");
    if (receipt.status === "searched" && fetched.length > 0) {
      lines.push("公开背景（未确认 · 身份待确认，仅来自检索到的公开来源）：");
      for (const citation of fetched.slice(0, MAX_RENDERED_CITATIONS)) {
        lines.push(
          `- ${citation.title} · ${citation.url} · 检索于 ${citation.retrieved_at}` +
            (citation.excerpt ? ` ·「${citation.excerpt}」` : ""),
        );
      }
      continue;
    }
    if (receipt.status !== "searched") {
      lines.push(`公开背景检索：${STATUS_ANSWER[receipt.status]}`);
    }
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

/** Skip a host-appended section the answer already carries. */
export function firstContactResearchAnswerAlreadyCovered(
  body: string,
  receipts: readonly FirstContactResearchReceipt[],
): boolean {
  const section = firstContactResearchAnswerSection(receipts);
  return Boolean(section) && body.includes(section.trim());
}
