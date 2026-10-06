/**
 * Offline help for the `capir update` family.
 *
 * `renderUpdateHelp` never resolves an environment, reads stdin, loads a
 * credential, touches the network or writes a journal. Plain output is
 * readable text; `--json` renders the stable machine schema.
 */

export type UpdateHelpFormat = "human" | "json";
export type UpdateHelpPath = "update" | "update --check" | "update --rollback";

export const UPDATE_HELP_PATHS: UpdateHelpPath[] = [
  "update",
  "update --check",
  "update --rollback",
];

const CHANNEL = "https://github.com/getyak/capir/releases/download/capir-stable";
const INSTALL_COMMAND = "curl -fsSL " + CHANNEL + "/install.sh -o capir-install.sh && sh capir-install.sh";

const SHARED_ARGUMENTS = [
  {
    name: "--json",
    required: false,
    value: null,
    description: "Machine-stable JSON envelope. Human-readable text is the default for update.",
  },
  {
    name: "--human",
    required: false,
    value: null,
    description: "Force readable text output (the default).",
  },
];

const ERROR_CODES = [
  {
    code: "CAPIR_UPDATE_UNMANAGED",
    exit_code: 3,
    meaning: "capir runs from a source checkout or package-manager install; update never modifies those. Install a managed copy first.",
  },
  {
    code: "CAPIR_UPDATE_SIGNATURE_INVALID",
    exit_code: 3,
    meaning: "The signed release manifest failed signature verification; nothing was used.",
  },
  {
    code: "CAPIR_UPDATE_MANIFEST_INVALID",
    exit_code: 3,
    meaning: "The verified manifest is structurally invalid (version, tag, urls, assets).",
  },
  {
    code: "CAPIR_UPDATE_CHECKSUM_MISMATCH",
    exit_code: 3,
    meaning: "The downloaded archive failed the signed sha256 or byte size check; nothing was extracted.",
  },
  {
    code: "CAPIR_UPDATE_ARCHIVE_UNSAFE",
    exit_code: 3,
    meaning: "The archive escapes its root or deviates from the portable layout; nothing was installed.",
  },
  {
    code: "CAPIR_UPDATE_SMOKE_FAILED",
    exit_code: 3,
    meaning: "The staged CLI failed --version, --help or native keyring smoke; the previous install is preserved.",
  },
  {
    code: "CAPIR_UPDATE_DOWNLOAD_FAILED",
    exit_code: 3,
    meaning: "The release transport failed or exceeded its byte cap or deadline.",
  },
  {
    code: "CAPIR_UPDATE_PLATFORM_UNSUPPORTED",
    exit_code: 3,
    meaning: "No release asset exists for this platform (Windows is source-install only).",
  },
  {
    code: "CAPIR_UPDATE_VERSION_CONFLICT",
    exit_code: 3,
    meaning: "The target version directory already exists with different contents; it is never overwritten.",
  },
  {
    code: "CAPIR_UPDATE_NO_PREVIOUS",
    exit_code: 3,
    meaning: "Rollback requested but no previous managed version is recorded.",
  },
  {
    code: "CAPIR_UPDATE_LAUNCHER_CONFLICT",
    exit_code: 3,
    meaning: "An unrelated launcher exists at the launcher path; only install --replace-existing may back it up.",
  },
  {
    code: "CAPIR_UPDATE_LOCK_HELD",
    exit_code: 3,
    meaning: "Another install, update or rollback holds the managed lock; retry after it finishes.",
  },
];

function checkPayload(): Record<string, unknown> {
  return {
    path: "update --check",
    arguments: [...SHARED_ARGUMENTS],
    example: "capir update --check --json",
    envelope_fields: {
      current: "version of the running capir (string)",
      latest: "newest verified stable version from the signed capir-stable channel",
      update_available: "true only when latest is strictly newer than current",
      install_method: "managed | unmanaged",
      source: "immutable release URL of the verified manifest (tag capir-vX.Y.Z)",
    },
    guarantees: [
      "writes no install files and touches no credentials (the automatic check cache is auto-check only)",
      "needs no --env and no auth",
    ],
    error_codes: ERROR_CODES,
  };
}

