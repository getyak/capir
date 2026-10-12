import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  currentSessionMock,
  readBackendSessionClaimsMock,
  analyzeScreenshotMock,
  authMock,
  classifyScreenshotAnalysisFailureMock,
  getScreenshotAnalysisAvailabilityMock,
  issueScreenshotAnalysisReceiptMock,
} = vi.hoisted(() => ({
  currentSessionMock: vi.fn(),
  readBackendSessionClaimsMock: vi.fn(),
  analyzeScreenshotMock: vi.fn(),
  authMock: vi.fn(),
  classifyScreenshotAnalysisFailureMock: vi.fn(),
  getScreenshotAnalysisAvailabilityMock: vi.fn(),
  issueScreenshotAnalysisReceiptMock: vi.fn(),
}));

vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: readBackendSessionClaimsMock, authenticatedBackendClient: async () => ({ currentSession: currentSessionMock }) }));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/server/screenshot-analysis", () => ({
  analyzeScreenshot: analyzeScreenshotMock,
  classifyScreenshotAnalysisFailure:
    classifyScreenshotAnalysisFailureMock,
  getScreenshotAnalysisAvailability:
    getScreenshotAnalysisAvailabilityMock,
}));
vi.mock("@/lib/server/screenshot-analysis-receipt", () => ({
  issueScreenshotAnalysisReceipt: issueScreenshotAnalysisReceiptMock,
}));

import { POST } from "./route";
import { BackendSessionExpiredError } from "@/lib/backend-session";

function buildRequest(options: {
  ip?: string;
  screenshotOwner?: string;
  workspace?: string;
}) {
  const form = new FormData();
  form.set(
    "image",
    new File([new Uint8Array([1, 2, 3])], "capture.webp", {
      type: "image/webp",
    }),
  );
  form.set("screenshotOwner", options.screenshotOwner ?? "candidate");
  return new NextRequest(
    "http://127.0.0.1:3000/api/captures/screenshot-analysis",
    {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "x-talent-signal-workspace": options.workspace ?? "owner",
        "x-forwarded-for": options.ip ?? "203.0.113.10",
      },
      body: form,
    },
  );
}

