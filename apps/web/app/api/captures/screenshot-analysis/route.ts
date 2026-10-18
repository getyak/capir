import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  analyzeScreenshot,
  classifyScreenshotAnalysisFailure,
  getScreenshotAnalysisAvailability,
} from "@/lib/server/screenshot-analysis";
import { issueScreenshotAnalysisReceipt } from "@/lib/server/screenshot-analysis-receipt";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { authenticatedBackendClient, readBackendSessionClaims } from "@/lib/server/backendAuth";
import {
  BackendSessionExpiredError,
  backendSessionIsExpired,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import { SCREENSHOT_OWNER_ROLES } from "@/lib/screenshot-capture";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { createRequestRateLimiter } from "@/lib/server/request-rate-limit";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 6;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Screenshot analysis admits a bounded 6-per-minute budget per verified
 * backend account and user, never caller-supplied forwarding headers: the same
 * authenticated principal cannot buy extra image/model budget by churning IP
 * headers, and distinct accounts stay isolated. The fixed-window map is
 * bounded, evicts expired keys on consume, creates no timers, and is per
 * process only; a multi-process deployment needs its own trusted edge control.
 */
const screenshotRateLimiter = createRequestRateLimiter({
  limit: RATE_LIMIT_REQUESTS,
  windowMs: RATE_LIMIT_WINDOW_MS,
  capacity: 256,
});

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

function boundedFormText(
  value: FormDataEntryValue | null,
  maximum: number,
) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : null;
}

