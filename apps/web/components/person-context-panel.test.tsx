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
  it("reads only after an explicit person selection",async()=>{
    mocks.fetch.mockResolvedValue(Response.json(body("a")));
    await render();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("a");
    expect(mocks.fetch).toHaveBeenCalledWith("/api/local-integration/people/a/preview",expect.objectContaining({headers:{"x-workspace-session":"binding"}}));
  });
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
  it("aborts an expired panel's read and cannot reopen it with a late response",async()=>{
    let resolve!:(response:Response)=>void;
    let signal:AbortSignal|undefined;
    mocks.fetch.mockImplementation((_url:string,options:RequestInit)=>{signal=options.signal as AbortSignal;return new Promise<Response>(done=>{resolve=done;});});
    await render();await click("a");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("正在读取");
    await act(async()=>window.dispatchEvent(new Event("expired")));
    expect(signal?.aborted).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async()=>resolve(Response.json(body("a"))));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("shows a failed scoped read without stale content and recovers only through retry",async()=>{
    mocks.fetch.mockResolvedValueOnce(Response.json({...body("a"),session_version:"other-account"})).mockResolvedValueOnce(Response.json(body("a")));
    await render();await click("a");
    const panel=document.querySelector('[role="dialog"]')!;
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain("暂时无法读取");
    expect(panel.textContent).not.toContain("same name a");
    await act(async()=>Array.from(panel.querySelectorAll("button")).find(button=>button.textContent==="重试")!.click());
    expect(panel.textContent).toContain("same name a");
    expect(panel.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("temporary person context sheet",()=>{
  it.each([false,true])("contains focus at narrow=%s while the underlying workspace stays inert",async(narrow)=>{
    Object.defineProperty(window,"matchMedia",{configurable:true,value:()=>({matches:narrow,addEventListener(){},removeEventListener(){}})});
    mocks.fetch.mockResolvedValue(Response.json(body("a")));
    await render();await click("a");
    const panel=document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.querySelector('[data-person-context-overlay]')).not.toBeNull();
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(panel.contains(document.activeElement)).toBe(true);
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.focus());
    expect(panel.contains(document.activeElement)).toBe(true);
  });
  it.each(["close","Escape","outside"])("dismisses with %s and restores the exact opener",async(method)=>{
    mocks.fetch.mockResolvedValue(Response.json(body("a")));
    await render();
    const opener=host.querySelector<HTMLButtonElement>("button")!;
    await act(async()=>{opener.focus();opener.click();});
    const panel=document.querySelector<HTMLElement>('[role="dialog"]')!;
    if(method==="close") await act(async()=>panel.querySelector<HTMLButtonElement>('[aria-label="关闭人物背景"]')!.click());
    else if(method==="Escape") await act(async()=>panel.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
    else {
      // Radix registers the document pointer listener after the opening press.
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
      const overlay=document.querySelector('[data-person-context-overlay]')!;
      await act(async()=>overlay.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerType:"mouse",button:0})));
      // Dialog 1.1.23 defers primary-button outside dismissal to the completed
      // click. happy-dom does not generate that click from a dispatched press.
      expect(document.querySelector('[role="dialog"]')).toBe(panel);
      await act(async()=>{
        overlay.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerType:"mouse",button:0}));
        overlay.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,button:0}));
      });
    }
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await vi.waitFor(()=>expect(document.activeElement).toBe(opener));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
