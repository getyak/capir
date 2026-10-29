// @vitest-environment happy-dom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({path:"/workspace",fetch:vi.fn()}));
vi.mock("next/navigation",()=>({usePathname:()=>mocks.path}));
vi.mock("./person-directory-avatar",()=>({PersonDirectoryAvatar:()=>null}));
vi.mock("./workspace-session-request",()=>({workspaceSessionFetch:mocks.fetch,WORKSPACE_SESSION_EXPIRED_EVENT:"expired"}));
import {PersonContextPanelProvider,usePersonContextPanel} from "./person-context-panel";
import {requestWorkspaceRefresh} from "@/lib/workspace-refresh";
import {invalidateWorkspaceDirectory} from "@/lib/workspace-directory-cache";
import {LocaleProvider} from "./locale-provider";
import type {MarketingLocale} from "@/lib/marketing-locale";
let root:Root, host:HTMLDivElement;
function Buttons(){const panel=usePersonContextPanel();return createElement("div",null,...["a","b"].map(id=>createElement("button",{key:id,onClick:(event:React.MouseEvent<HTMLButtonElement>)=>panel.open(id,event.currentTarget)},id)));}
const render=async(binding="binding")=>act(async()=>{root.render(<PersonContextPanelProvider binding={binding}><Buttons /></PersonContextPanelProvider>);});
const click=async(name:string)=>act(async()=>{Array.from(host.querySelectorAll("button")).find(button=>button.textContent===name)?.click();});
const body=(id:string)=>({person:{id,label:`same name ${id}`,headline:null,avatarUrl:null,contexts:[]},session_version:"binding",memory:[],history:[],historyUnavailable:false});
beforeEach(()=>{vi.resetAllMocks();mocks.path="/workspace";Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(window,"matchMedia",{configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe("person preview ownership",()=>{
  it.each([
    ["en", "Person context", "No saved context yet."],
    ["zh-CN", "人物背景", "暂无已保存的相关记忆。"],
    ["zh-TW", "人物背景", "暫無已儲存的相關記憶。"],
    ["ja", "人物の背景", "保存された関連メモリはまだありません。"],
    ["ko", "인물 배경", "저장된 관련 기억이 없습니다."],
  ] as const)("uses the host locale %s without changing person data",async(locale,title,empty)=>{
    mocks.fetch.mockResolvedValue(Response.json(body("a")));
    await act(async()=>root.render(<LocaleProvider locale={locale as MarketingLocale}><PersonContextPanelProvider binding="binding"><Buttons /></PersonContextPanelProvider></LocaleProvider>));
    await click("a");
    const panel=document.querySelector('[role="dialog"]')!;
    expect(panel.querySelector("h2")?.textContent).toBe(title);
    expect(panel.textContent).toContain(empty);
    expect(panel.textContent).toContain("same name a");
  });
  it("formats historical dates in the active locale and preserves saved evidence wording",async()=>{
    mocks.fetch.mockResolvedValue(Response.json({...body("a"),memory:[{id:"fact",text:"原始保留的中文",scope:"person",kind:"source_statement",timeStatus:"known",speaker:"林岚",observedAt:"2025-12-24T12:00:00Z",evidenceRetained:true}],history:[{id:"older-session",title:"Original session title",updatedAt:"2025-12-24T12:00:00Z"}]}));
    await act(async()=>root.render(<LocaleProvider locale="en"><PersonContextPanelProvider binding="binding"><Buttons /></PersonContextPanelProvider></LocaleProvider>));
    await click("a");
    const panel=document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain("原始保留的中文");
    expect(panel.textContent).toContain("Dec 24, 2025");
    expect(panel.querySelector("time")?.textContent).toBe("Dec 24, 2025");
    expect(panel.textContent).toContain("Source statements");
    expect(panel.querySelector('a[href="/workspace/sessions/older-session"]')?.textContent).toContain("Original session title");
  });
  it("keeps malformed source time visibly unknown instead of breaking the context panel",async()=>{
    mocks.fetch.mockResolvedValue(Response.json({...body("a"),memory:[{id:"fact",text:"已保存的内容",scope:"person",kind:"fact",timeStatus:"known",speaker:null,observedAt:"not-a-date",evidenceRetained:true}]}));
    await render();await click("a");
    const panel=document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain("已保存的内容");
    expect(panel.textContent).toContain("时间未知");
  });
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
    await render();await click("a");await act(async()=>invalidateWorkspaceDirectory(undefined,"revalidate"));
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
  it("withdraws a loaded discarded binding and never rereads it through refresh or reopening",async()=>{
    mocks.fetch.mockImplementation(()=>Promise.resolve(Response.json(body("a"))));
    await render();await click("a");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("same name a");
    await act(async()=>invalidateWorkspaceDirectory("binding","discard"));
    expect(document.body.textContent).not.toContain("same name a");
    const retry=Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button=>button.textContent==="重试");
    if(retry) await act(async()=>retry.click());
    await act(async()=>{
      requestWorkspaceRefresh("binding","interval");
      invalidateWorkspaceDirectory("binding","revalidate");
      invalidateWorkspaceDirectory(undefined,"revalidate");
    });
    await click("a");await click("b");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="alert"] button')).toBeNull();
  });
  it("fences a pending response after discard even when its transport ignores abort",async()=>{
    let resolve!:(response:Response)=>void;
    let signal:AbortSignal|undefined;
    mocks.fetch.mockImplementation((_url:string,options:RequestInit)=>{signal=options.signal as AbortSignal;return new Promise<Response>(done=>{resolve=done;});});
    await render();await click("a");
    await act(async()=>invalidateWorkspaceDirectory("binding","discard"));
    expect(signal?.aborted).toBe(true);
    await act(async()=>resolve(Response.json(body("a"))));
    expect(document.body.textContent).not.toContain("same name a");
    const close=document.querySelector<HTMLButtonElement>('[aria-label="关闭人物背景"]');
    if(close) await act(async()=>close.click());
    await click("a");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("keeps a discarded binding denied across closing and newer binding changes",async()=>{
    mocks.fetch.mockResolvedValueOnce(Response.json(body("a"))).mockResolvedValueOnce(Response.json({...body("b"),session_version:"new-binding"}));
    await render();await click("a");
    await act(async()=>invalidateWorkspaceDirectory("binding","discard"));
    await render("new-binding");await click("b");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("same name b");
    expect(mocks.fetch).toHaveBeenLastCalledWith("/api/local-integration/people/b/preview",expect.objectContaining({headers:{"x-workspace-session":"new-binding"}}));
    await render("binding");await click("a");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("remembers a global discard even while the panel is closed",async()=>{
    mocks.fetch.mockResolvedValue(Response.json(body("a")));
    await render();
    await act(async()=>invalidateWorkspaceDirectory(undefined,"discard"));
    await click("a");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("ignores another binding's discard without hiding authorized person content",async()=>{
    mocks.fetch.mockImplementation(()=>Promise.resolve(Response.json(body("a"))));
    await render();await click("a");
    await act(async()=>invalidateWorkspaceDirectory("other-binding","discard"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("same name a");
    await act(async()=>requestWorkspaceRefresh("binding","interval"));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("allows an ordinary failed read to recover with the same binding",async()=>{
    mocks.fetch.mockResolvedValueOnce(Response.json({code:"temporarily_unavailable"},{status:503})).mockResolvedValueOnce(Response.json(body("a")));
    await render();await click("a");
    const panel=document.querySelector('[role="dialog"]')!;
    expect(panel.querySelector('[role="alert"]')).not.toBeNull();
    await act(async()=>Array.from(panel.querySelectorAll("button")).find(button=>button.textContent==="重试")!.click());
    expect(panel.textContent).toContain("same name a");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
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
