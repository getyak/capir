import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { join } from "node:path";

import {
  fingerprint,
  type AgentBudget,
  type AgentInputArtifactManifestItem,
  type AgentJournalEvent,
  type AgentJournalOutput,
  type AgentPersonResearchArtifactCandidate,
  type AgentPersonResearchCheckpoint,
  type AgentPersonResearchJournal,
  type AgentPersonResearchNoActionCandidate,
  type AgentPersonResearchPlatform,
  type AgentPersonResearchScope,
  type AgentPersonResearchTerminalReceipt,
  type AgentPersonResearchAuthorization,
  type AgentPublicProfileResult,
} from "@talent-signal/agent";

import {
  assertLocalRunID,
  isLocalRecordCounter,
  isLocalRecordEnum,
  isLocalRecordFingerprint,
  isLocalRecordFingerprintArray,
  isLocalRecordID,
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

const PERSON_PLATFORMS = ["douyin", "tiktok", "weibo", "threads"] as const;
const PERSON_IDENTITY_STATUSES = ["possible_match", "ambiguous"] as const;
const PERSON_CLUE_KINDS = [
  "display_name",
  "handle",
  "profile_url",
  "platform",
] as const;
const PERSON_CLUE_OBSERVATION_STATUS =
  "unreviewed_screenshot_observation" as const;
const PERSON_EPISTEMIC_STATUSES = [
  "provider_observation",
  "agent_inference",
] as const;
const PERSON_NO_ACTION_REASON_CODES = [
  "NO_VISIBLE_IDENTITY_CLUE",
  "AMBIGUOUS_IDENTITY_CLUE",
  "NO_PUBLIC_PROFILE_MATCH",
  "UNTRUSTED_INSTRUCTION",
  "PROHIBITED_PERSON_ASSESSMENT",
  "PERSON_RESEARCH_UNAVAILABLE",
] as const;

export interface LocalPersonResearchRunRecord {
  scope: AgentPersonResearchScope;
  budget: AgentBudget;
  modelProviderID: string;
  model: string;
  sdkVersion: string;
  startedAt: string;
}

export interface LocalPersonResearchArtifactRecord {
  artifactID: string;
  runID: string;
  status: "draft";
  identityAuthority: "unconfirmed";
  publicationAuthority: "none";
  externalEffectAuthority: "none";
  candidateFingerprint: string;
  objective: string;
  authorization: AgentPersonResearchScope["authorization"];
  inputArtifactManifest: AgentPersonResearchScope["inputArtifactManifest"];
  candidate: AgentPersonResearchArtifactCandidate;
  createdAt: string;
}

export interface LocalPersonResearchNoActionRecord {
  noActionID: string;
  runID: string;
  candidateFingerprint: string;
  candidate: AgentPersonResearchNoActionCandidate;
  createdAt: string;
}

function stableRunIdentity(record: LocalPersonResearchRunRecord) {
  return fingerprint({
    scope: record.scope,
    budget: record.budget,
    modelProviderID: record.modelProviderID,
    model: record.model,
    sdkVersion: record.sdkVersion,
  });
}

function parsePlatforms(
  value: unknown,
  kind: string,
): AgentPersonResearchPlatform[] {
  if (!Array.isArray(value)) throw localRecordCorruptError(kind);
  const platforms: AgentPersonResearchPlatform[] = [];
  for (const platform of value) {
    if (!isLocalRecordEnum(platform, PERSON_PLATFORMS)) {
      throw localRecordCorruptError(kind);
    }
    platforms.push(platform);
  }
  return platforms;
}

function parseAuthorization(
  value: Record<string, unknown>,
  kind: string,
): AgentPersonResearchAuthorization {
  const maximumProviderCalls = value.maximumProviderCalls;
  const maximumResultsPerCall = value.maximumResultsPerCall;
  if (
    value.purpose !== "person_public_profile_research" ||
    value.accessMode !== "visible_screenshot_identity_clues" ||
    typeof maximumProviderCalls !== "number" ||
    typeof maximumResultsPerCall !== "number"
  ) {
    throw localRecordCorruptError(kind);
  }
  return {
    purpose: "person_public_profile_research",
    accessMode: "visible_screenshot_identity_clues",
    allowedPlatforms: parsePlatforms(value.allowedPlatforms, kind),
    maximumProviderCalls,
    maximumResultsPerCall,
  };
}

function parseManifestItem(
  value: unknown,
  kind: string,
): AgentInputArtifactManifestItem {
  if (
    !isLocalRecordObject(value) ||
    typeof value.artifactID !== "string" ||
    value.artifactID.length < 1 ||
    !isLocalRecordEnum(value.kind, ["text", "image"] as const) ||
    typeof value.mimeType !== "string" ||
    typeof value.byteSize !== "number" ||
    !isLocalRecordFingerprint(value.contentHash)
  ) {
    throw localRecordCorruptError(kind);
  }
  return {
    artifactID: value.artifactID,
    kind: value.kind,
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    contentHash: value.contentHash,
  };
}

function parseManifest(
  value: unknown,
  kind: string,
): readonly AgentInputArtifactManifestItem[] {
  if (!Array.isArray(value)) throw localRecordCorruptError(kind);
  return value.map((item) => parseManifestItem(item, kind));
}

function parseProfileResult(value: unknown): AgentPublicProfileResult {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordFingerprint(value.resultID) ||
    !isLocalRecordEnum(value.platform, PERSON_PLATFORMS) ||
    typeof value.providerID !== "string" ||
    (value.providerRequestID !== null &&
      typeof value.providerRequestID !== "string") ||
    typeof value.profileID !== "string" ||
    typeof value.displayName !== "string" ||
    (value.handle !== null && typeof value.handle !== "string") ||
    (value.biography !== null && typeof value.biography !== "string") ||
    typeof value.profileUrl !== "string" ||
    (value.avatarUrl !== null && typeof value.avatarUrl !== "string") ||
    (value.verified !== null && typeof value.verified !== "boolean") ||
    !isLocalRecordFingerprint(value.contentHash) ||
    !isLocalRecordTimestamp(value.retrievedAt)
  ) {
    throw localRecordCorruptError("checkpoint");
  }
  return {
    resultID: value.resultID,
    platform: value.platform,
    providerID: value.providerID,
    providerRequestID: value.providerRequestID,
    profileID: value.profileID,
    displayName: value.displayName,
    handle: value.handle,
    biography: value.biography,
    profileUrl: value.profileUrl,
    avatarUrl: value.avatarUrl,
    verified: value.verified,
    contentHash: value.contentHash,
    retrievedAt: value.retrievedAt,
  };
}

