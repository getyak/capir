"use client";

import { useT } from "@/components/locale-provider";
import { createContext, useContext, useEffect, type ReactNode } from "react";
export const OAuthPendingContext = createContext<((pending: boolean) => void) | null>(null);
import { useFormStatus } from "react-dom";

export function OAuthSubmit({ children, className = "auth-provider", disabled, formAction }: {
  children: ReactNode; className?: string; disabled?: boolean; formAction?: (data: FormData) => void | Promise<void>;
}) {
  const t = useT();
  const { pending } = useFormStatus();
  const onPending = useContext(OAuthPendingContext);
  useEffect(() => { onPending?.(pending); }, [pending, onPending]);
  return <button className={className} type="submit" formAction={formAction} disabled={disabled || pending} aria-busy={pending}>
    {pending ? <span role="status">{t("正在连接…")}</span> : children}
  </button>;
}
