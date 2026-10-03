import { describe, expect, it } from "vitest";
import { readDesktopRelease } from "./desktop-release";

describe("desktop release identity", () => {
  it("reports no bridge and no version when the native host is absent or unsupported", () => {
    expect(readDesktopRelease(undefined)).toEqual({
      available: false,
      appVersion: null,
      update: null,
    });
    expect(readDesktopRelease({ protocolVersion: 2, appVersion: "1.0" })).toEqual({
      available: false,
      appVersion: null,
      update: null,
    });
    expect(readDesktopRelease("<script>")).toEqual({
      available: false,
      appVersion: null,
      update: null,
    });
  });

  it("reads an installed app version without inventing one", () => {
    expect(
      readDesktopRelease({ protocolVersion: 1, availableVersion: null, appVersion: "0.2.0 (29)" }),
    ).toEqual({
      available: true,
      appVersion: "0.2.0 (29)",
      update: null,
    });
    expect(
      readDesktopRelease({ protocolVersion: 1, availableVersion: null, appVersion: "<img>" }),
    ).toEqual({ available: true, appVersion: null, update: null });
    expect(
      readDesktopRelease({ protocolVersion: 1, availableVersion: null, appVersion: "x".repeat(41) }),
    ).toEqual({ available: true, appVersion: null, update: null });
  });

  it("reads a structured update state from the new host fields", () => {
    expect(
      readDesktopRelease({
        protocolVersion: 1,
        availableVersion: null,
        appVersion: "0.2.0",
        update: { phase: "downloading", availableVersion: "0.3.0", progress: 41.6 },
      }),
    ).toEqual({
      available: true,
      appVersion: "0.2.0",
      update: { phase: "downloading", availableVersion: "0.3.0", progress: 42 },
    });
  });

  it("keeps the legacy top-level update fields working", () => {
    expect(
      readDesktopRelease({
        protocolVersion: 1,
        availableVersion: "0.3.0",
        phase: "available",
      }),
    ).toEqual({
      available: true,
      appVersion: null,
      update: { phase: "available", availableVersion: "0.3.0", progress: null },
    });
    expect(
      readDesktopRelease({ protocolVersion: 1, availableVersion: null, phase: "failed" }),
    ).toEqual({
      available: true,
      appVersion: null,
      update: { phase: "failed", availableVersion: null, progress: null },
    });
  });

  it("drops malformed phases and out-of-range progress", () => {
    const release = readDesktopRelease({
      protocolVersion: 1,
      availableVersion: "0.3.0",
      phase: "made-up",
    });
    expect(release.update).toEqual({
      phase: "available",
      availableVersion: "0.3.0",
      progress: null,
    });
    const clamped = readDesktopRelease({
      protocolVersion: 1,
      availableVersion: null,
      update: { phase: "downloading", availableVersion: "0.3.0", progress: Number.NaN },
    });
    expect(clamped.update?.progress).toBeNull();
  });
});
