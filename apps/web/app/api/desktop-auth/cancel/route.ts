import { desktopBrowserLoginCancelRoute } from "@/lib/server/desktop-browser-login";

export const dynamic = "force-dynamic";

/** Native cancellation proved by the prepared cancellation secret. */
export async function POST(request: Request) {
  return desktopBrowserLoginCancelRoute(request);
}
