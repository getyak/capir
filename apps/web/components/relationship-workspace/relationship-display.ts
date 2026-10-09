import type { PersonDirectoryItem, RelationshipResourceListItem } from "@talent-signal/contracts";

const fieldLabels: Record<string, string> = {
  availability: "可沟通时间",
  competing_process: "其他招聘流程",
  current_employer: "当前公司",
  current_role: "当前职位",
  decision_deadline: "决策期限",
  location: "地点",
  notice_period: "离职通知期",
  relocation_requirement: "搬迁要求",
  work_mode_constraint: "工作方式限制",
  work_mode_preference: "工作方式偏好",
};

export function personContextSummary(person: PersonDirectoryItem) {
  if (person.contexts.length === 0) {
    return "没有活跃关系情境";
  }

  const visibleContexts = person.contexts
    .slice(0, 2)
    .map((context) => context.display_label)
    .join(" · ");
  const remainingCount = Math.max(0, person.contexts.length - 2);
  return remainingCount > 0
    ? `${visibleContexts} · 另有 ${remainingCount} 项`
    : visibleContexts;
}

export function initials(value: string) {
  const segments = value.trim().split(/\s+/);
  if (segments.length === 1) {
    return value.slice(0, 2).toUpperCase();
  }
  return segments
    .map((segment) => segment[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function fieldLabel(field: string) {
  if (field.startsWith("professional_history.")) {
    return "职业经历";
  }
  return fieldLabels[field] ?? field.replaceAll("_", " ");
}

export function reviewLabel(status: string) {
  switch (status) {
    case "confirmed":
      return "已确认";
    case "dismissed":
      return "已驳回";
    case "unresolved":
      return "需要澄清";
    default:
      return "拟议";
  }
}

export function sourceKindLabel(kind: string) {
  switch (kind) {
    case "screenshot_metadata":
      return "对话截图";
    case "transcript":
      return "已审阅对话";
    case "fixture":
      return "合成采集内容";
    default:
      return "导入证据";
  }
}

export function sourceScopeLabel(scope: string) {
  switch (scope) {
    case "proposed_extracted_text":
      return "机器识别文本（待确认）";
    case "reviewed_extracted_text":
      return "仅保留已审阅文本";
    case "reviewed_selected_text":
      return "已审阅选区";
    case "reviewed_evidence_crop":
      return "保留证据裁剪区域";
    case "full_reviewed_source":
      return "保留完整来源";
    case "legacy_unknown":
      return "旧版范围尚未核验";
    default:
      return scope.replaceAll("_", " ");
  }
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function resourceKindLabel(kind: RelationshipResourceListItem["kind"]) {
  return { conversation_screenshot: "对话截图", conversation_transcript: "对话转写", resume: "简历", document: "文档", public_url: "公开链接", personal_note: "个人备注", contact_record: "联系人记录" }[kind];
}

export function resourceStateLabel(resource: Pick<RelationshipResourceListItem, "source_authorization_state" | "processing_state">) {
  if (resource.source_authorization_state === "revoked") return "访问已撤销";
  if (resource.source_authorization_state === "expired") return "授权已过期";
  return { received: "已接收", parsing: "正在整理", needs_identity_review: "待核对身份", needs_fact_review: "待核对资料", ready: "已就绪", failed: "整理失败" }[resource.processing_state];
}

/** Extraction review is separate from confirming a relationship fact. */
export function fragmentReviewLabel(status: string) {
  return ({ proposed: "待核对提取", reviewed: "提取已核对", rejected: "提取已驳回" } as Record<string, string>)[status] ?? "提取状态待核实";
}
export function fragmentLocationLabel(kind: string) {
  return ({ message: "对话片段", image_region: "图片片段", document_region: "文档区域", url_excerpt: "网页摘录", contact_field: "联系人资料", note_revision: "备注", document_text: "文档片段" } as Record<string, string>)[kind] ?? "来源片段";
}
export function fragmentAttributionLabel(actor: string, status: string) {
  const who = ({ candidate: "对方", recruiter: "记录人", client: "客户", document_author: "文档作者", public_source: "公开来源", unknown: "说话人不明" } as Record<string, string>)[actor] ?? "作者不明";
  const state = ({ confirmed: "归属已核对", proposed: "归属待核对", unknown: "归属尚未确定" } as Record<string, string>)[status] ?? "归属待核实";
  return `${who} · ${state}`;
}