function parseQueryObservation(
  value: unknown,
): AgentPersonResearchCheckpoint["queryObservations"][number] {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordEnum(value.platform, PERSON_PLATFORMS) ||
    typeof value.query !== "string" ||
    typeof value.sourceArtifactID !== "string" ||
    value.sourceArtifactID.length < 1 ||
    value.observationStatus !== PERSON_CLUE_OBSERVATION_STATUS
  ) {
    throw localRecordCorruptError("checkpoint");
  }
  return {
    platform: value.platform,
    query: value.query,
    sourceArtifactID: value.sourceArtifactID,
    observationStatus: "unreviewed_screenshot_observation",
  };
}

function parseObservedClue(
  value: unknown,
): AgentPersonResearchArtifactCandidate["observedClues"][number] {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordEnum(value.kind, PERSON_CLUE_KINDS) ||
    typeof value.value !== "string" ||
    typeof value.sourceArtifactID !== "string" ||
    value.sourceArtifactID.length < 1 ||
    value.observationStatus !== PERSON_CLUE_OBSERVATION_STATUS
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    kind: value.kind,
    value: value.value,
    sourceArtifactID: value.sourceArtifactID,
    observationStatus: "unreviewed_screenshot_observation",
  };
}

function parseCandidateRef(
  value: unknown,
): AgentPersonResearchArtifactCandidate["candidates"][number] {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordFingerprint(value.resultID) ||
    typeof value.matchBasis !== "string"
  ) {
    throw localRecordCorruptError("artifact");
  }
  return { resultID: value.resultID, matchBasis: value.matchBasis };
}

function parsePersonClaim(
  value: unknown,
): AgentPersonResearchArtifactCandidate["claims"][number] {
  if (
    !isLocalRecordObject(value) ||
    typeof value.statement !== "string" ||
    !isLocalRecordEnum(value.epistemicStatus, PERSON_EPISTEMIC_STATUSES) ||
    !isLocalRecordFingerprintArray(value.sourceRefs)
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    statement: value.statement,
    epistemicStatus: value.epistemicStatus,
    sourceRefs: value.sourceRefs,
  };
}

