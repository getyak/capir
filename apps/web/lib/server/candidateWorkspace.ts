import "server-only";

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import {
  isCandidateMomentumDataset,
  parseCandidateMomentumDataset,
  type CandidateMomentumDataset,
  type WorkspaceDataSource,
} from "../candidateMomentum";

const LOCAL_BACKEND_PATH = "/v1/candidate-momentum/cases";
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

const PRIVATE_MARKER_FILE = ".capir-evaluation.json";
const PRIVATE_MARKER_SCHEMA = "capir-private-evaluation.v1";
const PRIVATE_MARKER_REPOSITORY = "getyak/capir-evals";
const CORPUS_RELATIVE_PATH = ["evals", "candidate-momentum-v1.json"];

export type CandidateWorkspaceRead = {
  dataset: CandidateMomentumDataset | null;
  source: WorkspaceDataSource;
};

function getLocalBackendEndpoint() {
  const configured = process.env.TALENT_SIGNAL_BACKEND_URL?.trim();
  if (!configured) {
    return null;
  }

  try {
    const url = new URL(configured);
    if (
      !LOCAL_HOSTNAMES.has(url.hostname) ||
      (url.protocol !== "http:" && url.protocol !== "https:")
    ) {
      return null;
    }
    return new URL(LOCAL_BACKEND_PATH, url);
  } catch {
    return null;
  }
}

function inside(parent: string, child: string) {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * The product checkout root is the pnpm workspace root above `apps/web`. It is
 * located from the process working directory so the check survives both
 * `next dev`/`next start` (cwd = apps/web) and repository-root invocations.
 */
function productCheckoutRoot(): string | null {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/**
 * Optional private-development loader (GET-134). It reads the canonical
 * `evals/candidate-momentum-v1.json` from an explicitly configured, absolute
 * `CAPIR_EVAL_REPO` outside the product checkout, and only when that root
 * carries the capir-evals marker. Without that explicit configuration the
 * corpus stays unavailable: this function never fetches remote evidence and
 * never falls back to an embedded copy.
 */
async function loadPrivateEvaluationCorpus(): Promise<{
  dataset: CandidateMomentumDataset | null;
  detail: string;
}> {
  const configured = process.env.CAPIR_EVAL_REPO?.trim();
  if (!configured) {
    return {
      dataset: null,
      detail:
        "CAPIR_EVAL_REPO is not configured, so the frozen evaluation corpus is unavailable in this session.",
    };
  }
  if (!isAbsolute(configured)) {
    return {
      dataset: null,
      detail: "CAPIR_EVAL_REPO must be an absolute directory path.",
    };
  }

  const productCheckout = productCheckoutRoot();
  if (!productCheckout) {
    return {
      dataset: null,
      detail:
        "The product checkout root could not be located, so the private evaluation repository was ignored.",
    };
  }

  let evalRepo: string;
  let productRoot: string;
  try {
    evalRepo = realpathSync(configured);
    productRoot = realpathSync(productCheckout);
  } catch {
    return {
      dataset: null,
      detail: "CAPIR_EVAL_REPO could not be resolved on this host.",
    };
  }

  for (const product of [productCheckout, productRoot]) {
    for (const evaluation of [evalRepo, resolve(configured)]) {
      if (inside(product, evaluation) || inside(evaluation, product)) {
        return {
          dataset: null,
          detail:
            "CAPIR_EVAL_REPO must live outside the product checkout; the private evaluation repository was ignored.",
        };
      }
    }
  }

  let marker: { repository?: unknown; schemaVersion?: unknown } | null = null;
  try {
    marker = JSON.parse(
      readFileSync(join(evalRepo, PRIVATE_MARKER_FILE), "utf8"),
    );
  } catch {
    return {
      dataset: null,
      detail: `The evaluation root marker ${PRIVATE_MARKER_FILE} is missing or invalid; this is not a capir-evals checkout.`,
    };
  }
  if (
    marker?.schemaVersion !== PRIVATE_MARKER_SCHEMA ||
    marker?.repository !== PRIVATE_MARKER_REPOSITORY
  ) {
    return {
      dataset: null,
      detail: `The evaluation root marker ${PRIVATE_MARKER_FILE} does not identify ${PRIVATE_MARKER_REPOSITORY}.`,
    };
  }

  try {
    const corpusPath = realpathSync(join(evalRepo, ...CORPUS_RELATIVE_PATH));
    if (!inside(evalRepo, corpusPath)) {
      return {dataset:null,detail:"The corpus path must stay inside the configured evaluation repository."};
    }
    const payload: unknown = JSON.parse(
      await readFile(corpusPath, "utf8"),
    );
    const dataset = parseCandidateMomentumDataset(payload);
    if (!dataset) {
      return {
        dataset: null,
        detail:
          "The private evaluation corpus does not satisfy the frozen candidate-momentum contract.",
      };
    }
    // A file in the case bank is fixture input, never synchronized runtime state.
    return { dataset: {...dataset,data_mode:"fixture"}, detail: "" };
  } catch {
    return {
      dataset: null,
      detail:
        "The private evaluation corpus could not be read from the configured evaluation repository.",
    };
  }
}

const UNAVAILABLE_SOURCE: WorkspaceDataSource = {
  kind: "unavailable",
  label: "评测语料不可用",
  detail:
    "八案例评测语料只有私有 getyak/capir-evals 一个权威来源，本产品仓库不内置任何示例。私有开发时配置绝对路径的 CAPIR_EVAL_REPO 才会加载；当前不展示任何示例，也不会伪造同步状态。",
};

export async function loadCandidateWorkspace(): Promise<CandidateWorkspaceRead> {
  const { dataset: reference, detail: referenceDetail } =
    await loadPrivateEvaluationCorpus();
  const endpoint = getLocalBackendEndpoint();

  if (reference && endpoint) {
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) {
        throw new Error("local backend returned an error");
      }

      const payload: unknown = await response.json();
      if (!isCandidateMomentumDataset(payload, reference)) {
        throw new Error("local backend dataset deviates from the frozen contract");
      }

      return {
        dataset: payload,
        source: {
          kind:
            payload.data_mode === "synchronized"
              ? "synchronized-local"
              : "fixture-local",
          label:
            payload.data_mode === "synchronized"
              ? "Local synchronized backend"
              : "Local fixture backend",
          detail:
            payload.data_mode === "synchronized"
              ? "This state was explicitly labeled synchronized by the configured localhost backend."
              : "已配置的本地主机后端返回了合成测试状态，不代表任何外部系统。",
        },
      };
    } catch {
      return {
        dataset: reference,
        source: {
          kind: "fixture-local",
          label: "Private evaluation corpus",
          detail:
            "本地主机后端无法核验，已改为展示显式配置的私有评测语料。刷新可重试。",
        },
      };
    }
  }

  if (reference) {
    return {
      dataset: reference,
      source: {
        kind: "fixture-local",
        label: "Private evaluation corpus",
        detail:
          "语料来自显式配置的私有 capir-evals 仓库，仅用于本地评测审阅；不代表任何外部系统状态。",
      },
    };
  }

  return {
    dataset: null,
    source: {
      ...UNAVAILABLE_SOURCE,
      detail: `${UNAVAILABLE_SOURCE.detail}（${referenceDetail}）`,
    },
  };
}
