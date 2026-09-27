"use client";

import type {
  McpClientGrant,
  McpConnection,
  McpEndpointsResponse,
} from "@talent-signal/contracts";
import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState } from "react";

import {
  AddClientDialog,
  OutboundPanel,
  RevealTokenDialog,
} from "./workspace-extensions-outbound";
import {
  ConnectionDialog,
  InboundPanel,
} from "./workspace-extensions-inbound";
import { ConfirmDialog } from "./workspace-extensions-dialogs";
import {
  ExtensionRequestError,
  payloadCode,
  payloadError,
  type Direction,
  type Requester,
} from "./workspace-extensions-helpers";
import { useWorkspaceSessionRecovery } from "./use-workspace-session-recovery";
import { workspaceSessionFetch } from "./workspace-session-request";
import styles from "./workspace-extensions.module.css";

export function WorkspaceExtensions({
  connections: initialConnections,
  grants: initialGrants,
  endpoints: initialEndpoints,
  error,
  sessionVersion,
  recoveryHref: initialRecoveryHref,
}: {
  connections: McpConnection[];
  grants: McpClientGrant[];
  endpoints: McpEndpointsResponse;
  error: string | null;
  sessionVersion: string;
  recoveryHref: string | null;
}) {
  const [direction, setDirection] = useState<Direction>("inbound");
  const [connections, setConnections] = useState(initialConnections);
  const [grants, setGrants] = useState(initialGrants);
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [snapshotError, setSnapshotError] = useState<string | null>(error);
  const [reloading, setReloading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<McpConnection | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [revealed, setRevealed] = useState<{
    configuration: string;
    expiresAt: string;
    name: string;
    token: string;
    url: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "disconnect"; connection: McpConnection }
    | { kind: "revoke"; grant: McpClientGrant }
    | null
  >(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const inboundTab = useRef<HTMLButtonElement>(null);
  const outboundTab = useRef<HTMLButtonElement>(null);
  const { sessionRecoveryHref } = useWorkspaceSessionRecovery(initialRecoveryHref);

  const mark = (id: string, value: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const request: Requester = async (path, init) => {
    const response = await workspaceSessionFetch(`/api/extensions${path}`, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        "x-workspace-session": sessionVersion,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      method: init.method,
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const code = payloadCode(payload);
      if (response.status === 401 || code === "session_stale") {
        setStale(true);
      }
      throw new ExtensionRequestError(
        payloadError(payload, "请求未完成。"),
        response.status,
        code,
      );
    }
    return payload;
  };

  async function reload() {
    setReloading(true);
    setSnapshotError(null);
    try {
      const payload = (await request("", { method: "GET" })) as {
        connections: McpConnection[];
        endpoints: McpEndpointsResponse;
        grants: McpClientGrant[];
      };
      setConnections(payload.connections);
      setEndpoints(payload.endpoints);
      setGrants(payload.grants);
    } catch (caught) {
      setSnapshotError(
        caught instanceof Error ? caught.message : "扩展状态暂时不可用。",
      );
    } finally {
      setReloading(false);
    }
  }

  function replaceConnection(connection: McpConnection) {
    setConnections((current) => {
      const exists = current.some((item) => item.id === connection.id);
      return exists
        ? current.map((item) => (item.id === connection.id ? connection : item))
        : [connection, ...current];
    });
  }

  async function connect(connection: McpConnection) {
    mark(connection.id, true);
    try {
      const payload = (await request(`/connections/${connection.id}/connect`, {
        body: {
          expected_revision: connection.revision,
          idempotency_key: crypto.randomUUID(),
        },
        method: "POST",
      })) as { connection: McpConnection };
      replaceConnection(payload.connection);
      setNotice(
        payload.connection.status === "verified"
          ? `已验证 ${payload.connection.friendly_name}，发现 ${payload.connection.tools_count} 个工具。`
          : `${payload.connection.friendly_name} 尚未通过验证。`,
      );
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "连接未完成。");
      await reload();
    } finally {
      mark(connection.id, false);
    }
  }

  async function disconnect(connection: McpConnection) {
    mark(connection.id, true);
    try {
      const payload = (await request(
        `/connections/${connection.id}/disconnect`,
        {
          body: {
            expected_revision: connection.revision,
            idempotency_key: crypto.randomUUID(),
          },
          method: "POST",
        },
      )) as { connection: McpConnection };
      replaceConnection(payload.connection);
      setConfirm(null);
      setNotice(
        `已断开 ${payload.connection.friendly_name}，并清除已保存的密钥与工具缓存。`,
      );
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "断开未完成。");
      await reload();
    } finally {
      mark(connection.id, false);
    }
  }

  async function revoke(grant: McpClientGrant) {
    mark(grant.id, true);
    try {
      const payload = (await request(`/clients/${grant.id}/revoke`, {
        body: {
          expected_revision: grant.revision,
          idempotency_key: crypto.randomUUID(),
        },
        method: "POST",
      })) as { grant: McpClientGrant };
      setGrants((current) =>
        current.map((item) =>
          item.id === payload.grant.id ? payload.grant : item,
        ),
      );
      setConfirm(null);
      setNotice(`已撤销 ${payload.grant.name}，后续请求会立即失败。`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "撤销未完成。");
      await reload();
    } finally {
      mark(grant.id, false);
    }
  }

  function switchDirection(next: Direction, focus: boolean) {
    setDirection(next);
    if (focus) (next === "inbound" ? inboundTab : outboundTab).current?.focus();
  }

  const configured = Boolean(
    endpoints.configured && endpoints.streamable_http_url,
  );

  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <header className={styles.header}>
        <div>
          <h1>扩展</h1>
          <p>连接常用工具，在熟悉的客户端使用工作区。</p>
        </div>
      </header>

      <div aria-label="扩展方向" className={styles.directionCards} role="tablist">
        <button
          aria-controls="extensions-inbound"
          aria-selected={direction === "inbound"}
          id="extensions-tab-inbound"
          onClick={() => switchDirection("inbound", false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              switchDirection("outbound", true);
            }
          }}
          ref={inboundTab}
          role="tab"
          tabIndex={direction === "inbound" ? 0 : -1}
          type="button"
        >
          <strong>连接服务</strong>
          <small className={styles.visuallyHidden}>从外部 MCP 服务读取</small>
        </button>
        <button
          aria-controls="extensions-outbound"
          aria-selected={direction === "outbound"}
          id="extensions-tab-outbound"
          onClick={() => switchDirection("outbound", false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              switchDirection("inbound", true);
            }
          }}
          ref={outboundTab}
          role="tab"
          tabIndex={direction === "outbound" ? 0 : -1}
          type="button"
        >
          <strong>接入客户端</strong>
          <small className={styles.visuallyHidden}>把工作区作为 MCP 服务</small>
        </button>
      </div>

      {stale ? (
        <div className={styles.boundary} role="alert">
          <WarningCircle aria-hidden="true" size={18} />
          <p>
            登录已改变，请重新打开扩展页再操作。
            <Link href={sessionRecoveryHref ?? "/login"}>重新登录</Link>
          </p>
        </div>
      ) : null}

      {direction === "inbound" ? (
        <InboundPanel
          connections={connections}
          onAdd={() => setAddOpen(true)}
          onConnect={(connection) => void connect(connection)}
          onDisconnect={(connection) =>
            setConfirm({ connection, kind: "disconnect" })
          }
          onEdit={(connection) => setEditTarget(connection)}
          onReload={() => void reload()}
          pending={pending}
          reloading={reloading}
          snapshotError={snapshotError}
        />
      ) : (
        <OutboundPanel
          configured={configured}
          endpoints={endpoints}
          grants={grants}
          onAdd={() => setClientOpen(true)}
          onReload={() => void reload()}
          onRevoke={(grant) => setConfirm({ grant, kind: "revoke" })}
          pending={pending}
          reloading={reloading}
          snapshotError={snapshotError}
        />
      )}

      {notice ? (
        <div aria-live="polite" className={styles.toast} role="status">
          {notice}
        </div>
      ) : null}

      {addOpen ? (
        <ConnectionDialog
          onClose={() => setAddOpen(false)}
          onSaved={(connection) => {
            replaceConnection(connection);
            setAddOpen(false);
            setNotice(
              `已保存 ${connection.friendly_name}。保存地址不等于连接，请点击连接完成握手。`,
            );
          }}
          onStale={() => void reload()}
          request={request}
        />
      ) : null}

      {editTarget ? (
        <ConnectionDialog
          connection={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(connection) => {
            replaceConnection(connection);
            setEditTarget(null);
            setNotice(
              `已更新 ${connection.friendly_name}。请重新连接以核验新的地址或密钥。`,
            );
          }}
          onStale={() => void reload()}
          request={request}
        />
      ) : null}

      {clientOpen ? (
        <AddClientDialog
          configured={configured && !snapshotError}
          onClose={() => { setClientOpen(false); void reload(); }}
          onCreated={(result) => {
            setGrants((current) => [result.grant, ...current]);
            setClientOpen(false);
            setRevealed({
              configuration: result.endpoint.configuration_json,
              expiresAt: result.grant.expires_at,
              name: result.grant.name,
              token: result.token,
              url: result.endpoint.streamable_http_url,
            });
          }}
          request={request}
        />
      ) : null}

      {revealed ? (
        <RevealTokenDialog
          onClose={() => setRevealed(null)}
          revealed={revealed}
        />
      ) : null}

      <ConfirmDialog
        busy={Boolean(confirm && pending.has(confirm.kind === "revoke" ? confirm.grant.id : confirm.connection.id))}
        confirmLabel={confirm?.kind === "revoke" ? "撤销客户端" : "断开连接"}
        description={
          confirm?.kind === "revoke"
            ? `撤销后，${confirm.grant.name} 的令牌会立即失效，无法再读取工作区。`
            : confirm
              ? `断开 ${confirm.connection.friendly_name} 会清除已保存的密钥与工具缓存；再次连接需要重新配置密钥。`
              : ""
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "revoke") void revoke(confirm.grant);
          else if (confirm?.kind === "disconnect")
            void disconnect(confirm.connection);
        }}
        open={confirm !== null}
        title={confirm?.kind === "revoke" ? "撤销这个客户端？" : "断开这个连接？"}
      />
    </main>
  );
}
