import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/people" }));
import { HealthNotice } from "./system-health-provider";
import { unavailableSystemHealth } from "@/lib/system-health";

describe("ordinary workspace diagnostic attention", () => {
  it("does not interrupt reading merely because a healthy probe expired", () => {
    const observation = unavailableSystemHealth();
    observation.status = "healthy";
    observation.components = observation.components.map(item => ({ ...item, status: "healthy" }));
    const html = renderToStaticMarkup(createElement(HealthNotice, { value: {
      observation, phase: "ready", refreshing: false, stale: true, refresh: async () => {},
    } }));
    expect(html).toBe("");
  });
  it("keeps actual dependency failure visible with its recovery destination", () => {
    const html = renderToStaticMarkup(createElement(HealthNotice, { value: {
      observation: unavailableSystemHealth(), phase: "ready", refreshing: false, stale: false, refresh: async () => {},
    } }));
    expect(html).toContain("服务暂时不可用");
    expect(html).toContain('href="/workspace/settings/diagnostics"');
  });
  it("distinguishes a confirmed schema problem from an unobserved dependency", () => {
    const observation = unavailableSystemHealth();
    observation.status = "degraded";
    observation.components.forEach(item => {
      item.status = "healthy";
      item.detail_code = item.id === "database" ? "query_completed"
        : item.id === "migrations" ? "required_migrations_applied" : "request_completed";
    });
    const migrations = observation.components.find(item => item.id === "migrations")!;
    migrations.status = "degraded";
    migrations.detail_code = "required_migrations_missing";
    const render = (stale = false) => renderToStaticMarkup(createElement(HealthNotice, { value: {
      observation, phase: "ready", refreshing: false, stale, refresh: async () => {},
    } }));
    const confirmed = render();
    expect(confirmed).toContain("部分服务存在异常");
    expect(confirmed).not.toContain("尚未确认");
    expect(confirmed).toContain('href="/workspace/settings/diagnostics"');

    migrations.status = "unknown";
    migrations.detail_code = "not_observed";
    const unknown = render();
    expect(unknown).toContain("部分服务状态尚未确认");
    expect(unknown).not.toContain("存在异常");
    const expiredUnknown = render(true);
    expect(expiredUnknown).toContain("已过期");
    expect(expiredUnknown).not.toContain("异常");
  });
});
