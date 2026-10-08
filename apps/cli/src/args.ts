/**
 * Strict argument parsing.
 *
 * Unknown commands, unknown flags and malformed values fail with exit code 2
 * before any side effect. One conventional leading `--` separator (from
 * `pnpm capir -- ...`) is accepted and stripped; anything else unrecognized is
 * rejected.
 */
import { CapirCliError, EXIT, invalidArgument } from "./errors.js";

export type CommandName =
  | "help"
  | "auth login"
  | "auth status"
  | "auth logout"
  | "sandbox start"
  | "sandbox status"
  | "sandbox stop"
  | "test create"
  | "test status"
  | "test stop"
  | "update";

export type UpdateMode = "check" | "apply" | "rollback";

export interface ParsedArgs {
  command: CommandName;
  suppliedFlags?: string[];
  help: boolean;
  version: boolean;
  human: boolean;
  /** Machine-stable JSON help/output compatibility path. */
  json: boolean;
  /** Resolved offline help topic for `help ...` and `--help` paths. */
  helpPath?: string;
  environment?: string;
  server?: string;
  /** auth login */
  clientLabel: string;
  timeoutSeconds: number;
  noninteractive: boolean;
  /** sandbox start */
  scenario: string;
  memberRole: string;
  modelPolicy: string;
  durationHours: number;
  surface: string;
  requestId?: string;
  open?: string;
  receiptDir?: string;
  waitSeconds: number;
  /** sandbox status / stop positional target */
  sandboxId?: string;
  /** test create */
  preset: string;
  username?: string;
  password?: string;
  passwordStdin: boolean;
  expiresRaw?: string;
  /** test status / stop positional target */
  runId?: string;
  /** update family mode: --check, --rollback or the default apply. */
  updateMode: UpdateMode;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `--expires-in` canonicalization: 1d is exactly 24h. */
export const EXPIRES_IN_HOURS: Record<string, number> = {
  "1h": 1,
  "4h": 4,
  "24h": 24,
  "1d": 24,
};

/** Explicitly deferred Stage A capabilities: rejected before any allocation. */
export const DEFERRED = {
  scenarios: new Set(["weekly", "monthly", "custom", "live", "record"]),
  modelPolicies: new Set(["live", "record", "test", "eval", "mcp"]),
  surfaces: new Set([
    "native",
    "ios",
    "macos",
    "macos-hybrid",
    "browser-extension",
    "chrome-extension",
    "mcp",
    "test",
    "eval",
  ]),
  roles: new Set(["admin", "owner", "observer"]),
} as const;

function flagValue(
  argv: string[],
  index: number,
  flag: string,
): [string, number] {
  const value = argv[index + 1];
  if (value === undefined || (value.startsWith("--") && value.length > 2)) {
    throw invalidArgument(
      "CAPIR_CLI_INVALID_ARGUMENT",
      `${flag} requires a value.`,
    );
  }
  return [value, index + 1];
}

export function parseArgs(argv: string[]): ParsedArgs {
  // Accept exactly one conventional leading `--` from `pnpm run` forwarding.
  const rest = argv[0] === "--" ? argv.slice(1) : [...argv];
  const parsed: ParsedArgs = {
    command: "help",
    help: false,
    version: false,
    human: false,
    json: false,
    clientLabel: "capir-cli",
    timeoutSeconds: 300,
    noninteractive: false,
    scenario: "daily",
    memberRole: "member",
    modelPolicy: "replay",
    durationHours: 4,
    surface: "web",
    waitSeconds: 90,
    preset: "daily",
    passwordStdin: false,
    updateMode: "apply",
  };
  const positionals: string[] = [];
  parsed.suppliedFlags = [];
  const suppliedValues = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    parsed.suppliedFlags.push(arg);
    if (!["--help", "-h", "--version", "--human", "--noninteractive"].includes(arg)) {
      const value = rest[i + 1];
      if (suppliedValues.has(arg) && suppliedValues.get(arg) !== value)
        throw invalidArgument("CAPIR_CLI_INVALID_ARGUMENT", `Conflicting ${arg} values.`);
      if (value !== undefined) suppliedValues.set(arg, value);
    }
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--version":
        parsed.version = true;
        break;
      case "--human":
        parsed.human = true;
        break;
      case "--noninteractive":
        parsed.noninteractive = true;
        break;
      case "--username": {
        const [value, next] = flagValue(rest, i, "--username");
        parsed.username = value;
        i = next;
        break;
      }
      // The supplied password is held in memory only: no parse error, help
      // text or envelope may ever echo its value.
      case "--password": {
        const [value, next] = flagValue(rest, i, "--password");
        parsed.password = value;
        i = next;
        break;
      }
      case "--password-stdin":
        parsed.passwordStdin = true;
        break;
      case "--check":
        parsed.updateMode = "check";
        break;
      case "--rollback":
        parsed.updateMode = "rollback";
        break;
      case "--expires-in": {
        const [value, next] = flagValue(rest, i, "--expires-in");
        parsed.expiresRaw = value;
        i = next;
        break;
      }
      case "--preset": {
        const [value, next] = flagValue(rest, i, "--preset");
        parsed.preset = value;
        i = next;
        break;
      }
      case "--server": {
        const [value, next] = flagValue(rest, i, "--server");
        parsed.server = value; i = next; break;
      }
      case "--env": {
        const [value, next] = flagValue(rest, i, "--env");
        parsed.environment = value;
        i = next;
        break;
      }
      case "--client-label": {
        const [value, next] = flagValue(rest, i, "--client-label");
        if (value.length < 1 || value.length > 80)
          throw invalidArgument(
            "CAPIR_CLI_INVALID_ARGUMENT",
            "--client-label must be 1-80 characters.",
          );
        parsed.clientLabel = value;
        i = next;
        break;
      }
      case "--timeout": {
        const [value, next] = flagValue(rest, i, "--timeout");
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 900)
          throw invalidArgument(
            "CAPIR_CLI_INVALID_ARGUMENT",
            "--timeout must be an integer number of seconds between 1 and 900.",
          );
        parsed.timeoutSeconds = seconds;
        i = next;
        break;
      }
      case "--scenario": {
        const [value, next] = flagValue(rest, i, "--scenario");
        parsed.scenario = value;
        i = next;
        break;
      }
      case "--role": {
        const [value, next] = flagValue(rest, i, "--role");
        parsed.memberRole = value;
        i = next;
        break;
      }
      case "--model-policy": {
        const [value, next] = flagValue(rest, i, "--model-policy");
        parsed.modelPolicy = value;
        i = next;
        break;
      }
      case "--duration-hours": {
        const [value, next] = flagValue(rest, i, "--duration-hours");
        const hours = Number(value);
        if (![1, 4, 24].includes(hours))
          throw invalidArgument(
            "CAPIR_CLI_INVALID_ARGUMENT",
            "--duration-hours must be 1, 4, or 24.",
          );
        parsed.durationHours = hours;
        i = next;
        break;
      }
      case "--surface": {
        const [value, next] = flagValue(rest, i, "--surface");
        parsed.surface = value;
        i = next;
        break;
      }
      case "--request-id": {
        const [value, next] = flagValue(rest, i, "--request-id");
        // Shape is validated with the command policy gates so offline help can
        // document hostile-looking values without failing.
        parsed.requestId = value;
        i = next;
        break;
      }
      case "--open": {
        const [value, next] = flagValue(rest, i, "--open");
        parsed.open = value;
        i = next;
        break;
      }
      case "--receipt-dir": {
        const [value, next] = flagValue(rest, i, "--receipt-dir");
        parsed.receiptDir = value;
        i = next;
        break;
      }
      case "--wait": {
        const [value, next] = flagValue(rest, i, "--wait");
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 600)
          throw invalidArgument(
            "CAPIR_CLI_INVALID_ARGUMENT",
            "--wait must be an integer number of seconds between 0 and 600.",
          );
        parsed.waitSeconds = seconds;
        i = next;
        break;
      }
      default:
        throw new CapirCliError(
          "CAPIR_CLI_UNKNOWN_FLAG",
          EXIT.INVALID_ARGUMENTS,
          `Unknown argument "${arg}". Nothing was executed.`,
        );
    }
  }

  const [first, second, third, ...others] = positionals;
  if (others.length > 0)
    throw invalidArgument(
      "CAPIR_CLI_INVALID_ARGUMENT",
      first === "test" || first === "help" || first === undefined
        ? "Unexpected extra positional argument."
        : `Unexpected positional argument "${others[0]}".`,
    );
  if (first === undefined || first === "help") {
    parsed.command = "help";
    const topic = [second, third].filter((part) => part !== undefined).join(" ");
    if (topic) parsed.helpPath = topic;
    return parsed;
  }
  if (first === "test") {
    // Help wins before any dispatch; unknown test subcommands are commands,
    // never model prompts.
    if (parsed.help) {
      parsed.command = "help";
      parsed.helpPath = second === undefined ? "test" : `test ${second}`;
      return parsed;
    }
    if (second === "create") {
      parsed.command = "test create";
      if (third !== undefined)
        throw invalidArgument(
          "CAPIR_CLI_INVALID_ARGUMENT",
          "Unexpected extra positional argument.",
        );
    } else if (second === "status" || second === "stop") {
      parsed.command = second === "status" ? "test status" : "test stop";
      if (third !== undefined) parsed.runId = third;
    } else {
      throw new CapirCliError(
        "CAPIR_CLI_UNKNOWN_COMMAND",
        EXIT.INVALID_ARGUMENTS,
        `Unknown command "test ${second ?? ""}". The test family supports test create, test status and test stop; see capir help test.`,
      );
    }
    return parsed;
  }
  if (first === "update") {
    // Routed before model parsing: no model ever receives update keywords.
    if (parsed.help) {
      parsed.command = "help";
      parsed.helpPath = "update";
      return parsed;
    }
    parsed.command = "update";
    if (second !== undefined || third !== undefined)
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        `Unexpected positional argument "${(second ?? third)!}". The update family takes flags only: --check, --rollback.`,
      );
    return parsed;
  }
  const noTargetCommands = new Set<CommandName>([
    "help",
    "auth login",
    "auth status",
    "auth logout",
    "sandbox start",
  ]);
  const withTarget = (command: CommandName): CommandName => {
    if (third !== undefined) parsed.sandboxId = third;
    return command;
  };
  if (first === "auth") {
    if (parsed.help) { parsed.command="help"; parsed.helpPath=second ? `auth ${second}` : "auth"; return parsed; }
    if (second === "login") { parsed.command = "auth login"; if (!parsed.suppliedFlags?.includes("--timeout")) parsed.timeoutSeconds=300; }
    else if (second === "status") parsed.command = "auth status";
    else if (second === "logout") parsed.command = "auth logout";
    else
      throw new CapirCliError(
        "CAPIR_CLI_UNKNOWN_COMMAND",
        EXIT.INVALID_ARGUMENTS,
        `Unknown command "auth ${second ?? ""}". Stage A supports auth login, auth status and auth logout.`,
      );
    if (third !== undefined && noTargetCommands.has(parsed.command))
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        `Unexpected positional argument "${third}".`,
      );
    return parsed;
  }
  if (first === "sandbox") {
    if (second === "start") parsed.command = "sandbox start";
    else if (second === "status") parsed.command = withTarget("sandbox status");
    else if (second === "stop") parsed.command = withTarget("sandbox stop");
    else
      throw new CapirCliError(
        "CAPIR_CLI_UNKNOWN_COMMAND",
        EXIT.INVALID_ARGUMENTS,
        `Unknown command "sandbox ${second ?? ""}". Stage A supports sandbox start, sandbox status and sandbox stop.`,
      );
    if (third !== undefined && noTargetCommands.has(parsed.command))
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        `Unexpected positional argument "${third}".`,
      );
    return parsed;
  }
  throw new CapirCliError(
    "CAPIR_CLI_UNKNOWN_COMMAND",
    EXIT.INVALID_ARGUMENTS,
    `Unknown command "${first}". Use ask for literal single-word prompts. Nothing was executed.`,
  );
}

