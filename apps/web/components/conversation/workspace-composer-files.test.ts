// @vitest-environment happy-dom
//
// Image handoff on the shared composer: a dropped or pasted image batch reaches
// `onFiles` untouched, while plain text paste, text-only clipboard data and the
// draft itself are never hijacked. Directory and unsupported drops surface an
// actionable error instead of navigating away.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceComposer } from "@/components/workspace-composer";

let mount: HTMLDivElement | null = null;
let root: Root | null = null;

function imageFile(name = "a.png", type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function transfer(overrides: {
  files?: File[];
  items?: Array<{ kind: string }>;
  types?: string[];
}): unknown {
  return {
    files: overrides.files ?? [],
    items: overrides.items ?? [],
    types: overrides.types ?? [],
  };
}

function nativeEvent(
  type: string,
  property: "dataTransfer" | "clipboardData",
  value: unknown,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, property, { value });
  return event;
}

let renderProps: Partial<Parameters<typeof WorkspaceComposer>[0]> = {};

async function render(
  overrides: Partial<Parameters<typeof WorkspaceComposer>[0]> = {},
): Promise<void> {
  renderProps = overrides;
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => {
    root?.render(
      createElement(WorkspaceComposer, {
        id: "composer",
        label: "消息",
        value: "已有草稿",
        maxLength: 1_000,
        placeholder: "输入",
        variant: "home",
        canSubmit: false,
        binding: null,
        onValueChange: () => {},
        onSubmit: () => {},
        onNavigate: () => {},
        ...renderProps,
      }),
    );
  });
}

/** Re-render the same root with merged props, as a live surface would. */
async function rerender(
  overrides: Partial<Parameters<typeof WorkspaceComposer>[0]>,
): Promise<void> {
  renderProps = { ...renderProps, ...overrides };
  await act(async () => {
    root?.render(
      createElement(WorkspaceComposer, {
        id: "composer",
        label: "消息",
        value: "已有草稿",
        maxLength: 1_000,
        placeholder: "输入",
        variant: "home",
        canSubmit: false,
        binding: null,
        onValueChange: () => {},
        onSubmit: () => {},
        onNavigate: () => {},
        ...renderProps,
      }),
    );
  });
}

function composerRoot(): HTMLElement {
  return document.querySelector("[data-variant]")!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  vi.unstubAllGlobals();
});

