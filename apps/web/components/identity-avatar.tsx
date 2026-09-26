"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { resolveAvatar, type AvatarPreference, type AvatarStyle } from "@/lib/avatar";
import { generatedAvatar } from "@/lib/generated-avatar";
import styles from "./identity-avatar.module.css";

export function IdentityAvatar({ id, label, url, className = "", size, preference, defaultStyle, dataSize, shape }: {
  id: string; label: string; url?: string | null; className?: string; size?: number;
  preference?: AvatarPreference; defaultStyle?: AvatarStyle; dataSize?: string;
  shape?: "circle" | "squircle";
}) {
  const avatar = useMemo(() => resolveAvatar({ id, label, url, preference, defaultStyle }), [id, label, url, preference, defaultStyle]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const photo = avatar.photo !== failed ? avatar.photo : null;
  const generationSeed = preference?.seed ?? `avatar-${avatar.hash}`;
  const generated = useMemo(() => generationSeed && (avatar.style === "shapes" || avatar.style === "glass") ? {
    light: generatedAvatar(avatar.style, generationSeed, false),
    dark: generatedAvatar(avatar.style, generationSeed, true),
  } : null, [avatar.style, generationSeed]);
  const checkCachedPhoto = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0 && photo) setLoaded(photo);
  }, [photo]);
  const variables = {
    "--avatar-bg": avatar.color[0], "--avatar-fg": avatar.color[1],
    "--avatar-dark-bg": avatar.color[2], "--avatar-dark-fg": avatar.color[3],
    ...(size ? { width: size, height: size, fontSize: size * .34 } : {}),
  } as CSSProperties;
  return <span aria-hidden="true" className={`${className} ${styles.avatar}`} style={variables} data-size={dataSize} data-shape={shape ?? "circle"} data-avatar-style={avatar.style} data-photo-loaded={Boolean(photo && loaded === photo)}>
    {avatar.style === "initials" ? <span className={styles.initials}>{avatar.initials}</span> : generated ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- local generated SVG, no network or optimizer. */}
      <img alt="" src={generated.light} width={192} height={192} className={styles.generated} data-appearance="light" />
      {/* eslint-disable-next-line @next/next/no-img-element -- local generated SVG, no network or optimizer. */}
      <img alt="" src={generated.dark} width={192} height={192} className={styles.generated} data-appearance="dark" />
    </> : null}
    {photo ? (
      // eslint-disable-next-line @next/next/no-img-element -- preserve authorized source URLs; never proxy private photos.
      <img ref={checkCachedPhoto} key={photo} alt="" src={photo} width={size ?? 64} height={size ?? 64} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        className={styles.photo} data-loaded={loaded === photo}
        onLoad={() => setLoaded(photo)} onError={() => setFailed(photo)} />
    ) : null}
  </span>;
}
