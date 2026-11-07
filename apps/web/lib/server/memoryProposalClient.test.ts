import { afterEach, describe, expect, it, vi } from "vitest";
import { TalentSignalClient } from "@talent-signal/contracts";

afterEach(() => vi.unstubAllGlobals());
describe("Memory proposal client compatibility", () => {
  it("retains the original default request and array response for an old caller", async () => {
    const legacy = { contract_version: "2026-08-24.10", proposals: [] };
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(legacy)); vi.stubGlobal("fetch", request);
    const client = new TalentSignalClient("https://synthetic.invalid", "synthetic-session");
    expect(await client.listMemoryProposals()).toEqual(legacy);
    expect(String(request.mock.calls[0]![0])).toBe("https://synthetic.invalid/v1/memory/proposals");
  });
  it("passes only explicit scope and returned continuation without inventing limits", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ proposals: [], has_more: false, next_cursor: null }));
    vi.stubGlobal("fetch", request);
    const client = new TalentSignalClient("https://synthetic.invalid", "synthetic-session");
    await client.listMemoryProposals({ purpose: "chat", session_id: "10000000-0000-4000-8000-000000000001",
      paginate: true, cursor: "mp1.returned_opaque" });
    const url = new URL(String(request.mock.calls[0]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ purpose: "chat",
      session_id: "10000000-0000-4000-8000-000000000001", paginate: "true", cursor: "mp1.returned_opaque" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
