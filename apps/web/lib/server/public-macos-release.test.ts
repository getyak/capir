import { describe, expect, it } from "vitest";
import { createPublicMacReleaseLookup, selectPublicMacRelease } from "./public-macos-release";

function published(version = "0.2.8", build = 999) {
  const base = `Talent-Signal-${version}-${build}-macOS-universal-signed`;
  return {
    tag_name: `v${version}`, draft: false, prerelease: true,
    published_at: "2026-10-15T00:00:00Z", author: { login: "github-actions[bot]" },
    assets: [".dmg", "-SHA256SUMS.txt"].map(suffix => ({
      name: base + suffix, size: 12345, state: "uploaded",
      browser_download_url: `https://github.com/getyak/capir/releases/download/v${version}/${base}${suffix}`,
    })),
  };
}

describe("public Mac cohort admission", () => {
  it("uses the independent native build order, retaining the explicit preview flag", () => {
    const release = selectPublicMacRelease([published("0.3.0", 998), published()]);
    expect(release).toEqual({
      version: "0.2.8", build: 999, preview: true,
      downloadHref: "https://github.com/getyak/capir/releases/download/v0.2.8/Talent-Signal-0.2.8-999-macOS-universal-signed.dmg",
      checksumHref: "https://github.com/getyak/capir/releases/download/v0.2.8/Talent-Signal-0.2.8-999-macOS-universal-signed-SHA256SUMS.txt",
    });
    const stable = published(); stable.prerelease = false;
    expect(selectPublicMacRelease([stable])?.preview).toBe(false);
  });

  it.each([
    ["draft", (release: ReturnType<typeof published>) => { release.draft = true; }],
    ["non-workflow author", (release: ReturnType<typeof published>) => { release.author.login = "another-author"; }],
    ["mismatched product tag", (release: ReturnType<typeof published>) => { release.tag_name = "v0.2.7"; }],
    ["unfinished upload", (release: ReturnType<typeof published>) => { release.assets[0].state = "new"; }],
    ["empty download", (release: ReturnType<typeof published>) => { release.assets[0].size = 0; }],
    ["foreign installer", (release: ReturnType<typeof published>) => { release.assets[0].browser_download_url = "https://example.invalid/installer.dmg"; }],
    ["foreign checksum", (release: ReturnType<typeof published>) => { release.assets[1].browser_download_url += "?redirect=elsewhere"; }],
    ["missing checksum", (release: ReturnType<typeof published>) => { release.assets.pop(); }],
    ["mixed checksum", (release: ReturnType<typeof published>) => { release.assets[1] = published("0.2.7", 998).assets[1]; }],
    ["unsigned preview", (release: ReturnType<typeof published>) => {
      for (const asset of release.assets) {
        asset.name = asset.name.replace("-signed", "-preview");
        asset.browser_download_url = asset.browser_download_url.replace("-signed", "-preview");
      }
    }],
  ] as const)("refuses a %s rather than offering an unpaired installer", (_name, mutate) => {
    const release = published(); mutate(release);
    expect(selectPublicMacRelease([release])).toBeNull();
  });

  it("accepts the official repository's historical slug without accepting other owners", () => {
    const release = published();
    for (const asset of release.assets) asset.browser_download_url = asset.browser_download_url.replace("/capir/", "/talent-signal/");
    expect(selectPublicMacRelease([release])?.downloadHref).toBe("https://github.com/getyak/talent-signal/releases/download/v0.2.8/Talent-Signal-0.2.8-999-macOS-universal-signed.dmg");
    for (const asset of release.assets) asset.browser_download_url = asset.browser_download_url.replace("/getyak/", "/other/");
    expect(selectPublicMacRelease([release])).toBeNull();
  });

  it.each([null, {}, [], [{ assets: null }]])("does not invent a download for malformed or empty metadata %j", value => {
    expect(selectPublicMacRelease(value)).toBeNull();
  });
});

describe("public release lookup lifecycle", () => {
  it("coalesces concurrent reads and replaces expired metadata with unavailable on failure", async () => {
    let clock = 0;
    let response = new Response(JSON.stringify([published()]));
    const lookup = createPublicMacReleaseLookup(async () => response, () => clock);
    const values = await Promise.all([lookup(), lookup(), lookup()]);
    expect(values.map(value => value?.version)).toEqual(["0.2.8", "0.2.8", "0.2.8"]);
    response = new Response("unavailable", { status: 503 });
    expect((await lookup())?.version).toBe("0.2.8");
    clock = 300_001;
    expect(await lookup()).toBeNull();
    response = new Response(JSON.stringify([published("0.2.9", 1000)]));
    clock = 330_002;
    expect((await lookup())?.version).toBe("0.2.9");
  });

  it.each([
    ["transport failure", async () => { throw new Error("unavailable"); }],
    ["non-JSON body", async () => new Response("<html>error</html>")],
    ["oversized metadata", async () => new Response("x".repeat(1_048_577))],
  ] as const)("keeps %s recoverable without a fabricated version", async (_name, fetcher) => {
    expect(await createPublicMacReleaseLookup(fetcher)()).toBeNull();
  });
});
