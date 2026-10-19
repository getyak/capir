"use client";

import { useActionState, useState } from "react";
import {
  LOCALE_ENDONYMS,
  SUPPORTED_LOCALES,
  type AccountSettings,
  type LocaleTag,
} from "@talent-signal/contracts";
import { saveAccountSettings, type AccountActionState } from "@/app/workspace/settings/actions";
import { useT } from "@/components/marketing/locale-provider";
import styles from "./settings-workspace.module.css";

type DisplayChoice = "system" | LocaleTag;

/**
 * Account-scoped display language (docs/internationalization.md).
 *
 * Unlike theme, this preference stores with the account and follows the user
 * to every device. `system` keeps following the platform language through the
 * canonical fallback chain. The picker labels are endonyms — each language
 * named in itself — and never frame any language as better than another.
 */
export function DisplayLanguageSettings({
  account,
}: {
  account: AccountSettings;
}) {
  const t = useT();
  const [operationId, setOperationId] = useState("");
  const [state, action, pending] = useActionState(saveAccountSettings, {} as AccountActionState);
  const current: DisplayChoice =
    state.data?.preferences?.display_language ?? account.preferences?.display_language ?? "system";
  const revision = state.data?.user.revision ?? account.user.revision;
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        const id = operationId || crypto.randomUUID();
        (event.currentTarget.elements.namedItem("operationId") as HTMLInputElement).value = id;
        setOperationId(id);
      }}
    >
      <input type="hidden" name="operationId" defaultValue={operationId} />
      <input type="hidden" name="workspaceId" value={account.workspace.id} />
      <input type="hidden" name="actorUserId" value={account.user.id} />
      <input type="hidden" name="kind" value="preferences" />
      <input type="hidden" name="revision" value={revision} />
      <label htmlFor="display-language-select">{t("language.display.label")}</label>
      <select
        id="display-language-select"
        name="display_language"
        key={revision}
        defaultValue={current}
        disabled={pending}
        data-display-language
      >
        <option value="system">{t("language.option.system")}</option>
        {SUPPORTED_LOCALES.map((tag) => (
          <option key={tag} value={tag}>{LOCALE_ENDONYMS[tag]}</option>
        ))}
      </select>
      <p>{t("language.display.hint")}</p>
      <p aria-live="polite">
        {pending ? "…" : state.error ?? (state.saved ? t("language.saved") : "")}
      </p>
      <button type="submit" className={styles.primaryButton} disabled={pending}>
        {t("language.save")}
      </button>
    </form>
  );
}
