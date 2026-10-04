/**
 * Detached browser-runner launcher.
 *
 * The CLI forks one owned child with a private IPC pipe, hands it the handoff
 * secret over that pipe (never argv, env, or logs), and waits only for the
 * actual launch receipt. The child survives the CLI's completed JSON output
 * and closes when its browser closes or the sandbox expiry arrives. Parent
 * environment secrets (e.g. CAPIR_TOKEN) are never copied into the child.
 */
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CapirCliError, EXIT } from "./errors.js";

export interface RunnerLaunchMessage {
  web_origin: string;
  sandbox_id: string;
  entry_path: string;
  handoff_secret: string;
  sandbox_expires_at: string;
  scenario_id: string;
  receipt_dir?: string;
  /** Explicitly enabled only by the owned local proof adapter. */
  test_headless?: boolean;
  /**
   * Explicit discriminant between entry flows. Omitted preserves the frozen
   * legacy strict-replay sandbox exchange and DOM contract; `test-run`
   * enables the operator test-account entry with exact identity verification.
   */
  purpose?: "test-run" | "sandbox";
  /** Nonsecret expected identity of the target test run. */
  expected?: ExpectedRunIdentity;
}

export interface ExpectedRunIdentity {
  run_id: string;
  account_id: string;
  user_id: string;
  username: string;
}

export interface RunnerVerification {
  banner_state: string | null;
  demo_expiry: string | null;
  /** True only once the entry reported a settled ready/error state. */
  settled: boolean;
  /** True only for a settled ready dataset with all-zero counts. */
  settled_empty: boolean;
  passed: boolean;
  observations: string[];
  /** Purpose-specific fields (dataset contract or legacy directory contract). */
  [key: string]: unknown;
}

export interface EntryObservation {
  banner_state: string | null;
  demo_expiry: string | null;
  dataset_state: string | null;
  dataset_counts: { contacts: number; observations: number; tasks: number };
  /** Canonical identity rendered by the test banner (test-run purpose). */
  run_id?: string | null;
  account_id?: string | null;
  user_id?: string | null;
  username?: string | null;
}

export interface EntryVerdict {
  passed: boolean;
  settled: boolean;
  settled_empty: boolean;
  reason: string;
}

export const PRESET_EXPECTED_COUNTS = {
  daily: { contacts: 12, observations: 30, tasks: 4 },
  empty: { contacts: 0, observations: 0, tasks: 0 },
} as const;

/**
 * Entry verdict over settled run-dataset state.
 *
 * Zero counts are only meaningful after the dataset reported a settled ready
 * state: a pending or failed dataset also reads zero and must never be
 * reported as a verified empty dataset. A settled error is a negative
 * observation for every preset, and a partial seed is never ready.
 */
export function evaluateEntryVerification(
  observation: EntryObservation,
  preset: "daily" | "empty",
  runExpiresAt: string,
): EntryVerdict {
  const settled =
    observation.dataset_state === "ready" || observation.dataset_state === "error";
  const counts = observation.dataset_counts;
  const settled_empty =
    observation.dataset_state === "ready" &&
    counts.contacts === 0 &&
    counts.observations === 0 &&
    counts.tasks === 0;
  const expected = PRESET_EXPECTED_COUNTS[preset];
  const counts_match =
    counts.contacts === expected.contacts &&
    counts.observations === expected.observations &&
    counts.tasks === expected.tasks;
  const reason =
    observation.banner_state !== "active"
      ? "test banner is not active"
      : observation.demo_expiry !== runExpiresAt
        ? "test banner expiry does not match the run expiry"
        : !settled
          ? "run dataset did not settle (verification still pending)"
          : observation.dataset_state === "error"
            ? "run dataset failed verification; an unreadable dataset is not an empty one"
            : !counts_match
              ? `dataset counts ${counts.contacts}/${counts.observations}/${counts.tasks} do not match the ${preset} preset expectation ${expected.contacts}/${expected.observations}/${expected.tasks}`
              : "";
  return { passed: reason === "", settled, settled_empty, reason };
}

/**
 * Exact identity gate for operator test-run entry: the rendered banner must
 * carry the CLI-expected run, account, user and username. Expected values are
 * cross-checked against the actual rendered identity; a foreign run with the
 * same preset or expiry never reports ready.
 */
export function evaluateTestEntryVerification(
  observation: EntryObservation,
  expected: ExpectedRunIdentity,
  preset: "daily" | "empty",
  runExpiresAt: string,
): EntryVerdict {
  const normalizeHandle = (handle: string) => handle.trim().toLowerCase();
  const identityReason =
    observation.run_id !== expected.run_id
      ? "rendered run id does not match the expected run"
      : observation.account_id !== expected.account_id
        ? "rendered account id does not match the expected account"
        : observation.user_id !== expected.user_id
          ? "rendered user id does not match the expected user"
          : normalizeHandle(observation.username ?? "") !== normalizeHandle(expected.username)
            ? "rendered username does not match the expected username"
            : "";
  if (identityReason) {
    return { passed: false, settled: false, settled_empty: false, reason: identityReason };
  }
  return evaluateEntryVerification(observation, preset, runExpiresAt);
}

export interface SandboxEntryObservation {
  banner_state: string | null;
  demo_expiry: string | null;
  directory_state: string | null;
  people_links: number;
}

/**
 * Frozen legacy strict-replay sandbox entry verdict over settled directory
 * state (unchanged semantics for the legacy runner purpose).
 */
