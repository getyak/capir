"use client";

import type {
  McpClientGrant,
  McpEndpointsResponse,
  McpGrantScope,
} from "@talent-signal/contracts";
import { Key, Plus, ShieldCheck, Trash, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";

import { CopyButton, ExtensionDialog } from "./workspace-extensions-dialogs";
import {
  formatTimestamp,
  grantStatusLabel,
  SCOPE_LABEL,
  type Requester,
} from "./workspace-extensions-helpers";
import styles from "./workspace-extensions.module.css";

export function OutboundPanel({
  configured,
  endpoints,
  grants,
  onAdd,
  onReload,
  onRevoke,
  pending,
  reloading,
  snapshotError,
}: {
  configured: boolean;
  endpoints: McpEndpointsResponse;
  grants: McpClientGrant[];
  onAdd: () => void;
  onReload: () => void;
  onRevoke: (grant: McpClientGrant) => void;
  pending: Set<string>;
  reloading: boolean;
  snapshotError: string | null;
}) {
  const emptyAndHealthy = grants.length === 0 && !snapshotError;
  return (
    <section
      aria-label="接入客户端"
      className={styles.panel}
      id="extensions-outbound"
      role="tabpanel"
    >
      <div className={styles.sectionHeading}>
        <h2>已接入客户端</h2>
        {emptyAndHealthy ? null : (
          <div className={styles.headingActions}>
            {snapshotError ? null : <span>{grants.length} 个</span>}
            <button
              className={styles.addButton}
              disabled={!configured || Boolean(snapshotError)}
              onClick={onAdd}
              type="button"
            >
              <Plus aria-hidden="true" size={14} />
              添加客户端
            </button>
          </div>
        )}
      </div>

      {snapshotError ? (
        <div className={styles.error} role="alert">
          <WarningCircle aria-hidden="true" size={18} />
          <div>
            <strong>客户端状态暂时无法读取</strong>
            <p>{snapshotError} 在重试成功前不会创建新的客户端令牌。</p>
            <button disabled={reloading} onClick={onReload} type="button">
              {reloading ? "正在重试…" : "重试"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.endpoint}>
            <ShieldCheck aria-hidden="true" size={17} />
            <div>
              {configured ? (
                <>
                  <strong>Streamable HTTP 地址</strong>
                  <code>{endpoints.streamable_http_url}</code>
                  <small>每个客户端使用独立令牌。</small>
                </>
              ) : (
                <>
                  <strong>接入地址尚未配置</strong>
                  <small>接入地址配置完成后，即可为客户端生成独立令牌。</small>
                </>
              )}
            </div>
          </div>

          {grants.length === 0 ? (
            <div className={styles.empty}>
              <strong>尚未添加客户端</strong>
              <p>令牌只显示一次，可随时单独撤销而不影响其他客户端。</p>
              <button
                className={styles.primary}
                disabled={!configured}
                onClick={onAdd}
                type="button"
              >
                <Plus aria-hidden="true" size={14} />
                添加客户端
              </button>
            </div>
          ) : (
            <ul className={styles.list}>
              {grants.map((grant) => {
                const busy = pending.has(grant.id);
                return (
                  <li
                    className={styles.row}
                    data-status={grant.status}
                    key={grant.id}
                  >
                    <span aria-hidden="true" className={styles.rowIcon}>
                      <Key size={17} />
                    </span>
                    <div className={styles.rowBody}>
                      <div className={styles.rowTitle}>
                        <strong>{grant.name}</strong>
                        <span className={styles.status}>
                          {grantStatusLabel(grant)}
                        </span>
                      </div>
                      <small>
                        令牌 {grant.token_hint} · 到期{" "}
                        {formatTimestamp(grant.expires_at)} · 最近使用{" "}
                        {grant.last_used_at ? formatTimestamp(grant.last_used_at) : "尚未使用"}
                      </small>
                      <small>
                        范围：
                        {grant.scopes
                          .map((scope) => SCOPE_LABEL[scope].label)
                          .join("、")}
                      </small>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        className={styles.quiet}
                        disabled={busy || grant.status === "revoked"}
                        onClick={() => onRevoke(grant)}
                        type="button"
                      >
                        <Trash aria-hidden="true" size={14} />
                        撤销
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={styles.scopeNote}>
            只读提供：工作区信息与（可选）人物目录；不含原文、消息或联系方式。
          </p>
        </>
      )}
    </section>
  );
}

export function AddClientDialog({
  configured,
  onClose,
  onCreated,
  request,
}: {
  configured: boolean;
  onClose: () => void;
  onCreated: (result: {
    endpoint: { configuration_json: string; streamable_http_url: string };
    grant: McpClientGrant;
    token: string;
  }) => void;
  request: Requester;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpGrantScope[]>([
    "workspace_metadata_read",
  ]);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [failure, setFailure] = useState<string | null>(null);

  function toggle(scope: McpGrantScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const payload = (await request("/clients", {
        body: {
          expires_in_days: days,
          idempotency_key: requestKey,
          name: name.trim(),
          scopes,
        },
        method: "POST",
      })) as {
        endpoint: { configuration_json: string; streamable_http_url: string };
        grant: McpClientGrant;
        token: string;
      };
      onCreated(payload);
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "无法创建客户端。");
      setBusy(false);
    }
  }

  return (
    <ExtensionDialog
      dismissible={!busy}
      description="先明确这个客户端能读取的范围，再生成只会显示一次的令牌。"
      footer={
        <>
          <button className={styles.quiet} disabled={busy} onClick={onClose} type="button">
            取消
          </button>
          <button
            className={styles.primary}
            disabled={busy || !name.trim() || scopes.length === 0 || !configured}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? "正在生成…" : "生成令牌"}
          </button>
        </>
      }
      onClose={onClose}
      title="添加 MCP 客户端"
    >
      {!configured ? (
        <p className={styles.dialogError} role="alert">
          当前部署接入地址尚未配置，暂时无法生成令牌。
        </p>
      ) : null}
      <label className={styles.field}>
        <span>客户端名称</span>
        <input
          autoComplete="off"
          autoFocus
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：我的笔记本客户端"
          value={name}
        />
      </label>
      <fieldset className={styles.scopes}>
        <legend>授权范围</legend>
        {(Object.keys(SCOPE_LABEL) as McpGrantScope[]).map((scope) => (
          <label key={scope}>
            <input
              checked={scopes.includes(scope)}
              onChange={() => toggle(scope)}
              type="checkbox"
            />
            <span>
              <strong>{SCOPE_LABEL[scope].label}</strong>
              <small>{SCOPE_LABEL[scope].detail}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className={styles.field}>
        <span>有效期</span>
        <select
          onChange={(event) => setDays(Number.parseInt(event.target.value, 10))}
          value={days}
        >
          <option value={7}>7 天</option>
          <option value={14}>14 天</option>
          <option value={30}>30 天（上限）</option>
        </select>
      </label>
      {failure ? (
        <p className={styles.dialogError} role="alert">
          {failure}
        </p>
      ) : null}
    </ExtensionDialog>
  );
}

export function RevealTokenDialog({
  onClose,
  revealed,
}: {
  onClose: () => void;
  revealed: {
    configuration: string;
    expiresAt: string;
    name: string;
    token: string;
    url: string;
  };
}) {
  return (
    <ExtensionDialog
      dismissible={false}
      description="关闭后无法再次查看。请立即复制到客户端；Talent Signal 只保存令牌哈希。"
      footer={
        <button className={styles.primary} onClick={onClose} type="button">
          我已保存，关闭
        </button>
      }
      onClose={onClose}
      title="令牌只显示一次"
      width="wide"
    >
      <div className={styles.reveal}>
        <small>
          {revealed.name} · 到期 {formatTimestamp(revealed.expiresAt)}
        </small>
        <code className={styles.token}>{revealed.token}</code>
        <CopyButton label="复制令牌" value={revealed.token} />
      </div>
      <div className={styles.reveal}>
        <small>通用 Streamable HTTP 配置</small>
        <pre>{revealed.configuration}</pre>
        <CopyButton label="复制配置" value={revealed.configuration} />
      </div>
      <p className={styles.scopeNote}>
        端点：<code>{revealed.url}</code>。请求头使用 Authorization: Bearer。
        仅支持 Streamable HTTP 传输。
      </p>
    </ExtensionDialog>
  );
}
