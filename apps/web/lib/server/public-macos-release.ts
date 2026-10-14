import "server-only";

const releaseEndpoint = "https://api.github.com/repos/getyak/capir/releases?per_page=20";

export type PublicMacRelease = {
  version: string;
  build: number;
  preview: boolean;
  downloadHref: string;
  checksumHref: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assetHref(asset: Record<string, unknown>, tag: string): string | null {
  if (asset.state !== "uploaded" || typeof asset.size !== "number" || asset.size <= 0) return null;
  // Public release metadata is presentation, never updater or execution authority.
  // Admit only literal assets from the owning repository, including its old slug.
  const href = asset.browser_download_url;
  if (typeof href !== "string" || typeof asset.name !== "string") return null;
  return ["capir", "talent-signal"].some(repo =>
    href === `https://github.com/getyak/${repo}/releases/download/${tag}/${asset.name}`,
  ) ? href : null;
}

export function selectPublicMacRelease(payload: unknown): PublicMacRelease | null {
  if (!Array.isArray(payload)) return null;
  let selected: PublicMacRelease | null = null;
  for (const value of payload.slice(0, 20)) {
    const release = record(value);
    if (!release || release.draft !== false || typeof release.prerelease !== "boolean" ||
      record(release.author)?.login !== "github-actions[bot]" ||
      typeof release.published_at !== "string" || !Number.isFinite(Date.parse(release.published_at)) ||
      !Array.isArray(release.assets)) continue;
    const assets = release.assets.map(record).filter((asset): asset is Record<string, unknown> => asset !== null);
    for (const installer of assets) {
      if (typeof installer.name !== "string") continue;
      const match = /^Talent-Signal-(\d{1,6}\.\d{1,6}\.\d{1,6})-([1-9]\d{0,8})-macOS-universal-signed\.dmg$/.exec(installer.name);
      if (!match) continue;
      const [, version, buildText] = match;
      const tag = `v${version}`;
      if (release.tag_name !== tag) continue;
      const checksumName = `${installer.name.slice(0, -4)}-SHA256SUMS.txt`;
      const checksums = assets.filter(asset => asset.name === checksumName);
      if (checksums.length !== 1) continue;
      const downloadHref = assetHref(installer, tag);
      const checksumHref = assetHref(checksums[0], tag);
      if (!downloadHref || !checksumHref) continue;
      const build = Number(buildText);
      if (!selected || build > selected.build) {
        selected = { version, build, preview: release.prerelease, downloadHref, checksumHref };
      }
    }
  }
  return selected;
}

/** One small public-metadata cache per server process; no account or secret input. */
export function createPublicMacReleaseLookup(
  fetcher: typeof fetch = (...args) => fetch(...args),
  now: () => number = Date.now,
) {
  let cached: { value: PublicMacRelease | null; expiresAt: number } | null = null;
  let pending: Promise<PublicMacRelease | null> | null = null;
  async function read(): Promise<PublicMacRelease | null> {
    try {
      const response = await fetcher(releaseEndpoint, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(4_000),
        headers: { accept: "application/vnd.github+json", "user-agent": "capri-public-download" },
      });
      if (!response.ok) return null;
      const body = await response.text();
      if (body.length > 1_048_576) return null;
      return selectPublicMacRelease(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return async (): Promise<PublicMacRelease | null> => {
    if (cached && now() < cached.expiresAt) return cached.value;
    pending ??= read().then(value => {
      // Failures replace expired metadata instead of reviving an old installer.
      cached = { value, expiresAt: now() + (value ? 300_000 : 30_000) };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
}

export const loadPublicMacRelease = createPublicMacReleaseLookup();
