import { Browser, Desktop, DeviceMobile } from "@phosphor-icons/react/dist/ssr";
import type { LocaleTag } from "@talent-signal/contracts";
import { translate } from "@/lib/i18n";
import styles from "./login.module.css";

/** A product promise, never a preview of another account's private content. */
export function AccountContinuity({ locale = "zh-CN" }: { locale?: LocaleTag } = {}) {
  const t = (key: string) => translate(locale, key);
  return (
    <aside className={styles.continuity} aria-label={t("跨设备继续你的工作")}>
      <p className={styles.eyebrow}>{t("让重要的连接，延续下去")}</p>
      <h2>{t("换个屏幕，")}<br />{t("继续上次的对话。")}</h2>
      <p className={styles.story}>{t("联系人、会话和一路积累的上下文，")}<br />{t("始终在你的同一账号里。")}</p>
      <div className={styles.continuityMap}>
        <p className={styles.accountLine}><span aria-hidden="true" />{t("你的关系工作台")}</p>
        <ul className={styles.devices} aria-label={t("可使用的设备")}>
          <li><DeviceMobile size={21} aria-hidden="true" />iPhone</li>
          <li><Browser size={21} aria-hidden="true" />Web</li>
          <li><Desktop size={21} aria-hidden="true" />Mac</li>
        </ul>
      </div>
    </aside>
  );
}
