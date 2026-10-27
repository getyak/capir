import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./lib/test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    server: { deps: { inline: ["next-auth"] } },
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
