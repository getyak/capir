"use client";
import { useEffect } from "react";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";

/** No credentials enter JS. A same-origin POST rolls the HttpOnly cookie; a
 * failed request neither signs out nor replays a business mutation. */
export function BrowserSessionRenewal() {
  useEffect(() => {
    let stopped = false;
    let pending = false;
    let controller: AbortController | null = null;
    const renew = async () => {
      if (pending || stopped || document.visibilityState === "hidden") return;
      pending = true;
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 15_000);
      try {
        for (let attempt = 0; attempt < 2 && !stopped; attempt += 1) {
          const result = await fetch("/api/auth/persistent", { method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "x-capri-session-renewal": "1" }, signal: controller.signal });
          const value = await result.json();
          if (!stopped && result.status === 401 && value.status === "revoked") window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
          // The previous response installed the pending HttpOnly cookie. This
          // second POST is the earliest enrollment is allowed to commit.
          if (!(result.ok && value.status === "pending")) break;
        }
      } catch { /* Network and service failures preserve the cookie and drafts. */ }
      finally { clearTimeout(deadline); controller = null; pending = false; }
    };
    const foreground = () => { void renew(); };
    foreground();
    window.addEventListener("focus", foreground);
    window.addEventListener("online", foreground);
    document.addEventListener("visibilitychange", foreground);
    const timer = setInterval(foreground, 3 * 60 * 60 * 1000);
    return () => {
      stopped = true; controller?.abort(); clearInterval(timer);
      window.removeEventListener("focus", foreground); window.removeEventListener("online", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, []);
  return null;
}
