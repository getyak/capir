"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  McpDirectoryEntry,
  McpInteractionRequest,
  McpConnection,
} from "@talent-signal/contracts";

import { workspaceSessionFetch } from "../workspace-session-request";
import { McpToolForm } from "./mcp-tool-form";
import { mcpIntentIdentity, workspaceIntentScope } from "./mcp-intent";
import { STATUS_LABEL, connectionErrorCopy } from "../workspace-extensions-helpers";
import { McpRequestCard } from "./mcp-request-card";
import styles from "./mcp.module.css";

/**
 * The Extensions directory and connected-tool inspector.
 *
 * Every entry is a real official remote service with its exact verified
 * domain. Adding an entry stages the same durable human request as any other
 * connection — never a dummy success — and the inspector's call path stages an
 * exact tool-call approval through the same route, with results shown as
 * receipts with provenance.
 */

function sessionHeaders(sessionVersion: string, json = false): Record<string, string> {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    "x-workspace-session": sessionVersion,
  };
}

async function getJson<T>(path: string, sessionVersion: string): Promise<T | null> {
  try {
    const response = await workspaceSessionFetch(path, {
      cache: "no-store",
      headers: sessionHeaders(sessionVersion),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(path: string, payload: unknown, sessionVersion: string): Promise<T | null> {
  try {
    const response = await workspaceSessionFetch(path, {
      body: JSON.stringify(payload),
      headers: sessionHeaders(sessionVersion, true),
      method: "POST",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const AUTH_LABELS = {
  anonymous: "免登录",
  bearer: "访问密钥",
  oauth: "OAuth 授权",
} as const;

export function McpDirectoryPanel({ sessionVersion, refreshVersion = 0, onEdit, onDisconnect }: {
  sessionVersion: string; refreshVersion?: number;
  onEdit?: (connection: McpConnection) => void;
  onDisconnect?: (connection: McpConnection) => void;
}) {
  const [entries, setEntries] = useState<McpDirectoryEntry[]>([]);
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [requests, setRequests] = useState<McpInteractionRequest[]>([]);
  const [staged, setStaged] = useState<McpInteractionRequest | null>(null);
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const keys = useRef(new Map<string, string>());
  const loadSequence = useRef(0);
  const scope = workspaceIntentScope(sessionVersion);
  const readyBinding = `${scope}:${refreshVersion}`;
  const ready = readyScope === readyBinding && !loading;
  const intentKey = (identity: string) => {
    const existing = keys.current.get(identity);
    if (existing) return existing;
    const key = `web-${crypto.randomUUID()}`;
    keys.current.set(identity, key);
    return key;
  };
  const finishIntent = (identity: string) => keys.current.delete(identity);
  const [notice, setNotice] = useState<string | null>(null);
  const [custom, setCustom] = useState({ auth_mode: "anonymous", friendly_name: "", server_url: "" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setReadyScope(null);
    const [directory, oauth, connectionList, interactionList] = await Promise.all([
      getJson<{ entries: McpDirectoryEntry[] }>("/api/extensions/directory", sessionVersion),
      getJson<{ available: boolean }>("/api/extensions/oauth/availability", sessionVersion),
      getJson<{ connections: McpConnection[] }>("/api/extensions/connections", sessionVersion),
      getJson<{ requests: McpInteractionRequest[] }>("/api/extensions/interactions", sessionVersion),
    ]);
    if (sequence !== loadSequence.current) return;
    setLoading(false);
    if (!Array.isArray(directory?.entries) || typeof oauth?.available !== "boolean" ||
        !Array.isArray(connectionList?.connections) || !Array.isArray(interactionList?.requests)) {
      setNotice("无法读取完整的连接状态。操作已停用，请重新加载；登录已变化时请重新登录。");
      return;
    }
    setEntries(directory.entries);
    setOauthAvailable(oauth.available);
    setConnections(connectionList.connections);
    setRequests(interactionList.requests);
    setReadyScope(readyBinding);
    setNotice(null);
  }, [readyBinding, sessionVersion]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    return () => { cancelled = true; loadSequence.current += 1; };
  }, [refresh, refreshVersion]);

  const onDecisionState = useCallback((state: McpInteractionRequest["state"]) => {
    if (["submitted", "rejected", "expired", "failed", "unknown"].includes(state)) void refresh();
  }, [refresh]);

  const stageAdd = async (input: {
    auth_mode: string;
    directory_entry_id?: string;
    friendly_name: string;
    server_url: string;
  }) => {
    if (busy || !ready || workspaceIntentScope(sessionVersion) !== scope) return;
    setBusy(true);
    setNotice(null);
    try {
      const identity = await mcpIntentIdentity(scope, "add", input);
      const stagedRequest = await postJson<{ request: McpInteractionRequest }>(
        "/api/extensions/interactions/propose-connection",
        {
          auth_mode: input.auth_mode,
          ...(input.directory_entry_id ? { directory_entry_id: input.directory_entry_id } : {}),
          friendly_name: input.friendly_name,
          idempotency_key: intentKey(identity),
          purpose: `添加 ${input.friendly_name} 的远程 MCP 服务。`,
          server_url: input.server_url,
        },
        sessionVersion,
      );
      if (stagedRequest) {
        finishIntent(identity);
        setStaged(stagedRequest.request);
        await refresh();
      } else {
        setNotice("连接请求没有建立。地址需要是公开 HTTPS 端点，请检查后重试。");
      }
    } catch {
      setNotice("请求未完成。请重新加载状态后重试。");
    } finally {
      setBusy(false);
    }
  };

  // Each tool row owns its own form and its own deliberate call intent, so
  // the second tool's button can never stage the first tool's arguments.
  const stageCall = async (connection: McpConnection, toolName: string, args: string) => {
    if (busy || !ready || workspaceIntentScope(sessionVersion) !== scope) return;
    setBusy(true);
    setNotice(null);
    try {
      const identity = await mcpIntentIdentity(scope, "call", [connection.id, connection.revision, toolName, args]);
      const stagedRequest = await postJson<{ request: McpInteractionRequest }>(
        "/api/extensions/interactions/propose-call",
        {
          arguments: args,
          connection_id: connection.id,
          idempotency_key: intentKey(identity),
          purpose: `调用 ${connection.friendly_name} 的 ${toolName}。`,
          tool_name: toolName,
        },
        sessionVersion,
      );
      if (stagedRequest) {
        finishIntent(identity);
        setStaged(stagedRequest.request);
        await refresh();
      } else {
        setNotice("这次调用请求没有建立。请检查工具参数是否符合它的输入结构。");
      }
    } catch {
      setNotice("请求未完成。请重新加载状态后重试。");
    } finally {
      setBusy(false);
    }
  };

  const verifyConnection = async (connection: McpConnection) => {
    if (busy || !ready || workspaceIntentScope(sessionVersion) !== scope) return;
    setBusy(true);
    setNotice(null);
    try {
      const identity = await mcpIntentIdentity(scope, "verify", [connection.id, connection.revision]);
      const updated = await postJson<{ connection: McpConnection }>(
        `/api/extensions/connections/${connection.id}/connect`,
        { expected_revision: connection.revision, idempotency_key: intentKey(identity) },
        sessionVersion,
      );
      if (updated) {
        finishIntent(identity);
        await refresh();
      } else {
        setNotice("连接检查没有完成，服务仍保持原状态。");
      }
    } catch {
      setNotice("请求未完成。请重新加载状态后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="连接服务" aria-labelledby="extensions-tab-inbound" id="extensions-inbound" role="tabpanel" className={styles.directory}>
      <div className={styles.sectionHeading}><div><h2>连接常用服务</h2><p className={styles.summary}>选择服务或添加自己的 MCP，确认后完成连接。</p></div><button className={styles.secondary} disabled={loading || busy} onClick={() => void refresh()} type="button">{loading ? "正在加载…" : "重新加载"}</button></div>
      {notice ? (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      ) : null}

      <div className={styles.directoryGrid}>
        {entries.map((entry) => {
          const oauthBlocked = entry.auth_mode === "oauth" && oauthAvailable === false;
          return (
            <article className={styles.entry} key={entry.id}>
              <h3>{entry.name}</h3>
              <span className={styles.domain}>{entry.verified_domain}</span>
              <p className={styles.summary}>{({ context7: "查询最新的开发库文档与示例。", deepwiki: "了解开源仓库的结构、文档与实现。", notion: "连接自己的 Notion 工作区，按授权访问页面。", linear: "连接自己的 Linear 工作区，查询任务与项目。" } as Record<string, string>)[entry.id] ?? entry.summary}</p>
              <p className={styles.authState}>
                <span>{AUTH_LABELS[entry.auth_mode]}</span>
                {oauthBlocked ? (
                  <span className={styles.authUnavailable}>OAuth 暂未配置，无法授权</span>
                ) : null}
              </p>
              <button
                className={styles.primary}
                disabled={!ready || busy || oauthBlocked}
                onClick={() =>
                  void stageAdd({
                    auth_mode: entry.auth_mode,
                    directory_entry_id: entry.id,
                    friendly_name: entry.name,
                    server_url: entry.server_url,
                  })
                }
                type="button"
              >
                添加连接
              </button>
            </article>
          );
        })}
      </div>

      <details className={styles.custom}><summary>添加自己的 MCP</summary><form
        className={styles.entry}
        onSubmit={(event) => {
          event.preventDefault();
          void stageAdd({ ...custom });
        }}
      >
        <fieldset disabled={!ready || busy} className={styles.fieldset}><legend className={styles.visuallyHidden}>自定义连接</legend>
        <label className={styles.field}>
          <span>名称</span>
          <input
            maxLength={80}
            onChange={(event) => setCustom((current) => ({ ...current, friendly_name: event.target.value }))}
            required
            value={custom.friendly_name}
          />
        </label>
        <label className={styles.field}>
          <span>服务地址（HTTPS 端点）</span>
          <input
            maxLength={2048}
            onChange={(event) => setCustom((current) => ({ ...current, server_url: event.target.value }))}
            required
            type="url"
            value={custom.server_url}
          />
        </label>
        <label className={styles.field}>
          <span>授权方式</span>
          <select
            className={styles.select}
            onChange={(event) =>
              setCustom((current) => ({ ...current, auth_mode: event.target.value }))
            }
            value={custom.auth_mode}
          >
            <option value="anonymous">免登录</option>
            <option value="bearer">访问密钥</option>
            <option value="oauth" disabled={oauthAvailable === false}>
              OAuth 授权{oauthAvailable === false ? "（暂未配置）" : ""}
            </option>
          </select>
        </label>
        <button className={styles.primary} type="submit">
          提交连接请求
        </button>
        </fieldset>
      </form></details>

      <h2>已连接的服务</h2>
      {connections.length === 0 && ready ? (
        <p className={styles.hint}>还没有连接任何远程 MCP 服务。</p>
      ) : (
        connections.map((connection) => (
          <article className={styles.entry} key={connection.id}>
            <h3>{connection.friendly_name}</h3>
            <span className={styles.domain}>{connection.server_url}</span>
            <p className={styles.authState}>
              <span>{AUTH_LABELS[connection.auth_mode]}</span>
              <span>{STATUS_LABEL[connection.status]}</span>
              <span>{connection.tools_count} 个工具</span>
            </p>
            {connection.status !== "verified" && (connectionErrorCopy(connection.last_error_code) ?? connection.last_error_message) ? <p className={styles.notice} role="status">{connectionErrorCopy(connection.last_error_code) ?? connection.last_error_message}</p> : null}
            <div className={styles.actions}>
              <button className={styles.secondary} disabled={!ready || busy} onClick={() => void verifyConnection(connection)} type="button">
                {connection.status === "verified" ? "重新检查连接" : "检查连接"}
              </button>
              {onEdit ? <button className={styles.secondary} disabled={!ready || busy} onClick={() => onEdit(connection)} type="button">编辑</button> : null}
              {onDisconnect ? <button className={styles.secondary} disabled={!ready || busy || connection.status === "disconnected"} onClick={() => onDisconnect(connection)} type="button">断开</button> : null}
            </div>
            {connection.tools.map((tool) => (
              <details className={styles.toolRow} key={tool.name}>
                <summary>
                  {tool.name}
                  {tool.read_only ? " · 只读标注（不构成授权）" : ""}
                </summary>
                <p className={styles.summary}>{tool.description}</p>
                <McpToolForm key={`${scope}:${connection.revision}:${tool.name}`} tool={tool} disabled={!ready || busy || connection.status !== "verified"} onSubmit={(args) => stageCall(connection, tool.name, args)} />
              </details>
            ))}
          </article>
        ))
      )}

      <h2>请求与结果</h2>
      {[...(staged && !requests.some((request) => request.id === staged.id) ? [staged] : []), ...requests].length === 0 && ready ? (
        <p className={styles.hint}>暂无待处理或最近的请求。</p>
      ) : (
        [...(staged && !requests.some((request) => request.id === staged.id) ? [staged] : []), ...requests].slice(0, 12).map((request) => (
          <McpRequestCard
            fallback={{ kind: request.kind, purpose: request.purpose, state: request.state }}
            key={request.id}
            requestId={request.id}
            sessionVersion={sessionVersion}
            onDecisionState={onDecisionState}
            disabled={!ready || busy}
          />
        ))
      )}
    </section>
  );
}

