"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  McpInteractionKind,
  McpInteractionRequest,
  McpInteractionState,
  McpToolCallReceipt,
} from "@talent-signal/contracts";

import { workspaceSessionFetch } from "../workspace-session-request";
import { mcpIntentIdentity, workspaceIntentScope } from "./mcp-intent";
import styles from "./mcp.module.css";

/**
 * The shared durable MCP request card.
 *
 * A typed renderer registry maps every human-participation kind (approval,
 * choice, form, secret, oauth) onto one restrained accessible card sharing a
 * single lifecycle/transport hook. Every read and action goes through the
 * real workspace session request (account scope plus the exact
 * `x-workspace-session` binding the BFF requires). The card reloads the
 * canonical request on mount and after every action; when the canonical read
 * fails the card is visibly "not loaded" and every decision that needs the
 * current revision is disabled instead of trusting a stale snapshot. A secret
 * plaintext is only held for submission and cleared in `finally`. The backend
 * saves encrypted connection credentials for reuse; plaintext never enters
 * conversation history, audit records, or model input.
 */

export const MCP_INTERACTION_STATE_LABELS: Record<McpInteractionState, string> = {
  waiting: "进行中",
  pending: "等待确认",
  submitting: "提交中",
  submitted: "已确认",
  expired: "已过期",
  rejected: "已拒绝",
  failed: "未完成",
  unknown: "结果未知",
};

export const MCP_INTERACTION_KIND_LABELS: Record<McpInteractionKind, string> = {
  approval: "工具调用确认",
  choice: "选择",
  form: "连接表单",
  secret: "密钥确认",
  oauth: "OAuth 授权",
};

const TERMINAL_STATES = new Set<McpInteractionState>([
  "submitted",
  "expired",
  "rejected",
  "failed",
  "unknown",
]);

function headers(sessionVersion: string, json = false): Record<string, string> {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    "x-workspace-session": sessionVersion,
  };
}

export interface McpRequestState {
  busy: boolean;
  error: string | null;
  loaded: boolean;
  request: McpInteractionRequest | null;
  refresh: () => Promise<void>;
  resolve: (payload: Record<string, unknown>) => Promise<void>;
  act: (payload: Record<string, unknown>) => Promise<void>;
}

export function useMcpRequest(
  requestId: string,
  sessionVersion: string,
  onDecisionState?: (state: McpInteractionState) => void,
): McpRequestState {
  const [request, setRequest] = useState<McpInteractionRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const scope = workspaceIntentScope(sessionVersion);
  const canonicalReady = loaded && loadedScope === `${scope}:${requestId}`;

  const refresh = useCallback(async () => {
    try {
      const response = await workspaceSessionFetch(
        `/api/extensions/interactions/${requestId}`,
        { cache: "no-store", headers: headers(sessionVersion) },
      );
      if (!response.ok) {
        setLoaded(false);
        setRequest(null);
        setError("无法加载这条请求的最新状态。请刷新后重试；在加载成功前不会执行任何操作。");
        return;
      }
      const body = (await response.json()) as { request?: McpInteractionRequest };
      if (!body.request) {
        setLoaded(false);
        setError("无法加载这条请求的最新状态。");
        return;
      }
      setRequest(body.request);
      setLoaded(true);
      setLoadedScope(`${scope}:${requestId}`);
      setError(null);
      onDecisionState?.(body.request.state);
    } catch {
      setLoaded(false);
      setRequest(null);
      setError("网络异常，这条请求的最新状态未加载。决策按钮已停用。");
    }
  }, [onDecisionState, requestId, scope, sessionVersion]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await workspaceSessionFetch(
          `/api/extensions/interactions/${requestId}`,
          { cache: "no-store", headers: headers(sessionVersion) },
        );
        if (!response.ok) {
          setLoaded(false);
          setError("无法加载这条请求的最新状态。请刷新后重试；在加载成功前不会执行任何操作。");
          return;
        }
        const body = (await response.json()) as { request?: McpInteractionRequest };
        if (!body.request) {
          setLoaded(false);
          setError("无法加载这条请求的最新状态。");
          return;
        }
        setRequest(body.request);
        setLoaded(true);
        setLoadedScope(`${scope}:${requestId}`);
        onDecisionState?.(body.request.state);
      } catch {
        setLoaded(false);
        setError("网络异常，这条请求的最新状态未加载。决策按钮已停用。");
      }
    })();
  }, [onDecisionState, requestId, scope, sessionVersion]);

  const resolve = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!canonicalReady || !request || busy || workspaceIntentScope(sessionVersion) !== scope) return;
      setBusy(true);
      try {
        const current = request;
        const identity = await mcpIntentIdentity(scope, `resolve:${requestId}:${current.revision}`, payload);
        const key = keys.current.get(identity) ?? `web-resolve-${crypto.randomUUID()}`;
        keys.current.set(identity, key);
        // Retry identity binds owner scope, request revision and exact input.
        // Changed choices, parameters or credentials start a distinct intent.
        const response = await workspaceSessionFetch(
          `/api/extensions/interactions/${requestId}/resolve`,
          {
            body: JSON.stringify({
              expected_revision: current?.revision ?? 1,
              idempotency_key: key,
              ...payload,
            }),
            headers: headers(sessionVersion, true),
            method: "POST",
          },
        );
        if (!response.ok) {
          await refresh();
          setError("未能确认这次操作的结果。请查看卡片最新状态；结果未知时不会自动重试。");
          return;
        }
        keys.current.delete(identity);
        const body = (await response.json()) as { request?: McpInteractionRequest };
        if (body.request) {
          setRequest(body.request);
          setLoaded(true);
        setLoadedScope(`${scope}:${requestId}`);
          setError(null);
          onDecisionState?.(body.request.state);
        } else {
          await refresh();
        }
      } catch {
        // A thrown network call leaves the outcome unknown; say so visibly and
        // never auto-retry the effect.
        await refresh();
        setError("网络异常，无法确认这次操作是否生效。请刷新查看当前状态；不会自动重试。");
      } finally {
        setBusy(false);
      }
    },
    [busy, canonicalReady, onDecisionState, refresh, request, requestId, scope, sessionVersion],
  );

  return { act: resolve, busy, error, loaded: canonicalReady, refresh, request: canonicalReady ? request : null, resolve };
}