export function evaluateSandboxEntryVerification(
  observation: SandboxEntryObservation,
  expectation: "people" | "no-people",
  sandboxExpiresAt: string,
): EntryVerdict {
  const settled =
    observation.directory_state === "ready" || observation.directory_state === "error";
  const settled_empty =
    observation.directory_state === "ready" && observation.people_links === 0;
  const reason =
    observation.banner_state !== "active"
      ? "demo banner is not active"
      : observation.demo_expiry !== sandboxExpiresAt
        ? "demo expiry does not match the sandbox expiry"
        : !settled
          ? "people directory did not settle (hydration still pending)"
          : observation.directory_state === "error"
            ? "people directory failed to load; an unreadable directory is not an empty one"
            : expectation === "people" && observation.people_links < 1
              ? "daily scenario must render at least one people link"
              : expectation === "no-people" && !settled_empty
                ? "empty scenario must settle a ready directory with zero people links"
                : "";
  return { passed: reason === "", settled, settled_empty, reason };
}

export interface RunnerReceipt {
  ok: boolean;
  launched: boolean;
  pid: number;
  sandbox_id: string;
  entry_path: string;
  browser: { name: string; version: string | null; headless: boolean };
  verification?: RunnerVerification;
  error?: { code: string; message: string };
}

export function runnerHeadless(message: RunnerLaunchMessage): boolean {
  return message.test_headless === true;
}

/** Environment allowlist for the owned runner child (no credential variables). */
export function runnerEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "DISPLAY",
    "XDG_RUNTIME_DIR",
    "PLAYWRIGHT_BROWSERS_PATH",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = parent[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const RECEIPT_TIMEOUT_MS = 60_000;

export function browserRunnerEntry(): string {
  const adjacent = fileURLToPath(new URL("./browser-runner.js", import.meta.url));
  const built = fileURLToPath(new URL("../dist/browser-runner.js", import.meta.url));
  const entry = existsSync(adjacent) ? adjacent : built;
  if (!existsSync(entry)) throw new CapirCliError(
    "CAPIR_BROWSER_RUNNER_UNBUILT", EXIT.INFRASTRUCTURE,
    "The browser runner is not built; run pnpm --filter @talent-signal/cli build before opening a sandbox.",
  );
  return entry;
}

export async function spawnRunner(
  message: RunnerLaunchMessage,
  options: { receiptTimeoutMs?: number } = {},
): Promise<RunnerReceipt> {
  const entry = browserRunnerEntry();
  const child = fork(entry, [], {
    detached: true,
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      ...runnerEnvironment(process.env),
      ...(message.test_headless && process.env.CAPIR_TEST_CHROME_EXECUTABLE
        ? { CAPIR_TEST_CHROME_EXECUTABLE: process.env.CAPIR_TEST_CHROME_EXECUTABLE } : {}),
    },
  });
  const timeoutMs = options.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS;
  return new Promise<RunnerReceipt>((resolve) => {
    let settled = false;
    const settle = (receipt: RunnerReceipt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.disconnect();
      } catch {
        /* the channel may already be gone */
      }
      child.unref();
      resolve(receipt);
    };
    const timer = setTimeout(() => {
      settle({
        ok: false,
        launched: false,
        pid: child.pid ?? -1,
        sandbox_id: message.sandbox_id,
        entry_path: message.entry_path,
        browser: { name: "chromium", version: null, headless: Boolean(message.test_headless) },
        error: {
          code: "CAPIR_BROWSER_LAUNCH_TIMEOUT",
          message: "The owned browser runner did not report a launch receipt in time.",
        },
      });
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.on("message", (receipt: unknown) => {
      settle(receipt as RunnerReceipt);
    });
    child.on("error", (error) => {
      settle({
        ok: false,
        launched: false,
        pid: child.pid ?? -1,
        sandbox_id: message.sandbox_id,
        entry_path: message.entry_path,
        browser: { name: "chromium", version: null, headless: Boolean(message.test_headless) },
        error: { code: "CAPIR_BROWSER_LAUNCH_FAILED", message: error.message },
      });
    });
    child.on("exit", (code) => {
      settle({
        ok: false,
        launched: false,
        pid: child.pid ?? -1,
        sandbox_id: message.sandbox_id,
        entry_path: message.entry_path,
        browser: { name: "chromium", version: null, headless: Boolean(message.test_headless) },
        error: {
          code: "CAPIR_BROWSER_LAUNCH_FAILED",
          message: `The owned browser runner exited before reporting a launch receipt (exit ${code}).`,
        },
      });
    });
    child.send(message, (error) => {
      if (error)
        settle({
          ok: false,
          launched: false,
          pid: child.pid ?? -1,
          sandbox_id: message.sandbox_id,
          entry_path: message.entry_path,
          browser: { name: "chromium", version: null, headless: Boolean(message.test_headless) },
          error: {
            code: "CAPIR_BROWSER_LAUNCH_FAILED",
            message: `The launch message could not be delivered: ${error.message}`,
          },
        });
    });
  });
}

export function browserFailure(
  receipt: RunnerReceipt,
  run: unknown,
  requestIds: Record<string, unknown>,
): CapirCliError {
  if (!receipt.launched || receipt.error) {
    return new CapirCliError(
      receipt.error?.code ?? "CAPIR_BROWSER_LAUNCH_FAILED",
      EXIT.INFRASTRUCTURE,
      receipt.error?.message ??
        "The sandbox entry browser failed to start; the ready run is preserved and can be reopened with sandbox status --open web.",
      { run, browser: receipt, clientState: requestIds },
    );
  }
  return new CapirCliError(
    "CAPIR_VERIFICATION_FAILED",
    EXIT.ASSERTION,
    "The sandbox entry browser opened, but the rendered demo banner or synthetic people verification failed.",
    { run, browser: receipt, clientState: requestIds },
  );
}
