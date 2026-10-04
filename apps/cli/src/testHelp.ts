/**
 * Offline help for the `capir test` family.
 *
 * `renderTestHelp` never resolves an environment, reads stdin, loads a
 * credential, touches the network or writes a journal. Plain output is
 * readable text with executable examples; `--json` renders one stable
 * machine schema (argument schema, defaults, examples, error codes and next
 * steps) for existing machine callers.
 */

export type TestHelpFormat = "human" | "json";
export type TestHelpPath = "test" | "test create" | "test status" | "test stop";

export const TEST_PRESET_COUNTS = {
  daily: { contacts: 12, observations: 30, tasks: 4 },
  empty: { contacts: 0, observations: 0, tasks: 0 },
} as const;

export const TEST_HELP_PATHS: TestHelpPath[] = [
  "test",
  "test create",
  "test status",
  "test stop",
];

const ENV_ARGUMENT = {
  name: "--env",
  required: true,
  value: "<name>",
  description:
    "Explicit named test environment from the private environments.json; required for every operation and never resolved by help.",
};
const JSON_ARGUMENT = {
  name: "--json",
  required: false,
  value: null,
  description: "Machine-stable JSON output (the compatibility path for agents).",
};
const HUMAN_ARGUMENT = {
  name: "--human",
  required: false,
  value: null,
  description: "Readable text output.",
};
const REQUEST_ID_ARGUMENT = {
  name: "--request-id",
  required: false,
  value: "<uuid>",
  description: "Resume the SAME recorded operation; never allocate a copy.",
};
const OPEN_ARGUMENT = {
  name: "--open",
  required: false,
  value: "web",
  description:
    "Open a fresh isolated browser context into the test workspace after the run is ready; browser readiness is reported separately from creation.",
};

const CREATE_ARGUMENTS = [
  ENV_ARGUMENT,
  {
    name: "--username",
    required: false,
    value: "<handle>",
    description:
      "Optional unique handle. Email-shaped handles are accepted only inside the reserved lab.invalid namespace; omitted handles are generated uniquely per run.",
  },
  {
    name: "--password",
    required: false,
    value: "<value>",
    description:
      "Optional chosen password, verified by the server's salted credential. Never echoed. Exclusive with --password-stdin.",
    exclusive_with: ["--password-stdin"],
  },
  {
    name: "--password-stdin",
    required: false,
    value: null,
    description:
      "Read the chosen password from stdin instead of argv. Exclusive with --password. Help never reads stdin.",
    exclusive_with: ["--password"],
  },
  {
    name: "--expires-in",
    required: false,
    value: "<time>",
    values: ["1h", "4h", "24h", "1d"],
    default: "4h",
    description: "Run lifetime; 1d canonicalizes to 24h. There is no non-expiring account.",
  },
  {
    name: "--preset",
    required: false,
    value: "<preset>",
    values: ["daily", "empty"],
    default: "daily",
    description:
      "Synthetic dataset: daily seeds 12 contacts, 30 observations and 4 tasks; empty seeds nothing. Creation invokes no model, email or OAuth flow.",
  },
  REQUEST_ID_ARGUMENT,
  OPEN_ARGUMENT,
  JSON_ARGUMENT,
  HUMAN_ARGUMENT,
];

function targetArgument(command: string) {
  return {
    name: "<run-id>",
    required: true,
    value: "<uuid>",
    description: `The run id returned by capir test create; ${command} touches only that run.`,
  };
}

const STATUS_ARGUMENTS = [
  targetArgument("test status"),
  ENV_ARGUMENT,
  JSON_ARGUMENT,
  HUMAN_ARGUMENT,
];

const STOP_ARGUMENTS = [
  targetArgument("test stop"),
  ENV_ARGUMENT,
  REQUEST_ID_ARGUMENT,
  JSON_ARGUMENT,
  HUMAN_ARGUMENT,
];

const CREATE_ERRORS = [
  {
    code: "CAPIR_ENVIRONMENT_REQUIRED",
    exit_code: 2,
    meaning: "No --env name was supplied; nothing was allocated.",
  },
  {
    code: "CAPIR_TEST_OPERATOR_CREDENTIAL_MISSING",
    exit_code: 4,
    meaning: "The provisioning prerequisite is not installed for this origin pair; nothing was allocated.",
  },
  {
    code: "CAPIR_TEST_INTENT_CONFLICT",
    exit_code: 2,
    meaning: "The --request-id was recorded with different parameters; the conflict is reported and nothing is overwritten.",
  },
  {
    code: "CAPIR_TEST_CONFLICT",
    exit_code: 2,
    meaning: "The server verified a different credential identity for this request id; the previous credential is never rotated.",
  },
  {
    code: "CAPIR_TEST_KEYRING_CONFLICT",
    exit_code: 3,
    meaning: "Another operation already owns the run credential item; the item is preserved and no password is overwritten.",
  },
  {
    code: "CAPIR_TEST_CREDENTIAL_MISSING",
    exit_code: 3,
    meaning: "The local run credential item is gone; the ready run is never rotated, reset or reallocated.",
  },
  {
    code: "CAPIR_TEST_TRANSPORT_AMBIGUOUS",
    exit_code: 3,
    meaning: "The request may or may not have been accepted; resume the same operation with --request-id and the preserved credential.",
  },
];

