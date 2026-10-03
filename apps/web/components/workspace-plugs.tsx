import {
  CalendarBlank,
  Desktop,
  Key,
  LockKey,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";

import type { WorkspaceConnection } from "@/lib/workspace-plugs";
import Link from "next/link";

import styles from "./workspace-plugs.module.css";
import { WorkspaceNativeBoundary } from "./workspace-native-boundary";

const icons = {
  "account-sign-in": Key,
  "google-calendar": CalendarBlank,
  "macos-capture": Desktop,
} as const;

export function WorkspacePlugs({
  connections,
  error,
}: {
  connections: WorkspaceConnection[];
  error: string | null;
}) {
  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <header className={styles.header}>
        <h1>连接</h1>
        <p>
          管理资料入口，查看每项能力的授权范围。
        </p>
      </header>

      {error ? (
        <section className={styles.error} role="alert">
          <WarningCircle aria-hidden="true" size={20} />
          <div>
            <strong>连接状态暂时无法核验</strong>
            <p>{error} 请重新读取，核验成功前不会启用连接。</p>
            <a href="/workspace/plugs">重新读取</a>
          </div>
        </section>
      ) : (
        <section aria-labelledby="connections-title" className={styles.listSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="connections-title">连接状态</h2>
            </div>
            <span>{connections.filter(connection => connection.status === "connected").length} 项已连接 · {connections.length} 项能力</span>
          </div>
          <ul className={styles.list}>
            {connections.map((connection) => {
              const Icon = icons[connection.id as keyof typeof icons] ?? LockKey;
              return (
                <li className={styles.row} data-status={connection.status} key={connection.id}>
                  <span aria-hidden="true" className={styles.icon}>
                    <Icon size={18} weight="duotone" />
                  </span>
                  <div className={styles.body}>
                    <div className={styles.titleLine}>
                      <h3>{connection.label}</h3>
                      <span className={styles.status}>{connection.statusLabel}</span>
                    </div>
                    <small>{connection.scopeLabel}</small>
                    <details className={styles.scopeDetails}><summary>权限说明</summary><p>{connection.description}</p></details>
                    {connection.recovery ? (
                      <p className={styles.recovery}>{connection.recovery}</p>
                    ) : null}
                  </div>
                  {connection.id === "account-sign-in" ? <Link className={styles.manage} href="/workspace/settings?section=account">管理账号</Link> : connection.id === "google-calendar" ? <Link className={styles.manage} href="/workspace/meetings">查看草稿</Link> : <a className={styles.manage} href="#native-capabilities">了解能力</a>}
                </li>
              );
            })}
          </ul>
          <details className={styles.directionNote}>
            <summary>连接方向与不可用能力</summary>
            <p>
              当前版本只实现读取方向：已授权的来源可以被读取，并在写入前始终询问。
              把 capri 作为受控服务接入其他客户端（MCP 发布）尚未实现，
              因此这里不提供方向切换、客户端列表或范围开关。
            </p>
          </details>
        </section>
      )}

      <section className={styles.workflows} aria-labelledby="connection-workflows">
        <h2 id="connection-workflows">可用工作流</h2>
        <div>
          <Link href="/workspace/captures"><strong>截图与文档</strong><span>导入资料，核对来源与归属</span></Link>
          <Link href="/workspace/meetings"><strong>会议草稿</strong><span>核对日程，再由日历应用确认导入</span></Link>
        </div>
      </section>
      <aside className={styles.boundary}>
        <LockKey aria-hidden="true" size={18} />
        <p>
          当前没有可用的日历授权入口。capri 不会把 Google 登录当成日历许可，也不会让远程 Web 内容获得原生采集能力。
        </p>
      </aside>

      <details className={styles.nativeBoundary} id="native-capabilities">
        <summary>查看 Mac 本机能力说明</summary>
        <WorkspaceNativeBoundary />
      </details>
    </main>
  );
}
