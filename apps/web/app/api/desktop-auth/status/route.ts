import { desktopBrowserLoginStatusRoute } from "@/lib/server/desktop-browser-login";

export const dynamic = "force-dynamic";

/**
 * Fixed read-only status for the selected WebKit context: decode the primary
 * cookie, verify the live backend session, never write a cookie.
 */
export async function GET(request: Request) {
  return desktopBrowserLoginStatusRoute(request);
}
