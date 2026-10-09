import { desktopBrowserLoginPrepareRoute } from "@/lib/server/desktop-browser-login";

export const dynamic = "force-dynamic";

/** Anonymous, rate-limited preparation of one bounded Mac login grant. */
export async function POST(request: Request) {
  return desktopBrowserLoginPrepareRoute(request);
}
