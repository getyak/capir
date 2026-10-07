import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  distDir: process.env.TALENT_SIGNAL_NEXT_DIST_DIR || ".next",
  // Auth callback URLs carry temporary proofs; never mirror their queries to the terminal.
  logging: { incomingRequests: { ignore: [/\/desktop-auth(?:\/|\?|$)/, /\/capir\/authorize(?:\/|\?|$)/, /\/login\?/, /\/api\/auth\//] } },
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Inline conversation images arrive as base64 JSON: 30,000,000 binary
    // bytes encode to 40,000,000 characters. This proxy budget keeps that
    // bounded (the route still rejects over-limit declarations with 413)
    // instead of silently truncating a valid batch at the 10 MB default.
    // https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize
    proxyClientMaxBodySize: 41_000_000,
    // https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports
    optimizePackageImports: ["@phosphor-icons/react", "@phosphor-icons/react/dist/ssr"],
    // Next.js needs the TypeScript 6 API while the workspace CLI uses native TypeScript 7.
    useTypeScriptCli: false,
    // Deliberately no global `staleTimes` override and no whole-route
    // `router.prefetch`: a prefetched dynamic RSC payload can skip a fresh
    // server-side authorization render for its cache lifetime. Bounded reuse is
    // limited to the account-keyed directory snapshot in
    // `lib/workspace-directory-cache.ts`, which 401s and successful private
    // mutations discard. Next's default `<Link>` partial prefetch (down to
    // `app/workspace/loading.tsx`) is kept.
  },
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["mammoth", "pdf-parse"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {source:"/capir/authorize",headers:[{key:"Referrer-Policy",value:"no-referrer"},{key:"Cache-Control",value:"private, no-store"}]},
      {source:"/workspace/settings/cli",headers:[{key:"Referrer-Policy",value:"no-referrer"},{key:"Cache-Control",value:"private, no-store"}]},
      {
        source: "/desktop-auth/:path*",
        // Origin-only referrers hide attempt/state while preserving the exact
        // Origin on form POSTs. Fetch maps no-referrer navigation POSTs to
        // Origin:null, which our CSRF admission correctly refuses.
        // https://fetch.spec.whatwg.org/#append-a-request-origin-header
        headers: [{ key: "Referrer-Policy", value: "strict-origin" }, { key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/api/desktop-auth/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
