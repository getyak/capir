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
  CONVERSATION_IMAGE_DRAFT,
  conversationImageGeneration,
  persistConversationImageDraft,
  purgeExpiredConversationImages,
  setConversationImageStoreForTest,
  type ConversationImageStore,
  type DurableConversationImage,
} from "../../lib/conversation-image-store";
import { clearConversationImageStore, sweepConversationImageStore } from "../../lib/conversation-image-lifecycle";
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
    async put(key, images, expectedIds) {
      if (expectedIds && JSON.stringify((map.get(key) ?? []).map(image => image.attachment_id)) !== JSON.stringify(expectedIds)) return false;
      if (failing) return false;
      if (images.length) map.set(key, [...images]);
      else map.delete(key);
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

function Probe({ scope = "owner" }: { scope?: string }) {
  const current = useConversation({ id: sid, scope, chatBinding: "chat", detailBinding: "detail" });
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
  await act(async () => { await chat.addFiles([imageFile("a.png")]); });
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { await gate; return base.put(key, images); } });
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
  await act(async () => { await chat.addFiles([imageFile("first.png")]); });
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { await gate; return base.put(key, images); } });
  await act(async () => { chat.changeDraft("caption"); });
  let pending!: Promise<boolean>;
  await act(async () => { pending = chat.submit(); });
  let adding!: Promise<void>;
  await act(async () => { adding = chat.addFiles([imageFile("second.png")]); });
  await act(async () => { release(); await pending; await adding; });
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
  await act(async () => { await chat.addFiles([imageFile("orphan.png")]); });
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { await gate; return base.put(key, images); } });
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

async function remount() {
  await act(async () => { root.unmount(); });
  root = createRoot(mount);
  await act(async () => { root.render(createElement(Probe)); });
  await flush();
}

it("restores the exact ordered unsent files and manifests after route unmount without admission", async () => {
  await act(async () => { chat.changeDraft("保留原话"); await chat.addFiles([imageFile("one.png"), imageFile("two.png")]); });
  const original = chat.attachments.map(({ id, manifest }) => ({ id, manifest }));
  await remount();
  expect(chat.draft).toBe("保留原话");
  expect(chat.attachments.map(({ id, manifest }) => ({ id, manifest }))).toEqual(original);
  expect(await chat.attachments[1]!.file.arrayBuffer()).toEqual(await imageFile().arrayBuffer());
  expect(queuePosts()).toHaveLength(0);
});

it("persists explicit removal and transfers only remaining files to a durable message", async () => {
  await act(async () => { await chat.addFiles([imageFile("remove.png"), imageFile("send.png")]); });
  await act(async () => { chat.removeAttachment(chat.attachments[0]!.id); });
  await remount();
  expect(chat.attachments.map(a => a.manifest.file_name)).toEqual(["send.png"]);
  await act(async () => { expect(await chat.submit()).toBe(true); });
  await remount();
  expect(chat.attachments).toEqual([]);
  expect(chat.messages[0]!.images?.map(a => a.file_name)).toEqual(["send.png"]);
});


it("explicitly refuses an initial unpersisted batch and accepts a deliberate reselection after recovery", async () => {
  memory.fail(true);
  const file = imageFile("reselect.png");
  await act(async () => { await chat.addFiles([file]); });
  expect(chat.attachments).toEqual([]);
  expect(chat.attachmentDraftUnsafe).toBe(false);
  expect(chat.error).toContain("未添加");
  memory.fail(false);
  await act(async () => { await chat.addFiles([file]); });
  await remount();
  expect(chat.attachments[0]!.file.name).toBe("reselect.png");
  expect(queuePosts()).toHaveLength(0);
});

it("does not claim a removal when storage refuses its durable update", async () => {
  await act(async () => { await chat.addFiles([imageFile("keep.png")]); }); await flush();
  memory.fail(true);
  await act(async () => { await chat.removeAttachment(chat.attachments[0]!.id); }); await flush();
  expect(chat.attachments).toHaveLength(1);
  expect(chat.attachmentDraftUnsafe).toBe(true);
});

