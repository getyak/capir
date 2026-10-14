import { validReturnSessionId } from "@/components/session-return-navigation";

/** A navigation intent opens a draft; it carries no Person fields or save authority. */
export function isCreatePersonEntry(parameters: { surface?: unknown; intent?: unknown }): boolean {
  return parameters.surface === "desk" && parameters.intent === "create-contact";
}

export function createPersonEntryCallback(search: string): string | null {
  const parameters = new URLSearchParams(search);
  if (parameters.getAll("surface").length !== 1 || parameters.getAll("intent").length !== 1 ||
    !isCreatePersonEntry({ surface: parameters.get("surface"), intent: parameters.get("intent") })) return null;

  const callback = new URLSearchParams({ surface: "desk", intent: "create-contact" });
  const session = parameters.getAll("session").length === 1
    ? validReturnSessionId(parameters.get("session")) : null;
  if (session) callback.set("session", session);
  return `/workspace?${callback.toString()}`;
}
