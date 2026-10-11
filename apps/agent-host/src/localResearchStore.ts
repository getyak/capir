import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { join } from "node:path";

import {
  fingerprint,
  PublicResearchNoActionOutputSchema,
  type AgentBudget,
  type AgentFetchedWebPage,
  type AgentJournalEvent,
  type AgentJournalOutput,
  type AgentPublicResearchCheckpoint,
  type AgentPublicResearchJournal,
  type AgentPublicResearchNoActionCandidate,
  type AgentPublicResearchScope,
  type AgentPublicResearchTerminalReceipt,
  type AgentResearchArtifactCandidate,
  type AgentWebResearchAuthorization,
  type AgentWebSearchResult,
} from "@talent-signal/agent";

import {
  assertLocalRunID,
  isLocalRecordCounter,
  isLocalRecordEnum,
  isLocalRecordFingerprint,
  isLocalRecordFingerprintArray,
  isLocalRecordID,
  isLocalRecordStringArray,
  isLocalRecordObject,
  isLocalRecordTimestamp,
  localRecordCorruptError,
  publishImmutableJsonRecord,
  readPersistedJsonRecord,
  replaceMutableJsonRecord,
} from "./localResearchFiles.js";

const TERMINAL_STATUSES = [
  "artifact_created",
  "no_action",
  "quarantined",
  "budget_exhausted",
  "cancelled",
  "failed",
] as const;

const PUBLIC_NO_ACTION_REASON_CODES = [
  "NO_MATERIAL_CHANGE",
  "INSUFFICIENT_EVIDENCE",
  "UNTRUSTED_INSTRUCTION",
  "PUBLIC_RESEARCH_UNAVAILABLE",
] as const;

function parseAuthorization(
  value: Record<string, unknown>,
  kind: string,
): AgentWebResearchAuthorization {
  const subjectKind = value.subjectKind;
  const accessMode = value.accessMode;
  const allowedDomains = value.allowedDomains;
  const queryAnchors = value.queryAnchors;
  const maximumSearchCount = value.maximumSearchCount;
  const maximumFetchCount = value.maximumFetchCount;
  if (
    value.purpose !== "company_market_research" ||
    (subjectKind !== "company" && subjectKind !== "market") ||
    (accessMode !== "domain_allowlist" && accessMode !== "open_web") ||
    !Array.isArray(allowedDomains) ||
    !allowedDomains.every((domain) => typeof domain === "string") ||
    !Array.isArray(queryAnchors) ||
    !queryAnchors.every((anchor) => typeof anchor === "string") ||
    typeof maximumSearchCount !== "number" ||
    typeof maximumFetchCount !== "number"
  ) {
    throw localRecordCorruptError(kind);
  }
  return {
    purpose: "company_market_research",
    subjectKind,
    accessMode,
    allowedDomains: [...allowedDomains] as string[],
    queryAnchors: [...queryAnchors] as string[],
    maximumSearchCount,
    maximumFetchCount,
  };
}

export interface LocalRunRecord {
  scope: AgentPublicResearchScope;
  budget: AgentBudget;
  modelProviderID: string;
  model: string;
  sdkVersion: string;
  startedAt: string;
}

export interface LocalResearchArtifactRecord {
  artifactID: string;
  runID: string;
  status: "draft";
  publicationAuthority: "none";
  candidateFingerprint: string;
  objective: string;
  authorization: AgentWebResearchAuthorization;
  candidate: AgentResearchArtifactCandidate;
  createdAt: string;
}

export interface LocalResearchNoActionRecord {
  noActionID: string;
  runID: string;
  candidateFingerprint: string;
  candidate: AgentPublicResearchNoActionCandidate;
  createdAt: string;
}

function stableRunIdentity(record: LocalRunRecord) {
  return fingerprint({
    scope: record.scope,
    budget: record.budget,
    modelProviderID: record.modelProviderID,
    model: record.model,
    sdkVersion: record.sdkVersion,
  });
}