it("recovers a slow draft put after unmount and keeps a newer removal ordered after it", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let signalPutStarted!: () => void;
  const putStarted = new Promise<void>(resolve => { signalPutStarted = resolve; });
  let releasePreparation!: () => void;
  const preparationGate = new Promise<void>(resolve => { releasePreparation = resolve; });
  let signalPreparationStarted!: () => void;
  const preparationStarted = new Promise<void>(resolve => { signalPreparationStarted = resolve; });
  let releaseHydration!: () => void;
  const hydrationGate = new Promise<void>(resolve => { releaseHydration = resolve; });
  let signalHydrationStarted!: () => void;
  const hydrationStarted = new Promise<void>(resolve => { signalHydrationStarted = resolve; });
  const file = imageFile("slow.png");
  const readBytes = file.arrayBuffer.bind(file);
  const read = vi.spyOn(file, "arrayBuffer").mockImplementationOnce(async () => {
    signalPreparationStarted();
    await preparationGate;
    return readBytes();
  }).mockImplementationOnce(async () => {
    signalHydrationStarted();
    await hydrationGate;
    return readBytes();
  });
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, put: async (...args) => {
    signalPutStarted();
    await gate;
    return base.put(...args);
  } });
  let adding!: Promise<void>;
  try {
    await act(async () => { adding = chat.addFiles([file]); await preparationStarted; });
    // Preparation alone also reports unsafe: it does not prove a put exists.
    expect(chat.preparing).toBe(true);
    expect(chat.attachments).toEqual([]);
    expect(memory.map.size).toBe(0);
    // Exercise real reading and hashing after a controlled delay, then wait
    // for the queued write itself before unmounting its original owner.
    await act(async () => { releasePreparation(); await putStarted; });
    expect(chat.attachments).toEqual([]);
    expect(chat.attachmentDraftUnsafe).toBe(true);
    expect(memory.map.size).toBe(0);
    await act(async () => { root.unmount(); }); root = createRoot(mount);
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { release(); await adding; await hydrationStarted; });
    expect(memory.map.size).toBe(1);
    expect(chat.attachments).toEqual([]);
    // The old addition has settled, but the new root still has to read and
    // hash the stored file. Wait for its committed preview, not a timer.
    await vi.waitFor(async () => {
      await act(async () => { releaseHydration(); });
      expect(chat.attachments.map(a => a.file.name)).toEqual(["slow.png"]);
    });
    await act(async () => { await chat.removeAttachment(chat.attachments[0]!.id); });
    expect(memory.map.has(conversationImageKey("owner", sid, CONVERSATION_IMAGE_DRAFT))).toBe(false);
    await remount(); expect(chat.attachments).toEqual([]); expect(queuePosts()).toHaveLength(0);
  } finally {
    await act(async () => { releasePreparation(); release(); releaseHydration(); await adding; });
    read.mockRestore();
  }
});

it("does not revive old preparation across the existing account A-B-A fence", async () => {
  let release!: () => void;
  const digest = vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(new Promise<ArrayBuffer>(resolve => { release = () => resolve(new Uint8Array(32).buffer); }));
  try {
    let pending!: Promise<void>;
    await act(async () => { pending = chat.addFiles([imageFile("old.png")]); }); await flush(1);
    sweepConversationImageStore("other"); sweepConversationImageStore("owner");
    await act(async () => { release(); await pending; }); await flush();
    expect(chat.attachments).toEqual([]); expect(memory.map.size).toBe(0);
  } finally { digest.mockRestore(); }
});

it("clears a late draft write after session deletion instead of resurrecting bytes", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { await gate; return base.put(key, images); } });
  let adding!: Promise<void>;
  await act(async () => { adding = chat.addFiles([imageFile("deleted.png")]); }); await flush(1);
  clearConversationImageStore("owner", sid);
  await act(async () => { release(); await adding; }); await flush();
  expect(memory.map.size).toBe(0); await remount(); expect(chat.attachments).toEqual([]);
});

it("expires unsent drafts within the existing byte-store retention and never renews them on reopen", async () => {
  await act(async () => { await chat.addFiles([imageFile("expired.png")]); }); await flush();
  const key = conversationImageKey("owner", sid, CONVERSATION_IMAGE_DRAFT);
  const records = memory.map.get(key)!;
  records[0]!.expiresAt = Date.now() - 1;
  await purgeExpiredConversationImages(); await remount();
  expect(chat.attachments).toEqual([]); expect(memory.map.size).toBe(0);
});

