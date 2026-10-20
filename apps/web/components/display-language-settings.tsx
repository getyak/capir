"use client";

import { startTransition, useActionState, useState } from "react";
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
  const [choice, setChoice] = useState<DisplayChoice>(account.preferences?.display_language ?? "system");
  const [state, action, pending] = useActionState(async (previous: AccountActionState, form: FormData) => {
    const result = await saveAccountSettings(previous, form);
    if (result.saved) {
      setOperationId("");
      const confirmed = result.data?.preferences?.display_language ?? "system";
      if (confirmed !== form.get("display_language")) {
        setChoice(confirmed);
        return { ...result, saved: false, error: "界面语言已在另一端改变，已显示最新设置。请核对后再保存。" };
      }
    }
    return { ...result, data: result.data ?? previous.data };
  }, {} as AccountActionState);
  const revision = state.data?.user.revision ?? account.user.revision;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) {
          return;
        }
        const id = operationId || crypto.randomUUID();
        (event.currentTarget.elements.namedItem("operationId") as HTMLInputElement).value = id;
        setOperationId(id);
        const form = new FormData(event.currentTarget);
        // Dispatch explicitly so a resolved error does not trigger React's
        // native form reset and replace the language needed for a safe retry.
        startTransition(() => action(form));
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
        value={choice}
        onChange={(event) => {
          setChoice(event.target.value as DisplayChoice);
          setOperationId("");
        }}
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
        {pending ? "…" : state.error ? t(state.error) : state.saved ? t("language.saved") : ""}
      </p>
      <button type="submit" className={styles.primaryButton} disabled={pending}>
        {t("language.save")}
      </button>
    </form>
  );
}
