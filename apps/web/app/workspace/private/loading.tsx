import Link from "next/link";
import { Ghost, X } from "@phosphor-icons/react/dist/ssr";
import styles from "@/components/conversation/private-conversation.module.css";

export default function PrivateConversationLoading() {
  return <main id="main-content" className={styles.room} data-empty="true" aria-busy="true">
    <header className={styles.header}>
      <span className={styles.roomName}><Ghost size={18} weight="fill" aria-hidden="true"/>隐私对话</span>
      <Link className={styles.exit} href="/workspace"><X size={16} aria-hidden="true"/>返回工作区</Link>
    </header>
    <div className={styles.body}><div className={styles.welcome}>
      <h1>只属于此刻的对话</h1>
      <p role="status">正在打开隐私对话…</p>
    </div></div>
  </main>;
}
