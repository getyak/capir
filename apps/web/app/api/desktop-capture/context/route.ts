import { desktopCaptureContextRoute } from "@/lib/server/desktopCapture";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return desktopCaptureContextRoute(request); }