it("serializes an old cleared put before a replacement draft in the same account", async () => {
  await act(async () => { await chat.addFiles([imageFile("source.png")]); }); await flush();
  const key = conversationImageKey("owner", sid, CONVERSATION_IMAGE_DRAFT);
  const records = memory.map.get(key)!;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const base = memory.store;
  let first = true;
  setConversationImageStoreForTest({ ...base, put: async (key, images) => { if (first) { first = false; await gate; } return base.put(key, images); } });
  const old = persistConversationImageDraft("owner", sid, records, conversationImageGeneration()); await flush(1);
  clearConversationImageStore("owner", sid);
  const replacement = records.map(r => ({ ...r, file_name: "replacement.png" }));
  const fresh = persistConversationImageDraft("owner", sid, replacement, conversationImageGeneration());
  release(); await expect(old).resolves.toBe(false); await expect(fresh).resolves.toBe(true);
  expect(memory.map.get(key)?.[0]?.file_name).toBe("replacement.png");
});

it("reports a failed draft read and does not overwrite retained files with a new selection", async () => {
  await act(async () => { await chat.addFiles([imageFile("retained.png")]); }); await flush();
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, get: async () => { throw new Error("denied"); } });
  await remount();
  expect(chat.error).toContain("无法读取");
  expect(chat.attachmentDraftUnsafe).toBe(true);
  await act(async () => { await chat.addFiles([imageFile("replacement.png")]); });
  setConversationImageStoreForTest(base);
  await act(async () => { await chat.retryAttachmentDraft(); }); await flush();
  expect(chat.attachments.map(a => a.file.name)).toEqual(["retained.png"]);
  expect(queuePosts()).toHaveLength(0);
});


it("keeps a second writer's original input when another tab already replaced its draft", async () => {
  await act(async () => { await chat.addFiles([imageFile("ours.png")]); }); await flush();
  const key = conversationImageKey("owner", sid, CONVERSATION_IMAGE_DRAFT);
  const theirs = memory.map.get(key)!.map(record => ({ ...record, attachment_id: crypto.randomUUID(), file_name: "theirs.png" }));
  await memory.store.put(key, theirs);
  await act(async () => { await chat.addFiles([imageFile("new.png")]); }); await flush();
  const original = chat.attachments[0]!;
  expect(chat.attachments.map(a => a.file.name)).toEqual(["ours.png"]);
  expect(chat.error).toContain("未添加");
  expect(chat.attachmentDraftUnsafe).toBe(true);
  expect(chat.error).toContain("离开或刷新可能丢失");
  await act(async () => { expect(await chat.retryAttachmentDraft()).toBe(false); });
  expect(chat.attachments[0]).toBe(original);
  expect(chat.attachmentDraftUnsafe).toBe(true);
  expect(memory.map.get(key)).toEqual(theirs);
  expect(queuePosts()).toHaveLength(0);
});

it("retains original File metadata separately from the bounded send manifest", async () => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], `${"long".repeat(60)}.png`, { type: "image/png", lastModified: 123456 });
  await act(async () => { await chat.addFiles([file]); }); await flush();
  await remount();
  expect(chat.attachments[0]!.file.name).toBe(file.name);
  expect(chat.attachments[0]!.file.lastModified).toBe(123456);
  expect(chat.attachments[0]!.manifest.file_name).toHaveLength(200);
});

it("serializes rapid selections behind durable acknowledgement without exposing unpersisted previews", async () => {
  const base = memory.store;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  setConversationImageStoreForTest({ ...base, put: async (key, images, expected) => { await gate; return base.put(key, images, expected); } });
  let additions!: Promise<void>[];
  await act(async () => { additions = ["one.png", "two.png", "three.png"].map(name => chat.addFiles([imageFile(name)])); }); await flush(1);
  expect(chat.attachments).toEqual([]);
  expect(chat.preparing).toBe(true);
  await act(async () => { release(); await Promise.all(additions); });
  await remount();
  expect(chat.attachments.map(a => a.file.name)).toEqual(["one.png", "two.png", "three.png"]);
});

it("does not let an old scope's slow removal block or clear a replacement conversation", async () => {
  await act(async () => { await chat.addFiles([imageFile("old.png")]); }); await flush();
  const base = memory.store;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  setConversationImageStoreForTest({ ...base, put: async (key, images, expected) => { if (key.startsWith("owner:")) await gate; return base.put(key, images, expected); } });
  let removal!: Promise<void>;
  await act(async () => { removal = chat.removeAttachment(chat.attachments[0]!.id); }); await flush(1);
  await act(async () => { root.render(createElement(Probe, { scope: "other" })); }); await flush();
  await act(async () => { chat.changeDraft("新账号原话"); });
  await act(async () => { expect(await chat.submit()).toBe(true); });
  await act(async () => { release(); await removal; }); await flush();
  expect(chat.messages[0]?.objective).toBe("新账号原话");
  expect(chat.attachments).toEqual([]);
});

