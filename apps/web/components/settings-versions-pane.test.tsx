// @vitest-environment happy-dom
import { CONTRACT_VERSION, type SystemHealthResponse } from "@talent-signal/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const healthState = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("./system-health-provider", () => ({
  useOptionalSystemHealth: () => healthState.value,
}));

import { SettingsVersionsPane } from "./settings-versions-pane";

const observation: SystemHealthResponse = {
  contract_version: CONTRACT_VERSION,
  schema_version: "system-health.v1",
  status: "healthy",
  observed_at: "2026-09-14T09:00:00.000Z",
  backend_revision: "abc1234",
  components: [
    { id: "web", label: "Web", kind: "service", required: true, status: "healthy", duration_ms: null, detail_code: "request_completed" },
    { id: "backend", label: "Backend", kind: "service", required: true, status: "healthy", duration_ms: 2, detail_code: "request_completed" },
    { id: "database", label: "Database", kind: "database", required: true, status: "healthy", duration_ms: 3, detail_code: "query_completed" },
    { id: "migrations", label: "Migrations", kind: "schema", required: true, status: "healthy", duration_ms: 1, detail_code: "required_migrations_applied" },
  ],
};

function healthValue(overrides: Record<string, unknown> = {}) {
  return {
    observation,
    phase: "ready",
    refreshing: false,
    stale: false,
    refresh: vi.fn(),
    ...overrides,
  };
}

let root: Root;
let host: HTMLDivElement;

async function render(webRelease: { revision: string; source: "release_file" | "vercel_git_commit_sha" } | null) {
  await act(() =>
    root.render(
      <SettingsVersionsPane
        webRelease={webRelease}
        webReleaseObservedAt="2026-09-28T10:00:00.000Z"
      />,
    ),
  );
}

function row(id: string) {
  return host.querySelector<HTMLElement>(`[data-version-component="${id}"]`)!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  healthState.value = null;
  delete window.talentSignalDesktop;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  delete window.talentSignalDesktop;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows unknown for every component without an authoritative source", async () => {
  await render(null);
  expect(row("web").getAttribute("data-unknown")).toBe("true");
  expect(row("web").textContent).toContain("无法确认版本");
  expect(row("backend").textContent).toContain("未提供版本");
  expect(row("backend").textContent).toContain("此页面没有可用的系统检测");
  expect(row("macos").textContent).toContain("无法确认版本");
  expect(row("macos").textContent).toContain("此处无法读取 macOS 应用窗口");
  expect(row("macos").textContent).toContain("未观测");
  expect(row("macos").textContent).not.toContain("读取于");
  expect(row("ios").textContent).toContain("此设备无法读取");
  expect(row("extension").textContent).toContain("此设备无法读取");
  // No fabricated recency or compatibility claim.
  expect(host.textContent).not.toContain("最新");
  expect(host.textContent).not.toContain("过旧");
});

it("reports the Web build with its validated source and read time", async () => {
  await render({ revision: "a12d51bc", source: "release_file" });
  expect(row("web").textContent).toContain("a12d51bc");
  expect(row("web").textContent).toContain("当前页面的发布回执");
  expect(row("web").querySelector("button")?.textContent).toContain("重新载入本页版本");
  expect(row("web").textContent).toContain("读取于");
  expect(row("web").textContent).toContain("本次页面加载使用的 Web 构建");
  expect(row("web").getAttribute("data-unknown")).toBe("false");
});

it("renders a compact revision with the full SHA available accessibly", async () => {
  const full = "0123456789abcdef0123456789abcdef01234567";
  await render({ revision: full, source: "release_file" });
  const identity = row("web").querySelector<HTMLElement>("[data-full-revision]")!;
  expect(identity.getAttribute("data-full-revision")).toBe(full);
  expect(identity.getAttribute("title")).toBe(full);
  expect(identity.textContent).toContain("012345678…");
  expect(identity.textContent).toContain(full);
  expect(row("web").textContent).toContain("当前页面的发布回执");
  expect(row("web").textContent).toContain("读取于");
});

it("reports a backend revision with source and observation time", async () => {
  healthState.value = healthValue();
  await render({ revision: "a12d51bc", source: "release_file" });
  expect(row("backend").textContent).toContain("abc1234");
  expect(row("backend").textContent).toContain("后端服务的本次运行回报");
  expect(row("backend").textContent).toContain("观测于");
  expect(row("backend").textContent).toContain("后端在本次请求中报告了此版本");
  expect(row("backend").getAttribute("data-unknown")).toBe("false");
});

