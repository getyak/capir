import { NextRequest, NextResponse } from "next/server";
import {
  analyzeWithAi,
  getAiAvailability,
} from "@/lib/server/ai-analysis";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { createRequestRateLimiter } from "@/lib/server/request-rate-limit";

export const runtime = "nodejs";

const MAX_CONVERSATION_LENGTH = 12_000;
const MAX_CONTEXT_LENGTH = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 8;

/**
 * The unauthenticated public demo has no trustworthy per-caller identity:
 * forwarding headers are caller-controlled, so deliberately churning them must
 * not buy extra model budget. Cost isolation therefore uses one bounded GLOBAL
 * process budget (8 per minute) rather than claiming IP-spoof protection. This
 * modest shared budget keeps the synthetic demo available to visitors without a
 * login requirement. The budget is per process only; a public deployment needs
 * its own trusted edge control and must not rely on this as a distributed
 * limiter.
 */
const PUBLIC_DEMO_RATE_LIMIT_KEY = "public-ai-demo:global";
const publicDemoRateLimiter = createRequestRateLimiter({
  limit: RATE_LIMIT_REQUESTS,
  windowMs: RATE_LIMIT_WINDOW_MS,
  capacity: 1,
});

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}

function parseRequestBody(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;
  if (
    typeof body.conversation !== "string" ||
    body.conversation.trim().length === 0 ||
    body.conversation.length > MAX_CONVERSATION_LENGTH ||
    typeof body.candidateContext !== "string" ||
    body.candidateContext.length > MAX_CONTEXT_LENGTH ||
    body.sourceSpeaker !== "candidate"
  ) {
    return null;
  }

  return {
    conversation: body.conversation.trim(),
    candidateContext: body.candidateContext.trim(),
    sourceSpeaker: "candidate" as const,
  };
}

export async function POST(request: NextRequest) {
  if (!getAiAvailability().enabled) {
    return NextResponse.json(
      { error: "AI 分析当前不可用。" },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  if (!isAllowedMutationOrigin(request.headers)) {
    return NextResponse.json(
      { error: "不允许跨源请求。" },
      { status: 403, headers: noStoreHeaders() },
    );
  }

  const rateLimit = publicDemoRateLimiter.consume(PUBLIC_DEMO_RATE_LIMIT_KEY);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "分析请求过多，请稍后重试。" },
      {
        status: 429,
        headers: {
          ...noStoreHeaders(),
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "JSON 请求无效。" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const input = parseRequestBody(body);
  if (!input) {
    return NextResponse.json(
      { error: "请添加更短的对话与有效的候选人背景。" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  try {
    const analysis = await analyzeWithAi(
      input.conversation,
      input.candidateContext,
      input.sourceSpeaker,
    );
    return NextResponse.json(analysis, {
      headers: noStoreHeaders(),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "The private analysis route could not complete. The note was not saved.",
      },
      { status: 502, headers: noStoreHeaders() },
    );
  }
}
