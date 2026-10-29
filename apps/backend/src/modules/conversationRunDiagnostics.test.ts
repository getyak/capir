import { describe, expect, it } from "vitest";
import { ClaudeHarnessFailure, ClaudeHarnessInterruption } from "@talent-signal/agent";
import { conversationRunDiagnostics } from "./conversationRunDiagnostics.js";

describe("safe conversation failure diagnostics",()=>{
  it("preserves a terminal provider failure and its HTTP status without provider prose",()=>{
    const error = new ClaudeHarnessFailure({ sessionID:"11111111-1111-4111-8111-111111111111",
      inputTokens:0, outputTokens:0, estimatedUsd:0, turns:1, toolCalls:0, toolCompletions:[],
      reportedModels:[], modelResponses:1, terminalReason:"PRIVATE_PROVIDER_PROSE", permissionDenials:[],
      providerStatus:400, apiRetries:[] }, "CLAUDE_HARNESS_PROVIDER_ERROR");
    expect(conversationRunDiagnostics(error)).toMatchObject({
      failure_code:"CLAUDE_HARNESS_PROVIDER_ERROR", provider_http_status:400,
    });
    expect(JSON.stringify(conversationRunDiagnostics(error))).not.toContain("PRIVATE_PROVIDER_PROSE");
    error.receipt.providerStatus = 999;
    expect(conversationRunDiagnostics(error).provider_http_status).toBeNull();
  });
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
