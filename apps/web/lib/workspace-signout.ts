/** Fixed presentation destinations; this protocol grants no sign-out authority. */
export function workspaceSignOutDestination(hosted: boolean): "/" | "/login?callbackUrl=%2Fworkspace&intent=sign-out" {
  return hosted ? "/login?callbackUrl=%2Fworkspace&intent=sign-out" : "/";
}

export type WorkspaceSignOutResult =
  | { status: "signed_out"; binding: string; redirectTo: ReturnType<typeof workspaceSignOutDestination> }
  | { status: "scope_changed" };

export function confirmedWorkspaceSignOut(value: unknown, binding: string, hosted: boolean): value is Extract<WorkspaceSignOutResult, { status: "signed_out" }> {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<Extract<WorkspaceSignOutResult, { status: "signed_out" }>>;
  return result.status === "signed_out" && result.binding === binding && result.redirectTo === workspaceSignOutDestination(hosted);
}