function parseRunRecord(
  runID: string,
  value: unknown,
): LocalRunRecord {
  if (!isLocalRecordObject(value)) throw localRecordCorruptError("run");
  const scope = value.scope;
  const budget = value.budget;
  if (
    !isLocalRecordObject(scope) ||
    scope.runID !== runID ||
    typeof scope.objective !== "string" ||
    typeof scope.providerID !== "string"
  ) {
    throw localRecordCorruptError("run");
  }
  const authorization = scope.authorization;
  if (!isLocalRecordObject(authorization)) {
    throw localRecordCorruptError("run");
  }
  const parsedAuthorization = parseAuthorization(authorization, "run");
  if (
    !isLocalRecordObject(budget) ||
    typeof budget.maxTurns !== "number" ||
    typeof budget.maxToolCalls !== "number" ||
    typeof budget.maxDurationMs !== "number" ||
    typeof budget.maxTaskTokens !== "number" ||
    typeof budget.maxEstimatedUsd !== "number"
  ) {
    throw localRecordCorruptError("run");
  }
  const modelProviderID = value.modelProviderID;
  const model = value.model;
  const sdkVersion = value.sdkVersion;
  const startedAt = value.startedAt;
  if (
    typeof modelProviderID !== "string" ||
    typeof model !== "string" ||
    typeof sdkVersion !== "string" ||
    !isLocalRecordTimestamp(startedAt)
  ) {
    throw localRecordCorruptError("run");
  }
  return {
    scope: {
      runID,
      objective: scope.objective,
      providerID: scope.providerID,
      authorization: parsedAuthorization,
    },
    budget: {
      maxTurns: budget.maxTurns,
      maxToolCalls: budget.maxToolCalls,
      maxDurationMs: budget.maxDurationMs,
      maxTaskTokens: budget.maxTaskTokens,
      maxEstimatedUsd: budget.maxEstimatedUsd,
    },
    modelProviderID,
    model,
    sdkVersion,
    startedAt,
  };
}

function parseWebSearchResult(value: unknown): AgentWebSearchResult {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordFingerprint(value.resultID) ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.snippet !== "string" ||
    (value.publishedAt !== null && typeof value.publishedAt !== "string") ||
    typeof value.providerID !== "string"
  ) {
    throw localRecordCorruptError("checkpoint");
  }
  return {
    resultID: value.resultID,
    url: value.url,
    title: value.title,
    snippet: value.snippet,
    publishedAt: value.publishedAt,
    providerID: value.providerID,
  };
}

function parseFetchedWebPage(value: unknown): AgentFetchedWebPage {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordFingerprint(value.resultID) ||
    typeof value.canonicalUrl !== "string" ||
    typeof value.title !== "string" ||
    typeof value.text !== "string" ||
    !isLocalRecordFingerprint(value.contentHash) ||
    !isLocalRecordTimestamp(value.retrievedAt) ||
    typeof value.providerID !== "string"
  ) {
    throw localRecordCorruptError("checkpoint");
  }
  return {
    resultID: value.resultID,
    canonicalUrl: value.canonicalUrl,
    title: value.title,
    text: value.text,
    contentHash: value.contentHash,
    retrievedAt: value.retrievedAt,
    providerID: value.providerID,
  };
}

function parseResearchSource(
  value: unknown,
): AgentResearchArtifactCandidate["sources"][number] {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordFingerprint(value.resultID) ||
    typeof value.url !== "string" ||
    typeof value.title !== "string" ||
    !isLocalRecordFingerprint(value.contentHash) ||
    !isLocalRecordTimestamp(value.retrievedAt)
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    resultID: value.resultID,
    url: value.url,
    title: value.title,
    contentHash: value.contentHash,
    retrievedAt: value.retrievedAt,
  };
}

function parseResearchClaim(
  value: unknown,
): AgentResearchArtifactCandidate["claims"][number] {
  if (
    !isLocalRecordObject(value) ||
    typeof value.statement !== "string" ||
    !isLocalRecordFingerprintArray(value.sourceRefs)
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    statement: value.statement,
    sourceRefs: value.sourceRefs,
  };
}

function parseResearchArtifactCandidate(
  value: unknown,
): AgentResearchArtifactCandidate {
  const claims = isLocalRecordObject(value) ? value.claims : undefined;
  const sources = isLocalRecordObject(value) ? value.sources : undefined;
  if (
    !isLocalRecordObject(value) ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.limitations !== "string" ||
    !Array.isArray(claims) ||
    !Array.isArray(sources)
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    title: value.title,
    summary: value.summary,
    limitations: value.limitations,
    claims: claims.map(parseResearchClaim),
    sources: sources.map(parseResearchSource),
  };
}

function parsePublicNoActionCandidate(
  value: unknown,
): AgentPublicResearchNoActionCandidate {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordEnum(value.reasonCode, PUBLIC_NO_ACTION_REASON_CODES) ||
    typeof value.reason !== "string" ||
    !isLocalRecordStringArray(value.missingEvidenceRefs) ||
    !PublicResearchNoActionOutputSchema.shape.missing_evidence_refs.safeParse(
      value.missingEvidenceRefs,
    ).success
  ) {
    throw localRecordCorruptError("no-action");
  }
  return {
    reasonCode: value.reasonCode,
    reason: value.reason,
    missingEvidenceRefs: value.missingEvidenceRefs,
  };
}