function displayArguments(request: McpInteractionRequest): Record<string, unknown> {
  try {
    const parsed = JSON.parse(request.arguments_display) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface RendererContext {
  state: McpRequestState;
  secret: string;
  setSecret: (value: string) => void;
  friendlyName: string;
  setFriendlyName: (value: string) => void;
}

type KindRenderer = (
  request: McpInteractionRequest,
  context: RendererContext,
) => React.ReactNode;

/** Decode only the bounded MCP text envelope. Remote text remains inert React text. */
function receiptPreview(receipt: McpToolCallReceipt): string {
  for (const candidate of [receipt.result_json, receipt.result_summary]) {
    if (!candidate || candidate.length > 24_000) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { content?: unknown }).content)) continue;
      const text = (parsed as { content: unknown[] }).content.slice(0, 100).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const block = item as { type?: unknown; text?: unknown };
        return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
      }).join("\n\n");
      if (text) return text.length > 1_200 ? `${text.slice(0, 1_200)}…` : text;
    } catch {
      // Plain text, errors and incomplete JSON keep their original display.
    }
  }
  const fallback = receipt.result_summary ?? receipt.result_json ?? receipt.error_code ?? "暂无结果摘要";
  return fallback.length > 1_200 ? `${fallback.slice(0, 1_200)}…` : fallback;
}

const ApprovalRenderer: KindRenderer = (request) => (
  <>
    <pre className={styles.args}>{request.arguments_display.slice(0, 2_000)}</pre>
    {request.receipt ? (
      <div className={styles.receipt}>
        <strong>
          结果（{request.receipt.outcome === "succeeded" ? "成功" : request.receipt.outcome === "outcome_unknown" ? "结果未知" : "失败"}）
        </strong>
        <pre className={styles.receiptPreview}>{receiptPreview(request.receipt)}</pre>
        <details><summary>查看结果与来源</summary>
          <p className={styles.hint}>{request.receipt.server_origin} · {request.receipt.tool_name} · {request.receipt.executed_at ?? "尚未执行"}</p>
          <p className={styles.hint}>call_id · {request.receipt.call_id}</p>
          {request.receipt.error_code ? <p className={styles.notice}>{request.receipt.error_code}</p> : null}
          {request.receipt.result_json ? <pre>{request.receipt.result_json.slice(0, 24_000)}</pre> : null}
        </details>
      </div>
    ) : null}
  </>
);

