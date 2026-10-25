// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, Children, cloneElement, createElement, isValidElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
const {claims,settings,testCookie,auth} = vi.hoisted(()=>({claims:vi.fn(),settings:vi.fn(),testCookie:{present:true},auth:vi.fn()}));
vi.mock("@/lib/server/marketing-locale",()=>({getMarketingLocale:async()=>"zh-CN"}));
vi.mock("@/auth",()=>({auth}));
vi.mock("next/headers",()=>({cookies:async()=>({has:()=>testCookie.present})}));
vi.mock("@/app/login/actions",()=>({signOutFromAccountMenu:vi.fn()}));
vi.mock("@/app/workspace/settings/testing/actions",()=>({leaveTestWorkspace:vi.fn()}));
vi.mock("@/lib/server/accountBackend",()=>({loadAccountSettings:settings}));
vi.mock("@/lib/server/backendAuth",()=>({authSecret:()=>"synthetic-layout-test-secret",readBackendSessionClaims:claims,readPrimaryBackendSessionClaims:async()=>null}));
vi.mock("@/lib/server/testWorkspaceSession",()=>({testWorkspaceSession:async()=>null,TEST_WORKSPACE_COOKIE:"test-cookie"}));
vi.mock("@/components/talent-signal-lab/lab-shell",()=>({TalentSignalLabShell:()=>null}));
vi.mock("@/components/workspace-shell-nav",()=>({WorkspaceCaptureLink:()=>null,WorkspaceMobileSourcesLink:()=>null,WorkspaceShellNav:()=>null}));
vi.mock("@/components/theme-toggle",()=>({ThemeToggle:()=>null}));
import WorkspaceLayout from "./layout";
import { WorkspaceSessionBoundary } from "@/components/workspace-session-boundary";
import { WorkspaceAccessRecovery } from "@/components/workspace-access-recovery";
async function resolvedWorkspaceLayout(props: Parameters<typeof WorkspaceLayout>[0]) {
  const layout = await WorkspaceLayout(props);
  const children = await Promise.all(Children.toArray(layout.props.children).map(child =>
    isValidElement<Parameters<typeof WorkspaceAccessRecovery>[0]>(child) && child.type === WorkspaceAccessRecovery
      ? WorkspaceAccessRecovery(child.props) : child));
  return cloneElement(layout, undefined, ...children);
}
function snapshot(value: unknown): string {
 return JSON.stringify(value, (key,item) => key === "type" || key.startsWith("_") ? undefined : item);
}
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({user:{name:"Owner"}});testCookie.present=true;settings.mockRejectedValue(new Error("Settings unavailable"));});
it("retains effective workspace scope when optional settings fail",async()=>{
 claims.mockResolvedValue({backendAccessToken:"synthetic-owned-session",backendRole:"member",backendUsername:"owner",backendAccountId:"rendered-test",backendUserId:"user-1",backendAccountName:"Test",backendAccountSlug:"lab-test",backendExpiresAt:new Date(Date.now()+60000).toISOString()});
 const layout=await resolvedWorkspaceLayout({children:"operational-child"});
 expect(layout.type).toBe(WorkspaceSessionBoundary);
 expect(layout.props.binding).toMatch(/^[a-f0-9]{64}$/);
 const rendered=snapshot(layout);
 expect(rendered).toContain('"data-workspace-scope":"rendered-test"');
 expect(rendered).toContain("operational-child");
 expect(settings).toHaveBeenCalledOnce();
});
it.each([null,{backendAccountId:"expired-test",backendExpiresAt:"2000-01-01T00:00:00Z"}])("does not render workspace or Lab controls without a current scope",async scope=>{
 claims.mockResolvedValue(scope);
 const rendered=snapshot(await resolvedWorkspaceLayout({children:"operational-child"}));
 expect(rendered).not.toContain("operational-child");
 expect(rendered).not.toContain("workspace-content");
 expect(rendered).toContain("返回我的空间");
});

