import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  DEFAULT_AGENT_BUDGET,
  fingerprint,
  runPersonResearchAgent,
  type AgentBudget,
  type AgentPersonResearchPlatform,
  type AgentPersonResearchTerminalReceipt,
  type AgentProvider,
} from "@talent-signal/agent";

import { LocalPersonResearchGateway } from "./localPersonResearchGateway.js";
import { LocalPersonResearchStore } from "./localPersonResearchStore.js";
import { withLocalRunAdmission } from "./localRunAdmission.js";
import {
  configuredLocalPersonProfileProvider,
  configuredLocalVisionAgentProvider,
} from "./providerConfig.js";
import type { TikHubProvider } from "./tikHubProvider.js";

interface PersonResearchArguments {
  imagePath: string;
  objective: string;
  allowedPlatforms: AgentPersonResearchPlatform[];
  maximumProviderCalls: number;
  maximumResultsPerCall: number;
  runID: string;
  stateRoot: string;
}

export interface LocalPersonResearchImageInput {
  bytes: Uint8Array;
  mediaType?: "image/png" | "image/jpeg" | "image/webp";
  expectedContentHash?: string;
  objective: string;
  allowedPlatforms: AgentPersonResearchPlatform[];
  maximumProviderCalls: number;
  maximumResultsPerCall: number;
  runID: string;
  stateRoot: string;
}

export interface LocalPersonResearchDependencies {
  modelProvider?: AgentProvider;
  profileProvider?: TikHubProvider;
  gateway?: LocalPersonResearchGateway;
}

export interface LocalPersonResearchCommandResult {
  receipt: AgentPersonResearchTerminalReceipt;
  stateDirectory: string;
  artifactFile: string | null;
  replayedTerminal: boolean;
}

const SUPPORTED_PLATFORMS = new Set<AgentPersonResearchPlatform>([
  "douyin",
  "tiktok",
  "weibo",
  "threads",
]);

