import { desktopCaptureSubmitRoute } from "@/lib/server/desktopCaptureSubmit";
import { desktopCaptureReceiptRoute } from "@/lib/server/desktopCaptureReceipt";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sessionId: string; messageId: string }> };
export async function POST(request: Request, context: Context) {
  const { sessionId, messageId } = await context.params;
  return desktopCaptureSubmitRoute(request, sessionId, messageId);
}
export async function GET(request: Request, context: Context) {
  const { sessionId, messageId } = await context.params;
  return desktopCaptureReceiptRoute(request, sessionId, messageId);
}
