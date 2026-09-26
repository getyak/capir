"use client";

import { useAvatarDisplay } from "./avatar-preferences-provider";
import { IdentityAvatar } from "./identity-avatar";

/** Shared recognition display; local choices never establish identity or trigger lookups. */
export function PersonDirectoryAvatar({ className, label, url, id, size, dataSize, shape, self = false }: {
  className?: string; label: string; url?: string | null; id: string; size?: number; dataSize?: string;
  shape?: "circle" | "squircle"; self?: boolean;
}) {
  const { store, defaultStyle, preference } = useAvatarDisplay(self ? "self" : `person:${id}`);
  return <IdentityAvatar className={className} id={self ? store?.key ?? id : id} label={label} url={url} size={size} dataSize={dataSize} shape={shape}
    defaultStyle={defaultStyle} preference={preference} />;
}
