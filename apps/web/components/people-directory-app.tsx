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
  return (
    <div className={styles.shell}>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <div className={styles.page}>
          <header className={styles.pageHeading}>
            <div>
              <h1>人物</h1>
              <p>
                {error
                  ? "目录暂时不可用；已保存的联系人资料不会改变。"
                  : "每段关系保留自己的上下文。"}
                {returnSessionId
                  ? " 这次选择会保留原对话入口，但不会自动改变对话范围。"
                  : ""}
              </p>
            </div>
            <Link
              className={styles.createPerson}
              href={withReturnSession(
                "/workspace?surface=desk&intent=create-contact",
                returnSessionId,
              )}
            >
              添加联系人
            </Link>
          </header>

          <div className={styles.listTools}>
            <PeopleDirectorySearch query={query} returnSessionId={returnSessionId} />
            <span aria-live="polite">{error ? "暂不可用" : `${people.length} 位${query ? "匹配人物" : "人物"}`}</span>
          </div>

          {error ? (
            <div className={styles.disconnectedState}>
              <WorkspaceDisconnectedState
                description={error}
                hint={
                  sessionRecoveryHref
                    ? "重新登录后会回到同一目录视图；系统不会用陈旧联系人状态替代当前结果。"
                    : "请稍后重新载入；你的联系人和已保存的来源不会因此丢失。"
                }
                primaryHref={
                  sessionRecoveryHref
                    ? sessionRecoveryHref
                    : withReturnSession(`/workspace/people${query ? `?query=${encodeURIComponent(query)}` : ""}`, returnSessionId)
                }
                primaryLabel={sessionRecoveryHref ? "重新登录" : "重新载入"}
                secondaryHref="/workspace"
                secondaryLabel="返回对话"
                title="人物目录暂时不可用。"
              />
            </div>
          ) : people.length === 0 ? (
            <div className={styles.empty}>
              <AddressBook aria-hidden="true" size={24} weight="duotone" />
              <div>
                <strong>{query ? "没有匹配人物" : "还没有人物"}</strong>
                <p>
                  {query
                    ? "请尝试其他姓名、邮箱或电话。联系方式会保持掩码，且只有在你明确输入时才会用于搜索。"
                    : "从一段聊天或人物介绍开始，整理你的第一位联系人。"}
                </p>
              </div>
              {query ? (
                <Link
                  href={withReturnSession("/workspace/people", returnSessionId)}
                >
                  清除搜索
                </Link>
              ) : (
                <Link
                  href={withReturnSession("/workspace?surface=desk", returnSessionId)}
                >
                  添加第一位联系人
                </Link>
              )}
            </div>
          ) : (
            <>
              <div aria-hidden="true" className={styles.tableHeader}>
                <span>人物</span>
                <span>关系情境与资料</span>
                <span>更新</span>
              </div>
              <PeopleDirectoryList people={people} returnSessionId={returnSessionId} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
