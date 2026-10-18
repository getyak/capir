import { PersonSourceSyncListQuerySchema, type PersonSourceSyncListQuery } from "@talent-signal/contracts";
import { matchesTypeBox } from "@/lib/typebox-validation";
import { loadPersonSourceSyncs } from "@/lib/server/timeWorkspace";
import { timeAccess, timeFailure, timeReply } from "@/lib/server/timeWorkspaceBoundary";
export const dynamic = "force-dynamic";

/**
 * Bounded owner-scoped lookup by exact person/context (+ optional seed) so an
 * existing grant is visible cross-device without any localStorage authority.
 * An all-account or cross-owner list is never served.
 */
export async function GET(request: Request) {
  try {
    const { binding } = await timeAccess(request);
    const query = new URL(request.url).searchParams;
    const allowed = new Set(["person_id", "relationship_context_id", "seed_resource_id"]);
    if ([...query.keys()].some((key) => !allowed.has(key) || query.getAll(key).length !== 1)) {
      return timeReply({ message: "筛选参数无效。" }, 400);
    }
    const filter = {
      person_id: query.get("person_id"),
      relationship_context_id: query.get("relationship_context_id"),
      ...(query.has("seed_resource_id") ? { seed_resource_id: query.get("seed_resource_id") } : {}),
    };
    if (!matchesTypeBox(PersonSourceSyncListQuerySchema, filter)) {
      return timeReply({ message: "人物或关系筛选无效。" }, 400);
    }
    return timeReply({
      ...await loadPersonSourceSyncs(filter as PersonSourceSyncListQuery),
      session_version: binding,
    });
  } catch (error) { return timeFailure(error); }
}
