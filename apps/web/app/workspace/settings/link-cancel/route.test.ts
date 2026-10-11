import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), {
      digest: `NEXT_REDIRECT;push;${url};307;`,
    });
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      boundary.jar.has(name) ? { value: boundary.jar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      boundary.jar.set(name, value);
    },
    delete: (name: string) => {
      boundary.jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  authSecret: () => "link-cancel-fixture-secret",
}));
vi.mock("next/navigation", () => ({ redirect: boundary.redirect }));

import {
  AUTH_OPERATION_COOKIE,
  sealAuthOperation,
  sessionFingerprint,
  type AuthOperation,
} from "@/lib/server/stagedAuth";
import { GET } from "./route";

const macCallback = "/desktop-auth/authorize?attempt=a&state=b";

function operation(overrides: Partial<AuthOperation> = {}): AuthOperation {
  return {
    ref: "current-link",
    intent: "link_provider",
    reauthProvider: "google",
    reauthChallengeId: "target-challenge",
    clientLabel: "talent-signal-web",
    targetProvider: "google",
    accountId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000002",
    sessionFingerprint: sessionFingerprint("bearer-original"),
    accountRevision: 2,
    userRevision: 1,
    step: "awaiting-target",
    returnTo: macCallback,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function run(ref: string | null): Promise<string> {
  const request = new Request(
    `http://web.test/workspace/settings/link-cancel${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
  );
  const error = await GET(request).then(
    () => null,
    (caught: unknown) => caught as { digest?: string },
  );
  return error!.digest!.split(";")[2]!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-11T00:00:00.000Z"));
  boundary.jar.clear();
  boundary.redirect.mockClear();
});

describe("ref-specific link cancellation", () => {
  it("clears only the matched operation and keeps its return hint as a neutral result", async () => {
    await sealAuthOperation(operation(), false);
    expect(await run("current-link")).toBe(
      `/workspace/settings?link=cancelled&returnTo=${encodeURIComponent(macCallback)}`,
    );
    // The matched operation is cleared; the result is neutral and does not
    // reopen the connecting panel (no connect hint).
    expect(boundary.jar.has(AUTH_OPERATION_COOKIE)).toBe(false);
  });

  it("drops a forged return hint sealed into the cancelled operation", async () => {
    await sealAuthOperation(operation({ returnTo: "https://evil.example/steal" }), false);
    const target = await run("current-link");
    expect(target).toBe("/workspace/settings?link=cancelled");
    expect(target).not.toContain("evil.example");
  });

  it("never clears or exposes a newer operation for a foreign or old ref", async () => {
    await sealAuthOperation(operation({ ref: "newer-flow", returnTo: macCallback }), false);
    for (const ref of ["older-flow", "current-link"]) {
      expect(await run(ref)).toBe("/workspace/settings?link=error");
      // The newer operation survives every foreign cancel.
      expect(boundary.jar.has(AUTH_OPERATION_COOKIE)).toBe(true);
    }
    // A missing ref never clears anything either.
    expect(await run(null)).toBe("/workspace/settings?link=error");
    expect(boundary.jar.has(AUTH_OPERATION_COOKIE)).toBe(true);
  });

  it("reports a generic recoverable outcome when nothing is staged", async () => {
    expect(await run("current-link")).toBe("/workspace/settings?link=error");
  });
});