function parsePersonSource(
  value: unknown,
): AgentPersonResearchArtifactCandidate["sources"][number] {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordFingerprint(value.resultID) ||
    !isLocalRecordEnum(value.platform, PERSON_PLATFORMS) ||
    typeof value.profileUrl !== "string" ||
    typeof value.displayName !== "string" ||
    (value.handle !== null && typeof value.handle !== "string") ||
    (value.biography !== null && typeof value.biography !== "string") ||
    (value.avatarUrl !== null && typeof value.avatarUrl !== "string") ||
    (value.verified !== null && typeof value.verified !== "boolean") ||
    !isLocalRecordFingerprint(value.contentHash) ||
    !isLocalRecordTimestamp(value.retrievedAt) ||
    typeof value.providerID !== "string" ||
    (value.providerRequestID !== null &&
      typeof value.providerRequestID !== "string")
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    resultID: value.resultID,
    platform: value.platform,
    profileUrl: value.profileUrl,
    displayName: value.displayName,
    handle: value.handle,
    biography: value.biography,
    avatarUrl: value.avatarUrl,
    verified: value.verified,
    contentHash: value.contentHash,
    retrievedAt: value.retrievedAt,
    providerID: value.providerID,
    providerRequestID: value.providerRequestID,
  };
}

function parsePersonArtifactCandidate(
  value: unknown,
): AgentPersonResearchArtifactCandidate {
  if (!isLocalRecordObject(value)) throw localRecordCorruptError("artifact");
  const observedClues = value.observedClues;
  const candidates = value.candidates;
  const claims = value.claims;
  const sources = value.sources;
  if (
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.limitations !== "string" ||
    !isLocalRecordEnum(value.identityStatus, PERSON_IDENTITY_STATUSES) ||
    !Array.isArray(observedClues) ||
    !Array.isArray(candidates) ||
    !Array.isArray(claims) ||
    !Array.isArray(sources)
  ) {
    throw localRecordCorruptError("artifact");
  }
  return {
    title: value.title,
    summary: value.summary,
    limitations: value.limitations,
    identityStatus: value.identityStatus,
    observedClues: observedClues.map(parseObservedClue),
    candidates: candidates.map(parseCandidateRef),
    claims: claims.map(parsePersonClaim),
    sources: sources.map(parsePersonSource),
  };
}

function parsePersonNoActionCandidate(
  value: unknown,
): AgentPersonResearchNoActionCandidate {
  if (
    !isLocalRecordObject(value) ||
    !isLocalRecordEnum(value.reasonCode, PERSON_NO_ACTION_REASON_CODES) ||
    typeof value.reason !== "string"
  ) {
    throw localRecordCorruptError("no-action");
  }
  return { reasonCode: value.reasonCode, reason: value.reason };
}

function parseRunRecord(
  runID: string,
  value: unknown,
): LocalPersonResearchRunRecord {
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
      inputArtifactManifest: parseManifest(scope.inputArtifactManifest, "run"),
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

function parseTerminalReceipt(
  runID: string,
  value: unknown,
): AgentPersonResearchTerminalReceipt {
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
): AgentPersonResearchCheckpoint {
  if (!isLocalRecordObject(value)) throw localRecordCorruptError("checkpoint");
  const profileResults = value.profileResults;
  const queryObservations = value.queryObservations;
  const providerCalls = value.providerCalls;
  const toolCalls = value.toolCalls;
  const sequence = value.sequence;
  if (
    !Array.isArray(profileResults) ||
    !Array.isArray(queryObservations) ||
    !isLocalRecordCounter(providerCalls) ||
    !isLocalRecordCounter(toolCalls) ||
    !isLocalRecordCounter(sequence)
  ) {
    throw localRecordCorruptError("checkpoint");
  }
  return {
    profileResults: profileResults.map(parseProfileResult),
    queryObservations: queryObservations.map(parseQueryObservation),
    providerCalls,
    toolCalls,
    sequence,
  };
}

function parseArtifactRecord(
  runID: string,
  candidateFingerprint: string,
  value: unknown,
): LocalPersonResearchArtifactRecord {
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
    value.identityAuthority !== "unconfirmed" ||
    value.publicationAuthority !== "none" ||
    value.externalEffectAuthority !== "none" ||
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
    identityAuthority: "unconfirmed",
    publicationAuthority: "none",
    externalEffectAuthority: "none",
    candidateFingerprint,
    objective,
    authorization: parseAuthorization(authorization, "artifact"),
    inputArtifactManifest: parseManifest(value.inputArtifactManifest, "artifact"),
    candidate: parsePersonArtifactCandidate(candidate),
    createdAt,
  };
}

function parseNoActionRecord(
  runID: string,
  candidateFingerprint: string,
  value: unknown,
): LocalPersonResearchNoActionRecord {
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
    candidate: parsePersonNoActionCandidate(candidate),
    createdAt,
  };
}

export class LocalPersonResearchStore implements AgentPersonResearchJournal {
  private readonly lastSequence = new Map<string, number>();

  constructor(readonly stateRoot: string) {}

  private runDirectory(runID: string): string {
    assertLocalRunID(runID);
    return join(this.stateRoot, "person-runs", runID);
  }

