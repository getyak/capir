// @vitest-environment happy-dom
//
// Inline multimodal conversation: selected images become a composer preview,
// the bytes are written to the durable local store before any network
// admission, the same immutable manifest is resent on an unknown-timeout
// retry, and a denied durable write never sends or drops the draft.
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  conversationImageKey,
  setConversationImageStoreForTest,
  type ConversationImageStore,
  type DurableConversationImage,
} from "../../lib/conversation-image-store";
import { readConversationMessages } from "../../lib/conversation-local";
import { useConversation } from "./use-conversation";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("../workspace-session-request", () => ({ workspaceSessionFetch: fetcher }));

const sid = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30";

function memoryStore() {
  const map = new Map<string, DurableConversationImage[]>();
  const deletes: string[] = [];
  let failing = false;
  const store: ConversationImageStore = {
    async put(key, images) {
      if (failing) return false;
      map.set(key, [...images]);
      return true;
    },
    async get(key) {
      return map.get(key) ?? [];
    },
    async delete(key) {
      deletes.push(key);
      map.delete(key);
    },
    async deletePrefix(prefix) {
      deletes.push(`prefix:${prefix}`);
      for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key);
    },
    async inventory() {
      return [...map.entries()].map(([key, images]) => ({
        key,
        expiresAt: images.reduce((min, image) => Math.min(min, image.expiresAt), Number.POSITIVE_INFINITY),
      }));
    },
  };
  return { map, deletes, store, fail: (value: boolean) => { failing = value; } };
}

function imageFile(name = "shot.png", type = "image/png"): File {
  return new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], name, { type });
}

let chat: ReturnType<typeof useConversation>;
let root: Root;
let mount: HTMLDivElement;
let memory: ReturnType<typeof memoryStore>;

function Probe() {
  const current = useConversation({ id: sid, scope: "owner", chatBinding: "chat", detailBinding: "detail" });
  useLayoutEffect(() => { chat = current; });
  return null;
}
async function flush(times = 6) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  });
}
function queuePosts() {
  return fetcher.mock.calls.filter((call) => {
    const init = call[1] as RequestInit | undefined;
    return init?.method === "POST" && String(call[0]).endsWith("/conversation-queue");
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  memory = memoryStore();
  setConversationImageStoreForTest(memory.store);
  fetcher.mockReset();
  fetcher.mockImplementation(() => Promise.resolve(Response.json({}, { status: 202 })));
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => { root.render(createElement(Probe)); });
  await flush();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null as unknown as Root;
  mount.remove();
  setConversationImageStoreForTest(undefined);
  vi.unstubAllGlobals();
});

it("stages an image preview without sending, then admits the exact bytes inline", async () => {
  await act(async () => { await chat.addFiles([imageFile()]); });
  expect(chat.attachments).toHaveLength(1);
  expect(chat.attachments[0]!.manifest.content_hash).toMatch(/^[a-f0-9]{64}$/u);
  expect(queuePosts()).toHaveLength(0);

  await act(async () => { chat.changeDraft("请看这张图"); });
  await act(async () => { expect(await chat.submit()).toBe(true); });
  expect(chat.attachments).toHaveLength(0);
  expect(chat.draft).toBe("");
  expect(chat.messages[0]!.images).toHaveLength(1);
  await flush();

  const posts = queuePosts();
  expect(posts).toHaveLength(1);
  const body = JSON.parse((posts[0]![1] as RequestInit).body as string);
  expect(body.objective).toBe("请看这张图");
  expect(body.images).toHaveLength(1);
  expect(body.images[0].media_type).toBe("image/png");
  expect(body.images[0].byte_size).toBe(8);
  expect(body.images[0].data_base64).toBe("iVBORwECAwQ=");
  expect(body.images[0].content_hash).toBe(chat.messages[0]!.images?.[0]?.content_hash);
});

it("keeps the draft and images and never sends when durable image storage is denied", async () => {
  await act(async () => { await chat.addFiles([imageFile("keep.png")]); });
  memory.fail(true);
  await act(async () => { chat.changeDraft("不要丢"); });
  await act(async () => { expect(await chat.submit()).toBe(false); });
  expect(chat.draft).toBe("不要丢");
  expect(chat.attachments).toHaveLength(1);
  expect(queuePosts()).toHaveLength(0);
});