function updatePayload(): Record<string, unknown> {
  return {
    path: "update",
    arguments: [...SHARED_ARGUMENTS],
    example: "capir update --json",
    envelope_fields: {
      action: "updated | already-current",
      previous_version: "version that was current before this update",
      current_version: "version active after this update",
      version_dir: "physical managed version directory",
      launcher: "launcher path that resolves `current` atomically",
    },
    guarantees: [
      "download, signature, sha256, byte size, archive confinement and smoke checks all run before publishing",
      "any failure preserves the previous install and running sessions",
      "old versions are never deleted; the previous version stays available for rollback",
      "running sessions keep their resolved version; the update applies to the next invocation",
    ],
    error_codes: ERROR_CODES,
  };
}

function rollbackPayload(): Record<string, unknown> {
  return {
    path: "update --rollback",
    arguments: [...SHARED_ARGUMENTS],
    example: "capir update --rollback --json",
    envelope_fields: {
      action: "rolled-back",
      current_version: "version active after the rollback",
      previous_version: "version that was left behind (kept, never deleted)",
      version_dir: "physical managed version directory",
      launcher: "launcher path",
    },
    guarantees: [
      "switches `current` back to the recorded previous version atomically",
      "keeps both versions and running sessions intact",
    ],
    error_codes: ERROR_CODES,
  };
}

function human(): string {
  return [
    "capir update - check, install and roll back managed standalone releases.",
    "",
    "Usage",
    "  capir update --check        read current/latest/update availability (no writes)",
    "  capir update                download and atomically install the newest stable release",
    "  capir update --rollback     switch the managed install back to the previous version",
    "",
    "Arguments",
    "  --check       check only; never writes install files or touches credentials",
    "  --rollback    roll back to the recorded previous version",
    "  --json        machine-stable JSON envelope (human-readable text is the default)",
    "  --human       force readable text output",
    "",
    "Managed installs",
    "  root:      ~/.local/share/capir           (override CAPIR_INSTALL_DIR)",
    "  versions:  <root>/versions/<version>/    current symlink switches atomically",
    "  launcher:  ~/.local/bin/capir            (override CAPIR_BIN_DIR)",
    "  Verified newest stable manifest and signature live in the non-latest",
    "  capir-stable channel release; version releases are immutable tags capir-vX.Y.Z.",
    "",
    "Safety",
    "  Signature verification runs before any manifest parsing or use; the archive",
    "  sha256 and byte size are verified before extraction; archive paths and",
    "  symlinks may never escape the install root; the bundled CLI is smoke-tested",
    "  (--version, --help, native keyring) from a clean environment before publish.",
    "  Source checkouts and package-manager installs are never modified in place:",
    "  install a managed copy first:",
    "    " + INSTALL_COMMAND,
    "",
    "Automatic update notice",
    "  Ordinary interactive commands may print a one-line notice to stderr at most",
    "  once per ~24h (bounded to 2 seconds, offline-safe, never automatic install).",
    "  Help, --version, doctor, update, --json, --noninteractive and non-TTY runs",
    "  never start a network check. Disable with CAPIR_DISABLE_UPDATE_CHECK=1.",
    "",
    "Errors",
    ...ERROR_CODES.map((entry) => `  ${entry.code} (exit ${entry.exit_code}): ${entry.meaning}`),
    "",
    "Machine callers",
    "  capir update --check --json    stable envelope: current, latest, update_available,",
    "                                 install_method, source",
  ].join("\n");
}

function family(): Record<string, unknown> {
  return {
    path: "update",
    arguments: [...SHARED_ARGUMENTS],
    commands: [
      "capir update --check [--json]",
      "capir update [--json]",
      "capir update --rollback [--json]",
    ],
    install: {
      bootstrap_url: CHANNEL + "/install.sh",
      install_command: INSTALL_COMMAND,
      managed_root: "~/.local/share/capir (override CAPIR_INSTALL_DIR)",
      launcher: "~/.local/bin/capir (override CAPIR_BIN_DIR)",
      supported_platforms: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"],
      windows: "source installs only; the native updater does not support Windows",
    },
    error_codes: ERROR_CODES,
    paths: UPDATE_HELP_PATHS,
  };
}

function payload(path: UpdateHelpPath): Record<string, unknown> {
  if (path === "update --check") return checkPayload();
  if (path === "update --rollback") return rollbackPayload();
  return family();
}

/** Offline, side-effect free help renderer for the update family. */
export function renderUpdateHelp(path: string, format: UpdateHelpFormat): string {
  if (!UPDATE_HELP_PATHS.includes(path as UpdateHelpPath)) {
    throw new Error(
      `Unknown help path "${path}"; expected one of ${UPDATE_HELP_PATHS.join(", ")}.`,
    );
  }
  if (format === "json") return JSON.stringify(payload(path as UpdateHelpPath), null, 2);
  return human();
}
