export type AvatarStyle = "initials" | "shapes" | "glass";
export type AvatarPreference = { style: "auto" | AvatarStyle; photo?: string; seed?: string };

// Paired, low-saturation identity colors. Color carries no relationship state.
export const avatarPalette = [
  ["#e8ded3", "#3d3026", "#514338", "#f4e8dc"],
  ["#dce5dc", "#2e4033", "#374c3e", "#e1efe1"],
  ["#dce5eb", "#2d3e4b", "#354957", "#e1edf5"],
  ["#e6dfee", "#453650", "#4c3d59", "#f0e4fa"],
  ["#eededc", "#513732", "#593f3b", "#f8e4e0"],
  ["#e9e5cf", "#464126", "#504b32", "#f3efda"],
  ["#d6e7e4", "#29433e", "#304e49", "#dcf1eb"],
  ["#e7dfda", "#453931", "#4e423a", "#f2e8df"],
  ["#dfe1ef", "#343b56", "#3d4560", "#e6e9fb"],
  ["#ebdfE5", "#4c3342", "#563e4d", "#f8e4ef"],
] as const;

export function avatarHash(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return hash >>> 0;
}

export function avatarInitials(label: string): string {
  // Display annotations are not part of the recognition name. Otherwise every
  // person labelled “姓名（测试）” gets the same “试” avatar. This is presentation
  // only; the saved label and identity authority remain untouched.
  const name = label.trim().normalize("NFC")
    .replace(/(?:\s*(?:\([^()]*\)|（[^（）]*）))+\s*$/u, "")
    .trim();
  if (!name || /[@/:\d]/u.test(name) || /^(未知联系人|未命名|未知|联系人|人物|unknown|unnamed|anonymous)$/iu.test(name)) return "";
  const han = name.match(/\p{Script=Han}/gu);
  if (han?.length) return han.at(-1)!;
  const words = name.match(/\p{L}[\p{L}\p{M}]*/gu) ?? [];
  const first = (word: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word))[0]?.segment ?? "";
  return (words.length > 1 ? first(words[0]!) + first(words.at(-1)!) : first(words[0] ?? "")).toUpperCase();
}

export function isAvatarStyle(value: unknown): value is AvatarStyle {
  return value === "initials" || value === "shapes" || value === "glass";
}

/** Generated display choices use opaque, bounded seeds, never names or contacts. */
export function isAvatarSeed(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function isLocalAvatarPhoto(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100_000 && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/u.test(value);
}

export function resolveAvatar({ id, label, url, defaultStyle = "initials", preference }: {
  id: string; label: string; url?: string | null; defaultStyle?: AvatarStyle; preference?: AvatarPreference;
}) {
  const initials = avatarInitials(label);
  const selected = preference?.style ?? "auto";
  const fallback = selected === "auto" ? defaultStyle : selected;
  const style = fallback === "initials" && !initials ? "shapes" : fallback;
  const remote = url && (/^https:\/\//u.test(url) || /^\/(?!\/)/u.test(url)) ? url : null;
  const photo = selected === "auto" ? (isLocalAvatarPhoto(preference?.photo) ? preference.photo : remote) : null;
  const hash = avatarHash(id);
  return { initials, style, photo, hash, color: avatarPalette[hash % avatarPalette.length] };
}