const ChoiceRenderer: KindRenderer = (request, context) => (
  <ul className={styles.choices}>
    {request.choices.map((option) => (
      <li key={option.id}>
        <button
          className={styles.secondary}
          disabled={!context.state.loaded || context.state.busy || request.state !== "pending"}
          onClick={() => void context.state.resolve({ action: "submit", choice_id: option.id })}
          type="button"
        >
          {option.label}
        </button>
        {option.description ? <span className={styles.hint}>{option.description}</span> : null}
      </li>
    ))}
  </ul>
);

const FormRenderer: KindRenderer = (request, context) => {
  const values = displayArguments(request);
  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>名称</span>
        <input
          disabled={context.state.busy || TERMINAL_STATES.has(request.state)}
          maxLength={80}
          onChange={(event) => context.setFriendlyName(event.target.value)}
          value={context.friendlyName || String(values.friendly_name ?? request.target.connection_label)}
        />
      </label>
      <label className={styles.field}>
        <span>服务地址</span>
        <input disabled readOnly value={String(values.server_url ?? request.target.server_origin)} />
      </label>
    </div>
  );
};

const SecretRenderer: KindRenderer = (request, context) => (
  <div className={styles.form}>
    {FormRenderer(request, context)}
    <label className={styles.field}>
      <span>访问密钥</span>
      <input
        autoComplete="new-password"
        disabled={context.state.busy || TERMINAL_STATES.has(request.state)}
        onChange={(event) => context.setSecret(event.target.value)}
        type="password"
        value={context.secret}
      />
      <span className={styles.hint}>
        密钥只用于这一次输入。连接保存的是加密后的凭据，供后续调用使用；密钥本身不会回显，模型和对话内容永远不会看到它。
      </span>
    </label>
  </div>
);

const OAuthRenderer: KindRenderer = (request, context) => (
  <div className={styles.form}>
    {context.state.loaded && !context.state.busy && !TERMINAL_STATES.has(request.state) && Date.parse(request.expires_at) > Date.now() && request.oauth?.available && request.oauth.connect_url ? (
      <a className={styles.primary} href={request.oauth.connect_url} rel="noreferrer" target="_blank">
        前往授权（{request.oauth.provider}）
      </a>
    ) : (
      <p className={styles.hint}>
        {!context.state.loaded || context.state.busy ? "正在核验状态，授权入口暂时停用。" : TERMINAL_STATES.has(request.state) ? "这条授权请求已结束。" : Date.parse(request.expires_at) <= Date.now() ? "授权请求已过期，请刷新状态。" : "此部署尚未配置 OAuth，暂时无法通过授权连接。"}
      </p>
    )}
  </div>
);

/** The typed kind → renderer registry shared by every surface. */
export const MCP_REQUEST_RENDERERS: Record<McpInteractionKind, KindRenderer> = {
  approval: ApprovalRenderer,
  choice: ChoiceRenderer,
  form: FormRenderer,
  oauth: OAuthRenderer,
  secret: SecretRenderer,
};

export interface McpRequestCardProps {
  requestId: string;
  sessionVersion: string;
  /** Last known state, used only until the canonical read lands. */
  fallback?: { kind: McpInteractionKind; state: McpInteractionState; purpose: string };
  onDecisionState?: (state: McpInteractionState) => void;
  disabled?: boolean;
}

export function McpRequestCard(props: McpRequestCardProps) {
  return <McpRequestCardContent key={`${workspaceIntentScope(props.sessionVersion)}:${props.requestId}`} {...props} />;
}

