"use client";

import { useT } from "@/components/locale-provider";
import type { PersonDirectoryItem } from "@talent-signal/contracts";
import { AddressBook } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import styles from "./people-directory-app.module.css";
import { withReturnSession } from "./session-return-navigation";
import { PeopleDirectoryList } from "./people-directory-list";
import { WorkspaceDisconnectedState } from "./workspace-disconnected-state";
import { PeopleDirectorySearch } from "./people-directory-search";

type Props = {
  error: string | null;
  people: PersonDirectoryItem[];
  query: string;
  returnSessionId: string | null;
  sessionRecoveryHref: string | null;
};

export function PeopleDirectoryApp({
  error,
  people,
  query,
  returnSessionId,
  sessionRecoveryHref,
}: Props) {
  const t = useT();
  return (
    <div className={styles.shell}>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <div className={styles.page}>
          <header className={styles.pageHeading}>
            <div>
              <h1>{t("人物")}</h1>
              <p>
                {error
                  ? t("目录暂时不可用；已保存的联系人资料不会改变。")
                  : t("每段关系保留自己的上下文。")}
                {returnSessionId
                  ? ` ${t("这次选择会保留原对话入口，但不会自动改变对话范围。")}`
                  : ""}
              </p>
            </div>
            <Link
              className={styles.createPerson}
              href={withReturnSession(
                "/workspace?surface=desk&intent=create-contact",
                returnSessionId,
              )}
            >{t("添加联系人")}</Link>
          </header>

          <div className={styles.listTools}>
            <PeopleDirectorySearch query={query} returnSessionId={returnSessionId} />
            <span aria-live="polite">{error ? t("暂不可用") : people.length === 200
              ? t(query ? "当前显示前 200 位匹配人物" : "当前显示前 200 位人物")
              : t(query ? "{count} 位匹配人物" : "{count} 位人物", { count: people.length })}</span>
          </div>

          {error ? (
            <div className={styles.disconnectedState}>
              <WorkspaceDisconnectedState
                description={t(error)}
                eyebrow={t("连接暂时中断")}
                hint={
                  sessionRecoveryHref
                    ? t("重新登录后会回到同一目录视图；系统不会用陈旧联系人状态替代当前结果。")
                    : t("请稍后重新载入；你的联系人和已保存的来源不会因此丢失。")
                }
                primaryHref={
                  sessionRecoveryHref
                    ? sessionRecoveryHref
                    : withReturnSession(`/workspace/people${query ? `?query=${encodeURIComponent(query)}` : ""}`, returnSessionId)
                }
                primaryLabel={sessionRecoveryHref ? t("重新登录") : t("重新载入")}
                secondaryHref="/workspace"
                secondaryLabel={t("返回对话")}
                title={t("人物目录暂时不可用。")}
              />
            </div>
          ) : people.length === 0 ? (
            <div className={styles.empty}>
              <AddressBook aria-hidden="true" size={24} weight="duotone" />
              <div>
                <strong>{query ? t("没有匹配人物") : t("还没有人物")}</strong>
                <p>
                  {query
                    ? t("请尝试其他姓名、邮箱或电话。联系方式会保持掩码，且只有在你明确输入时才会用于搜索。")
                    : t("从一段聊天或人物介绍开始，整理你的第一位联系人。")}
                </p>
              </div>
              {query ? (
                <Link
                  href={withReturnSession("/workspace/people", returnSessionId)}
                >{t("清除搜索")}</Link>
              ) : (
                <Link
                  href={withReturnSession("/workspace?surface=desk&intent=create-contact", returnSessionId)}
                >{t("添加第一位联系人")}</Link>
              )}
            </div>
          ) : (
            <>
              <div aria-hidden="true" className={styles.tableHeader}>
                <span>{t("人物")}</span>
                <span>{t("关系情境与资料")}</span>
                <span>{t("更新")}</span>
              </div>
              <PeopleDirectoryList people={people} query={query} returnSessionId={returnSessionId} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
