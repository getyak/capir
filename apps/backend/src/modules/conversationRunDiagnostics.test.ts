import { describe, expect, it } from "vitest";
import { ClaudeHarnessInterruption } from "@talent-signal/agent";
import { conversationRunDiagnostics } from "./conversationRunDiagnostics.js";

describe("safe conversation failure diagnostics",()=>{
  it("does not retain arbitrary provider errors",()=>{
    expect(JSON.stringify(conversationRunDiagnostics(new Error("secret-provider-payload")))).not.toContain("secret");
  });
  it("keeps SDK correlation and observed usage, never terminal prose or nonfinite timings",()=>{
    const sessionID="11111111-1111-4111-8111-111111111111";
    const receipt={sessionID,inputTokens:12,outputTokens:3,estimatedUsd:null,turns:null,toolCalls:1,
      toolCompletions:[],reportedModels:[],modelResponses:2,terminalReason:"secret terminal prose",permissionDenials:["secret"],usageComplete:false as const,
      sdkTiming:{initializedAfterMs:NaN,firstModelResponseAfterMs:Infinity}};
    expect(conversationRunDiagnostics(new ClaudeHarnessInterruption(receipt,"WORKSPACE_CONVERSATION_TIMEOUT")))
      .toMatchObject({failure_code:"WORKSPACE_CONVERSATION_TIMEOUT",sdk_session_id:sessionID,input_tokens:12,output_tokens:3,usage_complete:false,sdk_initialized_ms:null,sdk_first_response_ms:null});
    expect(JSON.stringify(conversationRunDiagnostics(new ClaudeHarnessInterruption(receipt,"secret error")))).not.toMatch(/secret|provider_request_id/);
  });
});
