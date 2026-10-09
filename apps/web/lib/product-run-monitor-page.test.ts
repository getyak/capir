import { beforeEach, describe, expect, it, vi } from "vitest";

const { claims, expired, binding, redirect } = vi.hoisted(() => ({
  claims: vi.fn(), expired: vi.fn(), binding: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: claims }));
vi.mock("@/lib/backend-session", () => ({ backendSessionIsExpired: expired }));
vi.mock("@/lib/server/contact-handoff-session", () => ({ contactHandoffSessionVersion: binding }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/product-run-monitor", () => ({ ProductRunMonitor: () => null }));
import MonitorPage from "@/app/workspace/monitor/page";

beforeEach(() => {
  vi.clearAllMocks();
  claims.mockResolvedValue({ backendAccountId: "account", backendAccessToken: "private-token", backendExpiresAt: "expiry" });
  expired.mockReturnValue(false);
  binding.mockReturnValue("opaque-login-a");
  redirect.mockImplementation(() => { throw new Error("redirected"); });
});

describe("monitor login identity", () => {
  it.each(["missing", "expired"])("redirects a %s backend session before rendering any monitoring state", async kind => {
    if (kind === "missing") claims.mockResolvedValue(null);
    else expired.mockReturnValue(true);
    await expect(MonitorPage()).rejects.toThrow("redirected");
    expect(redirect).toHaveBeenCalledWith("/login?callbackUrl=%2Fworkspace%2Fmonitor");
    expect(binding).not.toHaveBeenCalled();
  });

  it("remounts the monitor on a changed opaque login binding without passing credentials", async () => {
    const first = await MonitorPage();
    expect(first.key).toBe("opaque-login-a");
    expect(first.props).toEqual({ sessionBinding: "opaque-login-a" });
    binding.mockReturnValue("opaque-login-b");
    const second = await MonitorPage();
    expect(second.key).toBe("opaque-login-b");
    expect(JSON.stringify(second.props)).not.toContain("private-token");
  });
});
