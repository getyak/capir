/**
 * Completion receipts carry only a tool name and return time. They do not
 * carry the operation's arguments, success, or a saved/reviewed outcome.
 * These labels therefore describe returned requests, never completed writes.
 */
const TOOL_LABEL_KEYS: Readonly<Record<string, string>> = {
  memory_review: "execution.tool.memory",
  memory_review_recall: "execution.tool.memoryRecall",
  memory_review_propose: "execution.tool.memoryProposal",
  read_relationship_memory: "execution.tool.memoryRecall",
  contact_workspace: "execution.tool.contact",
  contact_workspace_search: "execution.tool.contactSearch",
  contact_workspace_read: "execution.tool.contactRead",
  contact_workspace_propose_create: "execution.tool.contactProposal",
  contact_workspace_propose_update: "execution.tool.contactProposal",
  stage_calendar_draft: "execution.tool.calendar",
  cite_evidence: "execution.tool.sources",
  read_pursuit: "execution.tool.pursuit",
  read_evidence: "execution.tool.evidence",
  search_web: "execution.tool.webSearch",
  fetch_web: "execution.tool.webPage",
  create_research_artifact: "execution.tool.research",
  create_person_research_artifact: "execution.tool.research",
  stage_pursuit_proposal: "execution.tool.proposal",
  mcp_connections: "execution.tool.connection",
  search_douyin_profiles: "execution.tool.profile",
  search_tiktok_profiles: "execution.tool.profile",
  search_weibo_profiles: "execution.tool.profile",
  search_threads_profiles: "execution.tool.profile",
};

export function executionToolLabelKey(name: string): string {
  return Object.hasOwn(TOOL_LABEL_KEYS, name) ? TOOL_LABEL_KEYS[name]! : "execution.tool.other";
}
