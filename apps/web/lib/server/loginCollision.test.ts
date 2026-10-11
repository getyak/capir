import { describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ entries: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.entries.has(name) ? { name, value: jar.entries.get(name)! } : undefined,
    set: (name: string, value: string) => {
      jar.entries.set(name, value);
    },
    delete: (name: string) => {
      jar.entries.delete(name);
    },
  }),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  authSecret: () => "login-collision-fixture-secret",
}));

import { LOGIN_COLLISION_TTL_SECONDS } from "@/lib/login-continuity";
import {
  LOGIN_COLLISION_COOKIE,
  readLoginCollisionHint,
  sealLoginCollisionHint,
} from "./loginCollision";

describe("sealed login collision hint", () => {
  it("round-trips only the provider and seal time through an HttpOnly sealed cookie", async () => {
    jar.entries.clear();
    await sealLoginCollisionHint("google");
    const raw = jar.entries.get(LOGIN_COLLISION_COOKIE)!;
    expect(raw).toBeTruthy();
    // The sealed bytes never carry a token, email or account detail, and the
    // cookie policy is the short-lived HttpOnly same-site one.
    expect(raw).not.toContain("identity");
    expect(raw).not.toContain("@");
    const hint = await readLoginCollisionHint();
    expect(hint).toMatchObject({ provider: "google" });
    expect(Date.parse(hint!.sealedAt)).toBeGreaterThan(0);
  });

  it("expires silently and never discloses a collision after its lifetime", async () => {
    jar.entries.clear();
    await sealLoginCollisionHint("apple");
    const sealedAt = Date.now();
    expect(await readLoginCollisionHint(sealedAt + 1_000)).toMatchObject({ provider: "apple" });
    expect(
      await readLoginCollisionHint(sealedAt + (LOGIN_COLLISION_TTL_SECONDS + 1) * 1_000),
    ).toBeNull();
  });

  it("fails closed on forged, truncated or cross-secret bytes", async () => {
    jar.entries.clear();
    expect(await readLoginCollisionHint()).toBeNull();
    for (const forged of ["", "not-a-jwt", "a.b.c", "{}"]) {
      jar.entries.set(LOGIN_COLLISION_COOKIE, forged);
      expect(await readLoginCollisionHint()).toBeNull();
    }
  });
});
