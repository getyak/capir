#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_AGENT_BUDGET,
  fingerprint,
  normalizePublicResearchDomains,
  runPublicResearchAgent,
  type AgentBudget,
  type AgentProvider,
  type AgentPublicResearchTerminalReceipt,
} from "@talent-signal/agent";

import { LocalResearchGateway } from "./localResearchGateway.js";
import { LocalResearchStore } from "./localResearchStore.js";
import { withLocalRunAdmission } from "./localRunAdmission.js";
import {
  configuredFirecrawlWebFetch,
  configuredLocalAgentProvider,
  configuredLocalWebSearchProvider,
} from "./providerConfig.js";
import type { AgentWebSearchProvider } from "./webSearchProviders.js";
import { runLocalPersonResearchCommand } from "./personResearchCommand.js";
import { startPersonResearchServer } from "./personResearchServer.js";

interface ResearchArguments {
  objective: string;
  subjectKind: "company" | "market";
  accessMode: "domain_allowlist" | "open_web";
  allowedDomains: string[];
  queryAnchors: string[];
  maximumSearchCount: number;
  maximumFetchCount: number;
  runID: string;
  stateRoot: string;
}

export interface LocalResearchDependencies {
  modelProvider?: AgentProvider;
  searchProvider?: AgentWebSearchProvider;
  gateway?: LocalResearchGateway;
}

export interface LocalResearchCommandResult {
  receipt: AgentPublicResearchTerminalReceipt;
  stateDirectory: string;
  artifactFile: string | null;
  replayedTerminal: boolean;
}

