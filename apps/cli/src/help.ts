/**
 * `help`: offline usage plus the test-family routing.
 *
 * Help is side effect free by construction: it never resolves an environment,
 * reads stdin, loads a credential, touches the network or writes an operation
 * journal — even when hostile-looking flags are present. Plain help is
 * readable text with executable examples; `--json` renders the stable machine
 * schema for existing machine callers.
 */
import type { TestHelpPath } from "./testHelp.js";
import { UPDATE_HELP_PATHS } from "./updateHelp.js";

export const USAGE = {
  summary:
    "capir: direct text models and scoped strict-replay test sandboxes.",
  invocation: "node apps/cli/dist/cli.js <command> [flags]  (or: pnpm -s capir -- <command> [flags])",
  commands: {
    ask: "Ask an explicitly configured model; supports streamed text, stdin and --json.",
    chat: "Interactive in-memory model conversation: /help, /model, /reset, /exit.",
    models: "Offline profiles: add, list, show, use, remove; list --remote discovers one provider page.",
    doctor: "Offline model, runtime and selected sandbox configuration diagnostics.",
    "auth login": "Open the configured Web consent page and store a scoped grant in the OS keyring.",
    "auth status": "Read the current scoped grant (never renews it).",
    "auth logout": "Revoke the scoped grant and remove its keyring entry.",
    "sandbox start": "Create a strict-replay sandbox (defaults: --scenario daily --role member --model-policy replay --duration-hours 4).",
    "sandbox status": "Read one sandbox (read-only unless --open web).",
    "sandbox stop": "Stop a sandbox and poll real cleanup (reports deleting/failed distinctly).",
    "test create": "Create one expiring, isolated test account with synthetic data (defaults: --preset daily --expires-in 4h).",
    "test status": "Read one test run (read-only; never reveals a password).",
    "test stop": "Stop a test run and prune its local run credential.",
    update: "Standalone managed releases: update --check, update, update --rollback (offline help).",
    help: "This offline discovery surface; --json renders the stable machine schema.",
  },
  flags: [
    "--env <name>        explicit named test environment (required for operations)",
    "--human             render text instead of the JSON envelope",
    "--json              machine-stable JSON (help schema or operation envelope)",
    "--open web          open an isolated browser session into the run",
    "--request-id <uuid> resume the SAME recorded operation",
    "--username <handle> test create: chosen unique handle (email-shaped only in lab.invalid)",
    "--password <value>  test create: chosen password, never echoed (exclusive with --password-stdin)",
    "--password-stdin    test create: read the chosen password from stdin (exclusive with --password)",
    "--expires-in <time> test create: 1h | 4h | 24h | 1d (default 4h)",
    "--preset <preset>   test create: daily | empty (default daily)",
    "--wait <seconds>    cleanup polling budget for sandbox stop (default 90)",
    "--timeout <seconds> browser/network deadline; an in-flight keyring write settles before exit (default 300)",
    "--noninteractive    fail login promptly instead of waiting for consent",
    "--receipt-dir <dir> write sanitized browser receipts (proof/diagnostic)",
  ],
  stage_a: {
    scenarios: ["daily", "empty"],
    roles: ["member"],
    model_policy: "strict_replay",
    durations_hours: [1, 4, 24],
    surfaces: ["web"],
    operations: ["auth login", "auth status", "auth logout", "sandbox start", "sandbox status", "sandbox stop"],
    test_operations: ["test create", "test status", "test stop"],
  },
  deferred: {
    scenarios: ["other proposed scenarios"],
    model_policies: ["live", "record"],
    clients: ["native", "mcp", "test", "eval"],
    grants: ["refresh", "machine-identity federation"],
    note: "Deferred capabilities are rejected before any allocation; they are never silently emulated.",
  },
} as const;

export const HELP_PATHS: TestHelpPath[] = [
  "test",
  "test create",
  "test status",
  "test stop",
];

export const ALL_HELP_PATHS = [...HELP_PATHS, ...UPDATE_HELP_PATHS];

/** Stable machine help: unchanged `usage` plus the offline help routing. */
export function machineHelpPayload(): Record<string, unknown> {
  return { usage: USAGE, help_paths: ALL_HELP_PATHS };
}

/** Readable global help: commands, quick start, defaults and next actions. */
export function renderGlobalHelp(): string {
  return [
    "capir: direct text models and scoped strict-replay test sandboxes.",
    "",
    "Commands",
    "  capir ask <text>            ask an explicitly configured model",
    "  capir chat                  interactive in-memory model conversation",
    "  capir models add|list|show|use|remove",
    "  capir doctor                offline model and runtime diagnostics",
    "  capir auth login|status|logout   scoped Web-consent grants (OS keyring)",
    "  capir sandbox start|status|stop   strict-replay sandboxes",
    "  capir test create|status|stop     expiring isolated test accounts (no prior login)",
    "  capir update [--check|--rollback] managed standalone releases (offline help)",
    "  capir help [command]        offline help; --json renders the stable schema",
    "",
    "AI product acceptance (quick start)",
    "  capir help test create",
    "  capir test create --env <test-env> --preset daily --open web",
    "  capir test status <run-id> --env <test-env>",
    "  capir test stop <run-id> --env <test-env>",
    "",
    "Defaults",
    "  test create: --preset daily (12 contacts, 30 observations, 4 tasks), --expires-in 4h (1h, 4h, 24h, 1d).",
    "  Every operation requires an explicit --env <name>.",
    "",
    "Help is offline: it never resolves an environment, reads stdin, loads a credential,",
    "uses the network or writes an operation journal.",
    "Machine callers: append --json for the stable schema (arguments, defaults, examples, error codes).",
  ].join("\n");
}