const READ_ERRORS = [
  {
    code: "CAPIR_TEST_NOT_FOUND",
    exit_code: 3,
    meaning: "The server knows no such run for this principal; no fallback account is entered.",
  },
  {
    code: "CAPIR_TEST_AUTH_DENIED",
    exit_code: 4,
    meaning: "The operator credential is unknown, revoked or scoped to another origin pair.",
  },
];

function createHelp() {
  return {
    path: "test create",
    summary:
      "Create one expiring, isolated capir test account with versioned synthetic data and return its usable credentials.",
    arguments: CREATE_ARGUMENTS,
    defaults: {
      preset: "daily",
      expires_in: "4h",
      duration_hours: 4,
      preset_counts: TEST_PRESET_COUNTS.daily,
      empty_counts: TEST_PRESET_COUNTS.empty,
    },
    examples: [
      {
        argv: ["capir", "test", "create", "--env", "staging"],
        description: "Generated unique username and generated password, daily preset, 4h lifetime.",
      },
      {
        argv: ["capir", "test", "create", "--env", "staging", "--preset", "daily", "--open", "web"],
        description: "Create and open the test workspace in a fresh isolated browser context.",
      },
      {
        argv: ["capir", "test", "create", "--env", "staging", "--username", "qa-mcp", "--password-stdin", "--expires-in", "4h"],
        description: "Chosen handle with the chosen password read from stdin.",
      },
      {
        argv: ["capir", "test", "create", "--env", "staging", "--request-id", "<uuid>"],
        description: "Resume the exact recorded create; the original credential is reused, never rotated.",
      },
    ],
    errors: CREATE_ERRORS,
    next_steps: [
      "capir test status <run-id> --env <name>",
      "capir test stop <run-id> --env <name>",
    ],
  };
}

function statusHelp() {
  return {
    path: "test status",
    summary:
      "Read one test run without extending its lifetime, rotating credentials or revealing any password.",
    arguments: STATUS_ARGUMENTS,
    defaults: {},
    examples: [
      {
        argv: ["capir", "test", "status", "<run-id>", "--env", "staging"],
        description: "Canonical run readback (state, counts, expiry).",
      },
      {
        argv: ["capir", "test", "status", "<run-id>", "--env", "staging", "--json"],
        description: "The same readback as a machine envelope.",
      },
    ],
    errors: READ_ERRORS,
    next_steps: ["capir test stop <run-id> --env <name>"],
  };
}

function stopHelp() {
  return {
    path: "test stop",
    summary:
      "Revoke access to one test run first, then clean its data, credentials and sessions; deleting and deleted stay distinct.",
    arguments: STOP_ARGUMENTS,
    defaults: {},
    examples: [
      {
        argv: ["capir", "test", "stop", "<run-id>", "--env", "staging"],
        description: "Stop the owned run and prune its local run credential item.",
      },
      {
        argv: ["capir", "test", "stop", "<run-id>", "--env", "staging", "--request-id", "<uuid>"],
        description: "Resume the exact recorded stop operation.",
      },
    ],
    errors: READ_ERRORS,
    next_steps: [
      "capir test create --env <name> --preset daily --open web",
    ],
  };
}

function familyHelp() {
  return {
    path: "test",
    summary:
      "Operator test-account lifecycle: create, status and stop. No prior human login, no model calls, no email and no OAuth.",
    commands: [
      { name: "test create", summary: createHelp().summary },
      { name: "test status", summary: statusHelp().summary },
      { name: "test stop", summary: stopHelp().summary },
    ],
    arguments: [ENV_ARGUMENT],
    defaults: createHelp().defaults,
    examples: [
      {
        argv: ["capir", "help", "test", "create"],
        summary: "Offline help with the full create argument schema.",
      },
      {
        argv: ["capir", "test", "create", "--env", "staging", "--preset", "daily", "--open", "web"],
        summary: "Create and open a daily test workspace.",
      },
      {
        argv: ["capir", "test", "status", "<run-id>", "--env", "staging"],
        summary: "Read the run back.",
      },
      {
        argv: ["capir", "test", "stop", "<run-id>", "--env", "staging"],
        summary: "Stop and verify cleanup.",
      },
    ],
    errors: CREATE_ERRORS.slice(0, 1),
    next_steps: [
      "capir test create --env <name> --preset daily --open web",
      "capir test status <run-id> --env <name>",
      "capir test stop <run-id> --env <name>",
    ],
  };
}

function helpPayload(path: TestHelpPath): Record<string, unknown> {
  if (path === "test") return familyHelp();
  if (path === "test create") return createHelp();
  if (path === "test status") return statusHelp();
  return stopHelp();
}

