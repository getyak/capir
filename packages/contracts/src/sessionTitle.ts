/** An initial reply may replace a generated placeholder, never a chosen name. */
export function resolveFirstReplyTitle(current: string, suggested: string, initial: string): string {
  return !current.trim() || [initial, "新的对话", "新对话", "New conversation", "Untitled"].includes(current)
    ? suggested : current;
}
