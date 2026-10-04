import type {
  McpClientGrant,
  McpConnection,
  McpGrantScope,
} from "@talent-signal/contracts";

export type Direction = "inbound" | "outbound";

export type Requester = (
  path: string,
  init: { body?: unknown; method: "GET" | "POST" | "PUT" },
) => Promise<unknown>;

/** Carries the bounded backend error code so callers can branch on outcomes. */
export class ExtensionRequestError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ExtensionRequestError";
    this.code = code;
    this.status = status;
  }
}

export const STATUS_LABEL: Record<McpConnection["status"], string> = {
  disconnected: "未连接",
  failed: "连接失败",
  unauthorized: "需要授权",
  verified: "已验证",
};

export const SCOPE_LABEL: Record<
  McpGrantScope,
  { detail: string; label: string }
> = {
  people_directory_read: {
    detail: "只读的人物目录投影：姓名、简介与场景名称，不含联系方式。",
    label: "人物目录只读",
  },
  workspace_metadata_read: {
    detail: "工作区名称与活跃人物数量。",
    label: "工作区元数据",
  },
};

/** Locally owned copy. Remote server text is never rendered. */
export function connectionErrorCopy(code: string | null): string | null {
  switch (code) {
    case "MCP_REQUIRES_AUTH":
      return "服务器需要授权。请按连接的授权方式完成 OAuth，或编辑连接并填写 Bearer 密钥。";
    case "MCP_CREDENTIAL_UNAVAILABLE":
      return "当前部署尚未启用凭据存储，无法读取已保存的密钥。请联系管理员。";
    case "MCP_PROTOCOL_UNSUPPORTED":
      return "服务器协商了当前版本不支持的 MCP 协议版本。";
    case "MCP_REDIRECT_REFUSED":
      return "服务器尝试重定向请求，已拒绝。";
    case "MCP_RESPONSE_TOO_LARGE":
      return "服务器响应或工具目录超过允许大小。";
    case "MCP_TOO_MANY_TOOLS":
      return "工具目录超过 100 个工具或 5 页上限，或分页无效。";
    case "MCP_TIMEOUT":
      return "服务器未在 10 秒内响应。";
    case "MCP_DNS_UNAVAILABLE":
      return "服务器域名无法解析为公网地址。";
    case "MCP_RESPONSE_INVALID":
      return "服务器返回了无法解析的 MCP 响应。";
    case "MCP_ENDPOINT_REJECTED":
      return "服务器地址不是可接受的公网 HTTPS 来源。";
    case "MCP_HANDSHAKE_FAILED":
      return "与服务器的握手未能完成。";
    case "MCP_UNAUTHORIZED":
      return "服务器拒绝了提供的密钥。";
    default:
      return null;
  }
}

export function payloadError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as {
      message?: unknown;
      error?: { message?: unknown };
    };
    if (typeof record.error?.message === "string") return record.error.message;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

export function payloadCode(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const record = payload as { code?: unknown; error?: { code?: unknown } };
    if (typeof record.error?.code === "string") return record.error.code;
    if (typeof record.code === "string") return record.code;
  }
  return null;
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "尚未核验";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "尚未核验";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function grantStatusLabel(grant: McpClientGrant): string {
  if (grant.status === "revoked") return "已撤销";
  if (grant.status === "expired") return "已过期";
  return "有效";
}
