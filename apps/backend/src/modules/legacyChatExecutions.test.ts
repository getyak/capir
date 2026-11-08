import { expect, it } from "vitest";
import type { PoolClient } from "pg";
import type { LegacyChatAuthority } from "./legacyChatAuthority.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { admitLegacyChatExecution, freezeLegacyChatAnswerProvider, snapshotEligibleLegacyProvider } from "./legacyChatExecutions.js";
import { guardLegacyProvider } from "./legacyChatProviderGuard.js";
import { runLegacyChatAnswerWindow } from "./legacyChatOwner.js";

it("delegates the frozen answer-only window through the real original-authority guard",async () => {
  let calls = 0;
  const actual: RemoteChatAnswerProviding = { providerId: "deepseek-chat-completions",model: "synthetic-frozen-answer",
    supportsImageInput: false,async answer() {
      expect(this).toBe(actual); calls++;
      return { kind: "answer",title: "Synthetic",body: "Exact synthetic answer",citation_ids: [],
        provider_id: "deepseek-chat-completions",model: actual.model,provider_request_id: null,input_tokens: 1,output_tokens: 1 };
    } };
  const selected = snapshotEligibleLegacyProvider(actual)!.provider!;
  const controller = new AbortController();
  const authority = { signal: controller.signal,provider: <T>(operation: () => Promise<T>) => operation() } as unknown as LegacyChatAuthority;
  const bounded = freezeLegacyChatAnswerProvider(selected.model,request => runLegacyChatAnswerWindow({
    answer: () => selected.answer(request),poll: async () => {},signal: controller.signal }));
  expect(Object.isFrozen(selected)).toBe(true); expect(Object.isFrozen(bounded)).toBe(true);
  expect((bounded as { run?: unknown }).run).toBeUndefined();
  const guarded = guardLegacyProvider(bounded,authority);
  await expect(guarded.answer({ objective: "Synthetic",context_blocks: [],allowed_citation_ids: [] }))
    .resolves.toMatchObject({ body: "Exact synthetic answer" });
  expect(calls).toBe(1);
});

it("binds disabled provider absence as SQL NULL rather than JSON null",async () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  let descriptor: unknown = "not inserted";
  const client = { query: async (sql: string,values: unknown[]) => {
    if (sql.includes("AS deadline")) return { rows: [{ deadline: "2099-01-01T00:00:00.123456Z" }],rowCount: 1 };
    if (sql.includes("AS generation")) return { rows: [{ generation: "0",session_stamp: null,current: true }],rowCount: 1 };
    if (sql.startsWith("INSERT INTO legacy_chat_executions")) descriptor = values[8];
    return { rows: [{}],rowCount: 1 };
  } } as unknown as PoolClient;
  const authority = { assertCurrent: async () => {},snapshotOriginal: () => ({ originalDeadline: "2099-01-01T00:00:00.123456Z" }) } as unknown as LegacyChatAuthority;
  const selected = snapshotEligibleLegacyProvider(null)!;
  await admitLegacyChatExecution(client,{ accountId: uuid(1),accountSlug: "synthetic",userId: uuid(2),userKind: "password_human",
    userEmail: "synthetic@example.invalid",sessionId: uuid(3) },{ id: uuid(4),replay: null },authority,selected);
  // A PostgreSQL parameter null is SQL NULL. JSON.stringify(null) would send
  // the string "null" and violate the real object-or-SQL-NULL table constraint.
  expect(descriptor).toBeNull();
});
