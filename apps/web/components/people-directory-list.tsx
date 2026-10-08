import type { PersonDirectoryItem } from "@talent-signal/contracts";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import Link from "next/link";
import { AvatarEditor } from "./avatar-editor";
import { personMemoryHref } from "./people-directory-navigation";
import styles from "./people-directory-app.module.css";

type ListProps = { people: PersonDirectoryItem[]; query: string; returnSessionId: string | null };

function formatActivity(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "已有活动记录";
  }
  const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

function identityHandleLabel(type: string) {
  const labels: Record<string, string> = {
    email: "邮箱", phone: "电话", wechat: "微信", linkedin_url: " LinkedIn",
    public_profile_url: "公开主页", source_native_id: "来源标识",
  };
  return labels[type] ?? "联系方式";
}

function identityMatchLabel(
  match: PersonDirectoryItem["identity_matches"][number],
) {
  if (match.kind === "name") {
    return "姓名匹配";
  }
  if (match.kind === "confirmed_handle") {
    return `当前${identityHandleLabel(match.handle_type)}：${match.display_hint}`;
  }
  return `历史${identityHandleLabel(match.handle_type)}：${match.display_hint}`;
}

function personChange(person: PersonDirectoryItem) {
  if (person.contexts.length > 1) {
    return `${person.contexts.length} 个关系情境`;
  }
  if (person.capture_count > 0) {
    return `来源 ${person.capture_count} · 已确认线索 ${person.confirmed_identity_count}`;
  }
  return "暂无已确认的来源";
}

function PersonRow({ person, query, returnSessionId }: { person: PersonDirectoryItem; query: string; returnSessionId: string | null }) {
  const match = person.identity_matches[0];
  const context = person.contexts[0];
  return <>
    <div className={styles.rowAvatar}><AvatarEditor id={person.id} label={person.display_label} url={person.avatar?.url} size={40} /></div>
    <Link
      className={styles.personRow}
      href={personMemoryHref(person.id, query, returnSessionId)}
    >
      <span className={styles.personIdentity}>
        <span className={styles.personName}>
          <strong>{person.display_label}</strong>
          <small>
            {match ? identityMatchLabel(match) : person.profile?.headline ?? "身份待补充"}
          </small>
        </span>
      </span>
      <span className={styles.personChange}>
        <span className={styles.contextLabel}>
          {context?.display_label ?? "没有活跃情境"}
        </span>
        <small>{personChange(person)}</small>
      </span>
      <span className={styles.personMeta}>
        <time dateTime={person.last_activity_at}>
          {formatActivity(person.last_activity_at)}
        </time>
        <ArrowRight aria-hidden="true" size={15} />
      </span>
    </Link>
  </>;
}

export function PeopleDirectoryList(props: ListProps) {
  return <ol className={styles.peopleList} aria-label="联系人列表">
    {props.people.map(person => <li key={person.id}><PersonRow person={person} query={props.query} returnSessionId={props.returnSessionId} /></li>)}
  </ol>;
}
