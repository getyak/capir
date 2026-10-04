"use client";

import type { McpConnection } from "@talent-signal/contracts";
import {
  ArrowClockwise,
  LinkSimple,
  PencilSimple,
  Plus,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState } from "react";

import { mcpIntentIdentity, workspaceIntentScope } from "./mcp/mcp-intent";
import { ExtensionDialog } from "./workspace-extensions-dialogs";
import {
  connectionErrorCopy,
  ExtensionRequestError,
  formatTimestamp,
  STATUS_LABEL,
  type Requester,
} from "./workspace-extensions-helpers";
import styles from "./workspace-extensions.module.css";

export function InboundPanel({
  connections,
  onAdd,
  onConnect,
  onDisconnect,
  onEdit,
  onReload,
  pending,
  reloading,
  snapshotError,
}: {
  connections: McpConnection[];
  onAdd: () => void;
  onConnect: (connection: McpConnection) => void;
  onDisconnect: (connection: McpConnection) => void;
  onEdit: (connection: McpConnection) => void;
  onReload: () => void;
  pending: Set<string>;
  reloading: boolean;
  snapshotError: string | null;
}) {
  const emptyAndHealthy = connections.length === 0 && !snapshotError;
  return (
    <section
      aria-label="连接服务"
      className={styles.panel}
      id="extensions-inbound"
      role="tabpanel"
    >
      <div className={styles.sectionHeading}>
        <h2>当前连接</h2>
        {emptyAndHealthy ? null : (
          <div className={styles.headingActions}>
            {snapshotError ? null : <span>{connections.length} 个</span>}
            <button className={styles.addButton} disabled={Boolean(snapshotError)} onClick={onAdd} type="button">
              <Plus aria-hidden="true" size={14} />
              添加
            </button>
          </div>
        )}
      </div>

      {snapshotError ? (
        <div className={styles.error} role="alert">
          <WarningCircle aria-hidden="true" size={18} />
          <div>
            <strong>连接状态暂时无法读取</strong>
            <p>{snapshotError}</p>
            <button disabled={reloading} onClick={onReload} type="button">
              {reloading ? "正在重试…" : "重试"}
            </button>
          </div>
        </div>
      ) : connections.length === 0 ? (
        <div className={styles.empty}>
          <strong>还没有连接外部服务</strong>
          <p>添加 HTTPS 地址后，握手成功才会标记为已验证。</p>
          <button className={styles.primary} onClick={onAdd} type="button">
            <Plus aria-hidden="true" size={14} />
            添加连接
          </button>
        </div>
      ) : (
        <ul className={styles.list}>
          {connections.map((connection) => {
            const busy = pending.has(connection.id);
            const statusMessage =
              connectionErrorCopy(connection.last_error_code) ??
              connection.last_error_message;
            return (
              <li
                className={styles.row}
                data-status={connection.status}
                key={connection.id}
              >
                <span aria-hidden="true" className={styles.rowIcon}>
                  <LinkSimple size={17} />
                </span>
                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>
                    <strong>{connection.friendly_name}</strong>
                    <span className={styles.status}>
                      {STATUS_LABEL[connection.status]}
                    </span>
                  </div>
                  <small className={styles.url}>{connection.server_url}</small>
                  <small>
                    {connection.tools_count} 个工具 ·{" "}
                    {connection.credential_configured ? "已配置密钥" : "无密钥"} ·
                    最近核验 {formatTimestamp(connection.last_checked_at)}
                  </small>
                  {statusMessage && connection.status !== "verified" ? (
                    <p className={styles.recovery}>{statusMessage}</p>
                  ) : null}
                  {connection.tools.length > 0 ? (
                    <details className={styles.tools}>
                      <summary>查看工具（{connection.tools.length}）</summary>
                      <p className={styles.toolNote}>
                        工具名称与描述来自外部服务器，只用于了解可用能力，不会被执行。
                      </p>
                      <ul>
                        {connection.tools.map((tool) => (
                          <li key={tool.name}>
                            <strong>{tool.name}</strong>
                            {tool.read_only ? (
                              <span>服务端声明只读</span>
                            ) : null}
                            {tool.description ? (
                              <small>{tool.description}</small>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
                <div className={styles.rowActions}>
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => onConnect(connection)}
                    type="button"
                  >
                    {busy ? (
                      <SpinnerGap
                        aria-hidden="true"
                        className={styles.spin}
                        size={14}
                      />
                    ) : connection.status === "verified" ? (
                      <ArrowClockwise aria-hidden="true" size={14} />
                    ) : (
                      <LinkSimple aria-hidden="true" size={14} />
                    )}
                    {connection.status === "verified" ? "重新检查" : "连接"}
                  </button>
                  <button
                    className={styles.quiet}
                    disabled={busy}
                    onClick={() => onEdit(connection)}
                    type="button"
                  >
                    <PencilSimple aria-hidden="true" size={14} />
                    编辑
                  </button>
                  <button
                    className={styles.quiet}
                    disabled={busy}
                    onClick={() => onDisconnect(connection)}
                    type="button"
                  >
                    断开
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.utilityNote}>
        资料仍可继续导入与核对
        <Link className={styles.quiet} href="/workspace/captures">截图与文档</Link>
        <Link className={styles.quiet} href="/workspace/meetings">时间与安排</Link>
      </p>
    </section>
  );
}

export function ConnectionDialog({
  sessionVersion,
  connection,
  onClose,
  onSaved,
  onStale,
  request,
}: {
  sessionVersion: string;
  connection?: McpConnection;
  onClose: () => void;
  onSaved: (connection: McpConnection) => void;
  onStale: () => void;
  request: Requester;
}) {
  const [name, setName] = useState(connection?.friendly_name ?? "");
  const [url, setUrl] = useState(connection?.server_url ?? "");
  const [secret, setSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const editing = Boolean(connection);
  const urlChanged = Boolean(connection && url.trim() !== connection.server_url);

  async function submit() {
    setBusy(true);
    setFailure(null);
    setStale(false);
    try {
      const identity = await mcpIntentIdentity(workspaceIntentScope(sessionVersion), "edit-connection", [connection?.id, connection?.revision, name.trim(), url.trim(), secret, removeSecret]);
      const requestKey = keys.current.get(identity) ?? crypto.randomUUID();
      keys.current.set(identity, requestKey);
      let payload:
        | { connection: McpConnection }
        | { contract_version: string; connection: McpConnection };
      if (connection) {
        const body: Record<string, unknown> = {
          expected_revision: connection.revision,
          friendly_name: name.trim(),
          idempotency_key: requestKey,
          server_url: url.trim(),
        };
        if (removeSecret) body.bearer_secret = null;
        else if (secret) body.bearer_secret = secret;
        payload = (await request(`/connections/${connection.id}`, {
          body,
          method: "PUT",
        })) as { connection: McpConnection };
      } else {
        payload = (await request("/connections", {
          body: {
            friendly_name: name.trim(),
            idempotency_key: requestKey,
            server_url: url.trim(),
            ...(secret ? { bearer_secret: secret } : {}),
          },
          method: "POST",
        })) as { connection: McpConnection };
      }
      keys.current.delete(identity);
      onSaved(payload.connection);
    } catch (caught) {
      if (
        caught instanceof ExtensionRequestError &&
        caught.code === "MCP_CONNECTION_CHANGED"
      ) {
        setStale(true);
        setFailure(caught.message);
      } else {
        setFailure(caught instanceof Error ? caught.message : "无法保存连接。");
      }
    } finally {
      setBusy(false);
      setSecret("");
    }
  }

  return (
    <ExtensionDialog
      dismissible={!busy}
      description="使用 Streamable HTTP（HTTPS）地址；不要包含账号、查询参数或片段。"
      footer={
        <>
          <button className={styles.quiet} disabled={busy} onClick={onClose} type="button">
            取消
          </button>
          {stale ? (
            <button
              className={styles.primary}
              onClick={() => {
                onStale();
                onClose();
              }}
              type="button"
            >
              刷新并关闭
            </button>
          ) : (
            <button
              className={styles.primary}
              disabled={busy || !name.trim() || !url.trim()}
              onClick={() => void submit()}
              type="button"
            >
              {busy ? "正在保存…" : editing ? "保存修改" : "保存地址"}
            </button>
          )}
        </>
      }
      onClose={onClose}
      title={editing ? "编辑 MCP 服务" : "添加 MCP 服务"}
    >
      <label className={styles.field}>
        <span>名称</span>
        <input
          autoComplete="off"
          autoFocus
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：团队 CRM"
          value={name}
        />
      </label>
      <label className={styles.field}>
        <span>服务器地址</span>
        <input
          autoComplete="off"
          inputMode="url"
          maxLength={2048}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          value={url}
        />
        {urlChanged ? (
          <small>
            地址已改变：旧地址的本地访问将停止，密钥与工具缓存会移除；OAuth 代理凭据另外清理。
          </small>
        ) : null}
      </label>
      <label className={styles.field}>
        <span>Bearer 密钥（可选）</span>
        <input
          autoComplete="new-password"
          disabled={removeSecret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={
            connection?.credential_configured
              ? "留空则保持当前密钥"
              : "留空则不发送 Authorization"
          }
          type="password"
          value={secret}
        />
        <small>密钥加密保存，保存后不会再次显示。</small>
      </label>
      {connection?.credential_configured ? (
        <label className={styles.checkboxField}>
          <input
            checked={removeSecret}
            onChange={(event) => setRemoveSecret(event.target.checked)}
            type="checkbox"
          />
          <span>移除已保存的密钥</span>
        </label>
      ) : null}
      {failure ? (
        <p className={styles.dialogError} role="alert">
          {failure}
          {stale ? " 请刷新后重试。" : ""}
        </p>
      ) : null}
    </ExtensionDialog>
  );
}
