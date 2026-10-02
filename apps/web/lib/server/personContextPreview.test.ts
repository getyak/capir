import {beforeEach, describe, expect, it, vi} from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({memory: vi.fn(), sessions: vi.fn()}));
vi.mock("./localBackend", () => ({loadPersonMemory: mocks.memory}));
vi.mock("./workspaceSessions", () => ({loadWorkspaceSessionDirectory: mocks.sessions}));
import {loadPersonContextPreview} from "./personContextPreview";
import {BackendSessionExpiredError} from "../backend-session";
const id = "10000000-0000-4000-8000-000000000041";
beforeEach(() => {vi.resetAllMocks(); mocks.sessions.mockResolvedValue({sessions: []});});
describe("person-only read projection", () => {
  it("omits raw evidence, pending proposals, self and other-person memory while preserving future/source status", async () => {
    const item = {id: "m1", scope: "person", subject_id: id, display_text: "合成人物计划周四发方案，尚未发送。", statement_kind: "source_statement", time_status: "future", speaker: "合成人物", evidence_retained: true, observed_time: null, evidence_refs: [{excerpt: "raw synthetic source"}]};
    mocks.memory.mockResolvedValue({person: {id, display_label: "合成人物", profile: null, avatar: null, contexts: [{id:"ctx", display_label:"设计讨论"}]}, proposals: [{secret: "pending synthetic proposal"}], items: [item, {...item,id:"self",scope:"self"}, {...item,id:"other",subject_id:"another"}, {...item,id:"ctx-other",scope:"relationship",relationship_context_id:"not-owned"}]});
    mocks.sessions.mockResolvedValue({sessions: [{personId:id,sessionId:"session",title:"合成讨论",updatedAt:"2026-10-01T00:00:00.000Z"},{personId:"another",sessionId:"foreign",title:"other",updatedAt:"2026-10-01T00:00:00.000Z"}]});
    const result = await loadPersonContextPreview(id,"binding");
    expect(result.person.headline).toBeNull();
    expect(result.memory).toHaveLength(1);
    expect(result.memory[0]).toMatchObject({timeStatus:"future",kind:"source_statement",speaker:"合成人物"});
    expect(result.history.map(x => x.id)).toEqual(["session"]);
    expect(JSON.stringify(result)).not.toMatch(/raw synthetic|pending synthetic|evidence_refs/);
  });
  it("fails closed for a deleted/absent person, and never loads unrelated history", async () => {
    mocks.memory.mockResolvedValue({person:null,items:[],proposals:[]});
    await expect(loadPersonContextPreview(id,"binding")).rejects.toMatchObject({status:404});
    expect(mocks.sessions).not.toHaveBeenCalled();
  });
  it("represents unavailable history honestly without substituting records", async () => {
    mocks.memory.mockResolvedValue({person:{id,display_label:"合成人物",profile:null,avatar:null,contexts:[]},items:[],proposals:[]});
    mocks.sessions.mockRejectedValue(new Error("synthetic failure"));
    expect(await loadPersonContextPreview(id,"binding")).toMatchObject({history:[],historyUnavailable:true});
  });
  it.each([new BackendSessionExpiredError(), {status:403}])("fails closed if history authorization is revoked after the memory read", async error => {
    mocks.memory.mockResolvedValue({person:{id,display_label:"合成人物",profile:null,avatar:null,contexts:[]},items:[],proposals:[]});
    mocks.sessions.mockRejectedValue(error);
    await expect(loadPersonContextPreview(id,"binding")).rejects.toBe(error);
  });
});
