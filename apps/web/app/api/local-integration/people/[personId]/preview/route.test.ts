import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({claims:vi.fn(),load:vi.fn(),mode:vi.fn()}));
vi.mock("@/lib/server/backendAuth",()=>({readBackendSessionClaims:mocks.claims}));
vi.mock("@/lib/server/localBackend",()=>({isIntegrationMode:mocks.mode}));
vi.mock("@/lib/server/personContextPreview",()=>({loadPersonContextPreview:mocks.load}));
vi.mock("@/lib/server/workspaceSessions",()=>({workspaceSessionsBinding:()=>"current",isWorkspaceSessionId:(id:string)=>/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-8[\da-f]{3}-[\da-f]{12}$/.test(id)}));
import {GET} from "./route";
import {BackendSessionExpiredError} from "@/lib/backend-session";
const id="10000000-0000-4000-8000-000000000041";
const request=(binding="current")=>new Request(`http://localhost/api/local-integration/people/${id}/preview`,{headers:{"x-workspace-session":binding}});
beforeEach(()=>{vi.resetAllMocks();mocks.mode.mockReturnValue(true);mocks.claims.mockResolvedValue({backendExpiresAt:new Date(Date.now()+60000).toISOString()});mocks.load.mockResolvedValue({person:{id},session_version:"current"});});
describe("authenticated preview ingress",()=>{
  it("returns the recovery code without private payload when a later read rejects authentication",async()=>{
    mocks.load.mockRejectedValue(new BackendSessionExpiredError());
    const result=await GET(request(),{params:Promise.resolve({personId:id})});
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({code:"backend_session_expired"});
  });
  it("rejects missing authentication and stale credential binding before upstream reads",async()=>{
    mocks.claims.mockResolvedValue(null);expect((await GET(request(),{params:Promise.resolve({personId:id})})).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.claims.mockResolvedValue({backendExpiresAt:new Date(Date.now()+60000).toISOString()});
    expect((await GET(request("stale"),{params:Promise.resolve({personId:id})})).status).toBe(409);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("rejects invalid person IDs and disables the integration honestly",async()=>{
    expect((await GET(request(),{params:Promise.resolve({personId:"same-name"})})).status).toBe(400);
    mocks.mode.mockReturnValue(false);expect((await GET(request(),{params:Promise.resolve({personId:id})})).status).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("reads the exact UUID and returns a non-cacheable bound projection",async()=>{
    const result=await GET(request(),{params:Promise.resolve({personId:id})});
    expect(mocks.load).toHaveBeenCalledWith(id,"current");expect(result.status).toBe(200);expect(result.headers.get("cache-control")).toContain("no-store");
  });
});
