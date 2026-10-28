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
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 360 });
    await act(async () => resize([], {} as ResizeObserver));
    expect(canvas.style.getPropertyValue("--conversation-scrollbar-inset")).toBe("32px");
    expect(canvas.style.getPropertyValue("--conversation-viewport-height")).toBe("360px");
    // Overlay scrollbars occupy no layout space; borders still do.
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 774 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 280 });
    await act(async () => resize([], {} as ResizeObserver));
    expect(canvas.style.getPropertyValue("--conversation-scrollbar-inset")).toBe("0px");
    expect(canvas.style.getPropertyValue("--conversation-viewport-height")).toBe("280px");
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    expect(canvas.style.getPropertyValue("--conversation-scrollbar-inset")).toBe("");
    expect(canvas.style.getPropertyValue("--conversation-viewport-height")).toBe("");
  } finally {
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("rebinds to the new viewport when draft admission changes the runtime surface", async () => {
  const observed: Element[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    observe(node: Element) { observed.push(node); }
    disconnect = disconnect;
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Canvas({ identity }: { identity: string }) {
    const viewport = useRef<HTMLElement>(null);
    useConversationAxis(viewport, identity);
    return <main data-conversation-canvas><section key={identity} ref={viewport} /></main>;
  }
  try {
    await act(async () => root.render(<Canvas identity="draft"/>));
    const original = host.querySelector("section")!;
    await act(async () => root.render(<Canvas identity="admitted-session"/>));
    const admitted = host.querySelector("section")!;
    expect(admitted).not.toBe(original);
    expect(observed).toEqual([original, admitted]);
    expect(disconnect).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledTimes(2);
  } finally {
    host.remove();
    vi.unstubAllGlobals();
  }
});