function value(args: readonly string[], index: number, flag: string): string {
  const found = args[index + 1]?.trim();
  if (!found || found.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return found;
}

function count(raw: string, flag: string, minimum: number, maximum: number) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function parseResearchArguments(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): ResearchArguments {
  if (args[0] !== "research") {
    throw new Error(
      "Usage: talent-signal-agent research --objective <text> --subject <company|market> --anchor <term> (--allow-domain <domain>... | --open-web)",
    );
  }
  let objective = "";
  let subjectKind: "company" | "market" | null = null;
  let openWeb = false;
  const allowedDomains: string[] = [];
  const queryAnchors: string[] = [];
  let maximumSearchCount = 2;
  let maximumFetchCount = 3;
  let runID: string = randomUUID();
  let stateRoot = environment.TALENT_SIGNAL_AGENT_STATE_DIR?.trim()
    ? resolve(environment.TALENT_SIGNAL_AGENT_STATE_DIR.trim())
    : resolve(homedir(), ".talent-signal", "agent");

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--") {
      continue;
    } else if (flag === "--open-web") {
      openWeb = true;
    } else if (flag === "--objective") {
      objective = value(args, index, flag);
      index += 1;
    } else if (flag === "--subject") {
      const parsed = value(args, index, flag);
      if (parsed !== "company" && parsed !== "market") {
        throw new Error("--subject must be company or market.");
      }
      subjectKind = parsed;
      index += 1;
    } else if (flag === "--allow-domain") {
      allowedDomains.push(value(args, index, flag));
      index += 1;
    } else if (flag === "--anchor") {
      queryAnchors.push(value(args, index, flag));
      index += 1;
    } else if (flag === "--max-search") {
      maximumSearchCount = count(value(args, index, flag), flag, 1, 3);
      index += 1;
    } else if (flag === "--max-fetch") {
      maximumFetchCount = count(value(args, index, flag), flag, 1, 5);
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
  if (!objective) throw new Error("--objective is required.");
  if (!subjectKind) throw new Error("--subject is required.");
  if (queryAnchors.length === 0) {
    throw new Error("At least one --anchor company or market term is required.");
  }
  if (openWeb === (allowedDomains.length > 0)) {
    throw new Error("Choose exactly one of --open-web or --allow-domain.");
  }
  return {
    objective,
    subjectKind,
    accessMode: openWeb ? "open_web" : "domain_allowlist",
    allowedDomains: normalizePublicResearchDomains(allowedDomains),
    queryAnchors: [
      ...new Set(
        queryAnchors.map((anchor) =>
          anchor.normalize("NFKC").trim().toLowerCase(),
        ),
      ),
    ],
    maximumSearchCount,
    maximumFetchCount,
    runID,
    stateRoot,
  };
}

export async function runLocalResearchCommand(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: LocalResearchDependencies = {},
): Promise<LocalResearchCommandResult> {
  const parsed = parseResearchArguments(args, environment);
  const store = new LocalResearchStore(parsed.stateRoot);
  const stateDirectory = resolve(parsed.stateRoot, "runs", parsed.runID);
  // Whole-Run admission wraps terminal read and identity replay, provider
  // construction, and runner execution: at most one live process per Run may
  // reach any model or network call, while completed-terminal replay performs
  // no provider call at all.
  return withLocalRunAdmission(
    { runDirectory: stateDirectory, runID: parsed.runID },
    async () => {
      const existing = await store.readTerminal(parsed.runID);
      if (existing) {
        const recorded = await store.readRun(parsed.runID);
        const requestedIdentity = fingerprint({
          runID: parsed.runID,
          objective: parsed.objective,
          authorization: {
            purpose: "company_market_research",
            subjectKind: parsed.subjectKind,
            accessMode: parsed.accessMode,
            allowedDomains: parsed.allowedDomains,
            queryAnchors: parsed.queryAnchors,
            maximumSearchCount: parsed.maximumSearchCount,
            maximumFetchCount: parsed.maximumFetchCount,
          },
        });
        if (
          !recorded ||
          fingerprint({
            runID: recorded.scope.runID,
            objective: recorded.scope.objective,
            authorization: recorded.scope.authorization,
          }) !== requestedIdentity
        ) {
          throw new Error(
            "The completed run ID belongs to a different objective or authorization.",
          );
        }
        const artifactFile =
          existing.status === "artifact_created" && existing.candidateFingerprint
            ? store.artifactPath(parsed.runID, existing.candidateFingerprint)
            : null;
        return {
          receipt: existing,
          stateDirectory,
          artifactFile,
          replayedTerminal: true,
        };
      }
      const searchProvider =
        dependencies.searchProvider ?? configuredLocalWebSearchProvider(environment);
      const modelProvider =
        dependencies.modelProvider ?? configuredLocalAgentProvider(environment);
      const gateway =
        dependencies.gateway ??
        new LocalResearchGateway(searchProvider, store, {
          fetchPage: configuredFirecrawlWebFetch(environment),
        });
      const budget: AgentBudget = {
        ...DEFAULT_AGENT_BUDGET,
        maxToolCalls: Math.min(
          DEFAULT_AGENT_BUDGET.maxToolCalls,
          parsed.maximumSearchCount + parsed.maximumFetchCount + 1,
        ),
      };
      const receipt = await runPublicResearchAgent({
        scope: {
          runID: parsed.runID,
          objective: parsed.objective,
          providerID: searchProvider.id,
          authorization: {
            purpose: "company_market_research",
            subjectKind: parsed.subjectKind,
            accessMode: parsed.accessMode,
            allowedDomains: parsed.allowedDomains,
            queryAnchors: parsed.queryAnchors,
            maximumSearchCount: parsed.maximumSearchCount,
            maximumFetchCount: parsed.maximumFetchCount,
          },
        },
        budget,
        provider: modelProvider,
        gateway,
        journal: store,
      });
      const artifactFile =
        receipt.status === "artifact_created" && receipt.candidateFingerprint
          ? store.artifactPath(parsed.runID, receipt.candidateFingerprint)
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

async function main() {
  // SDK Linux libc detection uses a synchronous Node diagnostic report.
  // Omit reverse DNS and credentials from service diagnostics, as in the API.
  // Node 24 supports excludeNetwork although @types/node omits the property.
  Object.assign(process.report, { excludeNetwork: true, excludeEnv: true });
  const args = process.argv.slice(2);
  if (args[0] === "person-research-server") {
    let stateRoot = process.env.TALENT_SIGNAL_AGENT_STATE_DIR?.trim()
      ? resolve(process.env.TALENT_SIGNAL_AGENT_STATE_DIR.trim())
      : resolve(homedir(), ".talent-signal", "agent");
    let socketPath = process.env.TALENT_SIGNAL_PERSON_RESEARCH_SOCKET?.trim()
      ? resolve(process.env.TALENT_SIGNAL_PERSON_RESEARCH_SOCKET.trim())
      : null;
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === "--") continue;
      if (flag === "--state-dir") {
        stateRoot = resolve(value(args, index, flag));
        index += 1;
      } else if (flag === "--socket") {
        socketPath = resolve(value(args, index, flag));
        index += 1;
      } else {
        throw new Error(`Unknown argument: ${flag ?? "<empty>"}.`);
      }
    }
    socketPath ??= resolve(stateRoot, "person-research.sock");
    const server = await startPersonResearchServer({ socketPath, stateRoot });
    process.stdout.write(
      `${JSON.stringify({ status: "ready", socketPath, stateRoot })}\n`,
    );
    await new Promise<void>((accept) => {
      const close = () => server.close(() => accept());
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
    return;
  }
  const result =
    args[0] === "person-research"
      ? await runLocalPersonResearchCommand(args)
      : await runLocalResearchCommand(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!["artifact_created", "no_action"].includes(result.receipt.status)) {
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