it("reuses the same identity and manifest after an unknown timeout", async () => {
  await act(async () => { await chat.addFiles([imageFile("retry.png")]); });
  fetcher.mockRejectedValueOnce(new Error("timeout"));
  await act(async () => { await chat.submit(); });
  await flush();
  expect(chat.messages[0]!.delivery).toBe("unknown");
  const first = JSON.parse((queuePosts()[0]![1] as RequestInit).body as string);

  fetcher.mockImplementation(() => Promise.resolve(Response.json({}, { status: 202 })));
  await act(async () => { await chat.retryDelivery(chat.messages[0]!); });
  await flush();
  const sends = queuePosts();
  expect(sends).toHaveLength(2);
  const second = JSON.parse((sends[1]![1] as RequestInit).body as string);
  expect(second.message_id).toBe(first.message_id);
  expect(second.idempotency_key).toBe(first.idempotency_key);
  expect(second.images).toEqual(first.images);
  expect(chat.messages[0]!.delivery).toBe("accepted");
  await flush(4);
  // Acceptance keeps the only thumbnail until canonical history reconciles it.
  expect(memory.map.get(conversationImageKey("owner", sid, first.message_id))).toBeDefined();
});

it("supports images-only messages and removes local bytes on a definitive rejection removal", async () => {
  await act(async () => { await chat.addFiles([imageFile("only.png")]); });
  fetcher.mockResolvedValueOnce(Response.json({ message: "bad image" }, { status: 422 }));
  await act(async () => { await chat.submit(); });
  await flush();
  expect(chat.messages[0]!.objective).toBe("");
  expect(chat.messages[0]!.delivery).toBe("rejected");
  const messageId = chat.messages[0]!.id;
  expect(memory.map.has(conversationImageKey("owner", sid, messageId))).toBe(true);
  await act(async () => { chat.discardRejectedDelivery(messageId); });
  expect(memory.map.has(conversationImageKey("owner", sid, messageId))).toBe(false);
});

it("creates exactly one message for rapid Enter presses", async () => {
  await act(async () => { chat.changeDraft("rapid"); });
  await act(async () => { await Promise.all([chat.submit(), chat.submit(), chat.submit()]); });
  await flush();
  expect(chat.messages).toHaveLength(1);
  expect(queuePosts()).toHaveLength(1);
});

it("preserves text typed while the durable image put is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { await gate; return base.put(key, images); } });
  await act(async () => { await chat.addFiles([imageFile("a.png")]); });
  await act(async () => { chat.changeDraft("original"); });
  let pending!: Promise<boolean>;
  await act(async () => { pending = chat.submit(); });
  await act(async () => { chat.changeDraft("newer text"); });
  await act(async () => { release(); await pending; });
  await flush();
  expect(chat.draft).toBe("newer text");
  expect(chat.messages[0]!.objective).toBe("original");
  const body = JSON.parse((queuePosts()[0]![1] as RequestInit).body as string);
  expect(body.objective).toBe("original");
});

it("keeps an image added while the durable put is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { await gate; return base.put(key, images); } });
  await act(async () => { await chat.addFiles([imageFile("first.png")]); });
  await act(async () => { chat.changeDraft("caption"); });
  let pending!: Promise<boolean>;
  await act(async () => { pending = chat.submit(); });
  await act(async () => { await chat.addFiles([imageFile("second.png")]); });
  await act(async () => { release(); await pending; });
  await flush();
  expect(chat.attachments).toHaveLength(1);
  expect(chat.attachments[0]!.manifest.file_name).toBe("second.png");
  const body = JSON.parse((queuePosts()[0]![1] as RequestInit).body as string);
  expect(body.images).toHaveLength(1);
});

it("aborts a durable put on unmount without sending or leaving orphan bytes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { await gate; return base.put(key, images); } });
  await act(async () => { await chat.addFiles([imageFile("orphan.png")]); });
  await act(async () => { chat.changeDraft("orphan"); });
  let pending!: Promise<boolean>;
  await act(async () => { pending = chat.submit(); });
  const deletesBefore = memory.deletes.length;
  await act(async () => { root.unmount(); });
  root = null as unknown as Root;
  await act(async () => { release(); await pending; });
  await flush();
  expect(queuePosts()).toHaveLength(0);
  expect(memory.deletes.length).toBeGreaterThan(deletesBefore);
  expect(readConversationMessages("owner", sid)).toEqual([]);
});

