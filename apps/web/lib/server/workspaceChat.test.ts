import { describe, expect, it, vi } from "vitest";
import { TalentSignalHttpError, type TalentSignalClient, type AgentSessionResponse, CONTRACT_VERSION } from "@talent-signal/contracts";
import { askWorkspaceChat, workspaceSessionTitle } from "./workspaceChat";
const sid = "b31d4f3e-fa98-4eea-8b57-7a278d10dd41", rid = "ca3322d4-4534-4e6c-95df-b0ffed3c0574", tid = "aac2e37f-abe9-48bb-a48a-6a91c2f6920f";
const input = { session_id: sid, request_id: rid, objective: "明天下午三点聊半小时", time_zone: "Asia/Shanghai" };
const payload = { id: sid, scopeKind: "unresolved_intent" as const, personDisplayLabel: "", contextDisplayLabel: "", title: "test", turns: [], updatedAt: "2026-09-10T00:00:00Z", isUnread: false };
const record = { contract_version: CONTRACT_VERSION, session: { session_id: sid, revision: 1, updated_at: payload.updatedAt, expires_at: "2026-09-17T00:00:00Z", deleted_at: null, payload, display_authority: "stale_unconfirmed" } } as AgentSessionResponse;
const output = { task_id: tid, created_at: payload.updatedAt, disposition: "answer", blocks: [{ id: "answer-1", kind: "answer", title: "回复", status: "ready", body: "草稿等待确认", requires_user_decision: true, calendar_draft: { sensitive: "never persist executable payload" } }], external_effects: [], session_title: "安排明天下午会议" };
function fixture() {
 const getAgentSession = vi.fn().mockResolvedValue(structuredClone(record));
 const saveAgentSession = vi.fn().mockImplementation(async (_id, mutation) => ({ ...structuredClone(record), session: { ...structuredClone(record.session), payload: mutation.payload } }));
 const createUnscopedChatTask = vi.fn().mockResolvedValue(output);
 return { getAgentSession, saveAgentSession, createUnscopedChatTask, client: { getAgentSession, saveAgentSession, createUnscopedChatTask } as unknown as TalentSignalClient };
}
describe("Web workspace conversation", () => {
 it("creates an owned Session and stores canonical task references after completion", async () => {
  const f=fixture();f.getAgentSession.mockRejectedValueOnce(new TalentSignalHttpError(404,"not_found","",null));
  expect(await askWorkspaceChat(f.client,input)).toEqual(output);
  expect(f.saveAgentSession.mock.calls[0][1]).toMatchObject({idempotency_key:sid,expected_revision:0,payload:{scopeKind:"unresolved_intent",turns:[]}});
  expect(f.saveAgentSession.mock.calls[0][1].payload.title).toBe(input.objective);
  expect(f.createUnscopedChatTask).toHaveBeenCalledWith({idempotency_key:`web-chat:${rid}`,session_id:sid,message_id:rid,objective:input.objective,time_zone:input.time_zone});
  expect(f.saveAgentSession.mock.calls[1][1].idempotency_key).toBe(rid);
  expect(f.saveAgentSession.mock.calls[1][1].payload.title).toBe(output.session_title);
  expect(f.saveAgentSession.mock.calls[1][1].payload.turns[0]).toMatchObject({id:rid,objective:input.objective,response:{taskID:tid}});
  const history=f.saveAgentSession.mock.calls[1][1].payload.turns[0].response.unboundConversationBlocks;
  expect(history[0]).toMatchObject({body:"草稿等待确认",requires_user_decision:false,allows_static_share:false,citation_dependency_ids:[],target_ref:null});
  expect(history[0]).not.toHaveProperty("calendar_draft");
 });
 it("preserves the same intent key after a typed provider failure",async()=>{
  const f=fixture();f.createUnscopedChatTask.mockRejectedValueOnce(new TalentSignalHttpError(503,"CLAUDE_CHAT_RETRYABLE_FAILURE","retry",null));
  await expect(askWorkspaceChat(f.client,input)).rejects.toMatchObject({status:503});expect(f.saveAgentSession).not.toHaveBeenCalled();
  await askWorkspaceChat(f.client,input);expect(f.createUnscopedChatTask.mock.calls[0]).toEqual(f.createUnscopedChatTask.mock.calls[1]);
 });
 it("does not append a duplicate after an unknown response to an already applied save",async()=>{
  const f=fixture();f.getAgentSession.mockResolvedValue({...record,session:{...record.session,payload:{...payload,turns:[{id:rid}]}}});
  await askWorkspaceChat(f.client,input);expect(f.saveAgentSession).not.toHaveBeenCalled();
 });
 it.each([401,403])("does not recreate an inaccessible Session (%s)",async status=>{
  const f=fixture();f.getAgentSession.mockRejectedValue(new TalentSignalHttpError(status,"denied","",null));
  await expect(askWorkspaceChat(f.client,input)).rejects.toMatchObject({status});expect(f.saveAgentSession).not.toHaveBeenCalled();expect(f.createUnscopedChatTask).not.toHaveBeenCalled();
 });
 it("does not resurrect a deleted Session",async()=>{
  const f=fixture();f.getAgentSession.mockResolvedValue({...record,session:{...record.session,deleted_at:payload.updatedAt,payload:null}});
  await expect(askWorkspaceChat(f.client,input)).rejects.toMatchObject({status:409});expect(f.createUnscopedChatTask).not.toHaveBeenCalled();
 });
 it("preserves earlier turns with an expected revision",async()=>{
  const f=fixture();const prior={id:tid,objective:"earlier"};f.getAgentSession.mockResolvedValue({...record,session:{...record.session,revision:4,payload:{...payload,turns:[prior]}}});
  await askWorkspaceChat(f.client,input);expect(f.saveAgentSession.mock.calls[0][1].expected_revision).toBe(4);expect(f.saveAgentSession.mock.calls[0][1].payload.turns[0]).toEqual(prior);expect(f.saveAgentSession.mock.calls[0][1].payload.title).toBe(payload.title);
 });
 it("rejects invalid intent before any network call",async()=>{
  const f=fixture();await expect(askWorkspaceChat(f.client,{...input,request_id:"invalid"})).rejects.toMatchObject({status:400});expect(f.getAgentSession).not.toHaveBeenCalled();
 });
 it("keeps local titles single-line, useful, and within the shared budget",()=>{
 expect(workspaceSessionTitle("  比较 Maya\n两版外联话术  ")).toBe("比较 Maya 两版外联话术");
  expect(Array.from(workspaceSessionTitle("梳理"+"🧭".repeat(40)))).toHaveLength(32);
  const family="👨‍👩‍👧‍👦",compound=workspaceSessionTitle("梳理"+family.repeat(40));
  expect(Array.from(new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(compound))).toHaveLength(32);
  expect(compound.endsWith(family)).toBe(true);
  expect(workspaceSessionTitle("你好")).toBe("简单聊两句");
  expect(workspaceSessionTitle("Response")).toBe("Quick hello");
 });
});


it("keeps an explicitly renamed empty Session through its first legacy reply", async () => {
  const f = fixture();
  await askWorkspaceChat(f.client, input);
  expect(f.saveAgentSession.mock.calls[0][1].payload.title).toBe(payload.title);
});