it("refreshes profile labels without changing the authenticated scope",async()=>{
 claims.mockResolvedValue({backendAccessToken:"synthetic-owned-session",backendRole:"member",backendUsername:"owner",backendAccountId:"rendered-test",backendUserId:"user-1",backendAccountName:"Old workspace",backendAccountSlug:"test",backendExpiresAt:new Date(Date.now()+60000).toISOString()});
 settings.mockResolvedValue({workspace:{id:"rendered-test",name:"Updated workspace"},user:{id:"user-1",display_name:"Updated name"}});
 const rendered=snapshot(await resolvedWorkspaceLayout({children:"operational-child"}));
 expect(rendered).toContain("Updated name");
 expect(rendered).toContain("Updated workspace");
 expect(rendered).toContain('"data-workspace-scope":"rendered-test"');
});
it("rejects labels returned for another identity",async()=>{
 claims.mockResolvedValue({backendAccessToken:"synthetic-owned-session",backendRole:"member",backendUsername:"owner",backendAccountId:"rendered-test",backendUserId:"user-1",backendAccountName:"Test",backendAccountSlug:"test",backendExpiresAt:new Date(Date.now()+60000).toISOString()});
 settings.mockResolvedValue({workspace:{id:"other",name:"Other workspace"},user:{id:"other",display_name:"Other user"}});
 const rendered=snapshot(await resolvedWorkspaceLayout({children:"operational-child"}));
 expect(rendered).not.toContain("Other user");
 expect(rendered).toContain('"accountName":"Owner"');
});

it("keeps reauthentication and all scope-clearing boundaries when no test cookie exists", async () => {
  claims.mockResolvedValue(null);
  testCookie.present = false;
  const layout = await resolvedWorkspaceLayout({ children: "private-operational-child" });
  const rendered = snapshot(layout);
  expect(renderToStaticMarkup(layout)).toContain("/login?reason=backend_session_expired");
  expect(rendered).not.toContain("返回我的空间");
  expect(rendered).not.toContain("private-operational-child");
  expect(rendered).toContain('"sessionVersion":null');
  expect(rendered).toContain('"storageScope":null');
  expect(rendered).toContain('"binding":null');
});

// A revoked outer layout must retain a bounded identity-entry locator while
// continuing to remove all private content and its storage bindings.
it.each([
  ["/workspace?surface=desk&intent=create-contact&session=33333333-3333-4333-8333-333333333333&name=private&token=secret", "/workspace?surface=desk&intent=create-contact&session=33333333-3333-4333-8333-333333333333"],
  ["/workspace?surface=desk&intent=create-contact&session=invalid", "/workspace?surface=desk&intent=create-contact"],
  ["/workspace/people?surface=desk&intent=create-contact", null],
  ["/workspace?surface=desk&intent=delete-person&name=private", null],
  ["/workspace?surface=desk&intent=create-contact&intent=delete-person", null],
])("reauthenticates from %s without retaining form content or arbitrary actions", async (location, expected) => {
  claims.mockResolvedValue(null); testCookie.present = false;
  window.history.replaceState(null, "", location);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  try {
    const layout = await resolvedWorkspaceLayout({ children: createElement("p", null, "private child") });
    await act(async () => root.render(layout));
    const anchor = [...mount.querySelectorAll("a")].find(link => link.textContent?.includes("重新登录"));
    const destination = new URL(anchor!.getAttribute("href")!, "https://workspace.invalid");
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("reason")).toBe("backend_session_expired");
    expect(destination.searchParams.get("callbackUrl")).toBe(expected);
    expect(destination.href).not.toContain("private");
    expect(destination.href).not.toContain("secret");
    expect(mount.textContent).not.toContain("private child");
  } finally {
    await act(async () => root.unmount()); mount.remove();
    window.history.replaceState(null, "", "/"); vi.unstubAllGlobals();
  }
});

it("retains a null-scope completion observer when authentication disappears without taking over the child redirect", async () => {
  auth.mockResolvedValue(null);
  const layout = await resolvedWorkspaceLayout({ children: "callback-owned-child" });
  expect(layout.type).toBe(WorkspaceSessionBoundary); expect(layout.props.binding).toBeNull();
  const rendered = snapshot(layout); expect(rendered).toContain("callback-owned-child");
  expect(rendered).toContain('"sessionVersion":null'); expect(rendered).toContain('"storageScope":null');
  expect(claims).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled();
});
