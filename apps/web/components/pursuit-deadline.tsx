"use client";

import { useSyncExternalStore } from "react";
import { formatPursuitDeadline, formatPursuitDeadlineCompact } from "@/lib/pursuit-presentation";

const subscribe = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverZone = () => "UTC";

/** The server fallback is explicit; hydration then adopts the device's zone. */
export function PursuitDeadline({ value, compact = false }: {
  value: string | null;
  /** Glance label for meta lines; the full zone-aware label stays on the element. */
  compact?: boolean;
}) {
  const zone = useSyncExternalStore(subscribe, deviceZone, serverZone);
  const full = formatPursuitDeadline(value, zone);
  const label = compact ? formatPursuitDeadlineCompact(value, zone) : full;
  return value && Number.isFinite(Date.parse(value))
    ? <time dateTime={value} title={compact ? full : undefined} aria-label={compact ? full : undefined}>{label}</time>
    : <span>{label}</span>;
}