function parseTerminalReceipt(
  runID: string,
  value: unknown,
): AgentPublicResearchTerminalReceipt {
  if (!isLocalRecordObject(value)) throw localRecordCorruptError("terminal");
  const status = value.status;
  const reasonCode = value.reasonCode;
  const artifactID = value.artifactID;
  const noActionID = value.noActionID;
  const candidateFingerprint = value.candidateFingerprint;
  const externalEffects = value.externalEffects;
  const permissionDenials = value.permissionDenials;
  const providerSessionID = value.providerSessionID;
  const completedAt = value.completedAt;
  const usage = value.usage;
  if (
    value.runID !== runID ||
    !isLocalRecordEnum(status, TERMINAL_STATUSES) ||
    typeof reasonCode !== "string" ||
    (artifactID !== null && !isLocalRecordID(artifactID)) ||
    (noActionID !== null && !isLocalRecordID(noActionID)) ||
    (candidateFingerprint !== null &&
      !isLocalRecordFingerprint(candidateFingerprint)) ||
    !Array.isArray(externalEffects) ||
    externalEffects.length !== 0 ||
    !Array.isArray(permissionDenials) ||
    !permissionDenials.every((denial) => typeof denial === "string") ||
    (providerSessionID !== null && typeof providerSessionID !== "string") ||
    !isLocalRecordTimestamp(completedAt) ||
    !isLocalRecordObject(usage)
  ) {
    throw localRecordCorruptError("terminal");
  }
  // Status/ID relationships exactly as the runners produce them: a successful
  // artifact/no-action carries its committed ID and candidate fingerprint and
  // no competing output ID; other statuses claim no committed output ID while
  // a candidate fingerprint may legitimately predate a failure.
  if (status === "artifact_created") {
    if (
      artifactID === null ||
      noActionID !== null ||
      candidateFingerprint === null
    ) {
      throw localRecordCorruptError("terminal");
    }
  } else if (status === "no_action") {
    if (
      noActionID === null ||
      artifactID !== null ||
      candidateFingerprint === null
    ) {
      throw localRecordCorruptError("terminal");
    }
  } else if (artifactID !== null || noActionID !== null) {
    throw localRecordCorruptError("terminal");
  }
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const totalTokens = usage.totalTokens;
  const estimatedUsd = usage.estimatedUsd;
  const turns = usage.turns;
  const toolCalls = usage.toolCalls;
  const durationMs = usage.durationMs;
  if (
    (inputTokens !== null && typeof inputTokens !== "number") ||
    (outputTokens !== null && typeof outputTokens !== "number") ||
    (totalTokens !== null && typeof totalTokens !== "number") ||
    (estimatedUsd !== null && typeof estimatedUsd !== "number") ||
    (turns !== null && typeof turns !== "number") ||
    typeof toolCalls !== "number" ||
    typeof durationMs !== "number"
  ) {
    throw localRecordCorruptError("terminal");
  }
  return {
    runID,
    status,
    reasonCode,
    artifactID,
    noActionID,
    candidateFingerprint,
    externalEffects: [],
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedUsd,
      turns,
      toolCalls,
      durationMs,
    },
    permissionDenials: [...permissionDenials] as string[],
    providerSessionID,
    completedAt,
  };
}

function parseCheckpoint(
  value: unknown,
): AgentPublicResearchCheckpoint {
  if (!isLocalRecordObject(value)) throw localRecordCorruptError("checkpoint");
  const searchResults = value.searchResults;
  const fetchedPages = value.fetchedPages;
  const searchCalls = value.searchCalls;
  const fetchCalls = value.fetchCalls;
  const toolCalls = value.toolCalls;
  const sequence = value.sequence;
  if (
    !Array.isArray(searchResults) ||
    !Array.isArray(fetchedPages) ||
    !isLocalRecordCounter(searchCalls) ||
    !isLocalRecordCounter(fetchCalls) ||
    !isLocalRecordCounter(toolCalls) ||
    !isLocalRecordCounter(sequence)
  ) {
    throw localRecordCorruptError("checkpoint");
  }
  return {
    searchResults: searchResults.map(parseWebSearchResult),
    fetchedPages: fetchedPages.map(parseFetchedWebPage),
    searchCalls,
    fetchCalls,
    toolCalls,
    sequence,
  };
}

