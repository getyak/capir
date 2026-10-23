import { desktopCaptureResultRoute } from "@/lib/server/desktopCaptureReceipt";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sessionId: string; messageId: string }> };
export async function GET(request: Request, context: Context) {
  const { sessionId, messageId } = await context.params;
  return desktopCaptureResultRoute(request, sessionId, messageId);
}
