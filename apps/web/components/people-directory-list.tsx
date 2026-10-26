"use client";

import { useT, useLocale, type TFunction } from "@/components/locale-provider";
import type { MarketingLocale } from "@/lib/marketing-locale";
import type { PersonDirectoryItem } from "@talent-signal/contracts";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import Link from "next/link";
import { AvatarEditor } from "./avatar-editor";
import { personDirectoryEntryId, personMemoryHref } from "./people-directory-navigation";
import styles from "./people-directory-app.module.css";
import { PeopleDirectoryReturnList } from "./people-directory-return-list";
import { ListOrderMenu, useWorkspaceListReorder } from "./workspace-list-order";

type ListProps = { people: PersonDirectoryItem[]; query: string; returnSessionId: string | null };

function formatActivity(value: string, locale: MarketingLocale, t: TFunction) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("已有活动记录");
  }
  const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

function identityHandleLabel(type: string, t: TFunction) {
  const labels: Record<string, string> = {
    email: "邮箱", phone: "电话", wechat: "微信", linkedin_url: " LinkedIn",
    public_profile_url: "公开主页", source_native_id: "来源标识",
  };
  return t(labels[type] ?? "联系方式");
}

function identityMatchLabel(
  match: PersonDirectoryItem["identity_matches"][number],
  t: TFunction,
) {
  if (match.kind === "name") {
    return t("姓名匹配");
  }
  const handle = identityHandleLabel(match.handle_type, t);
  if (match.kind === "confirmed_handle") {
    return t("当前{handle}：{hint}", { handle, hint: match.display_hint });
  }
  return t("历史{handle}：{hint}", { handle, hint: match.display_hint });
}

function personChange(person: PersonDirectoryItem, t: TFunction) {
  if (person.contexts.length > 1) {
    return t("{count} 个关系情境", { count: person.contexts.length });
  }
  if (person.capture_count > 0) {
    return t("来源 {capture} · 已确认线索 {confirmed}", {
      capture: person.capture_count,
      confirmed: person.confirmed_identity_count,
    });
  }
  return t("暂无已确认的来源");
}

function PersonRow({ person, query, returnSessionId }: { person: PersonDirectoryItem; query: string; returnSessionId: string | null }) {
  const t = useT();
  const locale = useLocale();
  const match = person.identity_matches[0];
  const context = person.contexts[0];
  return <>
    <div className={styles.rowAvatar}><AvatarEditor id={person.id} label={person.display_label} url={person.avatar?.url} size={40} /></div>
    <Link
      className={styles.personRow}
      href={personMemoryHref(person.id, query, returnSessionId)}
      id={personDirectoryEntryId(person.id) ?? undefined}
    >
      <span className={styles.personIdentity}>
        <span className={styles.personName}>
          <strong>{person.display_label}</strong>
          <small>
            {match ? identityMatchLabel(match, t) : person.profile?.headline ?? t("身份待补充")}
          </small>
        </span>
      </span>
      <span className={styles.personChange}>
        <span className={styles.contextLabel}>
          {context?.display_label ?? t("没有活跃情境")}
        </span>
        <small>{personChange(person, t)}</small>
      </span>
      <span className={styles.personMeta}>
        <time dateTime={person.last_activity_at}>
          {formatActivity(person.last_activity_at, locale, t)}
        </time>
        <ArrowRight aria-hidden="true" size={15} />
      </span>
    </Link>
  </>;
}

export function PeopleDirectoryList(props: ListProps) {
  const order = useWorkspaceListReorder(props.people, "people", { disabled: Boolean(props.query) });
  return <>{order.notice}<PeopleDirectoryReturnList className={styles.peopleList}>
    {order.ordered.map(person => <li {...order.rowProps(person.id)} key={person.id}><PersonRow person={person} query={props.query} returnSessionId={props.returnSessionId} /><ListOrderMenu control={order.control(person.id)} label={person.display_label} /></li>)}
  </PeopleDirectoryReturnList></>;
}