/** Post-parse policy gates run before any side effect or dispatch. */
export function validateRequestShape(args: ParsedArgs): void {
  const common = ["--env", "--server", "--json", "--human", "--help", "-h", "--version"];
  const allowed: Record<CommandName, string[]> = {
    help: [...common, "--json"],
    "auth login": [...common, "--client-label", "--timeout", "--noninteractive"],
    "auth status": common, "auth logout": common,
    "sandbox start": [...common,"--scenario","--role","--model-policy","--duration-hours","--surface","--request-id","--open","--receipt-dir","--timeout"],
    "sandbox status": [...common,"--open","--receipt-dir","--timeout"],
    "sandbox stop": [...common,"--wait","--request-id"],
    "test create": [...common, "--json", "--username", "--password", "--password-stdin", "--expires-in", "--preset", "--request-id", "--open", "--receipt-dir", "--timeout"],
    "test status": [...common, "--json"],
    "test stop": [...common, "--json", "--request-id"],
    // update never resolves an environment and needs no credential.
    update: ["--help", "-h", "--version", "--human", "--json", "--check", "--rollback"],
  };
  for (const flag of args.suppliedFlags ?? []) if (!allowed[args.command].includes(flag))
    throw invalidArgument("CAPIR_CLI_INVALID_ARGUMENT", `${flag} does not apply to ${args.command}.`);

  if (args.requestId !== undefined && !UUID.test(args.requestId))
    throw invalidArgument("CAPIR_CLI_INVALID_ARGUMENT", "--request-id must be a UUID.");

  if (args.command === "update") {
    if (args.suppliedFlags?.includes("--check") && args.suppliedFlags?.includes("--rollback"))
      throw invalidArgument("CAPIR_CLI_INVALID_ARGUMENT", "Choose only one of --check and --rollback.");
    if (args.suppliedFlags?.includes("--check")) args.updateMode = "check";
    if (args.suppliedFlags?.includes("--rollback")) args.updateMode = "rollback";
  }

  if (args.command === "test create") {
    if (args.password !== undefined && args.passwordStdin)
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "Choose only one of --password and --password-stdin.",
      );
    if (args.password !== undefined && (args.password.length < 8 || args.password.length > 128))
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "The password must use the existing account password limits (8-128 characters).",
      );
    if (args.username !== undefined) {
      if (args.username.length < 3 || args.username.length > 320)
        throw invalidArgument(
          "CAPIR_CLI_INVALID_ARGUMENT",
          "--username must be 3-320 characters.",
        );
      if (args.username.includes("@") && !args.username.toLowerCase().endsWith("@lab.invalid"))
        throw invalidArgument(
          "CAPIR_CLI_INVALID_ARGUMENT",
          "Email-shaped usernames are accepted only in the reserved lab.invalid namespace; this command proves no email ownership.",
        );
    }
    if (!['daily', 'empty'].includes(args.preset))
      throw invalidArgument("CAPIR_CLI_INVALID_ARGUMENT", "--preset must be daily or empty.");
    if (args.expiresRaw !== undefined) {
      const hours = EXPIRES_IN_HOURS[args.expiresRaw];
      if (hours === undefined)
        throw invalidArgument(
          "CAPIR_CLI_INVALID_ARGUMENT",
          "--expires-in must be 1h, 4h, 24h or 1d.",
        );
      args.durationHours = hours;
    }
    if (args.open !== undefined && args.open !== "web")
      throw invalidArgument("CAPIR_CLI_INVALID_ARGUMENT", "--open accepts only the value web.");
  }
  if (args.command === "test status" || args.command === "test stop") {
    if (args.runId === undefined)
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        `${args.command} requires a run id.`,
      );
    if (!UUID.test(args.runId))
      throw invalidArgument("CAPIR_CLI_INVALID_ARGUMENT", "The run id must be a UUID.");
  }

  if (args.command === "sandbox status" || args.command === "sandbox stop") {
    if (args.command === "sandbox stop" && args.sandboxId === undefined)
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "sandbox stop requires a sandbox id.",
      );
    if (args.command === "sandbox status" && args.sandboxId === undefined)
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "sandbox status requires a sandbox id.",
      );
    if (args.sandboxId !== undefined && !UUID.test(args.sandboxId))
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "The sandbox id must be a UUID.",
      );
  }
  if (args.command === "sandbox start" || args.command === "sandbox status") {
    if (args.open !== undefined && args.open !== "web") {
      if (DEFERRED.surfaces.has(args.open))
        throw new CapirCliError(
          "CAPIR_UNSUPPORTED",
          EXIT.INFRASTRUCTURE,
          `Opening ${args.open} sessions is not supported in Stage A; only --open web is available.`,
        );
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "--open accepts only the value web.",
      );
    }
  }
  if (args.command === "sandbox start") {
    if (DEFERRED.modelPolicies.has(args.modelPolicy))
      throw new CapirCliError(
        "CAPIR_UNSUPPORTED",
        EXIT.INFRASTRUCTURE,
        `Model policy "${args.modelPolicy}" is not supported: capir replay sandboxes never invoke live models. Stage A runs strict replay only.`,
      );
    if (!["replay", "strict_replay"].includes(args.modelPolicy))
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "--model-policy must be replay (strict replay) in Stage A.",
      );
    if (DEFERRED.scenarios.has(args.scenario))
      throw new CapirCliError(
        "CAPIR_UNSUPPORTED",
        EXIT.INFRASTRUCTURE,
        `Scenario "${args.scenario}" is a deferred scenario; Stage A supports daily and empty only.`,
      );
    if (!["daily", "empty"].includes(args.scenario))
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "--scenario must be daily or empty.",
      );
    if (DEFERRED.roles.has(args.memberRole))
      throw new CapirCliError(
        "CAPIR_UNSUPPORTED",
        EXIT.INFRASTRUCTURE,
        `Role "${args.memberRole}" is not supported; capir sandboxes run with member role only.`,
      );
    if (args.memberRole !== "member")
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "--role must be member.",
      );
    if (DEFERRED.surfaces.has(args.surface))
      throw new CapirCliError(
        "CAPIR_UNSUPPORTED",
        EXIT.INFRASTRUCTURE,
        `Surface "${args.surface}" is not supported in Stage A; the supported client surface is web.`,
      );
    if (args.surface !== "web")
      throw invalidArgument(
        "CAPIR_CLI_INVALID_ARGUMENT",
        "--surface must be web.",
      );
  }
}
