import { describe, expect, it } from "vitest";
import {
  parseWebReleaseMetadata,
  readWebReleaseIdentity,
  vercelRevision,
} from "./web-release";

describe("web release metadata", () => {
  it("accepts a validated resident build receipt revision", () => {
    expect(parseWebReleaseMetadata({ revision: "26a664bb" })).toEqual({
      revision: "26a664bb",
      source: "release_file",
    });
    const full = "a".repeat(40);
    expect(parseWebReleaseMetadata({ revision: full })).toEqual({
      revision: full,
      source: "release_file",
    });
    // Git object names are case-insensitive; the receipt is normalized.
    expect(parseWebReleaseMetadata({ revision: "ABCDEF0" })?.revision).toBe("abcdef0");
  });

  it("never treats a buildID or commit label as a Git revision", () => {
    expect(parseWebReleaseMetadata({ buildID: "dsm6EMoVjbgFXvX8rwCiF" })).toBeNull();
    expect(parseWebReleaseMetadata({ buildId: "build_2026.09.28" })).toBeNull();
    expect(parseWebReleaseMetadata({ commit: "a12d51bc" })).toBeNull();
    expect(
      parseWebReleaseMetadata({ buildID: "dsm6EMoVjbgFXvX8rwCiF", revision: "26a664bb" }),
    ).toEqual({ revision: "26a664bb", source: "release_file" });
  });

  it("rejects malformed or empty revisions without inventing one", () => {
    expect(parseWebReleaseMetadata(null)).toBeNull();
    expect(parseWebReleaseMetadata({})).toBeNull();
    expect(parseWebReleaseMetadata({ revision: "" })).toBeNull();
    expect(parseWebReleaseMetadata({ revision: "26a664bb.dirty" })).toBeNull();
    expect(parseWebReleaseMetadata({ revision: "not-a-sha" })).toBeNull();
    expect(parseWebReleaseMetadata({ revision: "abc123" })).toBeNull();
    expect(parseWebReleaseMetadata({ revision: "a".repeat(41) })).toBeNull();
    expect(parseWebReleaseMetadata("<script>")).toBeNull();
  });

  it("prefers the resident receipt revision over the platform sha", () => {
    const identity = readWebReleaseIdentity({
      cwd: "/synthetic",
      env: { VERCEL_GIT_COMMIT_SHA: "abcdef0123456789" },
      readFile: () => JSON.stringify({ revision: "26a664bb", buildID: "dsm6EMoVjbgFXvX8rwCiF" }),
    });
    expect(identity).toEqual({ revision: "26a664bb", source: "release_file" });
  });

  it("ignores a buildID-only receipt and uses the platform revision", () => {
    const identity = readWebReleaseIdentity({
      cwd: "/synthetic",
      env: { VERCEL_GIT_COMMIT_SHA: "abcdef0123456789" },
      readFile: () => JSON.stringify({ buildID: "dsm6EMoVjbgFXvX8rwCiF" }),
    });
    expect(identity?.source).toBe("vercel_git_commit_sha");
  });

  it("falls back to a validated platform sha when the receipt is missing", () => {
    expect(
      readWebReleaseIdentity({
        cwd: "/synthetic",
        env: { VERCEL_GIT_COMMIT_SHA: "abcdef0123456789" },
        readFile: () => {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      }),
    ).toEqual({
      revision: "abcdef0123456789",
      source: "vercel_git_commit_sha",
    });
  });

  it("falls back when the receipt is malformed, not just absent", () => {
    const identity = readWebReleaseIdentity({
      cwd: "/synthetic",
      env: { VERCEL_GIT_COMMIT_SHA: "abcdef0123456789" },
      readFile: () => "{not json",
    });
    expect(identity?.source).toBe("vercel_git_commit_sha");
  });

  it("stays unknown when neither source is valid", () => {
    expect(
      readWebReleaseIdentity({
        cwd: "/synthetic",
        env: {},
        readFile: () => JSON.stringify({ revision: "bad value!" }),
      }),
    ).toBeNull();
    expect(
      readWebReleaseIdentity({
        cwd: "/synthetic",
        env: { VERCEL_GIT_COMMIT_SHA: "not-a-sha" },
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toBeNull();
  });

  it("only accepts bounded hex for a Vercel commit sha", () => {
    expect(vercelRevision("abcdef0")).toBe("abcdef0");
    expect(vercelRevision("  ABCDEF0123456789  ")).toBe("abcdef0123456789");
    expect(vercelRevision("a".repeat(40))).toBe("a".repeat(40));
    expect(vercelRevision("zzzzzzz")).toBeNull();
    expect(vercelRevision("abc")).toBeNull();
    expect(vercelRevision("a".repeat(41))).toBeNull();
    expect(vercelRevision("26a664bb.dirty")).toBeNull();
    expect(vercelRevision(undefined)).toBeNull();
  });
});
