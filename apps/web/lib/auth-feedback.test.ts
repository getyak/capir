import { describe, expect, it } from "vitest";

import {
  authFailureCodeFromCredentialsCode,
  authFailureIsRetryable,
  authFailureMessage,
} from "./auth-feedback";

describe("auth failure feedback", () => {
  it("differentiates invalid credentials, service outages, and rate limits", () => {
    const invalid = authFailureMessage("invalid_credentials", "sign-in");
    const unavailable = authFailureMessage("service_unavailable", "sign-in");
    const limited = authFailureMessage("rate_limited", "sign-in");

    expect(new Set([invalid, unavailable, limited]).size).toBe(3);
    expect(unavailable).not.toContain("本地后端");
  });

  it("only treats a backend outage as immediately retryable", () => {
    expect(authFailureIsRetryable("service_unavailable")).toBe(true);
    expect(authFailureIsRetryable("invalid_credentials")).toBe(false);
    expect(authFailureIsRetryable("rate_limited")).toBe(false);
    expect(authFailureIsRetryable("account_exists")).toBe(false);
  });

  it("maps credential codes to the surface states", () => {
    expect(authFailureCodeFromCredentialsCode("rate_limited", "sign-in")).toBe(
      "rate_limited",
    );
    expect(
      authFailureCodeFromCredentialsCode("service_unavailable", "register"),
    ).toBe("registration_result_unknown");
    expect(
      authFailureCodeFromCredentialsCode("account_exists", "register"),
    ).toBe("account_exists");
    expect(authFailureCodeFromCredentialsCode("", "sign-in")).toBe(
      "service_unavailable",
    );
    expect(authFailureCodeFromCredentialsCode(undefined, "sign-in")).toBe(
      "service_unavailable",
    );
  });

  it("does not retry an unconfirmed registration", () => {
    expect(authFailureIsRetryable("registration_result_unknown")).toBe(false);
    expect(authFailureMessage("registration_result_unknown", "register")).toContain("先尝试登录");
    expect(authFailureCodeFromCredentialsCode("credentials", "sign-in")).toBe("invalid_credentials");
  });

  it("never reports a duplicate account while signing in", () => {
    expect(
      authFailureCodeFromCredentialsCode("account_exists", "sign-in"),
    ).toBe("invalid_credentials");
  });

  it("explains a test-session limit with an explicit recovery prerequisite", () => {
    expect(authFailureCodeFromCredentialsCode("test_workspace_session_limit", "sign-in")).toBe("test_workspace_session_limit");
    expect(authFailureCodeFromCredentialsCode("test_workspace_session_limit", "register")).toBe("registration_result_unknown");
    expect(authFailureIsRetryable("test_workspace_session_limit")).toBe(false);
    const message = authFailureMessage("test_workspace_session_limit", "sign-in");
    expect(message).toContain("会话上限");
    expect(message).toContain("退出登录后重试");
    expect(message).not.toContain("服务");
    expect(message).not.toContain("LAB_");
  });
});
