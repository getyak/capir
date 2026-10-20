import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

function read(relativePath: string) {
  return readFileSync(resolve(webRoot, relativePath), "utf8");
}

describe("workspace skip-link landmarks", () => {
  it("keeps the global skip link bound to the stable main target", () => {
    expect(read("app/layout.tsx")).toContain('href="#main-content"');
  });

  it.each([
    "components/workspace-app.tsx",
    "app/workspace/loading.tsx",
  ])("renders one focusable main target in %s", (relativePath) => {
    const source = read(relativePath);

    expect(source.match(/id="main-content"/g)).toHaveLength(1);
    expect(source).toMatch(
      /<main[\s\S]*?id="main-content"[\s\S]*?tabIndex=\{-1\}[\s\S]*?>/,
    );
  });

  it.each([
    "components/marketing/marketing-home.tsx",
    "components/marketing/marketing-subpage.tsx",
    "app/demo/page.tsx",
    "app/relationships/page.tsx",
    "app/blog/page.tsx",
    "app/blog/about/page.tsx",
    "app/blog/[slug]/page.tsx",
    "app/briefs/project-health/page.tsx",
    "app/privacy/page.tsx",
    "app/login/page.tsx",
    "app/not-found.tsx",
    "app/workspace/evals/page.tsx",
    "app/workspace/evals/[traceId]/page.tsx",
    "app/workspace/pursuits/[id]/page.tsx",
    "components/people-directory-app.tsx",
    "components/pursuit-today-page.tsx",
    "components/relationship-workspace-app.tsx",
    "components/talent-signal-lab/lab-workspace.tsx",
  ])("keeps the global skip-link target focusable in %s", (relativePath) => {
    const source = read(relativePath);

    expect(source).toMatch(
      /<main[\s\S]*?id="main-content"[\s\S]*?tabIndex=\{-1\}[\s\S]*?>/,
    );
  });
});
