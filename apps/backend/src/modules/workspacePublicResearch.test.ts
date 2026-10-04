import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  CONTACT_RESEARCH_CONTRACT,
  ContactResearchToolRequestSchema,
  type ContactPublicSource,
  type ContactResearchChannel,
  type ContactResearchToolRequest,
  type ContactResearchToolResponse,
} from "@talent-signal/agent";

import type { ContactResearchClient } from "./contactResearchClient.js";
import {
  WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS,
  WORKSPACE_PUBLIC_RESEARCH_TOOL_NAMES,
  createWorkspacePublicResearch,
  isWorkspacePublicResearchTransientError,
  workspacePublicResearchQuery,
  type WorkspacePublicResearchSubject,
  type WorkspacePublicResearchToolResult,
} from "./workspacePublicResearch.js";

const taskID = randomUUID();

function subject(id: string, name: string, isCurrent?: () => Promise<boolean>): WorkspacePublicResearchSubject {
  return { id, name, ...(isCurrent ? { isCurrent } : {}) };
}

function discovered(
  provider: "exa" | "tikhub",
  channel: "web" | "weibo",
  url: string,
  text = "Public biography excerpt long enough to count as a real source receipt.",
): ContactPublicSource {
  return {
    source_id: createHash("sha256").update(`${provider}:${url}`).digest("hex"),
    url,
    title: `Public page for ${url}`,
    text,
    channel,
    provider_id: provider,
    provider_request_id: "fixture-request",
    content_hash: createHash("sha256").update(url).digest("hex"),
    retrieved_at: "2026-09-23T00:00:00.000Z",
    stage: provider === "exa" ? "discovered" : "profile_observation",
  };
}

type Handler = (request: ContactResearchToolRequest) => unknown;

function fakeClient(handler: Handler): {
  client: ContactResearchClient;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async (input: unknown) =>
    handler(ContactResearchToolRequestSchema.parse(input)),
  );
  return { client: { execute } as unknown as ContactResearchClient, execute };
}

function okChannel(
  channel: ContactResearchChannel,
  provider: "exa" | "tikhub",
  resultCount: number,
) {
  return { channel, provider, status: "ok" as const, result_count: resultCount, truncated: false, error_code: null };
}

function searchReply(
  request: ContactResearchToolRequest,
  sources: ContactPublicSource[],
  channels: ContactResearchToolResponse["channels"],
): ContactResearchToolResponse {
  return {
    contract_version: CONTACT_RESEARCH_CONTRACT,
    task_id: request.task_id,
    call_id: request.call_id,
    sources,
    channels,
    fetch_outcomes: [],
    external_effects: [],
  };
}

function fetched(
  source: ContactPublicSource,
  text = "Fetched public page body, long enough to serve as a source receipt.",
): ContactPublicSource {
  return { ...source, text, stage: "fetched" };
}

function ok(
  result: WorkspacePublicResearchToolResult,
): Extract<WorkspacePublicResearchToolResult, { ok: true }> {
  expect(result.ok).toBe(true);
  return result as Extract<WorkspacePublicResearchToolResult, { ok: true }>;
}

function failed(
  result: WorkspacePublicResearchToolResult,
): Extract<WorkspacePublicResearchToolResult, { ok: false }> {
  expect(result.ok).toBe(false);
  return result as Extract<WorkspacePublicResearchToolResult, { ok: false }>;
}

