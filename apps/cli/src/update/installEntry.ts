/**
 * Bundled Node installer entry: `node <tree>/package/dist/update/installEntry.js`.
 *
 * The shell bootstrap (install.sh) has already downloaded, signature-checked,
 * sha256-checked and extracted the archive under strict confinement. This
 * entry RE-VERIFIES everything in Node before touching the install root:
 * manifest signature (before parsing), current-platform archive sha256 and
 * byte size, tree-to-manifest binding, the physical link-graph confinement,
 * and a clean-environment smoke of the bundled CLI. Only then does it publish
 * the version directory, the launcher and the state under the install lock.
 *
 * The trust key is an explicit dependency: install.sh passes the public key
 * file it embeds via `--trust-key`. With no argument the committed production
 * key is used. There is no environment override for trust.
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CapirCliError, EXIT } from "../errors.js";
import { CAPIR_RELEASE_PUBLIC_KEY } from "./manifest.js";
import { hostPlatform } from "./platform.js";
import { verifyArchiveFile, verifyManifestBytes } from "./release.js";
import { installPortable, type UpdateOutcome, type UpdateTransport } from "./transaction.js";

export interface InstallEntryArgs {
  manifest: string;
  signature: string;
  archive: string;
  tree: string;
  installRoot: string;
  binDir: string;
  trustKeyFile?: string;
  /** Explicit transport binding (tests/mirrors); production passes the canonical base. */
  expectedReleaseBase?: string;
  replaceExisting: boolean;
}

export function parseInstallEntryArgs(argv: string[]): InstallEntryArgs {
  const values: Record<string, string | boolean> = {};
  const FLAGS = new Set(["--replace-existing"]);
  const VALUE_FLAGS = new Set([
    "--manifest",
    "--signature",
    "--archive",
    "--tree",
    "--install-root",
    "--bin-dir",
    "--trust-key",
    "--expected-release-base",
  ]);
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (FLAGS.has(token)) {
      values[token.slice(2)] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token))
      throw new CapirCliError(
        "CAPIR_CLI_UNKNOWN_FLAG",
        EXIT.INVALID_ARGUMENTS,
        `Unknown installer argument "${token}". Nothing was executed.`,
      );
    const value = argv[++index];
    if (value === undefined || value.startsWith("--"))
      throw new CapirCliError(
        "CAPIR_CLI_INVALID_ARGUMENT",
        EXIT.INVALID_ARGUMENTS,
        `${token} requires a value.`,
      );
    values[token.slice(2)] = value;
  }
  const requireValue = (name: string): string => {
    const value = values[name];
    if (typeof value !== "string" || value.length === 0)
      throw new CapirCliError(
        "CAPIR_CLI_INVALID_ARGUMENT",
        EXIT.INVALID_ARGUMENTS,
        `Installer argument --${name} is required.`,
      );
    return value;
  };
  return {
    manifest: requireValue("manifest"),
    signature: requireValue("signature"),
    archive: requireValue("archive"),
    tree: requireValue("tree"),
    installRoot: requireValue("install-root"),
    binDir: requireValue("bin-dir"),
    ...(typeof values["trust-key"] === "string" ? { trustKeyFile: values["trust-key"] } : {}),
    ...(typeof values["expected-release-base"] === "string"
      ? { expectedReleaseBase: values["expected-release-base"] }
      : {}),
    replaceExisting: values["replace-existing"] === true,
  };
}

/** Full install transaction with mandatory re-verification in Node. */
export async function runInstallEntry(
  args: InstallEntryArgs,
  transport: Pick<UpdateTransport, "lockTimeoutMs" | "now"> = {},
): Promise<UpdateOutcome> {
  const trustPublicKey = args.trustKeyFile
    ? readFileSync(args.trustKeyFile, "utf8")
    : CAPIR_RELEASE_PUBLIC_KEY;
  const manifestBytes = readFileSync(args.manifest);
  const signatureBytes = readFileSync(args.signature);
  // Signature verification strictly precedes parsing or use.
  const { manifest, asset } = verifyManifestBytes(
    manifestBytes,
    signatureBytes,
    trustPublicKey,
    hostPlatform(),
    args.expectedReleaseBase ? { releaseBaseUrl: args.expectedReleaseBase } : {},
  );
  // The current-platform archive sha256 and byte size run in Node too, even
  // though the shell bootstrap already checked them before extraction.
  await verifyArchiveFile(args.archive, asset);
  return installPortable({
    tree: args.tree,
    archivePath: args.archive,
    manifest,
    asset,
    installRoot: resolve(args.installRoot),
    binDir: resolve(args.binDir),
    replaceExisting: args.replaceExisting,
    transport: {
      // The installer performs no network transport of its own.
      fetchImpl: (async () => {
        throw new CapirCliError(
          "CAPIR_UPDATE_DOWNLOAD_FAILED",
          EXIT.INFRASTRUCTURE,
          "The installer entry performs no downloads.",
        );
      }) as unknown as UpdateTransport["fetchImpl"],
      trustPublicKey,
      ...transport,
    },
  });
}

async function main(): Promise<void> {
  try {
    const args = parseInstallEntryArgs(process.argv.slice(2));
    const outcome = await runInstallEntry(args);
    process.stdout.write(
      [
        `capir installed ${outcome.current_version}`,
        `  previous:     ${outcome.previous_version ?? "(none)"}`,
        `  version dir:  ${outcome.version_dir}`,
        `  launcher:     ${outcome.launcher}`,
        `  smoke:        --version, --help and native keyring verified from the bundled runtime`,
        "",
      ].join("\n"),
    );
  } catch (error) {
    const code = error instanceof CapirCliError ? error.code : "CAPIR_INTERNAL_ERROR";
    const exitCode = error instanceof CapirCliError ? error.exitCode : EXIT.INFRASTRUCTURE;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error ${code}: ${message}\n`);
    process.exitCode = exitCode;
    return;
  }
}

// Execute only when run directly (install.sh / smoke), never on import.
// realpath comparison keeps macOS symlinked tmp paths working.
function invokedDirectly(): boolean {
  try {
    return (
      process.argv[1] !== undefined &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}
if (invokedDirectly()) await main();
