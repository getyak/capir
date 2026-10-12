import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import {
  contactTaskDiagnosticCode,
  environmentScreenshotContactDependencies,
  loadScreenshotContactTask,
  reportScreenshotSpanPersistenceFailure,
  retainContactResearchResult,
} from "./screenshotContactTasks.js";
import { ARK_SCREENSHOT_PREPROCESS_MODEL, CONTACT_RESEARCH_CONTRACT, CONTACT_TASK_PUBLIC_SOURCE_LIMIT,
  type ContactPublicSource, type ContactResearchToolResponse } from "@talent-signal/agent";

const row = {
  id: "synthetic-task", status: "completed", revision: 1,
  expires_at: new Date("2099-01-01"), created_at: new Date(), updated_at: new Date(),
  capture_id: "synthetic-capture", input_manifest: {}, state: { response: {} },
};
const auth = { accountId: "synthetic-account", userId: "synthetic-owner" } as AuthContext;
describe("capture availability readback", () => {
  it("propagates a transient directory lookup failure instead of claiming deletion", async () => {
    const failure = new Error("connection timeout");
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockRejectedValueOnce(failure);
    await expect(loadScreenshotContactTask({ query } as unknown as Pool, auth, row.id)).rejects.toBe(failure);
  });
  it("propagates a transient source lookup failure instead of claiming deletion", async () => {
    const failure = new Error("query timeout");
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ available: true }] }).mockRejectedValueOnce(failure);
    await expect(loadScreenshotContactTask({ query } as unknown as Pool, auth, row.id)).rejects.toBe(failure);
  });
  it("still hides a source when the database proves it unavailable", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ available: true }] }).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await loadScreenshotContactTask({ query } as unknown as Pool, auth, row.id))
      .toMatchObject({ status: "deleted", contact: null, capture_id: null });
  });
});

describe("screenshot preprocessing configuration",()=>{
  it("stays disabled with the product gate",()=>{
    expect(environmentScreenshotContactDependencies({})).toBeNull();
  });
  it("fails closed without sensitive-processing admission or an Ark credential",()=>{
    expect(()=>environmentScreenshotContactDependencies({TALENT_SIGNAL_SCREENSHOT_CONTACT_AGENT_ENABLED:"true"}))
      .toThrow("CONTACT_AGENT_SENSITIVE_AI_NOT_ENABLED");
    expect(()=>environmentScreenshotContactDependencies({TALENT_SIGNAL_SCREENSHOT_CONTACT_AGENT_ENABLED:"true",
      TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING:"true"})).toThrow("SCREENSHOT_PREPROCESS_CREDENTIAL_REQUIRED");
  });
  it("pins the shared Ark Lite preprocessor independently of the downstream model",()=>{
    const dependencies=environmentScreenshotContactDependencies({TALENT_SIGNAL_SCREENSHOT_CONTACT_AGENT_ENABLED:"true",
      TALENT_SIGNAL_ALLOW_SENSITIVE_AI_PROCESSING:"true",ARK_API_KEY:"synthetic-ark",ZHIPU_API_KEY:"synthetic-zhipu"});
    expect(dependencies?.preprocessor).toMatchObject({provider:"volcano_ark",model:ARK_SCREENSHOT_PREPROCESS_MODEL});
  });
});

describe("task-wide public research capacity",()=>{
  const publicSource=(index:number,channel:ContactPublicSource["channel"]="web"):ContactPublicSource=>({
    source_id:index.toString(16).padStart(64,"0"),url:`https://example.com/profile/${index}`,
    title:`Example ${index}`,text:"Public profile",channel,
    provider_id:channel==="web"||channel==="linkedin"?"exa":"tikhub",
    provider_request_id:"fixture",content_hash:(index+100).toString(16).padStart(64,"0"),
    retrieved_at:"2026-09-19T00:00:00.000Z",stage:"discovered",
  });
  it("returns exactly the sources persisted when repeated multi-channel search reaches the task cap",()=>{
    const existing=Array.from({length:24},(_,index)=>publicSource(index));
    const channelNames=["linkedin","web","xiaohongshu","reddit","instagram"] as const;
    const incoming=channelNames.flatMap((channel,channelIndex)=>
      Array.from({length:5},(_,index)=>publicSource(100+channelIndex*5+index,channel)));
    const result:ContactResearchToolResponse={contract_version:CONTACT_RESEARCH_CONTRACT,
      task_id:"11111111-1111-4111-8111-111111111111",call_id:"22222222-2222-4222-8222-222222222222",
      sources:incoming,channels:channelNames.map(channel=>({channel,
        provider:channel==="linkedin"||channel==="web"?"exa" as const:"tikhub" as const,
        status:"ok" as const,result_count:5,truncated:false,error_code:null})),fetch_outcomes:[],external_effects:[]};
    const retained=retainContactResearchResult(existing,result);
    expect(existing).toHaveLength(CONTACT_TASK_PUBLIC_SOURCE_LIMIT);
    expect(retained.sources).toHaveLength(6);
    expect(retained.channels).toEqual([
      expect.objectContaining({channel:"linkedin",result_count:5,truncated:false}),
      expect.objectContaining({channel:"web",result_count:1,truncated:true}),
      ...channelNames.slice(2).map(channel=>expect.objectContaining({channel,result_count:0,truncated:true})),
    ]);
    expect(retained.sources.every(source=>existing.some(item=>item.source_id===source.source_id))).toBe(true);
  });
});

