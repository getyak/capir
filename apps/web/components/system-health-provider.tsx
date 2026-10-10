"use client";

import type { SystemHealthResponse } from "@talent-signal/contracts";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  parseSystemHealth,
  systemHealthIsStale,
  unavailableSystemHealth,
} from "@/lib/system-health";
import {
  reduceSystemHealth,
  type SystemHealthPhase,
} from "@/lib/system-health-state";
import { withSystemHealthTimeout } from "@/lib/system-health-timeout";

import { workspaceSessionFetch } from "./workspace-session-request";
import styles from "./system-health.module.css";

type SystemHealthContextValue = {
  observation: SystemHealthResponse | null;
  phase: SystemHealthPhase;
  refreshing: boolean;
  stale: boolean;
  refresh: () => Promise<void>;
};

const SystemHealthContext = createContext<SystemHealthContextValue | null>(null);

export function HealthNotice({ value }: { value: SystemHealthContextValue }) {
  const pathname = usePathname();
  if (
    pathname === "/workspace/settings/diagnostics" ||
    value.phase === "loading" ||
    value.phase === "session_expired" ||
    // A diagnostic TTL expiring is not a product outage. Diagnostics still
    // shows freshness, while ordinary reading stays quiet after a healthy probe.
    value.observation?.status === "healthy"
  ) {
    return null;
  }
  const unavailable = value.observation?.status === "unavailable";
  const confirmedProblem = value.observation?.components.some(item => item.status === "degraded");
  const message = value.stale
    ? "服务检测结果已过期，当前状态待确认。"
    : value.phase === "error"
      ? "暂时无法确认服务状态。"
      : unavailable
        ? "服务暂时不可用，发送或处理消息可能受影响。"
        : confirmedProblem
          ? "部分服务存在异常，处理消息可能受影响。"
          : "部分服务状态尚未确认。";
  return (
    <aside className={styles.notice} data-tone={unavailable ? "error" : "warning"} role="status">
      <span aria-hidden="true" className={styles.noticeMark} />
      <p>{message}</p>
      <Link href="/workspace/settings/diagnostics">查看系统检测</Link>
    </aside>
  );
}

export function SystemHealthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceSystemHealth, {
    observation: null,
    phase: "loading",
  });
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setRefreshing(true);
    dispatch({ type: "request_started" });
    try {
      const result = await withSystemHealthTimeout(
        (signal) =>
          workspaceSessionFetch("/api/system-health", {
            cache: "no-store",
            signal,
          }),
        { timeoutMs: 6_000, signal: controller.signal },
      );
      if (activeRequest.current !== controller) return;
      if (result.status === 401) {
        dispatch({ type: "session_expired" });
        return;
      }
      const parsed = parseSystemHealth(await result.json());
      if (activeRequest.current !== controller) return;
      if (!parsed) {
        dispatch({ type: "invalid_response" });
        return;
      }
      dispatch({ type: "observation_received", observation: parsed });
      setClock(Date.now());
    } catch (error) {
      if (
        activeRequest.current === controller &&
        (error as { name?: string }).name !== "AbortError"
      ) {
        dispatch({
          type: "observation_received",
          observation: unavailableSystemHealth(),
        });
        setClock(Date.now());
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    // Keep a visible workspace current without polling background windows.
    const refreshVisible = () => {
      if (document.visibilityState === "visible" && !activeRequest.current) void refresh();
    };
    const refreshTimer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      const active = activeRequest.current;
      activeRequest.current = null;
      active?.abort();
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  const stale = Boolean(
    state.observation &&
      systemHealthIsStale(state.observation.observed_at, clock),
  );
  const value = useMemo<SystemHealthContextValue>(
    () => ({
      observation: state.observation,
      phase: state.phase,
      refreshing,
      stale,
      refresh,
    }),
    [refresh, refreshing, stale, state.observation, state.phase],
  );

  return (
    <SystemHealthContext.Provider value={value}>
      <HealthNotice value={value} />
      {children}
    </SystemHealthContext.Provider>
  );
}

export function useSystemHealth(): SystemHealthContextValue {
  const value = useContext(SystemHealthContext);
  if (!value) throw new Error("System health requires the workspace provider.");
  return value;
}

/**
 * Context-optional read for surfaces that render outside the workspace health
 * provider (for example a static server render). Production always has the
 * provider; a missing one must degrade to unknown, never throw or fabricate.
 */
export function useOptionalSystemHealth(): SystemHealthContextValue | null {
  return useContext(SystemHealthContext);
}