function humanCreate(): string {
  const counts = TEST_PRESET_COUNTS.daily;
  return [
    "capir test create - create one expiring, isolated test account (no prior login).",
    "",
    "Usage",
    "  capir test create --env <name> [options]",
    "",
    "Arguments",
    "  --env <name>         required named test environment (never resolved by help)",
    "  --username <handle>  optional unique handle; email-shaped only in lab.invalid",
    "  --password <value>   optional chosen password, never echoed (exclusive with --password-stdin)",
    "  --password-stdin     read the chosen password from stdin (exclusive with --password)",
    "  --expires-in <time>  1h | 4h | 24h | 1d  (default 4h; 1d canonicalizes to 24h)",
    "  --preset <preset>    daily | empty       (default daily)",
    "  --request-id <uuid>  resume the SAME recorded create; the original credential is reused",
    "  --open web           open a fresh isolated browser context after the run is ready",
    "  --json | --human     machine envelope (default) | readable text",
    "",
    "Defaults",
    `  preset daily seeds ${counts.contacts} contacts, ${counts.observations} observations and ${counts.tasks} tasks;`,
    "  preset empty has no data. Creation invokes no model, no email and no OAuth flow.",
    "  A generated password carries at least 128 bits of OS cryptographic entropy.",
    "",
    "Examples",
    "  capir test create --env staging",
    "  capir test create --env staging --preset daily --open web",
    "  capir test create --env staging --username qa-mcp --password-stdin --expires-in 4h",
    "  capir test create --env staging --request-id <uuid>",
    "",
    "Errors",
    ...CREATE_ERRORS.map((entry) => `  ${entry.code} (exit ${entry.exit_code}): ${entry.meaning}`),
    "",
    "Next steps",
    "  capir test status <run-id> --env <name>",
    "  capir test stop <run-id> --env <name>",
  ].join("\n");
}

function humanStatus(): string {
  return [
    "capir test status - read one test run (read-only; never reveals a password).",
    "",
    "Usage",
    "  capir test status <run-id> --env <name> [--json | --human]",
    "",
    "Arguments",
    "  <run-id>   the run id returned by capir test create (required)",
    "  --env <name>   required named test environment",
    "  --json | --human",
    "",
    "Semantics",
    "  Status never extends the lifetime, rotates credentials or reveals a password.",
    "  Expired or deleted runs prune the local run credential item on this read.",
    "",
    "Examples",
    "  capir test status <run-id> --env staging",
    "  capir test status <run-id> --env staging --json",
    "",
    "Next steps",
    "  capir test stop <run-id> --env <name>",
  ].join("\n");
}

function humanStop(): string {
  return [
    "capir test stop - revoke and clean one test run.",
    "",
    "Usage",
    "  capir test stop <run-id> --env <name> [--request-id <uuid>] [--json | --human]",
    "",
    "Arguments",
    "  <run-id>   the run id returned by capir test create (required)",
    "  --env <name>   required named test environment",
    "  --request-id <uuid>   resume the exact recorded stop",
    "  --json | --human",
    "",
    "Semantics",
    "  Access is revoked before cleanup. deleting, cleanup failure and verified",
    "  deleted stay distinct; the local run credential item is removed on stop.",
    "",
    "Examples",
    "  capir test stop <run-id> --env staging",
    "  capir test stop <run-id> --env staging --request-id <uuid>",
    "",
    "Next steps",
    "  capir test create --env <name> --preset daily --open web",
  ].join("\n");
}

function humanFamily(): string {
  return [
    "capir test - operator test-account lifecycle (create, status, stop).",
    "",
    "Commands",
    "  capir test create --env <name>   create an expiring test account (preset daily, 4h)",
    "  capir test status <run-id> --env <name>   read one run back",
    "  capir test stop <run-id> --env <name>     revoke and clean one run",
    "",
    "Quick start",
    "  capir help test create",
    "  capir test create --env staging --preset daily --open web",
    "  capir test status <run-id> --env staging",
    "  capir test stop <run-id> --env staging",
    "",
    "Defaults",
    "  --preset daily (12 contacts, 30 observations, 4 tasks); --expires-in 4h (1h, 4h, 24h, 1d).",
    "",
    "Machine callers: add --json for the stable argument schema, examples, defaults and error codes.",
  ].join("\n");
}

/** Offline, side-effect free help renderer for the whole test family. */
export function renderTestHelp(path: string, format: TestHelpFormat): string {
  if (!TEST_HELP_PATHS.includes(path as TestHelpPath)) {
    throw new Error(
      `Unknown help path "${path}"; expected one of ${TEST_HELP_PATHS.join(", ")}.`,
    );
  }
  const typed = path as TestHelpPath;
  if (format === "json") return JSON.stringify(helpPayload(typed), null, 2);
  if (typed === "test create") return humanCreate();
  if (typed === "test status") return humanStatus();
  if (typed === "test stop") return humanStop();
  return humanFamily();
}
