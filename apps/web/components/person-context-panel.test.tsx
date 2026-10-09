// @vitest-environment happy-dom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({path:"/workspace",fetch:vi.fn(),listener:null as null | ((keys:readonly string[]|null,mode:string)=>void)}));
vi.mock("next/navigation",()=>({usePathname:()=>mocks.path}));
vi.mock("./person-directory-avatar",()=>({PersonDirectoryAvatar:()=>null}));
vi.mock("./workspace-session-request",()=>({workspaceSessionFetch:mocks.fetch,WORKSPACE_SESSION_EXPIRED_EVENT:"expired"}));
vi.mock("@/lib/workspace-directory-cache",()=>({subscribeWorkspaceDirectoryInvalidation:(listener:typeof mocks.listener)=>{mocks.listener=listener;return()=>{mocks.listener=null;};}}));
import {PersonContextPanelProvider,usePersonContextPanel} from "./person-context-panel";
import {requestWorkspaceRefresh} from "@/lib/workspace-refresh";
let root:Root, host:HTMLDivElement;
function Buttons(){const panel=usePersonContextPanel();return createElement("div",null,...["a","b"].map(id=>createElement("button",{key:id,onClick:(event:React.MouseEvent<HTMLButtonElement>)=>panel.open(id,event.currentTarget)},id)));}
const render=async(binding="binding")=>act(async()=>{root.render(<PersonContextPanelProvider binding={binding}><Buttons /></PersonContextPanelProvider>);});
const click=async(name:string)=>act(async()=>{Array.from(host.querySelectorAll("button")).find(button=>button.textContent===name)?.click();});
const body=(id:string)=>({person:{id,label:`same name ${id}`,headline:null,avatarUrl:null,contexts:[]},session_version:"binding",memory:[],history:[],historyUnavailable:false});
beforeEach(()=>{vi.resetAllMocks();mocks.path="/workspace";Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(window,"matchMedia",{configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe("person preview ownership",()=>{
  it("clears remotely deleted content on the shared active refresh",async()=>{
    mocks.fetch.mockResolvedValueOnce(Response.json(body("a"))).mockResolvedValueOnce(Response.json({code:"person_unavailable"},{status:404}));
    await render();await click("a");
    await act(async()=>requestWorkspaceRefresh("binding","interval"));
    const panel=document.querySelector('[role="dialog"]');
    expect(panel?.textContent).toContain("暂时无法读取");expect(panel?.textContent).not.toContain("same name a");
  });
  it("distinguishes saved facts from user opinion",async()=>{
    mocks.fetch.mockResolvedValue(Response.json({...body("a"),memory:[{id:"fact",text:"合成事实",scope:"person",kind:"fact"},{id:"opinion",text:"合成观点",scope:"person",kind:"user_opinion"}]}));
    await render();await click("a");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("已保存事实");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("用户观点");
  });
  it("preserves the canonical Session return parameter and gives Portal content shared theme scope",async()=>{
    const session="10000000-0000-4000-8000-000000000041";
    mocks.path=`/workspace/sessions/${session}`;
    mocks.fetch.mockResolvedValue(Response.json(body("a")));await render();await click("a");
    const panel=document.querySelector('[role="dialog"]');
    expect(panel?.classList.contains("ts-workspace-theme")).toBe(true);
    expect(panel?.querySelector('a')?.getAttribute("href")).toBe(`/workspace/people/a?session=${session}`);
  });
  it("discards an older response even when two people share a label",async()=>{
    let first!:(r:Response)=>void; mocks.fetch.mockImplementationOnce(()=>new Promise<Response>(resolve=>{first=resolve;})).mockResolvedValueOnce(Response.json(body("b")));
    await render();await click("a");await click("b");await act(async()=>first(Response.json(body("a"))));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("same name b");expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("same name a");
  });
  it("hides all previous person content synchronously on an account binding change",async()=>{
    mocks.fetch.mockResolvedValue(Response.json(body("a")));await render();await click("a");expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await render("other-account");expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("drops saved content when deletion invalidates the directory and the new read fails",async()=>{
    mocks.fetch.mockResolvedValueOnce(Response.json(body("a"))).mockResolvedValueOnce(Response.json({code:"person_unavailable"},{status:404}));
    await render();await click("a");await act(async()=>mocks.listener?.(null,"revalidate"));
    const panel=document.querySelector('[role="dialog"]');expect(panel?.textContent).toContain("暂时无法读取");expect(panel?.textContent).not.toContain("same name a");
  });
});