it("gates send while image hashing is incomplete", async () => {
  let releaseDigest!: () => void;
  const gate = new Promise<ArrayBuffer>((resolve) => {
    releaseDigest = () => resolve(new Uint8Array(32).fill(1).buffer);
  });
  const digest = vi.spyOn(crypto.subtle, "digest").mockReturnValue(gate);
  try {
    await act(async () => { void chat.addFiles([imageFile("slow.png")]); });
    await flush(2);
    expect(chat.preparing).toBe(true);
    await act(async () => { chat.changeDraft("wait"); });
    await act(async () => { expect(await chat.submit()).toBe(false); });
    await act(async () => { releaseDigest(); await flush(3); });
    expect(chat.preparing).toBe(false);
    expect(chat.attachments).toHaveLength(1);
  } finally {
    digest.mockRestore();
  }
});

it("recovers text send after rejecting an oversized image batch", async () => {
  await act(async () => { await chat.addFiles(Array.from({ length: 11 }, (_, i) => imageFile(`${i}.png`))); });
  expect(chat.preparing).toBe(false);
  expect(chat.attachments).toHaveLength(0);
  await act(async () => { chat.changeDraft("still usable"); });
  await act(async () => { expect(await chat.submit()).toBe(true); });
  await flush();
  expect(queuePosts()).toHaveLength(1);
});

it("keeps both batches when a second selection arrives during hashing", async () => {
  let release!: () => void;
  const gate = new Promise<ArrayBuffer>((resolve) => { release = () => resolve(new Uint8Array(32).buffer); });
  const digest = vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(gate);
  try {
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = chat.addFiles([imageFile("first.png")]); });
    await flush(2);
    await act(async () => { second = chat.addFiles([imageFile("second.png")]); });
    await act(async () => { release(); await Promise.all([first, second]); });
    expect(chat.preparing).toBe(false);
    expect(chat.attachments.map((image) => image.manifest.file_name)).toEqual(["first.png", "second.png"]);
  } finally { digest.mockRestore(); }
});

it("keeps an unknown receipt recoverable when reconciliation fails and local bytes disappear", async () => {
  await act(async () => { await chat.addFiles([imageFile("unknown.png")]); });
  fetcher.mockRejectedValueOnce(new Error("response lost after possible commit"));
  await act(async () => { await chat.submit(); });
  await flush();
  expect(chat.messages[0]!.delivery).toBe("unknown");
  memory.map.clear();
  fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
  await act(async () => { await chat.retryDelivery(chat.messages[0]!); });
  await flush();
  expect(chat.messages[0]!.delivery).toBe("unknown");
  expect(queuePosts()).toHaveLength(1);
});

it("explains an image admission server error without claiming processing", async () => {
  await act(async () => { await chat.addFiles([imageFile("server-error.png")]); });
  fetcher.mockResolvedValueOnce(Response.json({ message: "Internal server error" }, { status: 500 }));
  await act(async () => { await chat.submit(); });
  await flush();
  expect(chat.messages[0]!.delivery).toBe("unknown");
  expect(chat.messages[0]!.error).toBe("图片发送遇到服务器错误，尚未确认送达。原图已保留，请核对并重试。");
  expect(memory.map.size).toBe(1);
});

it("does not resend retained image bytes when checking delivery fails", async () => {
  await act(async () => { await chat.addFiles([imageFile("retained.png")]); });
  fetcher.mockRejectedValueOnce(new Error("lost admission response"));
  await act(async () => { await chat.submit(); });
  await flush();
  fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
  await act(async () => { await chat.retryDelivery(chat.messages[0]!); });
  await flush();
  expect(queuePosts()).toHaveLength(1);
  expect(chat.messages[0]!.delivery).toBe("unknown");
  expect(chat.messages[0]!.error).toBe("核对送达状态失败，消息和图片已保留。恢复连接后再重试。");
  expect(memory.map.size).toBe(1);
});