function parseArtifactRecord(
  runID: string,
  candidateFingerprint: string,
  value: unknown,
): LocalResearchArtifactRecord {
  if (!isLocalRecordObject(value)) throw localRecordCorruptError("artifact");
  const artifactID = value.artifactID;
  const objective = value.objective;
  const authorization = value.authorization;
  const candidate = value.candidate;
  const createdAt = value.createdAt;
  if (
    !isLocalRecordID(artifactID) ||
    value.runID !== runID ||
    value.status !== "draft" ||
    value.publicationAuthority !== "none" ||
    value.candidateFingerprint !== candidateFingerprint ||
    typeof objective !== "string" ||
    !isLocalRecordObject(authorization) ||
    !isLocalRecordObject(candidate) ||
    !isLocalRecordTimestamp(createdAt)
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    artifactID,
    runID,
    status: "draft",
    publicationAuthority: "none",
    candidateFingerprint,
    objective,
    authorization: parseAuthorization(authorization, "artifact"),
    candidate: parseResearchArtifactCandidate(candidate),
    createdAt,
  };
}

function parseNoActionRecord(
  runID: string,
  candidateFingerprint: string,
  value: unknown,
): LocalResearchNoActionRecord {
  if (!isLocalRecordObject(value)) throw localRecordCorruptError("no-action");
  const noActionID = value.noActionID;
  const candidate = value.candidate;
  const createdAt = value.createdAt;
  if (
    !isLocalRecordID(noActionID) ||
    value.runID !== runID ||
    value.candidateFingerprint !== candidateFingerprint ||
    !isLocalRecordObject(candidate) ||
    !isLocalRecordTimestamp(createdAt)
  ) {
    throw localRecordCorruptError("no-action");
  }
  return {
    noActionID,
    runID,
    candidateFingerprint,
    candidate: parsePublicNoActionCandidate(candidate),
    createdAt,
  };
}

export class LocalResearchStore implements AgentPublicResearchJournal {
  private readonly lastSequence = new Map<string, number>();

  constructor(readonly stateRoot: string) {}

  private runDirectory(runID: string): string {
    assertLocalRunID(runID);
    return join(this.stateRoot, "runs", runID);
  }

  private path(runID: string, name: string): string {
    return join(this.runDirectory(runID), name);
  }

  private async ensureRunDirectories(runID: string): Promise<void> {
    const directory = this.runDirectory(runID);
    await fs.mkdir(join(directory, "artifacts"), { recursive: true, mode: 0o700 });
    await fs.mkdir(join(directory, "no-actions"), { recursive: true, mode: 0o700 });
    await fs.chmod(this.stateRoot, 0o700);
    await fs.chmod(join(this.stateRoot, "runs"), 0o700);
    await fs.chmod(directory, 0o700);
  }

  async start(input: LocalRunRecord): Promise<void> {
    await this.ensureRunDirectories(input.scope.runID);
    const requested = parseRunRecord(input.scope.runID, input);
    await publishImmutableJsonRecord(
      this.path(input.scope.runID, "run.json"),
      input,
      (value) => {
        const existing = parseRunRecord(input.scope.runID, value);
        if (stableRunIdentity(existing) !== stableRunIdentity(requested)) {
          throw new Error(
            "The run ID already belongs to a different objective, authorization, provider, or budget.",
          );
        }
        return existing;
      },
    );
    const checkpoint = await this.loadCheckpoint(input.scope.runID);
    this.lastSequence.set(input.scope.runID, checkpoint?.sequence ?? 0);
  }

  async loadCheckpoint(runID: string) {
    return readPersistedJsonRecord(
      this.path(runID, "checkpoint.json"),
      parseCheckpoint,
    );
  }

  async saveCheckpoint(
    runID: string,
    checkpoint: AgentPublicResearchCheckpoint,
  ): Promise<void> {
    parseCheckpoint(checkpoint);
    await replaceMutableJsonRecord(this.path(runID, "checkpoint.json"), checkpoint);
  }

