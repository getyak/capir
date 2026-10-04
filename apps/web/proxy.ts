import { NextResponse, type NextRequest } from "next/server";

// Workspace mutations and task-history reads declare the account rendered by their tab.
// The route's backend authentication still verifies that account and authority.
// Login, the public demo, development fixtures and the separately authenticated
// extension protocol own their existing admission boundaries.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/+$/, "");
  const separateBoundary = path === "/api/analyze"
    // The published MCP endpoint uses its own scoped bearer token and never a
    // browser login cookie, so it is deliberately outside the workspace guard.
    || path === "/api/mcp"
    // Browser-owned macOS login (ADR 0022) runs before any workspace session
    // exists: anonymous grant preparation and proof-bound exchange/cancel
    // carry their own bounded authentication and never an account header.
    || path === "/api/desktop-auth" || path.startsWith("/api/desktop-auth/")
    // A test session is established here, so the exact POST carries its own
    // one-use proof, origin and consumer checks before any workspace exists.
    || (path === "/api/capir/test-entry" && request.method === "POST")
    || ["/api/auth", "/api/browser-extension", "/api/dev"].some(
      prefix => path === prefix || path.startsWith(`${prefix}/`),
    );
  // Installed extensions create a task, read it back, or recover it by their
  // request key. The route validates this session fingerprint before upstream IO.
  const taskRoot = path === "/api/contact-agent/tasks";
  const handoffTransport = (request.method === "POST" && taskRoot)
    || (request.method === "GET" && (
      (taskRoot && Boolean(request.nextUrl.searchParams.get("handoff_request_id")?.trim()))
      || /^\/api\/contact-agent\/tasks\/[0-9a-fA-F-]{36}$/.test(path)
    ));
  const sessionBoundHandoff = handoffTransport
    && Boolean(request.headers.get("x-contact-handoff-session")?.trim());
  const workspaceMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  // Task history can otherwise follow a changed cookie in an older open tab.
  // Native image links and event streams retain their existing route authority.
  const taskHistoryRead = ["GET", "HEAD"].includes(request.method)
    && (taskRoot || /^\/api\/contact-agent\/tasks\/[0-9a-fA-F-]{36}$/.test(path));
  if ((workspaceMutation || taskHistoryRead) && !separateBoundary && !sessionBoundHandoff && !request.headers.get("x-talent-signal-workspace")?.trim()) {
    return NextResponse.json({ code: "backend_session_expired" }, {
      status: 401,
      headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