function boundedFormInteger(
  value: FormDataEntryValue | null,
  minimum: number,
  maximum: number,
) {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "请先登录，再分析候选人依据。" },
      { status: 401, headers: noStoreHeaders() },
    );
  }
  if (!isAllowedMutationOrigin(request.headers)) {
    return NextResponse.json(
      { error: "不允许跨源截图分析。" },
      { status: 403, headers: noStoreHeaders() },
    );
  }
  // Authentication, rendered workspace binding, and revocation checks run
  // before any image body, model, or receipt work; only then is the admitted
  // account+user budgeted.
  let admittedRateLimitKey = "";
  try {
    const claims = await readBackendSessionClaims();
    const expectedWorkspace = request.headers.get("x-talent-signal-workspace");
    if (!claims || backendSessionIsExpired(claims.backendExpiresAt)
      || !expectedWorkspace || expectedWorkspace !== claims.backendAccountId) {
      throw new BackendSessionExpiredError();
    }
    const client = await authenticatedBackendClient();
    if (!client) throw new BackendSessionExpiredError();
    try {
      const current = await client.currentSession();
      if (current.account.id !== claims.backendAccountId || current.user.id !== claims.backendUserId) {
        throw new BackendSessionExpiredError();
      }
      admittedRateLimitKey =
        `screenshot-analysis:${current.account.id}:${current.user.id}`;
    } catch (error) {
      if (isBackendSessionExpiredError(error)
        || (error instanceof TalentSignalHttpError && (error.status === 401 || error.status === 403))) {
        throw new BackendSessionExpiredError();
      }
      return NextResponse.json({ error: "暂时无法核验登录空间，未发送截图。请稍后重试。" },
        { status: 503, headers: noStoreHeaders() });
    }
  } catch (error) {
    if (isBackendSessionExpiredError(error)) {
      return NextResponse.json(
        {
          code: "backend_session_expired",
          error:
            "登录空间已变化或会话已过期。未发送或保存来源；请刷新并返回自己的空间后重试。",
        },
        { status: 401, headers: noStoreHeaders() },
      );
    }
    throw error;
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return NextResponse.json(
      { error: "截图请求超过 8 MB。" },
      { status: 413, headers: noStoreHeaders() },
    );
  }
  const rateLimit = screenshotRateLimiter.consume(admittedRateLimitKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error:
          "Screenshot analysis is temporarily rate limited. Try again shortly.",
        code: "rate_limited",
      },
      {
        status: 429,
        headers: {
          ...noStoreHeaders(),
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }
  const availability = getScreenshotAnalysisAvailability();
  if (!availability.enabled) {
    const unavailable = {
      ai_disabled: {
        code: "ai_disabled",
        error:
          "截图分析尚未启用。未发送或保存来源；请让工作区管理员启用 AI 后重试。",
      },
      provider_credentials_missing: {
        code: "provider_credentials_missing",
        error:
          "所选截图分析 Provider 尚未配置凭据。未发送或保存来源；请完成 Provider 配置后重试。",
      },
      sensitive_processing_disabled: {
        code: "sensitive_processing_disabled",
        error:
          "私密截图处理尚未获准。未发送或保存来源；请先启用敏感数据处理许可。",
      },
    }[availability.unavailable_reason ?? "provider_credentials_missing"];
    return NextResponse.json(
      unavailable,
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "无法读取截图表单。" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const image = formData.get("image");
  const contactName =
    boundedFormText(formData.get("contactName"), 160) ??
    "Unbound person — recruiter will bind after review";
  const assignmentLabel =
    boundedFormText(formData.get("assignmentLabel"), 200) ??
    "Unbound relationship — recruiter will bind after review";
  const requestedOwner = boundedFormText(formData.get("screenshotOwner"), 20);
  const screenshotOwner = SCREENSHOT_OWNER_ROLES.find(
    (role) => role === requestedOwner,
  );
  const minimizationSupplied = [
    "cropTopPercent",
    "cropBottomPercent",
    "redactionCount",
  ].some((field) => formData.has(field));
  const cropTopPercent = boundedFormInteger(
    formData.get("cropTopPercent"),
    0,
    90,
  );
  const cropBottomPercent = boundedFormInteger(
    formData.get("cropBottomPercent"),
    10,
    100,
  );
  const redactionCount = boundedFormInteger(
    formData.get("redactionCount"),
    0,
    100,
  );
  const minimizationIsValid =
    cropTopPercent !== null &&
    cropBottomPercent !== null &&
    redactionCount !== null &&
    cropBottomPercent - cropTopPercent >= 10;
  if (
    !(image instanceof File) ||
    !screenshotOwner ||
    (minimizationSupplied && !minimizationIsValid) ||
    !ACCEPTED_IMAGE_TYPES.has(image.type) ||
    image.size <= 0 ||
    image.size > MAX_IMAGE_BYTES
  ) {
    return NextResponse.json(
      {
        error:
          "Choose a JPEG, PNG, or WebP screenshot under 8 MB and identify whose screen it came from.",
      },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  try {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const analysis = await analyzeScreenshot({
      bytes,
      mimeType: image.type as "image/jpeg" | "image/png" | "image/webp",
      contactName,
      assignmentLabel,
      screenshotOwner,
      signal: request.signal,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      ...(minimizationIsValid
        ? {
            preProviderMinimization: {
              crop_bottom_percent: cropBottomPercent,
              crop_top_percent: cropTopPercent,
              prepared_in_browser: true as const,
              redaction_count: redactionCount,
            },
          }
        : {}),
    });
    return NextResponse.json(
      {
        ...analysis,
        receipt: issueScreenshotAnalysisReceipt(analysis),
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (
      request.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return NextResponse.json(
        {
          error: "截图分析已取消，未保存任何来源。",
          code: "analysis_canceled",
        },
        { status: 499, headers: noStoreHeaders() },
      );
    }
    const requestId = randomUUID();
    const failureCode = classifyScreenshotAnalysisFailure(error);
    // Only closed failure classification and correlation are logged: raw error
    // text can carry provider bodies or private screenshot content.
    console.error("Screenshot analysis failed.", {
      requestId,
      model: getScreenshotAnalysisAvailability().screenshot_model,
      code: failureCode,
    });
    return NextResponse.json(
      {
        error:
          failureCode === "provider_timeout"
            ? "云端截图分析在 45 秒内未完成。未保存来源；请检查所选 Provider 的网络或专用代理配置后重试。"
            : failureCode === "provider_network_failed"
              ? "无法连接所选截图分析 Provider。未保存来源；请检查网络或专用代理配置后重试。"
              : "私密截图分析未能完成。capri 没有保存该来源。",
        code: failureCode,
        request_id: requestId,
      },
      {
        status: failureCode === "provider_timeout" ? 504 : 502,
        headers: noStoreHeaders(),
      },
    );
  }
}
