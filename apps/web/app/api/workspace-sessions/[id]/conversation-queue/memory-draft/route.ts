import { conversationQueueRoute } from "@/lib/server/conversationQueue";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
/** A dedicated path fails closed on older Web/backend revisions. */
export async function POST(request: Request, context: Context) { return conversationQueueRoute(request, (await context.params).id, "admit-memory-draft"); }
