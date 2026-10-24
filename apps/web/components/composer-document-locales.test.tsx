// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";
import { ComposerDocumentPreview } from "./composer-document";
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { if(root) await act(async()=>root!.unmount()); host?.remove(); });
it("localizes document review and counts while staging only the explicitly chosen original text", async () => {
  Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true });
  host=document.createElement("div"); document.body.append(host); root=createRoot(host);
  const add=vi.fn();
  await act(async()=>root!.render(<LocaleProvider locale="en"><ComposerDocumentPreview record={{key:1,name:"原文.txt",documentType:"text",text:"保持原文",warnings:[],error:null}}
    draftLength={0} maxLength={1000} sendLimit={1000} onAdd={add} onCancel={()=>{}}/></LocaleProvider>));
  const preview=document.querySelector('[data-composer-document]')!;
  expect(preview.textContent).toContain("Full text");
  expect(preview.textContent).toContain("原文.txt");
  expect(preview.textContent).toContain("保持原文");
  expect(preview.textContent).not.toContain("完整文本");
  expect(add).not.toHaveBeenCalled();
  const button=preview.querySelector<HTMLButtonElement>('[data-composer-document-add]')!;
  expect(button.textContent).toContain("Add to draft");
  act(()=>button.click());
  expect(add).toHaveBeenCalledExactlyOnceWith("保持原文");
});