function value(args: readonly string[], index: number, flag: string): string {
  const found = args[index + 1]?.trim();
  if (!found || found.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return found;
}

function count(raw: string, flag: string, minimum: number, maximum: number) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function parseArguments(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): PersonResearchArguments {
  if (args[0] !== "person-research") {
    throw new Error(
      "Usage: talent-signal-agent person-research --image <png|jpeg|webp> [--objective <text>] [--platform <douyin|tiktok|weibo|threads>...]",
    );
  }
  let imagePath = "";
  let objective =
    "Find possible public profile matches using only identity text visibly present in this screenshot.";
  const platforms: AgentPersonResearchPlatform[] = [];
  let maximumProviderCalls = 2;
  let maximumResultsPerCall = 5;
  let runID: string = randomUUID();
  let stateRoot = environment.TALENT_SIGNAL_AGENT_STATE_DIR?.trim()
    ? resolve(environment.TALENT_SIGNAL_AGENT_STATE_DIR.trim())
    : resolve(homedir(), ".talent-signal", "agent");

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--") {
      continue;
    } else if (flag === "--image") {
      imagePath = resolve(value(args, index, flag));
      index += 1;
    } else if (flag === "--objective") {
      objective = value(args, index, flag);
      index += 1;
    } else if (flag === "--platform") {
      const platform = value(args, index, flag) as AgentPersonResearchPlatform;
      if (!SUPPORTED_PLATFORMS.has(platform)) {
        throw new Error("--platform must be douyin, tiktok, weibo, or threads.");
      }
      platforms.push(platform);
      index += 1;
    } else if (flag === "--max-provider-calls") {
      maximumProviderCalls = count(value(args, index, flag), flag, 1, 4);
      index += 1;
    } else if (flag === "--max-results") {
      maximumResultsPerCall = count(value(args, index, flag), flag, 1, 10);
      index += 1;
    } else if (flag === "--run-id") {
      runID = value(args, index, flag);
      index += 1;
    } else if (flag === "--state-dir") {
      stateRoot = resolve(value(args, index, flag));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag ?? "<empty>"}.`);
    }
  }
  if (!imagePath) throw new Error("--image is required.");
  if (!objective.trim()) throw new Error("--objective cannot be empty.");
  return {
    imagePath,
    objective,
    allowedPlatforms:
      platforms.length > 0
        ? [...new Set(platforms)]
        : [...SUPPORTED_PLATFORMS],
    maximumProviderCalls,
    maximumResultsPerCall,
    runID,
    stateRoot,
  };
}

function detectedMimeType(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  throw new Error("--image must contain PNG, JPEG, or WebP bytes.");
}

async function readImage(path: string) {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 10_000_000) {
      throw new Error("--image must be a regular file from 1 byte to 10 MB.");
    }
    const bytes = await handle.readFile();
    return { bytes, mediaType: detectedMimeType(bytes) };
  } finally {
    await handle.close();
  }
}

export async function runLocalPersonResearchImage(
  input: LocalPersonResearchImageInput,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: LocalPersonResearchDependencies = {},
): Promise<LocalPersonResearchCommandResult> {
  const bytes = Buffer.from(input.bytes);
  if (bytes.byteLength < 1 || bytes.byteLength > 10_000_000) {
    throw new Error("The person-research image must contain 1 byte to 10 MB.");
  }
  const mimeType = detectedMimeType(bytes);
  if (input.mediaType && input.mediaType !== mimeType) {
    throw new Error("The declared person-research media type does not match its bytes.");
  }
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  if (input.expectedContentHash && input.expectedContentHash !== contentHash) {
    throw new Error("The person-research image hash does not match its task envelope.");
  }
  const image = {
    manifest: {
      artifactID: fingerprint({ kind: "image", mimeType, contentHash }),
      kind: "image" as const,
      mimeType,
      byteSize: bytes.byteLength,
      contentHash,
    },
    dataBase64: bytes.toString("base64"),
  };
  const store = new LocalPersonResearchStore(input.stateRoot);
  const authorization = {
    purpose: "person_public_profile_research" as const,
    accessMode: "visible_screenshot_identity_clues" as const,
    allowedPlatforms: input.allowedPlatforms,
    maximumProviderCalls: input.maximumProviderCalls,
    maximumResultsPerCall: input.maximumResultsPerCall,
  };
  const scope = {
    runID: input.runID,
    objective: input.objective,
    providerID: "tikhub",
    authorization,
    inputArtifactManifest: [image.manifest],
  };
  const stateDirectory = resolve(input.stateRoot, "person-runs", input.runID);
  // Whole-Run admission wraps terminal read and identity replay, provider
  // construction, and runner execution: at most one live process per Run may
  // reach any model or network call, while completed-terminal replay performs
  // no provider call at all.
  return withLocalRunAdmission(
    { runDirectory: stateDirectory, runID: input.runID },
    async () => {
      const existing = await store.readTerminal(input.runID);
      if (existing) {
        const recorded = await store.readRun(input.runID);
        const requestedIdentity = fingerprint({ scope });
        if (!recorded || fingerprint({ scope: recorded.scope }) !== requestedIdentity) {
          throw new Error(
            "The completed Run ID belongs to a different image, objective, or authorization.",
          );
        }
        const artifactFile =
          existing.status === "artifact_created" && existing.candidateFingerprint
            ? store.artifactPath(input.runID, existing.candidateFingerprint)
            : null;
        return {
          receipt: existing,
          stateDirectory,
          artifactFile,
          replayedTerminal: true,
        };
      }
      const profileProvider =
        dependencies.profileProvider ??
        configuredLocalPersonProfileProvider(environment);
      const modelProvider =
        dependencies.modelProvider ?? configuredLocalVisionAgentProvider(environment);
      const gateway =
        dependencies.gateway ?? new LocalPersonResearchGateway(profileProvider, store);
      const budget: AgentBudget = {
        ...DEFAULT_AGENT_BUDGET,
        maxToolCalls: Math.min(
          DEFAULT_AGENT_BUDGET.maxToolCalls,
          input.maximumProviderCalls + 1,
        ),
      };
      const receipt = await runPersonResearchAgent({
        scope,
        budget,
        provider: modelProvider,
        gateway,
        journal: store,
        providerInputParts: [
          {
            ...image.manifest,
            dataBase64: image.dataBase64,
          },
        ],
      });
      const artifactFile =
        receipt.status === "artifact_created" && receipt.candidateFingerprint
          ? store.artifactPath(input.runID, receipt.candidateFingerprint)
          : null;
      return {
        receipt,
        stateDirectory,
        artifactFile,
        replayedTerminal: false,
      };
    },
  );
}

export async function runLocalPersonResearchCommand(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: LocalPersonResearchDependencies = {},
): Promise<LocalPersonResearchCommandResult> {
  const parsed = parseArguments(args, environment);
  const image = await readImage(parsed.imagePath);
  return runLocalPersonResearchImage(
    {
      bytes: image.bytes,
      mediaType: image.mediaType,
      objective: parsed.objective,
      allowedPlatforms: parsed.allowedPlatforms,
      maximumProviderCalls: parsed.maximumProviderCalls,
      maximumResultsPerCall: parsed.maximumResultsPerCall,
      runID: parsed.runID,
      stateRoot: parsed.stateRoot,
    },
    environment,
    dependencies,
  );
}