describe("composer image intake", () => {
  it.each(["binding", "disabled", "readOnly"] as const)("discards picker results after %s changes", async (change) => {
    const onFiles = vi.fn();
    await render({ onFiles });
    await act(async () => document.querySelector<HTMLButtonElement>("[data-add-trigger]")!.click());
    const fileRow = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-add-panel] button")).find((button) => button.textContent?.includes("添加文件"))!;
    await act(async () => fileRow.click());
    await rerender(change === "binding" ? { binding: "new-context" } : { [change]: true });
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, "files", { configurable: true, value: [imageFile()] });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.querySelector("[data-composer-document]")).toBeNull();
  });
  it("hands pasted images to onFiles without touching the draft", async () => {
    const onFiles = vi.fn();
    const onValueChange = vi.fn();
    await render({ onFiles, onValueChange });
    const file = imageFile();
    const textarea = document.querySelector("textarea")!;
    const paste = nativeEvent("paste", "clipboardData", {
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      getData: () => "",
    });
    await act(async () => {
      textarea.dispatchEvent(paste);
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toEqual([file]);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe("已有草稿");
  });

  it("leaves text-only paste to the normal draft path", async () => {
    const onFiles = vi.fn();
    await render({ onFiles });
    const textarea = document.querySelector("textarea")!;
    const paste = nativeEvent("paste", "clipboardData", {
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      getData: () => "普通文字",
    });
    await act(async () => {
      textarea.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("does not intercept image paste when no intake is wired", async () => {
    await render();
    const textarea = document.querySelector("textarea")!;
    const paste = nativeEvent("paste", "clipboardData", {
      items: [
        { kind: "file", type: "image/png", getAsFile: () => imageFile() },
      ],
      getData: () => "",
    });
    await act(async () => {
      textarea.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(false);
  });

  it("accepts a dropped image batch and shows a drag affordance", async () => {
    const onFiles = vi.fn();
    await render({ onFiles });
    const file = imageFile("b.jpg", "image/jpeg");
    const dragEnter = nativeEvent(
      "dragenter",
      "dataTransfer",
      transfer({ files: [file], types: ["Files"] }),
    );
    await act(async () => {
      composerRoot().dispatchEvent(dragEnter);
    });
    expect(composerRoot().dataset.dragging).toBe("true");
    expect(document.body.textContent).toContain("松开后添加图片");

    const drop = nativeEvent(
      "drop",
      "dataTransfer",
      transfer({ files: [file], types: ["Files"] }),
    );
    await act(async () => {
      composerRoot().dispatchEvent(drop);
    });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(composerRoot().dataset.dragging).toBeUndefined();
  });

  it("refuses a directory drop with a useful message and no navigation", async () => {
    const onFiles = vi.fn();
    await render({ onFiles });
    const drop = nativeEvent(
      "drop",
      "dataTransfer",
      transfer({ files: [], items: [{ kind: "file" }], types: ["Files"] }),
    );
    await act(async () => {
      composerRoot().dispatchEvent(drop);
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(drop.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain("暂不支持文件夹");
  });

  it("refuses an unsupported or oversize batch as a whole", async () => {
    const onFiles = vi.fn();
    await render({ onFiles });
    const drop = nativeEvent(
      "drop",
      "dataTransfer",
      transfer({
        files: [imageFile("vector.gif", "image/gif")],
        types: ["Files"],
      }),
    );
    await act(async () => {
      composerRoot().dispatchEvent(drop);
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("PNG、JPEG 或 WebP");
  });
});

describe("composer document intake", () => {
  it("discards an accepted excerpt when its composer unmounts before close autofocus", async () => {
    const onValueChange = vi.fn();
    await render({ onFiles: vi.fn(), onValueChange });
    await dropFiles([documentFile("notes.txt", "合成文档")]);
    await act(async () => {
      addButton().click();
      root?.unmount();
      root = null;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onValueChange).not.toHaveBeenCalled();
  });
  function documentFile(
    name: string,
    content: BlobPart,
    type = "text/plain",
  ): File {
    return new File([content], name, { type });
  }

  function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-composer-document]");
  }

  function excerptField(): HTMLTextAreaElement {
    return dialog()!.querySelector<HTMLTextAreaElement>("textarea")!;
  }

  function addButton(): HTMLButtonElement {
    return dialog()!.querySelector<HTMLButtonElement>(
      "[data-composer-document-add]",
    )!;
  }

  function setExcerpt(value: string): Promise<void> {
    return act(async () => {
      const field = excerptField();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function flushSettle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function dropFiles(files: File[]): Promise<void> {
    const drop = nativeEvent(
      "drop",
      "dataTransfer",
      transfer({ files, types: ["Files"] }),
    );
    await act(async () => {
      composerRoot().dispatchEvent(drop);
    });
    await flushSettle();
  }

  it("previews a dropped text document and stages only the chosen excerpt", async () => {
    const onFiles = vi.fn();
    const onValueChange = vi.fn();
    await render({ onFiles, onValueChange, value: "已有草稿" });
    await dropFiles([documentFile("notes.txt", "文档第一段\n\n文档第二段")]);

    expect(dialog()).not.toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toContain("文档第一段");
    // Honest privacy copy: local text stays local, PDF/DOCX parsing is a
    // temporary upload, and nothing claims the original is never uploaded.
    expect(text).toContain("在本机读取");
    expect(text).toContain("会临时上传以提取文本");
    expect(text).not.toContain("原文不会上传");
    // The full excerpt fits and is preselected with the separator counted.
    expect(excerptField().value).toBe("文档第一段\n\n文档第二段");
    expect(text).toContain("合计 18 / 1000 字");

    await act(async () => {
      addButton().click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Exactly the chosen text is appended after an explicit separator; the
    // document itself is never an attachment and nothing is sent.
    expect(onValueChange).toHaveBeenCalledWith(
      "已有草稿\n\n文档第一段\n\n文档第二段",
    );
    expect(onFiles).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("keeps the draft intact when the excerpt cannot fit the send bound", async () => {
    const onValueChange = vi.fn();
    await render({
      onFiles: vi.fn(),
      onValueChange,
      value: "ABCDE",
      maxLength: 24,
    });
    const long = "很长的文档内容".repeat(10);
    await dropFiles([documentFile("long.md", long, "text/markdown")]);

    // A long document starts with an explicit explanation and no excerpt.
    expect(document.body.textContent).toContain("请在下方选择或编辑");
    expect(excerptField().value).toBe("");
    await act(async () => {
      Array.from(dialog()!.querySelectorAll("button"))
        .find((button) => button.textContent === "填入开头可加入的片段")!
        .click();
    });
    // The fill helper sizes the window to 24 - 5 draft - 2 separator = 17.
    expect(excerptField().value).toHaveLength(17);
    expect(document.body.textContent).toContain("合计 24 / 24 字");
    expect(addButton().disabled).toBe(false);

    await setExcerpt("x".repeat(30));
    expect(addButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("合计 37 / 24 字");
    await act(async () => {
      addButton().click();
    });
    expect(onValueChange).not.toHaveBeenCalled();
    // The overflow keeps the preview open for editing instead of discarding it.
    expect(dialog()).not.toBeNull();
  });

  it("does not stage a whitespace-only excerpt", async () => {
    const onValueChange = vi.fn();
    await render({ onFiles: vi.fn(), onValueChange, value: "" });
    await dropFiles([documentFile("notes.txt", "正文内容")]);
    await setExcerpt("   \n ");
    expect(addButton().disabled).toBe(true);
    await act(async () => {
      addButton().click();
    });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("cancels without touching the draft and restores typing focus", async () => {
    const onValueChange = vi.fn();
    await render({ onFiles: vi.fn(), onValueChange });
    await dropFiles([documentFile("notes.txt", "取消也不修改草稿")]);
    await act(async () => {
      Array.from(dialog()!.querySelectorAll("button"))
        .find((button) => button.textContent === "取消")!
        .click();
    });
    await flushSettle();
    expect(dialog()).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      document.querySelector<HTMLTextAreaElement>("#composer"),
    );
  });

  it("ignores a late extraction result after cancel", async () => {
    const scope = document.createElement("div");
    scope.setAttribute("data-workspace-scope", "account-1");
    document.body.append(scope);
    let resolveFetch: ((response: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const onValueChange = vi.fn();
    await render({
      onFiles: vi.fn(),
      onValueChange,
      binding: "binding-1",
      value: "保留草稿",
    });
    await dropFiles([
      documentFile("cv.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf"),
    ]);
    expect(dialog()).not.toBeNull();
    expect(document.body.textContent).toContain("正在提取文档文本");
    await act(async () => {
      Array.from(dialog()!.querySelectorAll("button"))
        .find((button) => button.textContent === "取消")!
        .click();
    });
    expect(dialog()).toBeNull();

    resolveFetch!(
      new Response(JSON.stringify({ text: "迟到的解析结果", warnings: [], count: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await flushSettle();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    scope.remove();
  });

  it("discards the preview when the surface becomes disabled mid-extraction", async () => {
    const scope = document.createElement("div");
    scope.setAttribute("data-workspace-scope", "account-1");
    document.body.append(scope);
    let resolveFetch: ((response: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const onValueChange = vi.fn();
    await render({
      onFiles: vi.fn(),
      onValueChange,
      binding: "binding-1",
    });
    await dropFiles([
      documentFile("cv.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf"),
    ]);
    expect(dialog()).not.toBeNull();
    await rerender({ disabled: true });
    expect(dialog()).toBeNull();

    resolveFetch!(
      new Response(JSON.stringify({ text: "过期结果", warnings: [], count: 4 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await flushSettle();
    expect(onValueChange).not.toHaveBeenCalled();
    scope.remove();
  });

  it("discards the preview when the workspace binding changes", async () => {
    const scope = document.createElement("div");
    scope.setAttribute("data-workspace-scope", "account-1");
    document.body.append(scope);
    let resolveFetch: ((response: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const onValueChange = vi.fn();
    await render({
      onFiles: vi.fn(),
      onValueChange,
      binding: "binding-1",
    });
    await dropFiles([
      documentFile("cv.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf"),
    ]);
    expect(dialog()).not.toBeNull();
    await rerender({ binding: "binding-2" });
    expect(dialog()).toBeNull();

    resolveFetch!(
      new Response(JSON.stringify({ text: "跨工作区结果", warnings: [], count: 6 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await flushSettle();
    expect(onValueChange).not.toHaveBeenCalled();
    scope.remove();
  });

  it("sends PDF bytes to the bounded preview route with the session binding", async () => {
    const scope = document.createElement("div");
    scope.setAttribute("data-workspace-scope", "account-1");
    document.body.append(scope);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ text: "提取出的文本", warnings: ["合成警告"], count: 6 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onFiles = vi.fn();
    await render({ onFiles, binding: "binding-1" });
    await dropFiles([
      documentFile("履历.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/local-integration/document-preview");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-workspace-session")).toBe("binding-1");
    expect(headers.get("x-document-name")).toBe(encodeURIComponent("履历.pdf"));
    expect(headers.get("content-type")).toBe("application/pdf");
    // The document is parsed for text only; images stay the attachment path.
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("提取出的文本");
    scope.remove();
  });

  it("never submits the conversation from the excerpt field", async () => {
    const onSubmit = vi.fn();
    await render({ onFiles: vi.fn(), onSubmit, value: "草稿" });
    await dropFiles([documentFile("notes.txt", "不会自动发送")]);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      excerptField().dispatchEvent(event);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("rejects mixed image and document batches atomically", async () => {
    const onFiles = vi.fn();
    await render({ onFiles });
    await dropFiles([
      imageFile("shot.png", "image/png"),
      documentFile("notes.txt", "文档"),
    ]);
    expect(dialog()).toBeNull();
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("分开添加");
  });

  it("rejects binary and archive files locally before any upload", async () => {
    const onFiles = vi.fn();
    await render({ onFiles });
    await dropFiles([
      documentFile("setup.exe", new Uint8Array([0x4d, 0x5a]), "application/octet-stream"),
    ]);
    expect(dialog()).toBeNull();
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("暂不支持这类文件");
  });

  it("reports empty and invalid UTF-8 documents honestly", async () => {
    const onValueChange = vi.fn();
    await render({ onFiles: vi.fn(), onValueChange });
    await dropFiles([documentFile("empty.txt", "")]);
    expect(document.body.textContent).toContain("这个文件是空的");
    expect(onValueChange).not.toHaveBeenCalled();

    await dropFiles([
      documentFile("bytes.txt", new Uint8Array([0xff, 0xfe, 0xfd])),
    ]);
    expect(document.body.textContent).toContain("UTF-8");
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