  private path(runID: string, name: string): string {
    return join(this.runDirectory(runID), name);
  }

  private async ensureRunDirectories(runID: string): Promise<void> {
    const collection = join(this.stateRoot, "person-runs");
    const directory = this.runDirectory(runID);
    await fs.mkdir(join(directory, "artifacts"), { recursive: true, mode: 0o700 });
    await fs.mkdir(join(directory, "no-actions"), { recursive: true, mode: 0o700 });
    await fs.chmod(this.stateRoot, 0o700);
    await fs.chmod(collection, 0o700);
    await fs.chmod(directory, 0o700);
  }

  async start(input: LocalPersonResearchRunRecord): Promise<void> {
    await this.ensureRunDirectories(input.scope.runID);
    const requested = parseRunRecord(input.scope.runID, input);
    await publishImmutableJsonRecord(
      this.path(input.scope.runID, "run.json"),
      input,
      (value) => {
        const existing = parseRunRecord(input.scope.runID, value);
        if (stableRunIdentity(existing) !== stableRunIdentity(requested)) {
          throw new Error(
            "The Run ID already belongs to a different image, objective, authorization, provider, model, or budget.",
          );
        }
        return existing;
      },
    );
    const checkpoint = await this.loadCheckpoint(input.scope.runID);
    this.lastSequence.set(input.scope.runID, checkpoint?.sequence ?? 0);
  }

  loadCheckpoint(runID: string) {
    return readPersistedJsonRecord(
      this.path(runID, "checkpoint.json"),
      parseCheckpoint,
    );
  }

  saveCheckpoint(runID: string, checkpoint: AgentPersonResearchCheckpoint) {
    parseCheckpoint(checkpoint);
    return replaceMutableJsonRecord(this.path(runID, "checkpoint.json"), checkpoint);
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

  async complete(receipt: AgentPersonResearchTerminalReceipt) {
    const requested = parseTerminalReceipt(receipt.runID, receipt);
    const publication = await publishImmutableJsonRecord(
      this.path(receipt.runID, "terminal.json"),
      receipt,
      (value) => {
        const existing = parseTerminalReceipt(receipt.runID, value);
        if (fingerprint(existing) !== fingerprint(requested)) {
          throw new Error("The Run already has a different terminal receipt.");
        }
        return existing;
      },
    );
    return publication.record;
  }

  readTerminal(runID: string) {
    return readPersistedJsonRecord(this.path(runID, "terminal.json"), (value) =>
      parseTerminalReceipt(runID, value),
    );
  }

  readRun(runID: string) {
    return readPersistedJsonRecord(this.path(runID, "run.json"), (value) =>
      parseRunRecord(runID, value),
    );
  }

  async commitPersonResearchArtifact(
    scope: AgentPersonResearchScope,
    candidate: AgentPersonResearchArtifactCandidate,
    candidateFingerprint: string,
  ) {
    if (!isLocalRecordFingerprint(candidateFingerprint)) {
      throw new Error("The artifact fingerprint is invalid.");
    }
    const record: LocalPersonResearchArtifactRecord = {
      artifactID: randomUUID(),
      runID: scope.runID,
      status: "draft",
      identityAuthority: "unconfirmed",
      publicationAuthority: "none",
      externalEffectAuthority: "none",
      candidateFingerprint,
      objective: scope.objective,
      authorization: scope.authorization,
      inputArtifactManifest: scope.inputArtifactManifest,
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
          fingerprint(existing.inputArtifactManifest) !==
            fingerprint(requested.inputArtifactManifest) ||
          fingerprint(existing.candidate) !== fingerprint(requested.candidate)
        ) {
          throw new Error(
            "The persisted person-research artifact conflicts with the requested candidate.",
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
    scope: AgentPersonResearchScope,
    candidate: AgentPersonResearchNoActionCandidate,
    candidateFingerprint: string,
  ) {
    if (!isLocalRecordFingerprint(candidateFingerprint)) {
      throw new Error("The no-action fingerprint is invalid.");
    }
    const record: LocalPersonResearchNoActionRecord = {
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
            "The persisted person-research no-action record conflicts with the requested candidate.",
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

  readArtifact(runID: string, candidateFingerprint: string) {
    return readPersistedJsonRecord(
      this.artifactPath(runID, candidateFingerprint),
      (value) => parseArtifactRecord(runID, candidateFingerprint, value),
    );
  }

  readNoAction(runID: string, candidateFingerprint: string) {
    return readPersistedJsonRecord(
      this.noActionPath(runID, candidateFingerprint),
      (value) => parseNoActionRecord(runID, candidateFingerprint, value),
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
