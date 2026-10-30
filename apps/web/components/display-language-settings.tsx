"use client";

import { startTransition, useActionState, useRef, useState } from "react";
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
type DisplayLanguageActionState = AccountActionState & { generation: number };

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
  const editGeneration = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [receipt, setReceipt] = useState<{ source: AccountSettings; value: AccountSettings } | null>(null);
  const confirmed = receipt?.source === account ? receipt.value : account;
  const [draft, setDraft] = useState<{ choice: DisplayChoice; revision: number } | null>(null);
  const choice = draft?.choice ?? confirmed.preferences?.display_language ?? "system";
  const revision = draft?.revision ?? confirmed.user.revision;
  const [state, action, pending] = useActionState<DisplayLanguageActionState, FormData>(async (previous, form) => {
    const submittedGeneration = editGeneration.current;
    const result = await saveAccountSettings(previous, form);
    if (result.data) setReceipt({ source: account, value: result.data });
    if (result.saved) {
      setOperationId("");
      setDraft(null);
      const savedChoice = result.data?.preferences?.display_language ?? "system";
      if (savedChoice !== form.get("display_language")) {
        return { ...result, generation: submittedGeneration, saved: false, error: "界面语言已在另一端改变，已显示最新设置。请核对后再保存。" };
      }
    }
    return { ...result, generation: submittedGeneration, data: result.data ?? previous.data };
  }, { generation: 0 });
  const feedback = state.generation === generation ? state : null;
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
        setDraft(current => current ?? { choice, revision });
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
          editGeneration.current += 1;
          setGeneration(editGeneration.current);
          setDraft(current => ({
            choice: event.target.value as DisplayChoice,
            revision: current?.revision ?? confirmed.user.revision,
          }));
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
        {pending ? "…" : feedback?.error ? t(feedback.error) : feedback?.saved ? t("language.saved") : ""}
      </p>
      <button type="submit" className={styles.primaryButton} disabled={pending}>
        {t("language.save")}
      </button>
    </form>
  );
}
