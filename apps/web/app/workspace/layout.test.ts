import { beforeEach, expect, it, vi } from "vitest";
const {claims,settings} = vi.hoisted(()=>({claims:vi.fn(),settings:vi.fn()}));
vi.mock("@/auth",()=>({auth:async()=>({user:{name:"Owner"}})}));
vi.mock("next/headers",()=>({cookies:async()=>({has:()=>true})}));
vi.mock("@/app/login/actions",()=>({signOutOfWorkspace:vi.fn()}));
vi.mock("@/app/workspace/settings/testing/actions",()=>({leaveTestWorkspace:vi.fn()}));
vi.mock("@/lib/server/accountBackend",()=>({loadAccountSettings:settings}));
vi.mock("@/lib/server/backendAuth",()=>({authSecret:()=>"synthetic-layout-test-secret",readBackendSessionClaims:claims,readPrimaryBackendSessionClaims:async()=>null}));
vi.mock("@/lib/server/testWorkspaceSession",()=>({testWorkspaceSession:async()=>null,TEST_WORKSPACE_COOKIE:"test-cookie"}));
vi.mock("@/components/talent-signal-lab/lab-shell",()=>({TalentSignalLabShell:()=>null}));
vi.mock("@/components/workspace-shell-nav",()=>({WorkspaceCaptureLink:()=>null,WorkspaceMobileSourcesLink:()=>null,WorkspaceShellNav:()=>null}));
vi.mock("@/components/theme-toggle",()=>({ThemeToggle:()=>null}));
import WorkspaceLayout from "./layout";
function snapshot(value: unknown): string {
 return JSON.stringify(value, (key,item) => key === "type" || key.startsWith("_") ? undefined : item);
}
beforeEach(()=>{vi.clearAllMocks();settings.mockRejectedValue(new Error("Settings unavailable"));});
it("retains effective workspace scope when optional settings fail",async()=>{
 claims.mockResolvedValue({backendAccessToken:"synthetic-owned-session",backendRole:"member",backendUsername:"owner",backendAccountId:"rendered-test",backendUserId:"user-1",backendAccountName:"Test",backendAccountSlug:"lab-test",backendExpiresAt:new Date(Date.now()+60000).toISOString()});
 const rendered=snapshot(await WorkspaceLayout({children:"operational-child"}));
 expect(rendered).toContain('"data-workspace-scope":"rendered-test"');
 expect(rendered).toContain("operational-child");
 expect(settings).toHaveBeenCalledOnce();
});
it.each([null,{backendAccountId:"expired-test",backendExpiresAt:"2000-01-01T00:00:00Z"}])("does not render workspace or Lab controls without a current scope",async scope=>{
 claims.mockResolvedValue(scope);
 const rendered=snapshot(await WorkspaceLayout({children:"operational-child"}));
 expect(rendered).not.toContain("operational-child");
 expect(rendered).not.toContain("workspace-content");
 expect(rendered).toContain("返回我的空间");
});

it("refreshes profile labels without changing the authenticated scope",async()=>{
 claims.mockResolvedValue({backendAccessToken:"synthetic-owned-session",backendRole:"member",backendUsername:"owner",backendAccountId:"rendered-test",backendUserId:"user-1",backendAccountName:"Old workspace",backendAccountSlug:"test",backendExpiresAt:new Date(Date.now()+60000).toISOString()});
 settings.mockResolvedValue({workspace:{id:"rendered-test",name:"Updated workspace"},user:{id:"user-1",display_name:"Updated name"}});
 const rendered=snapshot(await WorkspaceLayout({children:"operational-child"}));
 expect(rendered).toContain("Updated name");
 expect(rendered).toContain("Updated workspace");
 expect(rendered).toContain('"data-workspace-scope":"rendered-test"');
});
it("rejects labels returned for another identity",async()=>{
 claims.mockResolvedValue({backendAccessToken:"synthetic-owned-session",backendRole:"member",backendUsername:"owner",backendAccountId:"rendered-test",backendUserId:"user-1",backendAccountName:"Test",backendAccountSlug:"test",backendExpiresAt:new Date(Date.now()+60000).toISOString()});
 settings.mockResolvedValue({workspace:{id:"other",name:"Other workspace"},user:{id:"other",display_name:"Other user"}});
 const rendered=snapshot(await WorkspaceLayout({children:"operational-child"}));
 expect(rendered).not.toContain("Other user");
 expect(rendered).toContain('"accountName":"Owner"');
});