function McpRequestCardContent({
  requestId,
  sessionVersion,
  fallback,
  onDecisionState,
  disabled = false,
}: McpRequestCardProps) {
  const [secret, setSecret] = useState("");
  const [friendlyName, setFriendlyName] = useState("");
  const state = useMcpRequest(requestId, sessionVersion, onDecisionState);
  const { request, refresh, resolve } = state;

  const kind = request?.kind ?? fallback?.kind ?? "approval";
  const currentState = request?.state ?? fallback?.state ?? "pending";
  const purpose = request?.purpose ?? fallback?.purpose ?? "";

  // Bounded OAuth polling: visible nonterminal OAuth requests poll the
  // canonical poll route (and on focus) until they settle; no webhook is
  // assumed to exist. Polling stops at terminal state, expiry or unmount.
  const oauthActive =
    kind === "oauth" &&
    !disabled && state.loaded &&
    Boolean(request?.oauth?.available) &&
    !TERMINAL_STATES.has(currentState);
  const connectRequestId = request?.oauth?.connect_request_id ?? null;
  useEffect(() => {
    if (!oauthActive || !connectRequestId || !sessionVersion) return undefined;
    // Bounded by the request expiry as well as the terminal state.
    if (!(Date.parse(request?.expires_at ?? "") > Date.now())) return undefined;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const response = await workspaceSessionFetch(
          `/api/extensions/oauth/poll/${connectRequestId}`,
          {
            headers: headers(sessionVersion, true),
            method: "POST",
            body: "{}",
          },
        );
        if (stopped) return;
        if (response.ok) {
          const body = (await response.json()) as { request?: McpInteractionRequest };
          if (body.request && !stopped) {
            await refresh();
          }
        }
      } catch {
        // A failed poll is shown through the canonical read; polling continues
        // until terminal state or unmount.
      }
    };
    const timer = setInterval(() => void poll(), 5_000);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [connectRequestId, oauthActive, refresh, request?.expires_at, sessionVersion]);

  const actAndClear = async (payload: Record<string, unknown>) => {
    try {
      await resolve(payload);
    } finally {
      // Clear plaintext input even if submission fails; encrypted reuse is backend-owned.
      setSecret("");
    }
  };

  const renderer = MCP_REQUEST_RENDERERS[kind] ?? MCP_REQUEST_RENDERERS.approval;
  const target = request?.target;
  const decisionsDisabled = disabled || !state.loaded || state.busy;

  return (
    <section aria-label={`MCP 请求：${MCP_INTERACTION_KIND_LABELS[kind]}`} className={styles.card}>
      <header className={styles.cardHeader}>
        <span className={styles.kindTag}>{MCP_INTERACTION_KIND_LABELS[kind]}</span>
        <span aria-live="polite" className={TERMINAL_STATES.has(currentState) ? styles.stateSettled : styles.stateOpen}>
          {MCP_INTERACTION_STATE_LABELS[currentState]}
        </span>
      </header>
      <p className={styles.purpose}>{purpose}</p>
      {target ? (
        <p className={styles.target}>
          <span>{target.connection_label}</span>
          <code className={styles.endpoint}>{target.server_origin}</code>
          {target.tool_name ? <code className={styles.tool}>tool · {target.tool_name}</code> : null}
        </p>
      ) : null}

      {!state.loaded ? (
        <p className={styles.notice} role="alert">
          {state.error ?? "正在读取最新状态……"}
        </p>
      ) : (
        request && renderer(request, { friendlyName, secret, setFriendlyName, setSecret, state: { ...state, loaded: state.loaded && !disabled, busy: state.busy || disabled } })
      )}
      {state.loaded && state.error ? (
        <p className={styles.notice} role="alert">
          {state.error}
        </p>
      ) : null}

      {state.loaded && request && currentState === "pending" ? (
        <footer className={styles.actions}>
          {kind === "approval" ? (
            <button
              className={styles.primary}
              disabled={decisionsDisabled}
              onClick={() => void actAndClear({ action: "approve" })}
              type="button"
            >
              确认执行
            </button>
          ) : null}
          {kind === "oauth" ? (
            <button
              className={styles.primary}
              disabled={decisionsDisabled}
              onClick={() => void actAndClear({ action: "approve" })}
              type="button"
            >
              开始授权
            </button>
          ) : null}
          {kind === "form" ? (
            <button
              className={styles.primary}
              disabled={decisionsDisabled}
              onClick={() =>
                void actAndClear({
                  action: "approve",
                  values: JSON.stringify({ friendly_name: friendlyName || String(displayArguments(request).friendly_name ?? request.target.connection_label) }),
                })
              }
              type="button"
            >
              确认添加
            </button>
          ) : null}
          {kind === "secret" ? (
            <button
              className={styles.primary}
              disabled={decisionsDisabled || !secret}
              onClick={() =>
                void actAndClear({
                  action: "submit",
                  secret,
                  values: JSON.stringify({ friendly_name: friendlyName || String(displayArguments(request).friendly_name ?? request.target.connection_label) }),
                })
              }
              type="button"
            >
              确认并连接
            </button>
          ) : null}
          <button
            className={styles.secondary}
            disabled={decisionsDisabled}
            onClick={() => void actAndClear({ action: "reject" })}
            type="button"
          >
            拒绝
          </button>
        </footer>
      ) : (
        <footer className={styles.actions}>
          <button className={styles.secondary} disabled={state.busy} onClick={() => void refresh()} type="button">
            刷新状态
          </button>
        </footer>
      )}
    </section>
  );
}
