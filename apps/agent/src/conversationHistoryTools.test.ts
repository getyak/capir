import { describe, expect, it, vi } from "vitest";
import { createConversationHistoryTools } from "./conversationHistoryTools.js";

const dialogue = Array.from({ length: 18 }, (_, index) => ({
  message_id: `message-${index}`, role: index % 2 ? "assistant" as const : "user" as const,
  text: index === 0 ? "An earlier choice: synthetic blue." : `Synthetic turn ${index}`,
}));
function history(messages = dialogue, version = "version-1", assertCurrent = vi.fn(async () => {})) {
  const result = createConversationHistoryTools({ messages, version, assertCurrent });
  return { ...result, assertCurrent, read: async (input: Record<string, unknown>, signal = new AbortController().signal) => {
    const output = await result.tools[0]!.execute(input, signal);
    return JSON.parse((output.content[0] as { text: string }).text);
  } };
}

describe("authorized Session history windows", () => {
  it("retrieves earlier dialogue without changing the inline projection", async () => {
    const source = history();
    expect(source.inventory).toMatchObject({ message_count: 18, coverage: "not_loaded" });
    const page = await source.read({ operation: "search", query: "SYNTHETIC BLUE" });
    expect(page.entries).toMatchObject([{ message_id: "message-0", text: dialogue[0]!.text }]);
    expect(page.selection_kind).toBe("literal_matches_only");
    expect(page.authority).toBe("conversation_only_not_evidence_or_action_permission");
    expect(source.assertCurrent).toHaveBeenCalledTimes(2);
  });

  it("reaches every UTF-16 unit of a long message without splitting a surrogate pair", async () => {
    const text = "a😀中".repeat(2_000);
    const source = history([{ message_id: "long", role: "user", text }]);
    let offset = 0, restored = "";
    for (let index = 0; index < 5_000; index++) {
      const part = (await source.read({ operation: "read", message_id: "long", offset, character_count: 3 })).message;
      expect(part.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      restored += part.text;
      if (part.next_offset_utf16 === null) break;
      expect(part.next_offset_utf16).toBeGreaterThan(offset);
      offset = part.next_offset_utf16;
    }
    expect(restored).toBe(text);
  });

  it("pages bounded text with explicit continuation rather than silent truncation", async () => {
    const source = history();
    let cursor: string | undefined;
    const messages: string[] = [];
    do {
      const page = await source.read({ operation: "page", character_count: 64, ...(cursor ? { cursor } : {}) });
      expect(page.entries.map((entry: { text: string }) => entry.text).join("").length).toBeLessThanOrEqual(64);
      expect(page.coverage).toBe(page.next_cursor ? "partial_selection" : "selection_end");
      messages.push(...page.entries.map((entry: { text: string }) => entry.text));
      cursor = page.next_cursor;
    } while (cursor);
    expect(messages.join("")).toBe(dialogue.map(message => message.text).join(""));
  });

  it("caps response entries even when there is spare text capacity", async () => {
    const source = history(Array.from({ length: 45 }, (_, index) => ({ message_id: `${index}`, role: "user", text: "x" })));
    expect((await source.read({ operation: "page" })).entries).toHaveLength(20);
  });

  it("binds cursors to the snapshot version, selection and direction", async () => {
    const source = history();
    const page = await source.read({ operation: "page", character_count: 2 });
    await expect(history(dialogue, "version-2").read({ operation: "page", cursor: page.next_cursor })).rejects.toThrow("HISTORY_CURSOR_INVALID");
    await expect(source.read({ operation: "page", direction: "newest", cursor: page.next_cursor })).rejects.toThrow("HISTORY_CURSOR_INVALID");
    await expect(source.read({ operation: "search", query: "Synthetic", cursor: page.next_cursor })).rejects.toThrow("HISTORY_CURSOR_INVALID");
  });

  it("rejects source revocation before and after access without returning text", async () => {
    const before = vi.fn(async () => { throw new Error("SOURCE_REVOKED"); });
    await expect(history(dialogue, "v", before).read({ operation: "page" })).rejects.toThrow("SOURCE_REVOKED");
    const after = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SOURCE_REVOKED"));
    await expect(history(dialogue, "v", after).read({ operation: "page" })).rejects.toThrow("SOURCE_REVOKED");
  });

  it("does not retain a mutable caller-owned dialogue array", async () => {
    const messages = [{ message_id: "one", role: "user" as const, text: "Original synthetic text" }];
    const source = history(messages);
    messages[0]!.text = "Changed after admission";
    messages.push({ message_id: "two", role: "user", text: "Not admitted" });
    expect((await source.read({ operation: "page" })).entries).toMatchObject([{ text: "Original synthetic text" }]);
    await expect(source.read({ operation: "read", message_id: "two" })).rejects.toThrow("HISTORY_MESSAGE_UNAVAILABLE");
  });

  it("rejects selectors, mixed operations, invalid ranges and oversized windows", async () => {
    const source = history([{ message_id: "emoji", role: "user", text: "a😀z" }]);
    for (const input of [
      { operation: "page", session_id: "foreign" }, { operation: "page", query: "x" },
      { operation: "read", message_id: "emoji", cursor: "forged" },
      { operation: "read", message_id: "emoji", offset: 2 },
      { operation: "read", message_id: "emoji", offset: 20 },
      { operation: "page", character_count: 64_001 }, { operation: "search", query: " " },
    ]) await expect(source.read(input)).rejects.toThrow();
  });

  it("honors cancellation on both sides of an awaited authority check", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(history().read({ operation: "page" }, controller.signal)).rejects.toThrow();
    const late = new AbortController();
    const source = history(dialogue, "v", vi.fn(async () => { late.abort(); }));
    await expect(source.read({ operation: "page" }, late.signal)).rejects.toThrow();
  });

  it("does not claim semantic absence or expose a history capability for no dialogue", () => {
    expect(history([]).tools).toEqual([]);
    expect(history().instructions).toContain("no match cannot establish semantic absence");
  });
});