  async append(event: AgentJournalEvent): Promise<void> {
    const expected = (this.lastSequence.get(event.runID) ?? 0) + 1;
    if (event.sequence !== expected) {
      throw new Error(
        `Local journal sequence mismatch: expected ${expected}, received ${event.sequence}.`,
      );
    }
    await fs.appendFile(
      this.path(event.runID, "events.jsonl"),
      `${JSON.stringify(event)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    this.lastSequence.set(event.runID, event.sequence);
  }

  async recordOutput(output: AgentJournalOutput): Promise<void> {
    await fs.appendFile(
      this.path(output.runID, "outputs.jsonl"),
      `${JSON.stringify(output)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  async complete(receipt: AgentPublicResearchTerminalReceipt) {
    const requested = parseTerminalReceipt(receipt.runID, receipt);
    const publication = await publishImmutableJsonRecord(
      this.path(receipt.runID, "terminal.json"),
      receipt,
      (value) => {
        const existing = parseTerminalReceipt(receipt.runID, value);
        if (fingerprint(existing) !== fingerprint(requested)) {
          throw new Error("The run already has a different terminal receipt.");
        }
        return existing;
      },
    );
    return publication.record;
  }

  async readTerminal(runID: string) {
    return readPersistedJsonRecord(this.path(runID, "terminal.json"), (value) =>
      parseTerminalReceipt(runID, value),
    );
  }

  async readRun(runID: string) {
    return readPersistedJsonRecord(this.path(runID, "run.json"), (value) =>
      parseRunRecord(runID, value),
    );
  }

  async commitResearchArtifact(
    scope: AgentPublicResearchScope,
    candidate: AgentResearchArtifactCandidate,
    candidateFingerprint: string,
  ) {
    if (!isLocalRecordFingerprint(candidateFingerprint)) {
      throw new Error("The artifact fingerprint is invalid.");
    }
    const record: LocalResearchArtifactRecord = {
      artifactID: randomUUID(),
      runID: scope.runID,
      status: "draft",
      publicationAuthority: "none",
      candidateFingerprint,
      objective: scope.objective,
      authorization: scope.authorization,
      candidate,
      createdAt: new Date().toISOString(),
    };
    const requested = parseArtifactRecord(
      scope.runID,
      candidateFingerprint,
      record,
    );
    const publication = await publishImmutableJsonRecord(
      this.artifactPath(scope.runID, candidateFingerprint),
      record,
      (value) => {
        const existing = parseArtifactRecord(
          scope.runID,
          candidateFingerprint,
          value,
        );
        if (
          existing.objective !== requested.objective ||
          fingerprint(existing.authorization) !==
            fingerprint(requested.authorization) ||
          fingerprint(existing.candidate) !== fingerprint(requested.candidate)
        ) {
          throw new Error(
            "The persisted research artifact conflicts with the requested candidate.",
          );
        }
        return existing;
      },
    );
    return {
      artifactID: publication.record.artifactID,
      status: "draft" as const,
      replayed: publication.replayed,
      createdAt: publication.record.createdAt,
    };
  }

  async commitNoAction(
    scope: AgentPublicResearchScope,
    candidate: AgentPublicResearchNoActionCandidate,
    candidateFingerprint: string,
  ) {
    if (!isLocalRecordFingerprint(candidateFingerprint)) {
      throw new Error("The no-action fingerprint is invalid.");
    }
    const record: LocalResearchNoActionRecord = {
      noActionID: randomUUID(),
      runID: scope.runID,
      candidateFingerprint,
      candidate,
      createdAt: new Date().toISOString(),
    };
    const requested = parseNoActionRecord(
      scope.runID,
      candidateFingerprint,
      record,
    );
    const publication = await publishImmutableJsonRecord(
      this.noActionPath(scope.runID, candidateFingerprint),
      record,
      (value) => {
        const existing = parseNoActionRecord(
          scope.runID,
          candidateFingerprint,
          value,
        );
        if (fingerprint(existing.candidate) !== fingerprint(requested.candidate)) {
          throw new Error(
            "The persisted research no-action record conflicts with the requested candidate.",
          );
        }
        return existing;
      },
    );
    return {
      noActionID: publication.record.noActionID,
      replayed: publication.replayed,
      createdAt: publication.record.createdAt,
    };
  }

  artifactPath(runID: string, candidateFingerprint: string): string {
    if (!isLocalRecordFingerprint(candidateFingerprint)) {
      throw new Error("The artifact fingerprint is invalid.");
    }
    return join(
      this.runDirectory(runID),
      "artifacts",
      `${candidateFingerprint}.json`,
    );
  }

  noActionPath(runID: string, candidateFingerprint: string): string {
    if (!isLocalRecordFingerprint(candidateFingerprint)) {
      throw new Error("The no-action fingerprint is invalid.");
    }
    return join(
      this.runDirectory(runID),
      "no-actions",
      `${candidateFingerprint}.json`,
    );
  }

  async artifactExists(runID: string, candidateFingerprint: string) {
    try {
      await fs.access(this.artifactPath(runID, candidateFingerprint), constants.R_OK);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
}
