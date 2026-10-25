// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace',useSearchParams:()=>new URLSearchParams()}));
vi.mock('./workspace-search',()=>({useWorkspaceDirectory:()=>({data:{people:{people:[]}},loading:false,failed:false,retry:vi.fn()})}));
import { WorkspaceNavigationContinuityProvider } from './workspace-navigation-continuity';
import { WorkspaceComposer } from './workspace-composer';
import { invalidateWorkspaceDirectory } from '@/lib/workspace-directory-cache';
import { WORKSPACE_SESSION_EXPIRED_EVENT } from './workspace-session-request';
const TEXT='An unsent original draft with a selected phrase.';
const SESSION='10000000-0000-4000-8000-000000000001';
const OTHER='10000000-0000-4000-8000-000000000002';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render({shown=true,value=TEXT,scope='a'.repeat(64),viewKey=SESSION}:{shown?:boolean;value?:string;scope?:string;viewKey?:string}={}){
 await act(()=>root.render(<WorkspaceNavigationContinuityProvider scope={scope} binding="binding">{shown?<WorkspaceComposer id="test-composer" viewKey={viewKey} label="Message" value={value} maxLength={1000} placeholder="Write" variant="home" canSubmit binding="binding" onValueChange={()=>{}} onSubmit={()=>{}} onNavigate={()=>{}}/>:<button>Person detail</button>}</WorkspaceNavigationContinuityProvider>));
}
function field(){return host.querySelector('textarea')!;}
async function select(){await act(()=>{field().focus();field().setSelectionRange(3,11,'backward');field().dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));field().scrollTop=32;field().dispatchEvent(new Event('scroll',{bubbles:true}));});}
it('restores the exact selection and input scroll after returning without taking focus',async()=>{await render();await select();await render({shown:false});await render();expect(field().selectionStart).toBe(3);expect(field().selectionEnd).toBe(11);expect(field().selectionDirection).toBe('backward');expect(field().scrollTop).toBe(32);expect(document.activeElement).not.toBe(field());});
it('waits for asynchronous draft recovery before restoring the matching selection',async()=>{await render();await select();await render({shown:false});await render({value:''});await render();expect(field().selectionStart).toBe(3);expect(field().selectionEnd).toBe(11);});
it('does not apply a previous draft selection to changed content or another session',async()=>{await render();await select();await render({shown:false});await render({value:'A different draft'});expect(field().selectionStart).not.toBe(3);await render({shown:false});await render({viewKey:OTHER});expect(field().selectionStart).not.toBe(3);});
it('clears presentation state across account changes, including A to B to A',async()=>{await render();await select();await render({scope:'b'.repeat(64)});await render({scope:'a'.repeat(64)});await render({shown:false});await render();expect(field().selectionStart).not.toBe(3);});
it('fences remembered selections after confirmed session expiry',async()=>{await render();await select();await render({shown:false});await act(()=>window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));await render();expect(field().selectionStart).not.toBe(3);});
it('captures the final IME value on pointer commit without a later key or click',async()=>{
 await render();await select();
 await act(()=>field().dispatchEvent(new CompositionEvent('compositionstart',{data:'中',bubbles:true})));
 const final=TEXT.slice(0,3)+'中文'+TEXT.slice(11);
 await act(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;setter.call(field(),final);field().dispatchEvent(new InputEvent('input',{bubbles:true,data:'文',inputType:'insertCompositionText',isComposing:true}));});
 await render({value:final});
 await act(()=>{field().setSelectionRange(5,5);field().dispatchEvent(new CompositionEvent('compositionend',{data:'中文',bubbles:true}));});
 await render({shown:false,value:final});await render({value:final});
 expect(field().selectionStart).toBe(5);expect(field().selectionEnd).toBe(5);
});
it('forgets a cleared draft rather than restoring the previous editing point',async()=>{await render();await select();await render({value:''});await render();await render({shown:false});await render();expect(field().selectionStart).not.toBe(3);});

it('discards presentation state when this credential binding is revoked',async()=>{await render();await select();await render({shown:false});await act(()=>invalidateWorkspaceDirectory('binding','discard'));await render();expect(field().selectionStart).not.toBe(3);});
it('preserves presentation for ordinary refreshes and unrelated credential discards',async()=>{await render();await select();await render({shown:false});await act(()=>{invalidateWorkspaceDirectory('binding');invalidateWorkspaceDirectory('another-binding','discard');});await render();expect(field().selectionStart).toBe(3);});

it('does not let initial focus erase a selection before its draft finishes restoring',async()=>{await render();await select();await render({shown:false});await render({value:''});await act(()=>field().focus());await render();expect(field().selectionStart).toBe(3);expect(field().selectionEnd).toBe(11);expect(document.activeElement).toBe(field());});
