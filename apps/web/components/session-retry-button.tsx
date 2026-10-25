"use client";
import { useRouter } from "next/navigation";
export function SessionRetryButton() {
  const router = useRouter();
  return <button type="button" onClick={() => router.refresh()}>重试连接</button>;
}
