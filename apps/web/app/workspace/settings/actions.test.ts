import { beforeEach, expect, it, vi } from "vitest";
const { claims, update, revalidate } = vi.hoisted(() => ({ claims: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: claims }));
vi.mock("@/lib/server/accountBackend", () => ({ updateAccountSettings: update }));
import { saveAccountSettings } from "./actions";
beforeEach(() => { vi.clearAllMocks(); claims.mockResolvedValue({backendAccountId:"workspace",backendUserId:"current-user"}); });
it.each(["old-user", ""])("rejects a form rendered for another or missing actor", async actor => {
 const form = new FormData();
 form.set("workspaceId","workspace"); form.set("actorUserId",actor); form.set("kind","profile"); form.set("name","Old user name");
 expect(await saveAccountSettings({}, form)).toHaveProperty("error");
 expect(update).not.toHaveBeenCalled();
});
it.each(["other-account", ""]) ("rejects a substituted account before any write", async account => {
 const form = new FormData();
 form.set("workspaceId",account); form.set("actorUserId","current-user"); form.set("kind","profile"); form.set("name","Name");
 // Account identity comes from the verified session, so substituting only the
 // account id in the form must fail before reaching the backend boundary.
 expect(await saveAccountSettings({}, form)).toHaveProperty("error");
 expect(update).not.toHaveBeenCalled();
});
it("preserves a same-user profile edit", async () => {
 const form = new FormData();
 for (const [key,value] of Object.entries({workspaceId:"workspace",actorUserId:"current-user",kind:"profile",name:"My name",revision:"1",operationId:"operation"})) form.set(key,value);
 update.mockResolvedValue({user:{id:"current-user"}});
 expect(await saveAccountSettings({},form)).toMatchObject({saved:true});
 expect(revalidate).toHaveBeenCalledWith("/workspace", "layout");
 expect(update).toHaveBeenCalledExactlyOnceWith({id:"operation",kind:"profile",name:"My name",expected_revision:1});
});
