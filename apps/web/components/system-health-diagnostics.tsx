"use client";

import {
  ArrowClockwise,
  CheckCircle,
  Question,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type {
  SystemHealthComponent,
  SystemHealthStatus,
} from "@talent-signal/contracts";
import Link from "next/link";

import { backendSessionRecoveryHref } from "@/lib/backend-session";

import { useSystemHealth } from "./system-health-provider";
import styles from "./system-health.module.css";

const names: Record<SystemHealthComponent["id"], string> = {
  web: "capri Web",
  backend: "后端服务",
  database: "PostgreSQL 数据库",
  migrations: "数据库结构",
};

const statusNames: Record<SystemHealthStatus, string> = {
  healthy: "正常",
  degraded: "需确认",
  unavailable: "不可用",
  unknown: "未观测",
};

const detailNames: Record<SystemHealthComponent["detail_code"], string> = {
  request_completed: "当前请求已经完成",
  query_completed: "探测查询已经完成",
  required_migrations_applied: "必要迁移已应用",
  required_migrations_missing: "至少一项必要迁移缺失",
  dependency_unreachable: "本次无法连接这个依赖",
  not_observed: "上游失败，本次没有足够证据",
};

function StatusIcon({ status }: { status: SystemHealthStatus }) {
  const props = { "aria-hidden": true, size: 20, weight: "fill" as const };
  if (status === "healthy") return <CheckCircle {...props} />;
  if (status === "degraded") return <WarningCircle {...props} />;
  if (status === "unavailable") return <XCircle {...props} />;
  return <Question {...props} />;
}

function ComponentRow({ item }: { item: SystemHealthComponent }) {
  return (
    <li className={styles.component} data-status={item.status}>
      <span className={styles.componentIcon}><StatusIcon status={item.status} /></span>
      <span className={styles.componentCopy}>
        <strong>{names[item.id]}</strong>
        <small>{detailNames[item.detail_code]}</small>
      </span>
      <span className={styles.componentMeta}>
        <span>{statusNames[item.status]}</span>
        {item.duration_ms === null ? null : <small>{item.duration_ms} ms</small>}
      </span>
    </li>
  );
}

function formatObservation(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function SystemHealthDiagnostics() {
  const health = useSystemHealth();
  const status = health.observation?.status;
  const summary = health.phase === "session_expired"
    ? "登录会话已过期"
    : health.stale
    ? "结果已过期"
    : status === "healthy"
      ? "当前请求路径正常"
      : status === "degraded"
        ? "部分状态需要确认"
        : status === "unavailable"
          ? "请求路径被依赖阻断"
          : health.phase === "loading"
            ? "正在检测请求路径"
            : "暂时没有可验证结果";

  return (
    <main className={styles.page} id="main-content">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>REQUEST PATH</p>
          <h1>系统检测</h1>
          <p>确认一次真实页面请求依赖的服务，而不是展示泛化运行指标。</p>
        </div>
        <button
          className={styles.refresh}
          disabled={health.refreshing}
          onClick={() => void health.refresh()}
          type="button"
        >
          <ArrowClockwise aria-hidden="true" size={17} />
          {health.refreshing ? "检测中" : "重新检测"}
        </button>
      </header>

      <section className={styles.summary} data-status={health.stale ? "degraded" : status ?? "unknown"} aria-live="polite" aria-busy={health.refreshing}>
        <span className={styles.summaryMark} aria-hidden="true" />
        <div>
          <p>{summary}</p>
          <small>
            {health.observation
              ? `观测于 ${formatObservation(health.observation.observed_at)}`
              : "尚未取得完整的四项组件观测。"}
          </small>
        </div>
      </section>

      {health.observation ? (
        <ol className={styles.components} aria-label="必要服务状态">
          {health.observation.components.map((item) => (
            <ComponentRow item={item} key={item.id} />
          ))}
        </ol>
      ) : (
        <section className={styles.empty}>
          {health.phase === "session_expired" ? (
            <>
              <p>需要重新登录后才能读取工作区系统状态。</p>
              <Link
                className={styles.recovery}
                href={backendSessionRecoveryHref(
                  "/workspace/settings/diagnostics",
                )}
              >
                重新登录
              </Link>
            </>
          ) : (
            <>
              <p>检测端点没有返回可验证的结构。</p>
              <small>请重新检测；持续失败时先检查 Web 到后端的连接与登录会话。</small>
            </>
          )}
        </section>
      )}

      <aside className={styles.boundary}>
        <p>检测边界</p>
        <span>
          本页只判断当前产品请求路径：Web、后端、PostgreSQL 与必要迁移。Opik、外部模型、浏览器执行器及 Tailscale 暴露需在各自运维入口单独验证，不会在这里被推断为健康。
        </span>
      </aside>
    </main>
  );
}