it("keeps an older backend without the revision unknown", async () => {
  const withoutRevision = { ...observation };
  delete withoutRevision.backend_revision;
  healthState.value = healthValue({ observation: withoutRevision });
  await render(null);
  expect(row("backend").textContent).toContain("未提供版本");
  expect(row("backend").getAttribute("data-unknown")).toBe("true");
  // A healthy request is not version readback.
  expect(row("backend").textContent).toContain("本次请求路径已到达后端，但后端未提供版本标识");
  expect(row("backend").textContent).not.toContain("本次请求已确认这个后端版本");
});

it("keeps stale and session-expired ordering ahead of a missing revision", async () => {
  const withoutRevision = { ...observation };
  delete withoutRevision.backend_revision;
  healthState.value = healthValue({ observation: withoutRevision, stale: true });
  await render(null);
  expect(row("backend").textContent).toContain("上次结果已过期");

  healthState.value = healthValue({
    observation: null,
    phase: "session_expired",
    stale: true,
  });
  await render(null);
  expect(row("backend").textContent).toContain("登录会话已过期");
});

it("shows loading, error, stale and refresh states for the backend", async () => {
  healthState.value = healthValue({ observation: null, phase: "loading" });
  await render(null);
  expect(row("backend").textContent).toContain("正在读取后端状态");

  healthState.value = healthValue({ observation: null, phase: "error" });
  await render(null);
  expect(row("backend").textContent).toContain("暂时无法读取后端状态");

  healthState.value = healthValue({ stale: true });
  await render(null);
  expect(row("backend").textContent).toContain("上次结果已过期");

  const refresh = vi.fn();
  healthState.value = healthValue({ refreshing: true, refresh });
  await render(null);
  const button = row("backend").querySelector<HTMLButtonElement>("button")!;
  expect(button.textContent).toContain("读取中");
  expect(button.disabled).toBe(true);
  expect(refresh).not.toHaveBeenCalled();
});

it("calls refresh when the user re-reads the backend", async () => {
  const refresh = vi.fn();
  healthState.value = healthValue({ refresh });
  await render(null);
  const button = row("backend").querySelector<HTMLButtonElement>("button")!;
  await act(() => button.click());
  expect(refresh).toHaveBeenCalledOnce();
});

it("marks the Mac bridge as not observable when absent", async () => {
  await render(null);
  expect(row("macos").textContent).toContain("此处无法读取 macOS 应用窗口");
  expect(row("macos").textContent).toContain("未观测");
  expect(row("macos").textContent).not.toContain("读取于");
  expect(row("macos").textContent).not.toMatch(/\d{1,2}:\d{2}/);
  expect(row("macos").textContent).toContain("无法读取本地版本或更新状态");
});

it("reads the Mac app version and update from the native bridge", async () => {
  window.talentSignalDesktop = {
    protocolVersion: 1,
    availableVersion: null,
    appVersion: "0.2.0 (29)",
    update: { phase: "available", availableVersion: "0.3.0" },
  };
  await render(null);
  expect(row("macos").textContent).toContain("0.2.0 (29)");
  expect(row("macos").textContent).toContain("有可用更新 0.3.0");
  expect(row("macos").textContent).toContain("此设备的应用窗口");
  expect(row("macos").textContent).toContain("读取于");
  expect(row("macos").getAttribute("data-unknown")).toBe("false");

  window.talentSignalDesktop = {
    protocolVersion: 1,
    availableVersion: null,
    appVersion: "<img src=x>",
  };
  await act(() => {
    window.dispatchEvent(new Event("talent-signal-desktop"));
  });
  expect(row("macos").textContent).toContain("无法确认版本");
});

it("does not imply a Mac update check when the host only reports idle", async () => {
  window.talentSignalDesktop = {
    protocolVersion: 1,
    availableVersion: null,
    appVersion: "0.2.0 (29)",
    update: { phase: "idle" },
  };
  await render(null);
  expect(row("macos").textContent).toContain("更新状态未验证");
  expect(row("macos").textContent).not.toContain("暂无更新");
});
