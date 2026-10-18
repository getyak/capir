import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeWithAiMock, getAiAvailabilityMock } = vi.hoisted(() => ({
  analyzeWithAiMock: vi.fn(),
  getAiAvailabilityMock: vi.fn(),
}));

vi.mock("@/lib/server/ai-analysis", () => ({
  analyzeWithAi: analyzeWithAiMock,
  getAiAvailability: getAiAvailabilityMock,
}));

import { POST } from "./route";

const analysis = {
  result: { headline: "synthetic", follow_ups: [] },
  meta: { mode: "ai", model: "synthetic-model", provider: "OpenRouter" },
};

function validBody() {
  return {
    conversation: "synthetic conversation text",
    candidateContext: "synthetic context",
    sourceSpeaker: "candidate",
  };
}

function buildRequest(
  options: {
    origin?: string | null;
    host?: string;
    body?: unknown;
    forwardedFor?: string;
    realIp?: string;
    forwardedProto?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    host: options.host ?? "127.0.0.1:3000",
    "content-type": "application/json",
  };
  if (options.origin !== null) {
    headers.origin = options.origin ?? "http://127.0.0.1:3000";
  }
  if (options.forwardedFor !== undefined) {
    headers["x-forwarded-for"] = options.forwardedFor;
  }
  if (options.realIp !== undefined) {
    headers["x-real-ip"] = options.realIp;
  }
  if (options.forwardedProto !== undefined) {
    headers["x-forwarded-proto"] = options.forwardedProto;
  }
  return new NextRequest("http://127.0.0.1:3000/api/analyze", {
    method: "POST",
    headers,
    body:
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body ?? validBody()),
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
}

// Two full fixed windows per test: the module-level shared demo budget can
// never leak across tests.
let clockBase = 1_700_000_000_000;

beforeEach(() => {
  clockBase += 120_000;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(clockBase));
  vi.clearAllMocks();
  getAiAvailabilityMock.mockReturnValue({
    enabled: true,
    provider: "OpenRouter",
  });
  analyzeWithAiMock.mockResolvedValue(analysis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("public AI analysis admission", () => {
  it("rejects an absent Origin in production before reading the body or calling the model", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = buildRequest({ origin: null });
    const readBody = vi.spyOn(request, "json");
    const result = await POST(request);
    expect(result.status).toBe(403);
    expectNoStore(result);
    expect(readBody).not.toHaveBeenCalled();
    expect(analyzeWithAiMock).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-origin", { origin: "http://attacker.example" }],
    ["malformed", { origin: "not-a-url" }],
    ["protocol-changed", { origin: "https://127.0.0.1:3000" }],
  ])("rejects a %s Origin before reading the body or calling the model", async (_label, options) => {
    const request = buildRequest(options);
    const readBody = vi.spyOn(request, "json");
    const result = await POST(request);
    expect(result.status).toBe(403);
    expectNoStore(result);
    expect(readBody).not.toHaveBeenCalled();
    expect(analyzeWithAiMock).not.toHaveBeenCalled();
  });

  it("allows the same-origin request and forwards only the bounded parsed input", async () => {
    const result = await POST(buildRequest());
    expect(result.status).toBe(200);
    expectNoStore(result);
    await expect(result.json()).resolves.toEqual(analysis);
    expect(analyzeWithAiMock).toHaveBeenCalledWith(
      "synthetic conversation text",
      "synthetic context",
      "candidate",
    );
  });

  it("follows the trusted forwarded-proto boundary for legitimate production HTTPS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await POST(
      buildRequest({
        origin: "https://127.0.0.1:3000",
        forwardedProto: "https",
      }),
    );
    expect(result.status).toBe(200);
    expect(analyzeWithAiMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the disabled-by-default availability gate ahead of any provider work", async () => {
    getAiAvailabilityMock.mockReturnValue({
      enabled: false,
      provider: "OpenRouter",
    });
    const result = await POST(buildRequest());
    expect(result.status).toBe(503);
    expectNoStore(result);
    await expect(result.json()).resolves.toEqual({ error: "AI 分析当前不可用。" });
    expect(analyzeWithAiMock).not.toHaveBeenCalled();
  });

  it("cannot be bypassed by forwarded-header churn: one shared 8/minute budget", async () => {
    for (let index = 0; index < 8; index += 1) {
      const result = await POST(
        buildRequest({
          forwardedFor: `203.0.113.${index}`,
          realIp: `198.51.100.${index}`,
        }),
      );
      expect(result.status).toBe(200);
    }
    const limited = await POST(
      buildRequest({ forwardedFor: "203.0.113.200", realIp: "198.51.100.200" }),
    );
    expect(limited.status).toBe(429);
    expectNoStore(limited);
    await expect(limited.json()).resolves.toEqual({
      error: "分析请求过多，请稍后重试。",
    });
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(analyzeWithAiMock).toHaveBeenCalledTimes(8);
  });

  it("restores the shared budget only after the fixed window resets", async () => {
    for (let index = 0; index < 8; index += 1) {
      await POST(buildRequest({ forwardedFor: `203.0.113.${index}` }));
    }
    await expect(POST(buildRequest())).resolves.toMatchObject({ status: 429 });

    vi.setSystemTime(new Date(clockBase + 59_999));
    await expect(POST(buildRequest())).resolves.toMatchObject({ status: 429 });

    vi.setSystemTime(new Date(clockBase + 60_000));
    const reset = await POST(buildRequest());
    expect(reset.status).toBe(200);
    expect(analyzeWithAiMock).toHaveBeenCalledTimes(9);
  });

  it("rejects invalid and oversized admission without provider work", async () => {
    const invalidJson = await POST(buildRequest({ body: "not-json{" }));
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: "JSON 请求无效。",
    });

    const oversized = await POST(
      buildRequest({
        body: {
          ...validBody(),
          conversation: "x".repeat(12_001),
        },
      }),
    );
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toEqual({
      error: "请添加更短的对话与有效的候选人背景。",
    });

    const wrongSpeaker = await POST(
      buildRequest({
        body: { ...validBody(), sourceSpeaker: "recruiter" },
      }),
    );
    expect(wrongSpeaker.status).toBe(400);
    expect(analyzeWithAiMock).not.toHaveBeenCalled();
  });
});