describe("screenshot contact failure diagnostics", () => {
  function canaryError() {
    return Object.assign(new Error("SECRET_TASK_MESSAGE_CANARY"), {
      name: "CONTACT_TASK_ARBITRARY_NAME_CANARY",
      stack: "Error: SECRET_TASK_MESSAGE_CANARY\n    at SECRET_TASK_STACK_CANARY",
      cause: new Error("SECRET_TASK_CAUSE_CANARY"),
      code: "SECRET_TASK_CODE_CANARY",
    });
  }

  it("maps unknown uppercase messages and names to the fixed operation diagnostic", () => {
    // A code-shaped message is not a sanitization boundary: unknown content
    // never becomes a task limitation or observation diagnostic.
    expect(contactTaskDiagnosticCode(canaryError())).toBe("CONTACT_TASK_OPERATION_FAILED");
    expect(contactTaskDiagnosticCode(new Error("CONTACT_TASK_ARBITRARY_SECRET_CANARY")))
      .toBe("CONTACT_TASK_OPERATION_FAILED");
    expect(contactTaskDiagnosticCode(new Error("SCREENSHOT_ARBITRARY_SECRET_CANARY")))
      .toBe("CONTACT_TASK_OPERATION_FAILED");
    expect(contactTaskDiagnosticCode("SECRET_STRING_THROW_CANARY"))
      .toBe("CONTACT_TASK_OPERATION_FAILED");
  });

  it("keeps known policy failures and supported fault injection identifiable", () => {
    // Typed local policy errors map to their declared fixed codes.
    expect(contactTaskDiagnosticCode(new ApiError(409, "CONTACT_CITATION_EXCERPT_MISMATCH", "x")))
      .toBe("CONTACT_CITATION_EXCERPT_MISMATCH");
    expect(contactTaskDiagnosticCode(new ApiError(409, "CONTACT_QUESTION_ESCAPED_TEXT", "x")))
      .toBe("CONTACT_QUESTION_ESCAPED_TEXT");
    // The runner abort reasons and existing fault-injection throws survive.
    expect(contactTaskDiagnosticCode(new Error("CONTACT_TASK_LEASE_LOST")))
      .toBe("CONTACT_TASK_LEASE_LOST");
    expect(contactTaskDiagnosticCode(new Error("CONTACT_TASK_CANCELLED")))
      .toBe("CONTACT_TASK_CANCELLED");
    // Recognized research transport diagnostics stay identifiable.
    expect(contactTaskDiagnosticCode(Object.assign(new Error("socket reset"), { code: "ECONNRESET" })))
      .toBe("ECONNRESET");
    expect(contactTaskDiagnosticCode(new Error("CONTACT_RESEARCH_INJECTED_TRANSIENT")))
      .toBe("CONTACT_RESEARCH_INJECTED_TRANSIENT");
    // Shared Agent contact-surface policy codes stay identifiable.
    expect(contactTaskDiagnosticCode(new Error("CONTACT_TEXT_EXTRACTION_NOT_SOURCE_GROUNDED")))
      .toBe("CONTACT_TEXT_EXTRACTION_NOT_SOURCE_GROUNDED");
  });

  it("never lets raw Error.name or message reach span persistence logging", () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      reportScreenshotSpanPersistenceFailure(canaryError());
      reportScreenshotSpanPersistenceFailure(new Error("CONTACT_TASK_LEASE_LOST"));
    } finally {
      spy.mockRestore();
    }
    // Unknown content logs only the fixed operation diagnostic; the known
    // policy failure stays identifiable. Logging is never silenced.
    expect(logged).toEqual([
      ["Product screenshot span persistence failed", "CONTACT_TASK_OPERATION_FAILED"],
      ["Product screenshot span persistence failed", "CONTACT_TASK_LEASE_LOST"],
    ]);
    for (const canary of [
      "SECRET_TASK_MESSAGE_CANARY",
      "CONTACT_TASK_ARBITRARY_NAME_CANARY",
      "SECRET_TASK_STACK_CANARY",
      "SECRET_TASK_CAUSE_CANARY",
      "SECRET_TASK_CODE_CANARY",
    ]) {
      expect(JSON.stringify(logged)).not.toContain(canary);
    }
  });
});