it("keeps a durable handoff recoverable when cleaning up its old composer record fails", async () => {
  await act(async () => { await chat.addFiles([imageFile("handoff.png")]); }); await flush();
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, put: async (key, images, expected) => key.endsWith(`:${CONVERSATION_IMAGE_DRAFT}`) && !images.length ? false : base.put(key, images, expected) });
  await act(async () => { expect(await chat.submit()).toBe(true); }); await flush();
  expect(chat.attachments).toEqual([]);
  expect(chat.attachmentDraftUnsafe).toBe(false);
  expect(chat.error).toBe("");
  await remount();
  expect(chat.attachments).toEqual([]);
  expect(chat.messages[0]?.images?.[0]?.file_name).toBe("handoff.png");
  expect(chat.attachmentDraftUnsafe).toBe(false);
});

it("explicitly refuses a new selection while a slow draft read later fails, then retries without losing accepted files", async () => {
  await act(async () => { await chat.addFiles([imageFile("original.png")]); }); await flush();
  const original = chat.attachments.map(({ id, manifest, file }) => ({ id, manifest, file }));
  const base = memory.store;
  let rejectRead!: (error: Error) => void;
  const read = new Promise<DurableConversationImage[]>((_resolve, reject) => { rejectRead = reject; });
  setConversationImageStoreForTest({ ...base, get: async () => read });
  await remount();
  let selection!: Promise<void>;
  await act(async () => { selection = chat.addFiles([imageFile("new.png")]); }); await flush(1);
  expect(chat.error).toContain("尚未添加");
  await act(async () => { rejectRead(new Error("denied")); await selection; }); await flush();
  expect(chat.attachments).toEqual([]);
  setConversationImageStoreForTest(base);
  await act(async () => { await chat.retryAttachmentDraft(); }); await flush();
  expect(chat.attachments.map(({ id, manifest, file }) => ({ id, manifest, file }))).toEqual(original);
  expect(queuePosts()).toHaveLength(0);
});

it("accepts a legacy-browser batch only after its scoped durable write acknowledges it", async () => {
  vi.stubGlobal("navigation", undefined);
  const base = memory.store;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  setConversationImageStoreForTest({ ...base, put: async (key, images, expected) => { await gate; return base.put(key, images, expected); } });
  let adding!: Promise<void>;
  await act(async () => { adding = chat.addFiles([imageFile("pending.png")]); }); await flush(1);
  try { expect(chat.attachments).toEqual([]); expect(chat.preparing).toBe(true); }
  finally { await act(async () => { release(); await adding; }); }
  expect(chat.attachments.map(a => a.file.name)).toEqual(["pending.png"]);
  expect(memory.map.get(conversationImageKey("owner", sid, CONVERSATION_IMAGE_DRAFT))?.map(a => a.file_name)).toEqual(["pending.png"]);
  expect(queuePosts()).toHaveLength(0);
});

it("refuses an unpersisted legacy-browser batch without changing previously accepted input", async () => {
  vi.stubGlobal("navigation", undefined);
  await act(async () => { chat.changeDraft("原话保留"); await chat.addFiles([imageFile("stored.png")]); }); await flush();
  const originals = chat.attachments;
  memory.fail(true);
  await act(async () => { await chat.addFiles([imageFile("refused.png")]); });
  expect(chat.attachments).toEqual(originals);
  expect(chat.error).toContain("未添加");
  expect(chat.attachmentDraftUnsafe).toBe(false);
  expect(chat.draft).toBe("原话保留");
  memory.fail(false); await remount();
  expect(chat.attachments.map(a => a.file.name)).toEqual(["stored.png"]);
  expect(chat.draft).toBe("原话保留");
  expect(queuePosts()).toHaveLength(0);
});

