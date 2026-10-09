/**
 * Canonical standalone platform table for the capir release slice.
 *
 * One native build per platform on the matching GitHub-hosted runner; the
 * labels below are checked against the known hosted-runner labels by
 * scripts/capir/release-policy.test.mjs so a typo can never silently fall
 * back to a different architecture. linux-x64 targets glibc; Windows has no
 * native updater support (source installs only).
 */
export const SUPPORTED_PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

/** GitHub-hosted runner labels actually provisioned for each platform. */
export const RUNNERS = {
  "darwin-arm64": "macos-26",
  "darwin-x64": "macos-15-intel",
  "linux-arm64": "ubuntu-24.04-arm",
  "linux-x64": "ubuntu-latest",
};

/**
 * Known GitHub-hosted runner labels (public repos). Policy tests compare
 * RUNNERS against this allowlist; extend deliberately when GitHub adds labels.
 */
export const HOSTED_RUNNER_LABELS = new Set([
  "macos-26",
  "macos-15-intel",
  "macos-15",
  "macos-14",
  "macos-latest",
  "ubuntu-24.04-arm",
  "ubuntu-24.04",
  "ubuntu-22.04",
  "ubuntu-latest",
]);

export function hostPlatform(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  if (!SUPPORTED_PLATFORMS.includes(key)) {
    throw new Error(
      `Platform "${key}" is not supported (supported: ${SUPPORTED_PLATFORMS.join(", ")}; Windows is source-install only).`,
    );
  }
  return key;
}
