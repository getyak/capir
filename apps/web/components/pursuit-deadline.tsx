"use client";

import { useSyncExternalStore } from "react";
import { formatPursuitDeadline } from "@/lib/pursuit-presentation";

const subscribe = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverZone = () => "UTC";

/** The server fallback is explicit; hydration then adopts the device's zone. */
export function PursuitDeadline({ value }: { value: string | null }) {
  const zone = useSyncExternalStore(subscribe, deviceZone, serverZone);
  const label = formatPursuitDeadline(value, zone);
  return value && Number.isFinite(Date.parse(value))
    ? <time dateTime={value}>{label}</time>
    : <span>{label}</span>;
}
