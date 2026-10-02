// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useConversationAxis } from "./use-conversation-axis";

it("shares occupied scrollbar width, excludes borders, and releases observation", async () => {
  let resize!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Canvas() {
    const ref = useRef<HTMLElement>(null);
    useConversationAxis(ref);
    return <main data-conversation-canvas><section ref={ref} style={{ border: "1px solid" }} /></main>;
  }
  try {
    await act(async () => root.render(<Canvas />));
    const canvas = host.querySelector("main")!;
    const viewport = host.querySelector("section")!;
    Object.defineProperty(viewport, "offsetWidth", { configurable: true, value: 776 });
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 742 });
    await act(async () => resize([], {} as ResizeObserver));
    expect(canvas.style.getPropertyValue("--conversation-scrollbar-inset")).toBe("32px");
    // Overlay scrollbars occupy no layout space; borders still do.
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 774 });
    await act(async () => resize([], {} as ResizeObserver));
    expect(canvas.style.getPropertyValue("--conversation-scrollbar-inset")).toBe("0px");
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    expect(canvas.style.getPropertyValue("--conversation-scrollbar-inset")).toBe("");
  } finally {
    host.remove();
    vi.unstubAllGlobals();
  }
});
