import { describe, expect, it } from "vitest";

import {
  LOGIN_COLLISION_TTL_SECONDS,
  collisionHintIsLive,
  connectProviderFrom,
  continuityReturnTo,
  loginContinuationTarget,
  settingsConnectHints,
  settingsConnectPath,
  settingsLinkErrorTarget,
  type LoginCollisionHint,
} from "./login-continuity";

const baseTime = Date.parse("2026-10-11T00:00:00.000Z");
const macCallback = "/desktop-auth/authorize?attempt=a&state=b";

function hint(overrides: Partial<LoginCollisionHint> = {}): LoginCollisionHint {
  return {
    provider: "google",
    sealedAt: new Date(baseTime).toISOString(),
    ...overrides,
  };
}

describe("login continuity navigation hints", () => {
  it("allowlists the provider hint and drops every forged value", () => {
    expect(connectProviderFrom("google")).toBe("google");
    expect(connectProviderFrom("apple")).toBe("apple");
    for (const forged of [
      "password",
      "Google",
      "https://evil.example",
      "",
      null,
      undefined,
      ["google"],
      { provider: "google" },
    ]) {
      expect(connectProviderFrom(forged)).toBeNull();
    }
  });

  it("keeps a sealed collision hint live only inside its absolute lifetime", () => {
    expect(collisionHintIsLive(hint(), baseTime)).toBe(true);
    expect(
      collisionHintIsLive(hint(), baseTime + (LOGIN_COLLISION_TTL_SECONDS - 1) * 1_000),
    ).toBe(true);
    // Expired, future-skewed and malformed hints disclose nothing.
    expect(
      collisionHintIsLive(hint(), baseTime + (LOGIN_COLLISION_TTL_SECONDS + 1) * 1_000),
    ).toBe(false);
    expect(collisionHintIsLive(hint({ sealedAt: "" }), baseTime)).toBe(false);
    expect(
      collisionHintIsLive(hint({ sealedAt: new Date(baseTime + 60_000).toISOString() }), baseTime),
    ).toBe(false);
    expect(collisionHintIsLive(null, baseTime)).toBe(false);
  });

  it("preserves safe same-origin callbacks, including CLI/Mac browser callbacks", () => {
    for (const callback of [
      "/desktop-auth/authorize?attempt=10000000-0000-4000-8000-000000000001&state=aB3_-cD9",
      "/capir/authorize?schema_version=capir-auth.v2&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcapir%2Fcallback&state=aB3_-cD9&code_challenge=public-pkce-challenge&code_challenge_method=S256&web_origin=https%3A%2F%2Fapp.example&backend_origin=https%3A%2F%2Fapi.example&client_label=GET-141",
      "/workspace/pursuits/42",
      "/workspace/settings?section=account",
    ]) {
      const target = loginContinuationTarget({ callbackUrl: callback, provider: "google" });
      expect(target).toBe(
        `/workspace/settings?section=account&connect=google&returnTo=${encodeURIComponent(callback)}`,
      );
      // The return hint survives decode as the exact original safe callback.
      expect(decodeURIComponent(target.split("returnTo=")[1]!)).toBe(callback);
    }
  });

  it("rejects forged return targets instead of silently retargeting the journey", () => {
    for (const forged of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example",
      "javascript:alert(1)",
      " /workspace",
      "/login?connect=google",
      "/onboarding?callbackUrl=%2Fworkspace",
      "/login",
      "/onboarding",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(continuityReturnTo(forged)).toBeNull();
    }
  });

  it("falls back to the workspace when a continuation has no safe original", () => {
    expect(
      loginContinuationTarget({ callbackUrl: "https://evil.example", provider: "apple" }),
    ).toBe("/workspace/settings?section=account&connect=apple&returnTo=%2Fworkspace");
  });

  it("validates the settings hints independently of their source", () => {
    expect(
      settingsConnectHints({ connect: "google", returnTo: "/desktop-auth/authorize?attempt=a&state=b" }),
    ).toEqual({
      connect: "google",
      returnTo: "/desktop-auth/authorize?attempt=a&state=b",
    });
    // A forged query on either side collapses without becoming a target.
    expect(
      settingsConnectHints({ connect: "password", returnTo: "https://evil.example" }),
    ).toEqual({ connect: null, returnTo: null });
    expect(settingsConnectHints({})).toEqual({ connect: null, returnTo: null });
  });

  it("carries only validated hints through login-hop paths and failure targets", () => {
    expect(
      settingsConnectPath({
        returnPath: "/workspace/settings?section=account",
        connect: "google",
        returnTo: macCallback,
      }),
    ).toBe(
      `/workspace/settings?section=account&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    expect(
      settingsConnectPath({ returnPath: "/workspace/settings", connect: null, returnTo: null }),
    ).toBe("/workspace/settings");
    expect(
      settingsConnectPath({
        returnPath: "/workspace/settings",
        connect: null,
        returnTo: "https://evil.example/steal",
      }),
    ).toBe("/workspace/settings");
    expect(settingsLinkErrorTarget({ provider: "google", returnTo: macCallback })).toBe(
      `/workspace/settings?section=account&link=error&connect=google&returnTo=${encodeURIComponent(macCallback)}`,
    );
    expect(
      settingsLinkErrorTarget({ provider: "password", returnTo: "https://evil.example" }),
    ).toBe("/workspace/settings?section=account&link=error");
    expect(settingsLinkErrorTarget({})).toBe("/workspace/settings?section=account&link=error");
  });
});
