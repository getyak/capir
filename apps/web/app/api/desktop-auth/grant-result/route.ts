import { desktopBrowserLoginGrantResultRoute } from "@/lib/server/desktop-browser-login";

export const dynamic = "force-dynamic";

/** Secret-bound read-only outcome for an unknown exchange result. */
export async function POST(request: Request) {
  return desktopBrowserLoginGrantResultRoute(request);
}
