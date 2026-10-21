// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerDocumentPreview } from "./composer-document";

// Actual Dialog/FocusScope, controlled layout metrics. Real native Tab,
// clipping and editing are separately checked on the protected browser UI.
let root: Root, stage: HTMLDivElement, dialog: HTMLDivElement;
const close = () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭文档预览"]')!;
const add = () => dialog.querySelector<HTMLButtonElement>("[data-composer-document-add]")!;
const excerpt = () => dialog.querySelector<HTMLTextAreaElement>("textarea")!;
const rect = (top: number, height: number) => new DOMRect(33, top - dialog.scrollTop, 254, height);
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stage = document.createElement("div"); document.body.append(stage); root = createRoot(stage);
  await act(async () => root.render(<ComposerDocumentPreview record={{key:1,name:"synthetic.docx",documentType:"docx",text:"Synthetic preview only.",warnings:[],error:null}} draftLength={0} maxLength={1000} sendLimit={1000} onAdd={vi.fn()} onCancel={vi.fn()} restoreFocus={vi.fn()}/>));
  dialog = document.querySelector<HTMLDivElement>("[data-composer-document]")!;
  vi.spyOn(dialog, "getBoundingClientRect").mockImplementation(() => new DOMRect(16, 38, 288, 563));
  Object.defineProperties(dialog, { clientTop: {value:1}, clientHeight: {value:561} });
  vi.spyOn(close(), "getBoundingClientRect").mockImplementation(() => rect(49, 44));
  vi.spyOn(add(), "getBoundingClientRect").mockImplementation(() => rect(684, 44));
  vi.spyOn(excerpt(), "getBoundingClientRect").mockImplementation(() => rect(470, 155));
  await vi.waitFor(() => expect(document.activeElement).toBe(close()));
});
afterEach(async () => { await act(async () => root.unmount()); stage.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function tab(target: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {key:"Tab",shiftKey,bubbles:true,cancelable:true});
  await act(async () => target.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}
it("reveals the last control on the actual reverse FocusScope wrap", async () => {
  await tab(close(), true);
  expect(document.activeElement).toBe(add());
  expect(dialog.scrollTop).toBe(132);
  expect(add().getBoundingClientRect().bottom).toBeLessThanOrEqual(596);
});
it("reveals Close on the actual forward FocusScope wrap after reading lower content", async () => {
  dialog.scrollTop = 144; add().focus({preventScroll:true});
  await tab(add());
  expect(document.activeElement).toBe(close());
  expect(dialog.scrollTop).toBe(6);
  expect(close().getBoundingClientRect().top).toBeGreaterThanOrEqual(43);
});
it("preserves a visible excerpt's text and selection without additional scrolling", () => {
  dialog.scrollTop = 144; excerpt().focus({preventScroll:true}); excerpt().setSelectionRange(5, 9);
  expect(dialog.scrollTop).toBe(144);
  expect(excerpt().value).toBe("Synthetic preview only.");
  expect([excerpt().selectionStart, excerpt().selectionEnd]).toEqual([5, 9]);
  dialog.focus({preventScroll:true}); expect(dialog.scrollTop).toBe(144);
});
it("leaves an oversized editor to its native caret scrolling", () => {
  vi.mocked(excerpt().getBoundingClientRect).mockImplementation(() => rect(470, 1000));
  dialog.scrollTop = 144; excerpt().focus({preventScroll:true});
  expect(dialog.scrollTop).toBe(144);
});
