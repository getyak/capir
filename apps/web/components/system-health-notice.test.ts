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
});
