export const dynamic = "force-dynamic";

/** An empty same-origin document for the native app's isolated WebKit world. */
export function GET(): Response {
  return new Response("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"></head><body></body></html>", {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