function expectBoundedRetryAfter(response: Response) {
  const retryAfter = Number(response.headers.get("retry-after"));
  expect(Number.isInteger(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(retryAfter).toBeLessThanOrEqual(60);
}

async function admitAuthenticatedPrincipal(
  principal: { accountId: string; userId: string },
  attempts: number,
  startIp = 203,
) {
  readBackendSessionClaimsMock.mockResolvedValue({
    backendAccountId: principal.accountId,
    backendUserId: principal.userId,
    backendExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  currentSessionMock.mockResolvedValue({
    account: { id: principal.accountId },
    user: { id: principal.userId },
  });
  for (let index = 0; index < attempts; index += 1) {
    const result = await POST(
      buildRequest({
        ip: `203.0.113.${startIp + index}`,
        workspace: principal.accountId,
      }),
    );
    expect(result.status).toBe(200);
  }
}

// Two full fixed windows per test: the module-level principal budget can never
// leak across tests through fake clock or shared map state.
let clockBase = 1_700_000_000_000;
let currentBase = clockBase;

describe("screenshot analysis route", () => {
  beforeEach(() => {
    clockBase += 120_000;
    currentBase = clockBase;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(currentBase));
    vi.clearAllMocks();
    currentSessionMock.mockResolvedValue({account:{id:"owner"},user:{id:"user"}});
    readBackendSessionClaimsMock.mockResolvedValue({ backendAccountId: "owner", backendUserId: "user", backendExpiresAt: new Date(Date.now()+60000).toISOString() });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: "recruiter" } });
    getScreenshotAnalysisAvailabilityMock.mockReturnValue({
      enabled: true,
      provider: "OpenRouter",
      screenshot_model: "qwen/qwen3-vl-30b-a3b-instruct",
      unavailable_reason: null,
    });
    analyzeScreenshotMock.mockResolvedValue({
      draft: {
        action: null,
        assertions: [],
        captured_at: null,
        disposition: "no_action",
        messages: [],
        platform: "line",
        schema_version: "screenshot-capture.v1",
        transcription_notes: [],
      },
      meta: {
        model: "qwen/qwen3-vl-30b-a3b-instruct",
        prompt_version: "screenshot-evidence.v1",
        provider: "OpenRouter",
        request_id: "provider-request-1",
        source_sha256: "a".repeat(64),
      },
    });
    issueScreenshotAnalysisReceiptMock.mockReturnValue("receipt-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([null, ""])("rejects absent or empty rendered scope before reading private images: %s", async scope => {
    const request = buildRequest({ ip: "203.0.113.97" });
    if (scope === null) request.headers.delete("x-talent-signal-workspace");
    else request.headers.set("x-talent-signal-workspace", scope);
    const readImage = vi.spyOn(request, "formData");
    const result = await POST(request);
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "backend_session_expired" });
    expect(readImage).not.toHaveBeenCalled();
    expect(currentSessionMock).not.toHaveBeenCalled();
    expect(analyzeScreenshotMock).not.toHaveBeenCalled();
    expect(issueScreenshotAnalysisReceiptMock).not.toHaveBeenCalled();
  });

  it("rejects a stale test workspace before image or model processing", async () => {
    const request = buildRequest({ ip: "203.0.113.99" });
    request.headers.set("x-talent-signal-workspace", "old-test-workspace");
    const result = await POST(request);
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "backend_session_expired" });
    expect(analyzeScreenshotMock).not.toHaveBeenCalled();
    expect(issueScreenshotAnalysisReceiptMock).not.toHaveBeenCalled();
  });

  it.each([new BackendSessionExpiredError(), new Error("Backend unavailable")])("does not process a revoked or unverifiable test session", async failure => {
    currentSessionMock.mockRejectedValueOnce(failure);
    const result = await POST(buildRequest({ip:"203.0.113.98"}));
    expect([401,503]).toContain(result.status);
    expect(analyzeScreenshotMock).not.toHaveBeenCalled();
    expect(issueScreenshotAnalysisReceiptMock).not.toHaveBeenCalled();
  });

  it("returns exact non-secret admission codes when screenshot analysis is unavailable", async () => {
    const cases = [
      {
        reason: "ai_disabled",
        expectedMessage: /尚未启用/,
      },
      {
        reason: "sensitive_processing_disabled",
        expectedMessage: /私密截图处理尚未获准/,
      },
      {
        reason: "provider_credentials_missing",
        expectedMessage: /尚未配置凭据/,
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      getScreenshotAnalysisAvailabilityMock.mockReturnValueOnce({
        enabled: false,
        provider: "OpenRouter",
        screenshot_model: "qwen/qwen3-vl-30b-a3b-instruct",
        unavailable_reason: testCase.reason,
      });

      const result = await POST(
        buildRequest({ ip: `203.0.113.${10 + index}` }),
      );

      expect(result.status).toBe(503);
      await expect(result.json()).resolves.toMatchObject({
        code: testCase.reason,
        error: expect.stringMatching(testCase.expectedMessage),
      });
    }
    expect(analyzeScreenshotMock).not.toHaveBeenCalled();
  });

  it("maps provider timeouts to a distinct safe retry response", async () => {
    analyzeScreenshotMock.mockRejectedValueOnce(
      new DOMException("The operation timed out", "TimeoutError"),
    );
    classifyScreenshotAnalysisFailureMock.mockReturnValueOnce(
      "provider_timeout",
    );

    const result = await POST(
      buildRequest({ ip: "203.0.113.21" }),
    );

    expect(result.status).toBe(504);
    await expect(result.json()).resolves.toMatchObject({
      code: "provider_timeout",
      error: expect.stringMatching(/45 秒内未完成/),
    });
  });

  it("maps provider network failures to a distinct safe retry response", async () => {
    analyzeScreenshotMock.mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );
    classifyScreenshotAnalysisFailureMock.mockReturnValueOnce(
      "provider_network_failed",
    );

    const result = await POST(
      buildRequest({ ip: "203.0.113.22" }),
    );

    expect(result.status).toBe(502);
    await expect(result.json()).resolves.toMatchObject({
      code: "provider_network_failed",
      error: expect.stringMatching(/无法连接所选截图分析 Provider/),
    });
  });

  it("logs only closed failure classification and correlation, never raw provider text", async () => {
    analyzeScreenshotMock.mockRejectedValueOnce(
      new Error(
        "provider-body-private-canary with message-private-canary",
      ),
    );
    classifyScreenshotAnalysisFailureMock.mockReturnValueOnce(
      "analysis_failed",
    );

    const result = await POST(buildRequest({ ip: "203.0.113.23" }));

    expect(result.status).toBe(502);
    const logged = JSON.stringify(
      vi.mocked(console.error).mock.calls,
    );
    expect(logged).toContain("analysis_failed");
    expect(logged).toContain("Screenshot analysis failed.");
    expect(logged).not.toContain("provider-body-private-canary");
    expect(logged).not.toContain("message-private-canary");
  });

  it("binds the budget to the admitted account and user, not forwarded headers", async () => {
    for (let index = 0; index < 6; index += 1) {
      const result = await POST(
        buildRequest({ ip: `203.0.113.${40 + index}` }),
      );
      expect(result.status).toBe(200);
    }
    expect(analyzeScreenshotMock).toHaveBeenCalledTimes(6);

    // A new forwarded header variation cannot buy a seventh admission.
    const limited = await POST(buildRequest({ ip: "203.0.113.200" }));
    expect(limited.status).toBe(429);
    expectBoundedRetryAfter(limited);
    await expect(limited.json()).resolves.toMatchObject({
      code: "rate_limited",
    });
    expect(analyzeScreenshotMock).toHaveBeenCalledTimes(6);
    expect(issueScreenshotAnalysisReceiptMock).toHaveBeenCalledTimes(6);
  });

  it("keeps distinct admitted principals on isolated budgets", async () => {
    await admitAuthenticatedPrincipal(
      { accountId: "owner", userId: "user" },
      6,
    );
    const exhausted = await POST(
      buildRequest({ ip: "203.0.113.201", workspace: "owner" }),
    );
    expect(exhausted.status).toBe(429);

    await admitAuthenticatedPrincipal(
      { accountId: "owner-b", userId: "user-b" },
      2,
      50,
    );
    expect(analyzeScreenshotMock).toHaveBeenCalledTimes(8);
  });

  it("counts down a finite Retry-After and restores the budget at the window boundary", async () => {
    // Keep the authenticated session valid across the simulated window.
    readBackendSessionClaimsMock.mockResolvedValue({
      backendAccountId: "owner",
      backendUserId: "user",
      backendExpiresAt: new Date(currentBase + 3_600_000).toISOString(),
    });
    for (let index = 0; index < 6; index += 1) {
      await POST(buildRequest({ ip: `203.0.113.${60 + index}` }));
    }

    vi.setSystemTime(new Date(currentBase + 30_000));
    const midway = await POST(buildRequest({ ip: "203.0.113.202" }));
    expect(midway.status).toBe(429);
    expectBoundedRetryAfter(midway);
    expect(Number(midway.headers.get("retry-after"))).toBe(30);

    vi.setSystemTime(new Date(currentBase + 59_999));
    const boundary = await POST(buildRequest({ ip: "203.0.113.203" }));
    expect(boundary.status).toBe(429);
    expect(Number(boundary.headers.get("retry-after"))).toBe(1);

    vi.setSystemTime(new Date(currentBase + 60_000));
    const reset = await POST(buildRequest({ ip: "203.0.113.204" }));
    expect(reset.status).toBe(200);
    expect(analyzeScreenshotMock).toHaveBeenCalledTimes(7);
  });
});