describe("workspace public-subject research adapter", () => {
  it.each(["foreign_channel","excess_count","forged_id"])("rejects malformed search receipts: %s",async variant=>{
    const base=discovered("exa","web","https://example.com/a");
    const sources=variant==="foreign_channel"?[base,discovered("tikhub","weibo","https://weibo.example/a")]
      :variant==="excess_count"?Array.from({length:4},(_,i)=>discovered("exa","web",`https://example.com/${i}`))
      :[{...base,source_id:"f".repeat(64)}];
    const {client}=fakeClient(request=>searchReply(request,sources,[okChannel("web","exa",variant==="excess_count"?4:1)]));
    const research=createWorkspacePublicResearch({client,taskID,authorizedSubjects:()=>[subject("one","Simon Willison")]});
    expect(failed(await research.execute("search_public_subject",{subject_id:"one"})).error.code).toBe("PUBLIC_RESEARCH_UNAVAILABLE");
  });

  it("searches a host-authorized subject with the fixed minimal query and full receipts", async () => {
    const sourceA = discovered("exa", "web", "https://lilianweng.github.io/posts/2023-06-23-agent/");
    const sourceB = discovered("exa", "web", "https://example.com/profile");
    const { client, execute } = fakeClient((request) =>
      searchReply(request, [sourceA, sourceB], [okChannel("web", "exa", 2)]),
    );
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    const result = ok(await research.execute("search_public_subject", { subject_id: "sub-1" }));

    const request = execute.mock.calls[0]![0] as ContactResearchToolRequest;
    expect(Object.keys(request).sort()).toEqual([
      "anchors",
      "call_id",
      "contract_version",
      "input",
      "task_id",
    ]);
    expect(request).toMatchObject({
      contract_version: CONTACT_RESEARCH_CONTRACT,
      task_id: taskID,
      anchors: ["Lilian Weng"],
    });
    expect(request.input).toEqual({
      operation: "search",
      channels: ["web"],
      query: workspacePublicResearchQuery("Lilian Weng"),
      maximum_results_per_channel: 3,
    });
    expect(request.call_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(workspacePublicResearchQuery("Lilian Weng")).toBe(
      "Lilian Weng biography official website",
    );

    expect(result.data).toMatchObject({
      operation: "search",
      subject_id: "sub-1",
      subject_name: "Lilian Weng",
      fetchable_source_ids: [sourceA.source_id, sourceB.source_id],
      truncated: false,
    });
    // Full source receipts, not summaries: citations need url and content identity.
    const receipts = (result.data as { sources: ContactPublicSource[] }).sources;
    expect(receipts).toEqual([sourceA, sourceB]);
    expect(receipts[0]!.url).toMatch(/^https:\/\//u);
    expect(receipts[0]!.text.length).toBeGreaterThanOrEqual(40);
    expect(receipts[0]!.content_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(receipts[0]!.retrieved_at).toBeTruthy();
  });

  it("reserves the search budget before dispatch and never retries or refunds permanent failures", async () => {
    // Permanent injected unavailability is never retried: one dispatch per
    // invocation, and a failed dispatch still consumes its reservation.
    expect(isWorkspacePublicResearchTransientError(new Error("CONTACT_RESEARCH_INJECTED_TRANSIENT"))).toBe(true);
    expect(isWorkspacePublicResearchTransientError(new Error("CONTACT_RESEARCH_TIMEOUT"))).toBe(true);
    expect(isWorkspacePublicResearchTransientError(new Error("CONTACT_RESEARCH_UNAVAILABLE"))).toBe(false);
    expect(isWorkspacePublicResearchTransientError(new Error("PUBLIC_RESEARCH_RESPONSE_MISMATCH"))).toBe(false);
    const { client, execute } = fakeClient(() => {
      throw new Error("CONTACT_RESEARCH_UNAVAILABLE");
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    for (let index = 0; index < WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS; index += 1) {
      const result = failed(await research.execute("search_public_subject", { subject_id: "sub-1" }));
      expect(result.error).toMatchObject({
        code: "PUBLIC_RESEARCH_UNAVAILABLE",
        detail: "CONTACT_RESEARCH_UNAVAILABLE",
      });
      expect(result.attempts).toEqual([
        { call_id: result.callID, status: "failed", error_code: "CONTACT_RESEARCH_UNAVAILABLE" },
      ]);
    }
    const exhausted = failed(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(exhausted.error?.code).toBe("PUBLIC_RESEARCH_BUDGET_EXHAUSTED");
    expect(execute).toHaveBeenCalledTimes(WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS);
  });

  it("retries one transient failure with a fresh call_id and identical provenance", async () => {
    const source = discovered("exa", "web", "https://example.com/retried");
    const requests: ContactResearchToolRequest[] = [];
    let calls = 0;
    const { client, execute } = fakeClient((request) => {
      requests.push(request);
      calls += 1;
      if (calls === 1) throw new Error("CONTACT_RESEARCH_INJECTED_TRANSIENT");
      return searchReply(request, [source], [okChannel("web", "exa", 1)]);
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Andrew Ng")],
    });

    const result = ok(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    // One automatic retry recovered the transient failure inside the budget.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.attempts).toEqual([
      { call_id: result.callID, status: "failed", error_code: "CONTACT_RESEARCH_INJECTED_TRANSIENT" },
      { call_id: expect.any(String), status: "ok" },
    ]);
    // Fresh call_id per dispatch; identical anchors/query/channels: the retry
    // never broadens the query or the provenance.
    expect(requests).toHaveLength(2);
    expect(requests[0]!.call_id).toBe(result.callID);
    expect(requests[1]!.call_id).not.toBe(requests[0]!.call_id);
    expect({ ...requests[0]!, call_id: "fixed" }).toEqual({ ...requests[1]!, call_id: "fixed" });
    expect((result.data as { sources: ContactPublicSource[] }).sources).toEqual([source]);
  });

  it("bounds all-transient failures to one automatic retry and the global dispatch cap", async () => {
    const { client, execute } = fakeClient(() => {
      throw new Error("CONTACT_RESEARCH_INJECTED_TRANSIENT");
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Andrew Ng")],
    });

    const first = failed(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    // Initial plus exactly one retry, then the actual failure is preserved.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(first.error).toMatchObject({
      code: "PUBLIC_RESEARCH_UNAVAILABLE",
      detail: "CONTACT_RESEARCH_INJECTED_TRANSIENT",
    });
    expect(first.attempts).toHaveLength(2);
    expect(first.attempts?.every((attempt) => attempt.status === "failed"
      && attempt.error_code === "CONTACT_RESEARCH_INJECTED_TRANSIENT")).toBe(true);

    // Only one global dispatch remains: the failure is reported without a
    // retry, and the final invocation has no dispatch budget at all.
    const second = failed(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(second.attempts).toHaveLength(1);
    expect(second.error?.code).toBe("PUBLIC_RESEARCH_UNAVAILABLE");

    const third = failed(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(third.error?.code).toBe("PUBLIC_RESEARCH_BUDGET_EXHAUSTED");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("never retries after the subject turns stale or the run aborts between attempts", async () => {
    // Stale between attempts: no retry dispatch is sent.
    let current = true;
    const stale = fakeClient(() => {
      current = false;
      throw new Error("CONTACT_RESEARCH_INJECTED_TRANSIENT");
    });
    const staleResearch = createWorkspacePublicResearch({
      client: stale.client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Andrew Ng", async () => current)],
    });
    const staleResult = failed(await staleResearch.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(staleResult.error?.code).toBe("PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT");
    expect(stale.execute).toHaveBeenCalledTimes(1);
    expect(staleResult.attempts).toEqual([
      { call_id: staleResult.callID, status: "failed", error_code: "CONTACT_RESEARCH_INJECTED_TRANSIENT" },
    ]);

    // Aborted between attempts: no retry dispatch is sent.
    const controller = new AbortController();
    const aborted = fakeClient(() => {
      controller.abort();
      throw new Error("CONTACT_RESEARCH_INJECTED_TRANSIENT");
    });
    const abortedResearch = createWorkspacePublicResearch({
      client: aborted.client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Andrew Ng")],
    });
    const abortedResult = failed(await abortedResearch.execute(
      "search_public_subject",
      { subject_id: "sub-1" },
      controller.signal,
    ));
    expect(abortedResult.error?.code).toBe("PUBLIC_RESEARCH_CANCELLED");
    expect(aborted.execute).toHaveBeenCalledTimes(1);
    expect(abortedResult.attempts?.[0]).toMatchObject({
      status: "failed",
      error_code: "CONTACT_RESEARCH_INJECTED_TRANSIENT",
    });
  });

  it("keeps concurrent transient retries inside the global dispatch cap", async () => {
    const { client, execute } = fakeClient(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      throw new Error("CONTACT_RESEARCH_INJECTED_TRANSIENT");
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Andrew Ng")],
    });

    const results = await Promise.all([
      research.execute("search_public_subject", { subject_id: "sub-1" }),
      research.execute("search_public_subject", { subject_id: "sub-1" }),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
    // Both invocations combined may spend exactly the global dispatch budget:
    // one recovers its retry slot, the other reports its actual failure.
    expect(execute).toHaveBeenCalledTimes(WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS);
    expect(results.flatMap((result) => result.attempts ?? [])).toHaveLength(
      WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS,
    );
  });

  it("recovers one failed subject within the same bounded search budget",async()=>{
    let calls=0;
    const source=discovered("exa","web","https://example.com/recovered");
    const {client,execute}=fakeClient(request=>{if(++calls===2)throw Error("CONTACT_RESEARCH_UNAVAILABLE");return searchReply(request,[source],[okChannel("web","exa",1)]);});
    const research=createWorkspacePublicResearch({client,taskID,authorizedSubjects:()=>[subject("one","Simon Willison"),subject("two","Craig Mod")]});
    ok(await research.execute("search_public_subject",{subject_id:"one"}));
    failed(await research.execute("search_public_subject",{subject_id:"two"}));
    ok(await research.execute("search_public_subject",{subject_id:"two"}));
    expect(failed(await research.execute("search_public_subject",{subject_id:"two"})).error.code).toBe("PUBLIC_RESEARCH_BUDGET_EXHAUSTED");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("cannot over-admit concurrent calls past the reserved budget", async () => {
    const source = discovered("exa", "web", "https://example.com/concurrent");
    const { client, execute } = fakeClient(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return searchReply(request, [source], [okChannel("web", "exa", 1)]);
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    const results = await Promise.all(Array.from({length:WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS+1},()=>research.execute("search_public_subject", { subject_id: "sub-1" })));
    expect(execute).toHaveBeenCalledTimes(WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS);
    expect(results.filter((result) => result.ok)).toHaveLength(WORKSPACE_PUBLIC_RESEARCH_MAX_SEARCH_CALLS);
    const rejected = failed(results.find((result) => !result.ok)!);
    expect(rejected.error?.code).toBe("PUBLIC_RESEARCH_BUDGET_EXHAUSTED");
  });

  it("returns only registered entries with an accurate truncation flag at the five-source cap", async () => {
    const first = Array.from({ length: 3 }, (_value, index) =>
      discovered("exa", "web", `https://example.com/first-${index}`),
    );
    const second = Array.from({ length: 3 }, (_value, index) =>
      discovered("exa", "web", `https://example.com/second-${index}`),
    );
    const clientState = { phase: 1 };
    const { client } = fakeClient((request) =>
      searchReply(
        request,
        clientState.phase === 1 ? first : second,
        [okChannel("web", "exa", 3)],
      ),
    );
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Person A"), subject("sub-2", "Person B")],
    });

    const one = ok(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    expect((one.data as { sources: unknown[] }).sources).toHaveLength(3);
    expect((one.data as { truncated: boolean }).truncated).toBe(false);
    clientState.phase = 2;
    // Two people returning three each: the second call may register only two.
    const two = ok(await research.execute("search_public_subject", { subject_id: "sub-2" }));
    const payload = two.data as {
      sources: ContactPublicSource[];
      fetchable_source_ids: string[];
      truncated: boolean;
    };
    expect(payload.sources.map((source) => source.source_id)).toEqual([
      second[0]!.source_id,
      second[1]!.source_id,
    ]);
    expect(payload.fetchable_source_ids).toHaveLength(5);
    expect(payload.truncated).toBe(true);
  });

  it("lets a repeat receipt update its existing registry slot", async () => {
    const s1 = discovered("exa", "web", "https://example.com/one");
    const s2 = discovered("exa", "web", "https://example.com/two");
    const s1Updated = discovered("exa", "web", "https://example.com/one", "Updated public biography receipt text, long enough.");
    const s3 = discovered("exa", "web", "https://example.com/three");
    const s4 = discovered("tikhub", "weibo", "https://weibo.com/u/four");
    const clientState = { phase: 1 };
    const { client } = fakeClient((request) => {
      if (clientState.phase === 1) {
        return searchReply(request, [s1, s2], [okChannel("web", "exa", 2)]);
      }
      return searchReply(request, [s1Updated, s3, s4], [
        okChannel("web", "exa", 2),
        okChannel("weibo", "tikhub", 1),
      ]);
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Person A"), subject("sub-2", "Person B")],
    });

    ok(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    clientState.phase = 2;
    const second = ok(await research.execute("search_public_subject", {
      subject_id: "sub-2",
      channels: ["web", "weibo"],
    }));
    const payload = second.data as {
      sources: ContactPublicSource[];
      fetchable_source_ids: string[];
      truncated: boolean;
    };
    // The repeat updated slot one instead of consuming new capacity.
    expect(payload.sources.map((source) => source.source_id)).toEqual([
      s1Updated.source_id,
      s3.source_id,
      s4.source_id,
    ]);
    expect(payload.sources[0]!.text).toBe(s1Updated.text);
    expect(payload.fetchable_source_ids).toEqual([
      s1.source_id,
      s2.source_id,
      s3.source_id,
      s4.source_id,
    ]);
    expect(payload.truncated).toBe(false);
  });

  it("validates the search response binding inline before returning anything", async () => {
    const web = discovered("exa", "web", "https://example.com/web");
    const social = discovered("tikhub", "weibo", "https://weibo.com/u/social");
    const base = (request: ContactResearchToolRequest): ContactResearchToolResponse =>
      searchReply(request, [web, social], [
        okChannel("web", "exa", 1),
        okChannel("weibo", "tikhub", 1),
      ]);
    const runWith = async (mutate: (response: ContactResearchToolResponse) => ContactResearchToolResponse) => {
      const { client, execute } = fakeClient((request) => mutate(base(request)));
      const research = createWorkspacePublicResearch({
        client,
        taskID,
        authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
      });
      const result = failed(await research.execute("search_public_subject", {
        subject_id: "sub-1",
        channels: ["web", "weibo"],
      }));
      expect(execute).toHaveBeenCalledTimes(1);
      return result;
    };

    // Exact channel list and order.
    const reversed = await runWith((response) => ({
      ...response,
      channels: [...response.channels].reverse(),
    }));
    expect(reversed.error).toMatchObject({
      code: "PUBLIC_RESEARCH_UNAVAILABLE",
      detail: "PUBLIC_RESEARCH_RESPONSE_MISMATCH",
    });

    // Unique source ids.
    const duplicate = await runWith((response) => ({
      ...response,
      sources: [web, web],
      channels: [okChannel("web", "exa", 2), okChannel("weibo", "tikhub", 0)],
    }));
    expect(duplicate.error?.detail).toBe("PUBLIC_RESEARCH_RESPONSE_MISMATCH");

    // No failed channel may carry sources.
    const failedChannel = await runWith((response) => ({
      ...response,
      channels: [
        okChannel("web", "exa", 1),
        { channel: "weibo", provider: "tikhub", status: "failed" as const, result_count: 0, truncated: false, error_code: "RATE_LIMITED" as const },
      ],
    }));
    expect(failedChannel.error?.detail).toBe("PUBLIC_RESEARCH_RESPONSE_MISMATCH");

    // Per-channel counts must match returned sources.
    const wrongCount = await runWith((response) => ({
      ...response,
      channels: [okChannel("web", "exa", 2), okChannel("weibo", "tikhub", 1)],
    }));
    expect(wrongCount.error?.detail).toBe("PUBLIC_RESEARCH_RESPONSE_MISMATCH");

    // A source must carry its channel's expected provider.
    const wrongProvider = await runWith((response) => ({
      ...response,
      sources: [{ ...web, provider_id: "tikhub" as const }, social],
    }));
    expect(wrongProvider.error?.code).toBe("PUBLIC_RESEARCH_UNAVAILABLE");
    expect(JSON.stringify(wrongProvider.error)).not.toContain("https");
  });

  it("asserts subject currency before and after dispatch", async () => {
    // Stale before dispatch: no provider call at all.
    const { client, execute } = fakeClient((request) =>
      searchReply(request, [], [okChannel("web", "exa", 0)]),
    );
    const stale = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng", async () => false)],
    });
    const before = failed(await stale.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(before.error?.code).toBe("PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT");
    expect(execute).not.toHaveBeenCalled();

    // Turns stale while the provider call is in flight: the response is used
    // for nothing, and no source is registered or returned.
    const source = discovered("exa", "web", "https://example.com/late");
    let current = true;
    const flipped = fakeClient((request) => {
      current = false;
      return searchReply(request, [source], [okChannel("web", "exa", 1)]);
    });
    const research = createWorkspacePublicResearch({
      client: flipped.client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng", async () => current)],
    });
    const after = failed(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(after.error?.code).toBe("PUBLIC_RESEARCH_SUBJECT_NOT_CURRENT");
    expect(flipped.execute).toHaveBeenCalledTimes(1);
    const registryEmpty = failed(await research.execute("fetch_public_sources", {
      source_ids: [source.source_id],
    }));
    expect(registryEmpty.error?.code).toBe("PUBLIC_RESEARCH_SOURCE_NOT_DISCOVERED");
  });

  it("accepts subject ids only from the host registry, never raw names", async () => {
    const { client, execute } = fakeClient((request) =>
      searchReply(request, [], [okChannel("web", "exa", 0)]),
    );
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    const unknown = failed(await research.execute("search_public_subject", { subject_id: "sub-999" }));
    expect(unknown.error?.code).toBe("PUBLIC_RESEARCH_SUBJECT_NOT_AUTHORIZED");
    const rawName = failed(await research.execute("search_public_subject", { name: "Lilian Weng" }));
    expect(rawName.error?.code).toBe("PUBLIC_RESEARCH_TOOL_INPUT_INVALID");
    expect(execute).not.toHaveBeenCalled();

    // Defense in depth: even a host-supplied private-detail name never becomes
    // an outbound query.
    const leaking = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "user@example.com")],
    });
    const prohibited = failed(await leaking.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(prohibited.error?.code).toBe("PUBLIC_RESEARCH_QUERY_PROHIBITED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancels when the run aborts even after the client responded", async () => {
    const controller = new AbortController();
    const source = discovered("exa", "web", "https://example.com/aborted");
    const { client, execute } = fakeClient((request) => {
      controller.abort();
      return searchReply(request, [source], [okChannel("web", "exa", 1)]);
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    const cancelled = failed(await research.execute(
      "search_public_subject",
      { subject_id: "sub-1" },
      controller.signal,
    ));
    expect(cancelled.error?.code).toBe("PUBLIC_RESEARCH_CANCELLED");
    expect("data" in cancelled).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    // The abort fired after the client responded: nothing was registered.
    const registryEmpty = failed(await research.execute("fetch_public_sources", {
      source_ids: [source.source_id],
    }));
    expect(registryEmpty.error?.code).toBe("PUBLIC_RESEARCH_SOURCE_NOT_DISCOVERED");
  });

  it("fetches only same-run discovered ids in the requested order", async () => {
    const first = discovered("exa", "web", "https://example.com/first");
    const second = discovered("exa", "web", "https://example.com/second");
    const { client, execute } = fakeClient((request) => {
      if (request.input.operation === "search") {
        return searchReply(request, [first, second], [okChannel("web", "exa", 2)]);
      }
      if (request.input.operation !== "fetch") throw new Error("expected fetch");
      return {
        contract_version: CONTACT_RESEARCH_CONTRACT,
        task_id: request.task_id,
        call_id: request.call_id,
        sources: request.input.sources.map((source) => fetched(source)),
        channels: [],
        fetch_outcomes: request.input.sources.map((source) => ({
          source_id: source.source_id,
          channel: source.channel,
          provider: source.provider_id,
          status: "ok" as const,
          error_code: null,
        })),
        external_effects: [],
      };
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    ok(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    const result = ok(await research.execute("fetch_public_sources", {
      source_ids: [second.source_id, first.source_id],
    }));

    const fetchRequest = execute.mock.calls[1]![0] as ContactResearchToolRequest;
    if (fetchRequest.input.operation !== "fetch") throw new Error("expected fetch");
    expect(fetchRequest.input.sources.map((source) => source.source_id)).toEqual([
      second.source_id,
      first.source_id,
    ]);
    expect(fetchRequest.anchors).toEqual(["Lilian Weng"]);
    const payload = result.data as { sources: ContactPublicSource[] };
    expect(payload.sources.map((source) => source.stage)).toEqual(["fetched", "fetched"]);
    expect(payload.sources[0]!.url).toBe(second.url);
    expect(result.attempts).toEqual([{ call_id: result.callID, status: "ok" }]);

    const foreign = failed(await research.execute("fetch_public_sources", {
      source_ids: ["f".repeat(64)],
    }));
    expect(foreign.error?.code).toBe("PUBLIC_RESEARCH_SOURCE_NOT_DISCOVERED");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("refuses to fetch when the authorizing subject is no longer authorized", async () => {
    const source = discovered("exa", "web", "https://example.com/revoked");
    let authorized = [subject("sub-1", "Lilian Weng")];
    const { client, execute } = fakeClient((request) =>
      searchReply(request, [source], [okChannel("web", "exa", 1)]),
    );
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => authorized,
    });

    ok(await research.execute("search_public_subject", { subject_id: "sub-1" }));
    authorized = [];
    const revoked = failed(await research.execute("fetch_public_sources", {
      source_ids: [source.source_id],
    }));
    expect(revoked.error?.code).toBe("PUBLIC_RESEARCH_SUBJECT_NOT_AUTHORIZED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("never claims fetched content when a source or channel fails", async () => {
    const okSource = discovered("exa", "web", "https://example.com/readable");
    const socialSource = discovered("tikhub", "weibo", "https://weibo.com/u/other");
    const { client } = fakeClient((request) => {
      if (request.input.operation === "search") {
        return searchReply(request, [okSource, socialSource], [
          okChannel("web", "exa", 1),
          okChannel("weibo", "tikhub", 1),
        ]);
      }
      return {
        contract_version: CONTACT_RESEARCH_CONTRACT,
        task_id: request.task_id,
        call_id: request.call_id,
        sources: [fetched(okSource)],
        channels: [],
        fetch_outcomes: [
          { source_id: okSource.source_id, channel: "web", provider: "exa", status: "ok" as const, error_code: null },
          { source_id: socialSource.source_id, channel: "weibo", provider: "tikhub", status: "unsupported" as const, error_code: "UNSUPPORTED" as const },
        ],
        external_effects: [],
      };
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    ok(await research.execute("search_public_subject", {
      subject_id: "sub-1",
      channels: ["web", "weibo"],
    }));
    const fetch = ok(await research.execute("fetch_public_sources", {
      source_ids: [okSource.source_id, socialSource.source_id],
    }));
    const payload = fetch.data as {
      sources: ContactPublicSource[];
      fetch_outcomes: ContactResearchToolResponse["fetch_outcomes"];
    };
    // Failed/unsupported outcomes keep their bounded codes and no fetched receipt.
    expect(payload.sources.map((source) => source.source_id)).toEqual([okSource.source_id]);
    expect(payload.fetch_outcomes).toContainEqual({
      source_id: socialSource.source_id,
      channel: "weibo",
      provider: "tikhub",
      status: "unsupported",
      error_code: "UNSUPPORTED",
    });
  });

  it("sanitizes transport failures and readback mismatches into tool failures", async () => {
    const source = discovered("exa", "web", "https://example.com/profile");
    const { client } = fakeClient((request) => {
      if (request.input.operation === "search") {
        return searchReply(request, [source], [okChannel("web", "exa", 1)]);
      }
      return {
        contract_version: CONTACT_RESEARCH_CONTRACT,
        task_id: request.task_id,
        call_id: randomUUID(), // wrong call binding
        sources: [fetched(source)],
        channels: [],
        fetch_outcomes: [
          { source_id: source.source_id, channel: "web", provider: "exa", status: "ok" as const, error_code: null },
        ],
        external_effects: [],
      };
    });
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });
    ok(await research.execute("search_public_subject", { subject_id: "sub-1" }));

    const mismatch = failed(await research.execute("fetch_public_sources", {
      source_ids: [source.source_id],
    }));
    expect(mismatch.error?.code).toBe("PUBLIC_RESEARCH_UNAVAILABLE");
    expect(mismatch.error?.detail).toBe("CONTACT_RESEARCH_READBACK_MISMATCH");
    expect(mismatch.error?.message).not.toMatch(/https?:/u);
    // The failure path preserves its sanitized attempt receipt too.
    expect(mismatch.attempts).toEqual([
      { call_id: mismatch.callID, status: "failed", error_code: "CONTACT_RESEARCH_READBACK_MISMATCH" },
    ]);

    const broken = createWorkspacePublicResearch({
      client: {
        execute: vi.fn(async () => {
          throw new Error("socket exploded with /secret/path and raw provider text");
        }),
      } as unknown as ContactResearchClient,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });
    const transport = failed(await broken.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(transport.error?.code).toBe("PUBLIC_RESEARCH_UNAVAILABLE");
    expect(JSON.stringify(transport.error)).not.toContain("secret");
    expect(JSON.stringify(transport.error)).not.toContain("provider text");

    const malformed = createWorkspacePublicResearch({
      client: {
        execute: vi.fn(async () => ({
          contract_version: CONTACT_RESEARCH_CONTRACT,
          task_id: taskID,
          call_id: randomUUID(),
          sources: [],
          channels: [],
          fetch_outcomes: [],
          external_effects: ["an external effect"],
        })),
      } as unknown as ContactResearchClient,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });
    const invalid = failed(await malformed.execute("search_public_subject", { subject_id: "sub-1" }));
    expect(invalid.error?.code).toBe("PUBLIC_RESEARCH_UNAVAILABLE");
  });

  it("exposes tools with names, schemas, subject listing, and honest failures", async () => {
    const { client } = fakeClient((request) =>
      searchReply(request, [], [okChannel("web", "exa", 0)]),
    );
    const research = createWorkspacePublicResearch({
      client,
      taskID,
      authorizedSubjects: () => [subject("sub-1", "Lilian Weng")],
    });

    expect(research.names).toEqual(WORKSPACE_PUBLIC_RESEARCH_TOOL_NAMES);
    expect(Object.keys(research.schemas).sort()).toEqual([
      "fetch_public_sources",
      "search_public_subject",
    ]);
    expect(research.tools.map((tool) => tool.name)).toEqual([
      "search_public_subject",
      "fetch_public_sources",
    ]);
    for (const tool of research.tools) {
      expect(tool.readOnly).toBe(true);
      expect(tool.parameters).toBeDefined();
    }
    // The initial host subjects are visible to the model without raw-name input.
    expect(research.tools[0]!.description).toContain("sub-1 (Lilian Weng)");

    const tool = research.tools[0]!;
    const failureResult = await tool.execute({}, new AbortController().signal);
    expect(failureResult.isError).toBe(true);
    expect(failureResult.content[0]!.type).toBe("text");
    const payload = JSON.parse(failureResult.content[0]!.text) as WorkspacePublicResearchToolResult;
    expect(payload).toMatchObject({ ok: false, error: { code: "PUBLIC_RESEARCH_TOOL_INPUT_INVALID" } });

    const successResult = await tool.execute({ subject_id: "sub-1" }, new AbortController().signal);
    expect(successResult.isError).toBe(false);
    const successPayload = JSON.parse(successResult.content[0]!.text) as WorkspacePublicResearchToolResult;
    expect(successPayload.ok).toBe(true);

    const unknown = failed(await research.execute("read_evidence_source_image", {}));
    expect(unknown.error?.code).toBe("PUBLIC_RESEARCH_TOOL_UNKNOWN");
  });

  it("rejects an invalid run binding at creation", () => {
    const { client } = fakeClient((request) =>
      searchReply(request, [], [okChannel("web", "exa", 0)]),
    );
    expect(() =>
      createWorkspacePublicResearch({ client, taskID: "not-a-uuid", authorizedSubjects: () => [] }),
    ).toThrow("WORKSPACE_PUBLIC_RESEARCH_TASK_ID_INVALID");
  });
});

describe("provider channel failure recovery",()=>{
 it.each(["UNAVAILABLE","RATE_LIMITED"] as const)("recovers from explicit all-channel %s with dispatch receipts",async error_code=>{
  const source=discovered("exa","web","https://example.com/profile");let calls=0;
  const {client,execute}=fakeClient(request=>++calls===1?searchReply(request,[],[{channel:"web",provider:"exa",status:"failed",result_count:0,truncated:false,error_code}]):searchReply(request,[source],[okChannel("web","exa",1)]));
  const research=createWorkspacePublicResearch({client,taskID,authorizedSubjects:()=>[subject("one","Simon Willison")]});
  const result=ok(await research.execute("search_public_subject",{subject_id:"one"}));expect(execute).toHaveBeenCalledTimes(2);
  expect(result.attempts).toEqual([{call_id:result.callID,status:"failed",error_code:"CONTACT_RESEARCH_CHANNEL_TRANSIENT",channel_failures:[{channel:"web",error_code}]},{call_id:expect.any(String),status:"ok"}]);
  expect(result.attempts![1]!.call_id).not.toBe(result.callID);
 });
 it("does not retry a provider authentication failure or call it success",async()=>{
  const {client,execute}=fakeClient(request=>searchReply(request,[],[{channel:"web",provider:"exa",status:"failed",result_count:0,truncated:false,error_code:"AUTH_FAILED"}]));
  const research=createWorkspacePublicResearch({client,taskID,authorizedSubjects:()=>[subject("one","Simon Willison")]});
  expect(failed(await research.execute("search_public_subject",{subject_id:"one"})).error.detail).toBe("CONTACT_RESEARCH_CHANNEL_FAILED");expect(execute).toHaveBeenCalledOnce();
 });
 it("preserves partial success without re-searching successful channels",async()=>{
  const source=discovered("exa","web","https://example.com/profile");
  const {client,execute}=fakeClient(request=>searchReply(request,[source],[okChannel("web","exa",1),{channel:"weibo",provider:"tikhub",status:"failed",result_count:0,truncated:false,error_code:"UNAVAILABLE"}]));
  const research=createWorkspacePublicResearch({client,taskID,authorizedSubjects:()=>[subject("one","Simon Willison")]});
  ok(await research.execute("search_public_subject",{subject_id:"one",channels:["web","weibo"]}));expect(execute).toHaveBeenCalledOnce();
 });
});

it("includes canonical profile context while excluding malformed/private anchors from the actual query",()=>{
 expect(workspacePublicResearchQuery("Andrej Karpathy",[{kind:"handle",text:"https://github.com/karpathy"},{kind:"work",text:"nanoGPT"}])).toBe("Andrej Karpathy https://github.com/karpathy nanoGPT");
 expect(workspacePublicResearchQuery("Andrej Karpathy",[{kind:"handle",text:"https://example.test/profile/test%40gmail.com"},{kind:"work",text:"NeedsTherapy"}])).toBe("Andrej Karpathy biography official website");
});
