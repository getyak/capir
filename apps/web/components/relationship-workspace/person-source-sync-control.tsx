"use client";

import {
  PersonSourceSyncListResponseSchema,
  PersonSourceSyncResponseSchema,
  PersonSourceSyncRunsResponseSchema,
  type PersonSourceSyncEffectiveState,
  type PersonSourceSyncListResponse,
  type PersonSourceSyncRecord,
  type PersonSourceSyncRunRecord,
  type PersonSourceSyncRunsResponse,
} from "@talent-signal/contracts";
import { ArrowsClockwise, CircleNotch, Pause, Play, Trash, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./relationship-resource-composer.module.css";

import { matchesTypeBox } from "@/lib/typebox-validation";
import { timeRequest, TimeRequestError } from "@/lib/time-workspace-client";

const STATE_LABELS: Record<PersonSourceSyncEffectiveState, string> = {
  active: "定期读取中",
  paused: "已暂停",
  expired: "已到期 · 需重新确认",
  revoked: "已撤销",
  deleted: "已删除",
};

const RUN_LABELS: Record<PersonSourceSyncRunRecord["status"], string> = {
  pending: "排队中",
  running: "进行中",
  completed: "已完成",
  partial: "部分完成",
  failed: "未获得结果",
  skipped: "已跳过",
  unknown: "结果待核实",
};

const WARNING_LABELS: Record<string, string> = {
  PUBLIC_RESEARCH_FETCH_FAILED: "公开页面本次未能读取",
  PUBLIC_RESEARCH_CAPTURE_FAILED: "公开页面本次未能作为依据保存",
  PUBLIC_RESEARCH_UNAVAILABLE: "公开来源本次不可用",
  PUBLIC_RESEARCH_RETRY_FAILED: "重试未能完成",
  PERSON_SOURCE_SYNC_UNCHANGED: "页面内容没有变化，未产生新依据",
  PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED: "自动重试次数已用完",
  PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED: "本轮时限已过",
  PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION: "授权在完成前结束，已保存的部分依据保留",
  PERSON_SOURCE_SYNC_RECONCILIATION_UNRESOLVED: "结果仍未核实",
};

const STOP_LABELS: Record<string, string> = {
  PERSON_SOURCE_SYNC_GRANT_PAUSED: "你已暂停定期读取",
  PERSON_SOURCE_SYNC_GRANT_REVOKED: "此定期观察已结束",
  PERSON_SOURCE_SYNC_GRANT_EXPIRED: "定期观察已到期，需要重新确认",
  PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE: "人物已归档，不再读取",
  PERSON_SOURCE_SYNC_ACCOUNT_RETIRED: "账号已停用，不再读取",
  PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE: "此来源已不可用",
  PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_REVOKED: "来源访问已撤销",
  PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_EXPIRED: "来源授权已过期",
  PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_CHANGED: "来源授权已变化，需要重新确认",
  PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED: "来源网址已变化，需要重新确认",
  PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION: "授权在完成前结束",
  PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED: "自动重试次数已用完",
  PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED: "本轮时限已过",
  PERSON_SOURCE_SYNC_LEASE_LOST: "本轮由另一任务接管",
};

const FAILURE_LABELS: Record<string, string> = {
  PERSON_SOURCE_SYNC_SOURCE_UNAVAILABLE: "此公开网址还不是这个人物的已绑定来源，暂时不能定期读取。",
  PERSON_SOURCE_SYNC_SOURCE_NOT_AUTHORIZED: "此来源需要先恢复或续期访问授权。",
  PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED: "确认的网址与已绑定来源不一致，请重新核对。",
  PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE: "所选人物不可用。",
  PERSON_SOURCE_SYNC_GRANT_EXPIRED: "定期观察已到期，需要你重新确认后才会继续。",
  PERSON_SOURCE_SYNC_EXISTS: "这个人物已有一份定期观察，请先查看现有设置。",
  PERSON_SOURCE_SYNC_REVISION_CONFLICT: "设置已改变，已重新读取，请核对后再操作。",
  PERSON_SOURCE_SYNC_INTENT_CONFLICT: "这次操作与现有记录不一致，请重新读取。",
  PERSON_SOURCE_SYNC_INVALID: "请核对定期观察的确认内容。",
  PERSON_SOURCE_SYNC_EXPIRY_INVALID: "请选择一个未来的到期时间。",
};

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function defaultExpiryDay(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

export interface PersonSourceSyncControlProps {
  personId: string;
  relationshipContextId: string;
  seedResourceId: string;
  sourceUrl: string;
  sourceAuthorizationState: "authorized" | "revoked" | "expired";
  /** Owner session binding required by the time workspace boundary. */
  sessionBinding: string | null;
  onChanged?: () => void;
}

/**
 * The deliberate periodic re-read control for ONE already-bound public source
 * of ONE person: exact source, honest 24-hour UTC interval, IANA display zone,
 * required expiry and a confirmation structurally separate from the one-shot
 * research approval. Status/next-run readback is honest; paused, expired and
 * revoked states never silently resume.
 */
export function PersonSourceSyncControl(props: PersonSourceSyncControlProps) {
  return <ScopedPersonSourceSyncControl key={JSON.stringify([
    props.sessionBinding, props.personId, props.relationshipContextId,
    props.seedResourceId, props.sourceUrl, props.sourceAuthorizationState,
  ])} {...props} />;
}

function ScopedPersonSourceSyncControl({
  personId,
  relationshipContextId,
  seedResourceId,
  sourceUrl,
  sourceAuthorizationState,
  sessionBinding,
  onChanged,
}: PersonSourceSyncControlProps) {
  const [syncs, setSyncs] = useState<PersonSourceSyncRecord[] | null>(null);
  const [runs, setRuns] = useState<PersonSourceSyncRunRecord[]>([]);
  const [formOpenedAt] = useState(Date.now);
  const [expiryDay, setExpiryDay] = useState(defaultExpiryDay);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(true);
  const [sessionStale, setSessionStale] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const aliveRef = useRef(true);
  const readEpoch = useRef(0);
  // Response-loss safety: a retried operation resends its EXACT original
  // request (frozen fields included) with its original idempotency key and
  // expected revision, like existing schedules — never a changed intent.
  const pendingRef = useRef<{
    key: string;
    operation: "create" | "pause" | "resume" | "delete";
    url: string;
    method: "PUT" | "DELETE";
    body: Record<string, unknown>;
  } | null>(null);
  const displayZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const load = useCallback(async () => {
    if (!sessionBinding) return;
    const epoch = ++readEpoch.current;
    const current = () => aliveRef.current && epoch === readEpoch.current;
    const query = new URLSearchParams({
      person_id: personId,
      relationship_context_id: relationshipContextId,
      seed_resource_id: seedResourceId,
    });
    try {
      const payload = await timeRequest(`/api/time/person-source-syncs?${query}`, sessionBinding);
      if (!current()) return;
      if (!matchesTypeBox(PersonSourceSyncListResponseSchema, payload)) {
        throw new Error("定期观察设置暂时无法核实，请重新读取。");
      }
      const list = payload as PersonSourceSyncListResponse;
      setSyncs(list.syncs);
      const grant = list.syncs[0];
      if (grant) {
        try {
          const runPayload = await timeRequest(
            `/api/time/person-source-syncs/${encodeURIComponent(grant.id)}/runs`, sessionBinding,
          );
          if (!current()) return;
          if (!matchesTypeBox(PersonSourceSyncRunsResponseSchema, runPayload)) {
            throw new Error("最近读取记录暂时无法核实。");
          }
          setRuns((runPayload as PersonSourceSyncRunsResponse).runs);
        } catch (caught) {
          if (!current()) return;
          if (caught instanceof TimeRequestError && (caught.status === 401 || caught.code === "session_stale")) setSessionStale(true);
          setError(caught instanceof Error ? caught.message : "最近读取记录暂时无法核实。");
        }
      }
    } catch (caught) {
      if (!current()) return;
      if (caught instanceof TimeRequestError && (caught.status === 401 || caught.code === "session_stale")) setSessionStale(true);
      setError(caught instanceof Error ? caught.message : "定期观察状态暂时无法读取。");
    } finally {
      if (current()) setReading(false);
    }
  }, [personId, relationshipContextId, seedResourceId, sessionBinding]);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    // Install the scope lifetime before starting its asynchronous initial
    // read; an immediate retirement can cancel before issuing that request.
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; aliveRef.current = false; readEpoch.current += 1; };
  }, [load]);

  const sync = syncs?.[0] ?? null;
  // Times render in the grant's actual IANA zone (a new grant uses the chosen
  // browser zone); the interval stays an exact 86400-second UTC duration.
  const zone = sync?.time_zone ?? displayZone;
  const eligible = sourceAuthorizationState === "authorized";

  async function reconcilePendingOperation(pending: NonNullable<typeof pendingRef.current>): Promise<boolean> {
    try {
      const payload = await timeRequest(pending.url, sessionBinding!);
      if (!aliveRef.current || !matchesTypeBox(PersonSourceSyncResponseSchema, payload)) return false;
      const record = (payload as { sync: PersonSourceSyncRecord }).sync;
      const targetId = decodeURIComponent(pending.url.split("/").at(-1) ?? "");
      if (record.id !== targetId) return false;
      setSyncs(record.status === "deleted" ? [] : [record]);
      setRuns([]);
      // A later rejection only describes that replay, not an earlier unknown
      // commit. The original key on this owner-scoped grant is positive proof.
      if (record.last_operation_id !== pending.key || record.revision < Number(pending.body.expected_revision) + 1) return false;
      pendingRef.current = null;
      setPendingOperation(null);
      setConfirmed(false);
      setSyncs(null); setReading(true);
      await load();
      if (aliveRef.current) onChanged?.();
      return true;
    } catch (caught) {
      if (aliveRef.current && caught instanceof TimeRequestError && (caught.status === 401 || caught.code === "session_stale")) setSessionStale(true);
      return false;
    }
  }

  async function mutate(
    operation: "create" | "pause" | "resume" | "delete",
    target: PersonSourceSyncRecord | null,
  ) {
    if (!sessionBinding || sessionStale) {
      setError("登录已改变，请刷新页面后重试。");
      return;
    }
    const pending = pendingRef.current;
    if (pending && pending.operation !== operation) {
      setError("上次操作结果尚未核实，请先核实这次操作。");
      return;
    }
    const retry =
      pending !== null && pending.operation === operation ? pending : null;
    if (!retry && operation === "create") {
      const expiryMs = Date.parse(`${expiryDay}T23:59:59.000Z`);
      const now = Date.now();
      if (!Number.isFinite(expiryMs) || expiryMs <= now || expiryMs > now + 366 * 86_400_000) {
        setError(FAILURE_LABELS.PERSON_SOURCE_SYNC_EXPIRY_INVALID);
        setConfirmed(false);
        return;
      }
    }
    const key = retry ? retry.key : crypto.randomUUID();
    const url = retry
      ? retry.url
      : `/api/time/person-source-syncs/${encodeURIComponent(
          target?.id ?? key,
        )}`;
    const method: "PUT" | "DELETE" =
      operation === "delete" ? "DELETE" : "PUT";
    const body: Record<string, unknown> = retry
      ? retry.body
      : operation === "delete"
        ? {
            expected_revision: target ? target.revision : 1,
            idempotency_key: key,
          }
        : target
          ? {
              // An update echoes the grant's EXACT frozen fields; only a
              // create uses today's defaults (R2).
              expected_revision: target.revision,
              idempotency_key: key,
              person_id: target.person_id,
              relationship_context_id: target.relationship_context_id,
              seed_resource_id: target.seed_resource_id,
              source_url: target.source_url,
              time_zone: target.time_zone,
              interval_seconds: 86_400,
              expires_at: target.expires_at,
              status: operation === "pause" ? "paused" : "active",
              confirmation: "periodic_public_source_re_read",
            }
          : {
              expected_revision: 0,
              idempotency_key: key,
              person_id: personId,
              relationship_context_id: relationshipContextId,
              seed_resource_id: seedResourceId,
              source_url: sourceUrl,
              time_zone: displayZone,
              interval_seconds: 86_400,
              expires_at: new Date(
                `${expiryDay}T23:59:59.000Z`,
              ).toISOString(),
              status: "active",
              confirmation: "periodic_public_source_re_read",
            };
    // The full original request survives response loss with its expected
    // revision; a retry resends it byte-identically.
    pendingRef.current = { key, operation, url, method, body };
    setPendingOperation(operation);
    setBusy(operation);
    setError("");
    try {
      const payload = await timeRequest(url, sessionBinding, {
        method, body: JSON.stringify(body),
      });
      if (!aliveRef.current) return;
      if (!matchesTypeBox(PersonSourceSyncResponseSchema, payload)) {
        throw new Error("操作结果尚未核实，请核实并重试。");
      }
      pendingRef.current = null;
      setPendingOperation(null);
      setConfirmed(false);
      setSyncs(null); setRuns([]); setReading(true);
      await load();
      if (aliveRef.current) onChanged?.();
    } catch (caught) {
      if (!aliveRef.current) return;
      const definitive = caught instanceof TimeRequestError && caught.status >= 400 && caught.status < 500
        && caught.status !== 408 && caught.status !== 429 && caught.code !== "session_stale";
      if (caught instanceof TimeRequestError && (caught.status === 401 || caught.code === "session_stale")) {
        setSessionStale(true);
      }
      if (definitive && retry) {
        // An original unknown submission can have committed before this
        // replay was rejected (for example after the fixed expiry elapsed).
        const reconciled = await reconcilePendingOperation(retry);
        if (aliveRef.current) setError(reconciled ? "" : "上次操作仍未核实，暂不能更改其他设置；请继续核实这次操作。");
        return;
      }
      if (definitive) {
        // A definite rejection did not apply this intent. A new deliberate
        // action can use fresh input/CAS; unknown outcomes keep exact replay.
        pendingRef.current = null;
        setPendingOperation(null);
        setConfirmed(false);
        if (caught.status === 409 || caught.status === 404) {
          setSyncs(null); setRuns([]); setReading(true);
          await load();
        }
      }
      if (aliveRef.current) setError(
        caught instanceof TimeRequestError
          ? FAILURE_LABELS[caught.code] ?? caught.message
          : caught instanceof Error ? caught.message : "定期观察暂时无法完成，请重试。",
      );
    } finally {
      if (aliveRef.current) setBusy("");
    }
  }

  if (!sessionBinding || sessionStale) {
    return (
      <section className={styles.sourceSync} aria-label="定期公开来源读取">
        <p className={styles.sourceSyncEmpty}>登录状态已改变，请刷新页面后管理定期读取。</p>
      </section>
    );
  }

  return (
    <section className={styles.sourceSync} aria-label="定期公开来源读取">
      <div>
        <p className="eyebrow">定期公开来源读取</p>
        <h4>每 24 小时查看这个网址的新内容。</h4>
        <p>
          来源：<strong>{sourceUrl}</strong>
          <br />
          间隔：<strong>每 24 小时（固定间隔）</strong> · 下列时间按{" "}
          <strong>{zone}</strong> 显示，夏令时不改变间隔。每次仅读这一页，新内容会作为
          <strong>拟议依据</strong>等待你审阅，绝不自动确认事实或联系任何人。
        </p>
      </div>

      {!eligible ? (
        <p role="status" className={styles.sourceSyncNotice}>
          <Warning aria-hidden="true" size={16} weight="fill" />
          {sourceAuthorizationState === "revoked"
            ? "此来源访问已撤销；恢复访问后才能定期读取。"
            : "此来源授权已过期；续期访问后才能定期读取。"}
        </p>
      ) : null}
      {syncs === null ? (
        <div role="status">
          <p>{reading ? "正在核实定期观察设置…" : "现有设置尚未核实，请重新读取后再操作。"}</p>
          <button type="button" className="context-secondary-button" disabled={reading || busy !== ""} onClick={() => { setError(""); setReading(true); void load(); }}>重新读取设置</button>
        </div>
      ) : sync ? (
        <div className={styles.sourceSyncStatus} role="status">
          <p>
            状态：<strong>{STATE_LABELS[sync.effective_state]}</strong>
            {sync.effective_state === "expired"
              ? " · 到期后不会自动继续，需要你重新确认"
              : ""}
            <br />
            下次读取：<strong>{formatDate(sync.next_due_at, zone)}</strong>
            <br />
            到期：<strong>{formatDate(sync.expires_at, zone)}</strong>
          </p>
          {runs[0] ? (
            <small>
              最近一轮：{RUN_LABELS[runs[0].status]}
              {" · "}
              {formatDate(runs[0].cycle_due_at, zone)} · 新依据{" "}
              {runs[0].new_observations} 条
              {runs[0].warning_codes
                .map((code) => WARNING_LABELS[code])
                .filter(Boolean)
                .map((label) => ` · ${label}`)
                .join("")}
              {runs[0].stop_reason && STOP_LABELS[runs[0].stop_reason]
                ? ` · ${STOP_LABELS[runs[0].stop_reason]}`
                : ""}
            </small>
          ) : null}
          {sync.effective_state === "expired" ? (
            <p className={styles.sourceSyncNotice}>
              定期观察已到期，不会自动继续。删除旧记录后可重新确认一次新的定期读取。
            </p>
          ) : null}
          {!sync.content_available &&
          sync.effective_state !== "expired" ? (
            <p className={styles.sourceSyncNotice}>
              此来源内容已不可用；保留的记录只能删除，不能暂停或恢复。
            </p>
          ) : null}
          {sync.effective_state !== "deleted" ? (
            <div className={styles.sourceSyncActions}>
              {eligible && sync.content_available &&
              sync.effective_state === "active" ? (
                <button
                  className="context-secondary-button"
                  disabled={busy !== "" || pendingOperation !== null}
                  onClick={() => void mutate("pause", sync)}
                  type="button"
                >
                  {busy === "pause" ? (
                    <CircleNotch aria-hidden="true" className="spin" size={15} />
                  ) : (
                    <Pause aria-hidden="true" size={15} />
                  )}
                  暂停
                </button>
              ) : null}
              {eligible && sync.content_available &&
              sync.effective_state === "paused" ? (
                <button
                  className="context-primary-button context-primary-button--compact"
                  disabled={busy !== "" || pendingOperation !== null}
                  onClick={() => void mutate("resume", sync)}
                  type="button"
                >
                  {busy === "resume" ? (
                    <CircleNotch aria-hidden="true" className="spin" size={15} />
                  ) : (
                    <Play aria-hidden="true" size={15} />
                  )}
                  恢复
                </button>
              ) : null}
              <button
                className="context-text-button"
                disabled={busy !== "" || pendingOperation !== null}
                onClick={() => void mutate("delete", sync)}
                type="button"
              >
                <Trash aria-hidden="true" size={15} />
                删除定期观察
              </button>
            </div>
          ) : null}
        </div>
      ) : eligible ? (
        <div className={styles.sourceSyncSetup}>
          <label>
            <span>UTC 到期日（必填，默认 30 天）</span>
            <input
              max={new Date(formOpenedAt + 365 * 86_400_000).toISOString().slice(0, 10)}
              min={new Date(formOpenedAt + 86_400_000).toISOString().slice(0, 10)}
              onChange={(event) => setExpiryDay(event.currentTarget.value)}
              type="date"
              disabled={pendingOperation !== null}
              value={expiryDay}
            />
          </label>
          <small>UTC 当日 23:59:59 截止；实际到期：{expiryDay ? formatDate(`${expiryDay}T23:59:59.000Z`, displayZone) : "—"}（{displayZone}）。</small>
          <label className="context-resource-checkbox">
            <input
              checked={confirmed}
              disabled={pendingOperation !== null}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>
              我确认定期重新读取这一个公开网址
              <small>
                这与一次性公开研究批准是两次不同的决定；到期后必须重新确认。
              </small>
            </span>
          </label>
          <button
            className="context-primary-button context-primary-button--compact"
            disabled={!confirmed || !expiryDay || busy !== "" || pendingOperation !== null || !Number.isFinite(Date.parse(`${expiryDay}T23:59:59.000Z`)) || Date.parse(`${expiryDay}T23:59:59.000Z`) <= formOpenedAt || Date.parse(`${expiryDay}T23:59:59.000Z`) > formOpenedAt + 366 * 86_400_000}
            onClick={() => void mutate("create", null)}
            type="button"
          >
            {busy === "create" ? (
              <CircleNotch aria-hidden="true" className="spin" size={16} />
            ) : (
              <ArrowsClockwise aria-hidden="true" size={16} />
            )}
            开始定期读取
          </button>
        </div>
      ) : null}
      {pendingOperation && busy === "" ? (
        <div className={styles.sourceSyncNotice} role="status">
          <p>上次操作结果尚未核实，请先核实这次操作，再更改设置。</p>
          <button className="context-secondary-button" type="button" onClick={() => {
            const pending = pendingRef.current;
            if (pending) void mutate(pending.operation, sync);
          }}>核实并重试{({ create: "创建", pause: "暂停", resume: "恢复", delete: "删除" } as Record<string,string>)[pendingOperation]}</button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={styles.sourceSyncNotice}>
          <Warning aria-hidden="true" size={16} weight="fill" />
          {error}
        </p>
      ) : null}
    </section>
  );
}
