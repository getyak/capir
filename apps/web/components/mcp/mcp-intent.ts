/** Component-local retry ledger. No inputs or credentials are retained in keys. */
export async function mcpIntentIdentity(scope: string, target: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([scope, target, payload]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function workspaceIntentScope(sessionVersion: string): string {
  const accountScope = typeof document === "undefined" ? "" : document.querySelector("[data-workspace-scope]")?.getAttribute("data-workspace-scope") ?? "";
  return JSON.stringify([sessionVersion, accountScope]);
}
