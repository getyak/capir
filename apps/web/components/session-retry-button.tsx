"use client";
import { useRouter } from "next/navigation";
import { useT } from "./locale-provider";
export function SessionRetryButton() {
  const router = useRouter();
  const t = useT();
  return <button type="button" onClick={() => router.refresh()}>{t("重试连接")}</button>;
}
