// @vitest-environment happy-dom
//
// Original-image readback for a saved source. Bytes are fetched through the
// scoped workspace session proxy, decoded to an object URL that must be revoked,
// and a stale response must never paint after close or unmount.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
const createObjectURL = vi.hoisted(() => vi.fn(() => "blob:source-image"));
const revokeObjectURL = vi.hoisted(() => vi.fn());

vi.mock("@/components/workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: fetcher,
  workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));

import { SourceImageViewer } from "./source-image-viewer";

let mount: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(): Promise<void> {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(
      createElement(SourceImageViewer, { taskId: "task-1", imageIndex: 0 }),
    );
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function trigger(): HTMLButtonElement {
  return document.querySelector("button")!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  vi.unstubAllGlobals();
});

describe("source image viewer", () => {
  it("reads the image through the scoped proxy and revokes the object URL", async () => {
    fetcher.mockResolvedValue(
      new Response(new Blob([new Uint8Array([9, 9])], { type: "image/png" }), {
        status: 200,
      }),
    );
    await render();
    await act(async () => {
      trigger().click();
    });
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url] = fetcher.mock.calls[0] as [string];
    expect(url).toBe("/api/contact-agent/tasks/task-1/images/0");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const image = document.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("blob:source-image");

    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:source-image");
  });

  it("shows an actionable error and can retry", async () => {
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "gone" }), { status: 503 }),
    );
    await render();
    await act(async () => {
      trigger().click();
    });
    await flush();

    expect(document.body.textContent).toContain("原图暂时无法读取");
    expect(createObjectURL).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(
      new Response(new Blob([new Uint8Array([1])], { type: "image/png" }), {
        status: 200,
      }),
    );
    const retry = Array.from(document.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("重试"),
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    await flush();
    expect(document.querySelector("img")).not.toBeNull();
  });

  it("drops a late blob after the component unmounts", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    fetcher.mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    await render();
    await act(async () => {
      trigger().click();
    });
    await flush();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    await act(async () => {
      resolveFetch?.(
        new Response(new Blob([new Uint8Array([1])], { type: "image/png" }), {
          status: 200,
        }),
      );
      await Promise.resolve();
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("closes by Escape, cancels a pending image and returns to its source control", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    fetcher.mockImplementation(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
    await render();
    const opener = trigger();
    opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    await act(async () => {
      resolveFetch?.(new Response(new Blob([new Uint8Array([1])], { type: "image/png" })));
      await Promise.resolve();
    });
    expect(document.querySelector("img")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
