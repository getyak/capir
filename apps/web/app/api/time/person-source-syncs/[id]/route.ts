import {
  PersonSourceSyncDeleteRequestSchema, PersonSourceSyncMutationRequestSchema,
  type PersonSourceSyncDeleteRequest, type PersonSourceSyncMutationRequest,
} from "@talent-signal/contracts";
import { matchesTypeBox } from "@/lib/typebox-validation";
import { loadPersonSourceSync, savePersonSourceSync, removePersonSourceSync } from "@/lib/server/timeWorkspace";
import { timeAccess, timeFailure, timeReply } from "@/lib/server/timeWorkspaceBoundary";
import { isWorkspaceSessionId } from "@/lib/server/workspaceSessions";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function handle(request: Request, context: Context, method: "GET" | "PUT" | "DELETE") {
  try {
    const { binding } = await timeAccess(request, method !== "GET");
    const { id } = await context.params;
    if (!isWorkspaceSessionId(id)) return timeReply({ message: "记录标识无效。" }, 400);
    if (method === "GET") return timeReply({ ...await loadPersonSourceSync(id), session_version: binding });
    const body: unknown = await request.json();
    const schema = method === "PUT" ? PersonSourceSyncMutationRequestSchema : PersonSourceSyncDeleteRequestSchema;
    if (!matchesTypeBox(schema, body)) return timeReply({ message: "请核对定期观察内容。" }, 400);
    const result = method === "PUT"
      ? await savePersonSourceSync(id, body as PersonSourceSyncMutationRequest)
      : await removePersonSourceSync(id, body as PersonSourceSyncDeleteRequest);
    return timeReply({ ...result, session_version: binding });
  } catch (error) { return timeFailure(error); }
}
export const GET = (request: Request, context: Context) => handle(request, context, "GET");
export const PUT = (request: Request, context: Context) => handle(request, context, "PUT");
export const DELETE = (request: Request, context: Context) => handle(request, context, "DELETE");