it("never accepts a delayed legacy-browser batch after account invalidation", async () => {
  vi.stubGlobal("navigation", undefined);
  const base = memory.store;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  setConversationImageStoreForTest({ ...base, put: async (key, images, expected) => { await gate; return base.put(key, images, expected); } });
  let adding!: Promise<void>;
  await act(async () => { adding = chat.addFiles([imageFile("old-account.png")]); }); await flush(1);
  sweepConversationImageStore("other"); sweepConversationImageStore("owner");
  await act(async () => { release(); await adding; }); await flush();
  expect(chat.attachments).toEqual([]);
  expect(memory.map.size).toBe(0);
  expect(queuePosts()).toHaveLength(0);
});

it("counts unacknowledged selections against the existing ten-image bound", async () => {
  const base = memory.store;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  setConversationImageStoreForTest({ ...base, put: async (key, images, expected) => { await gate; return base.put(key, images, expected); } });
  let adding!: Promise<void>;
  await act(async () => { adding = chat.addFiles(Array.from({ length: 10 }, (_, i) => imageFile(`${i}.png`))); }); await flush(1);
  await act(async () => { await chat.addFiles([imageFile("over-limit.png")]); });
  expect(chat.attachments).toEqual([]);
  expect(chat.error).toContain("最多添加 10");
  await act(async () => { release(); await adding; });
  expect(chat.attachments.map(a => a.file.name)).toEqual(Array.from({ length: 10 }, (_, i) => `${i}.png`));
});

it("does not claim prior previews safe when their backing read is uncertain after a refused batch", async () => {
  await act(async () => { await chat.addFiles([imageFile("original.png")]); });
  const original = chat.attachments[0]!;
  const base = memory.store;
  setConversationImageStoreForTest({ ...base, put: async () => false, get: async () => { throw new Error("temporarily unreadable"); } });
  await act(async () => { await chat.addFiles([imageFile("refused.png")]); });
  expect(chat.attachments).toEqual([original]);
  expect(chat.attachmentDraftUnsafe).toBe(true);
  expect(chat.error).toContain("离开或刷新可能丢失");
  setConversationImageStoreForTest(base);
  await act(async () => { expect(await chat.retryAttachmentDraft()).toBe(true); });
  expect(chat.attachments[0]).toBe(original);
  expect(chat.attachmentDraftUnsafe).toBe(false);
  await remount();
  expect(chat.attachments.map(a => a.manifest)).toEqual([original.manifest]);
  expect(await chat.attachments[0]!.file.arrayBuffer()).toEqual(await original.file.arrayBuffer());
  expect(queuePosts()).toHaveLength(0);
});

it("does not overwrite a competing draft after an explicitly chosen stored version fails validation", async () => {
  await act(async () => { await chat.addFiles([imageFile("ours.png")]); });
  const original = chat.attachments[0]!;
  const key = conversationImageKey("owner", sid, CONVERSATION_IMAGE_DRAFT);
  const theirs = memory.map.get(key)!.map(record => ({ ...record, attachment_id: crypto.randomUUID(), file_name: "theirs.png", blob: imageFile("theirs.png") }));
  memory.map.set(key, theirs);
  await act(async () => { await chat.addFiles([imageFile("refused.png")]); });
  const read = vi.spyOn(theirs[0]!.blob, "arrayBuffer").mockRejectedValueOnce(new Error("read interrupted"));
  try {
    await act(async () => { await chat.useStoredAttachmentDraft(); });
    expect(chat.attachments[0]).toBe(original);
    expect(chat.attachmentDraftUnsafe).toBe(true);
    await act(async () => { expect(await chat.retryAttachmentDraft()).toBe(false); });
    expect(memory.map.get(key)).toEqual(theirs);
    expect(chat.attachments[0]).toBe(original);
  } finally { read.mockRestore(); }
});

it("does not let an old backing verification paint the replacement account", async () => {
  await act(async () => { await chat.addFiles([imageFile("ours.png")]); });
  const base = memory.store;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  setConversationImageStoreForTest({ ...base, put: async () => false, get: async key => { if (key.startsWith("owner:")) await gate; return base.get(key); } });
  let adding!: Promise<void>;
  await act(async () => { adding = chat.addFiles([imageFile("refused.png")]); }); await flush(1);
  await act(async () => { root.render(createElement(Probe, { scope: "other" })); }); await flush();
  await act(async () => { chat.changeDraft("新账号原文"); release(); await adding; }); await flush();
  expect(chat.draft).toBe("新账号原文");
  expect(chat.attachments).toEqual([]);
  expect(chat.attachmentDraftUnsafe).toBe(false);
  expect(chat.attachmentDraftRecoveryNeeded).toBe(false);
  expect(chat.error).toBe("");
});
