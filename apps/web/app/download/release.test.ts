import { describe, expect, it } from "vitest";

import {
  MACOS_RELEASES_HREF,
  downloadSurfaces,
  requestAccessHref,
} from "./release";

describe("public download surface", () => {
  it("points macOS at the existing public release surface", () => {
    const macos = downloadSurfaces("zh-CN").find((s) => s.platform === "macos");
    expect(macos?.publicInstall).toBe(true);
    expect(macos?.installHref).toBe(MACOS_RELEASES_HREF);
  });

  it("never invents a public iOS install endpoint and keeps request access", () => {
    const ios = downloadSurfaces("zh-CN").find((s) => s.platform === "ios");
    expect(ios?.publicInstall).toBe(false);
    expect(ios?.installHref).toBeNull();
    expect(ios?.status).toContain("尚无公开安装入口");
    expect(requestAccessHref("zh-CN")).toMatch(/^mailto:hello@talentsignal\.ai/);
  });

  it("reports both platforms without claiming an enforced install path", () => {
    const surfaces = downloadSurfaces("en");
    expect(surfaces.map((s) => s.platform)).toEqual(["macos", "ios"]);
    for (const surface of surfaces) {
      expect(surface.detail.length).toBeGreaterThan(10);
    }
  });
});
