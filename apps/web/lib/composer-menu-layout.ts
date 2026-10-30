/**
 * Placement geometry for the shared composer suggestion menu.
 *
 * The popup is absolutely anchored to the outer composer shell, but a reader
 * only ever sees the intersection of the visual viewport and the scrollports
 * of the clipping ancestors above it (the conversation canvas, a Session pane,
 * a scrolled list, a health banner pushing the canvas down). This module owns
 * that measurement: one pure placement function plus one small DOM walk, so
 * the component effect and its tests share the same geometry.
 *
 * Boundaries: it only decides side and height. It never hides or reorders
 * options. Inline placement reserves the existing composer body before giving
 * the remaining visible space to the menu's own scrollport.
 */

export type ComposerMenuBounds = {
  top: number;
  bottom: number;
};

export type ComposerMenuSide = "above" | "below" | "inline";

export type ComposerMenuPlacement = {
  side: ComposerMenuSide;
  maxHeight: number;
};

/** CSS gap between the outer composer and the absolutely anchored popup. */
export const COMPOSER_MENU_GAP = 8;
/** Smallest popup worth anchoring absolutely before falling inline. */
export const COMPOSER_MENU_MIN_HEIGHT = 140;

/** Sticky-header clearance above the visual viewport (72 including the gap). */
const HEADER_CLEARANCE = 64;
/** Dock clearance below the viewport: 92 mobile / 20 desktop, gap included. */
const DOCK_CLEARANCE = { mobile: 84, desktop: 12 };
/** Prefer `above` outright once this much room exists there. */
const ABOVE_PREFERENCE = 220;
const ABSOLUTE_CAP = 360;
const INLINE_CAP = 220;
const INLINE_RATIO = 0.45;

/**
 * Choose the side and height for the popup. `outer` is the outer composer
 * shell's rect — the anchor the popup's `calc(100% + 8px)` gap is measured
 * against — never the editor inside it. `clip` is the already-intersected
 * clipping-ancestor bounds (see {@link composerMenuClipBounds}), or null when
 * nothing clips. The chosen absolute height never exceeds the space that
 * actually exists on the chosen side; when neither side can afford the
 * existing 140px minimum the popup falls inline. Its height can be smaller
 * than 140px: the editor and its actions must keep their own visible space.
 */
export function composerMenuPlacement(input: {
  outer: ComposerMenuBounds;
  viewport: { top: number; height: number };
  clip?: ComposerMenuBounds | null;
  mobile: boolean;
  /** Existing editor/actions/padding/border plus the inline menu's grid gap. */
  inlineContentHeight?: number;
}): ComposerMenuPlacement {
  const clipTop = input.clip
    ? input.clip.top + COMPOSER_MENU_GAP
    : Number.NEGATIVE_INFINITY;
  const clipBottom = input.clip
    ? input.clip.bottom - COMPOSER_MENU_GAP
    : Number.POSITIVE_INFINITY;
  const viewportBottom = input.viewport.top + input.viewport.height;
  const safeTop = Math.max(input.viewport.top + HEADER_CLEARANCE, clipTop);
  const safeBottom = Math.min(
    viewportBottom - (input.mobile ? DOCK_CLEARANCE.mobile : DOCK_CLEARANCE.desktop),
    clipBottom,
  );
  const above = Math.max(0, input.outer.top - COMPOSER_MENU_GAP - safeTop);
  const below = Math.max(0, safeBottom - (input.outer.bottom + COMPOSER_MENU_GAP));
  const side: ComposerMenuSide =
    Math.max(above, below) < COMPOSER_MENU_MIN_HEIGHT
      ? "inline"
      : above >= ABOVE_PREFERENCE || above >= below
        ? "above"
        : "below";
  if (side === "inline") {
    const retained = input.inlineContentHeight
      ?? Math.max(0, input.outer.bottom - input.outer.top) + COMPOSER_MENU_GAP;
    const budget = safeBottom - Math.max(safeTop, input.outer.top) - retained;
    return {
      side,
      maxHeight: Math.max(
        0,
        Math.floor(Math.min(INLINE_CAP, input.viewport.height * INLINE_RATIO, budget)),
      ),
    };
  }
  const budget = side === "above" ? above : below;
  // Never taller than the real room on the chosen side.
  return {
    side,
    maxHeight: Math.min(
      budget,
      Math.max(COMPOSER_MENU_MIN_HEIGHT, Math.min(ABSOLUTE_CAP, budget)),
    ),
  };
}

const CLIP_OVERFLOW = new Set(["auto", "scroll", "hidden", "clip"]);

/**
 * Ancestors whose scrollport can clip the popup: overflow-y auto, scroll,
 * hidden or clip. Walk upward from `start` (the composer's parent) while
 * skipping anything inside `exclude` (the popup itself), so a menu never
 * clips itself and its scrolling list is never treated as a viewport bound.
 */
export function composerMenuClippingAncestors(
  start: Element | null,
  exclude?: Element | null,
): Element[] {
  const found: Element[] = [];
  for (let node: Element | null = start; node; node = node.parentElement) {
    if (exclude && (node === exclude || exclude.contains(node))) continue;
    const overflowY =
      node.ownerDocument?.defaultView?.getComputedStyle(node).overflowY ?? "";
    if (CLIP_OVERFLOW.has(overflowY)) found.push(node);
  }
  return found;
}

/**
 * Intersect the clipping ancestors' client boxes into one visible bound.
 * `getBoundingClientRect` already respects scrolled positions, and
 * clientTop/clientHeight describe the scrollport that actually clips, so a
 * partially scrolled pane contributes only the region still on screen.
 */
export function composerMenuClipBounds(
  ancestors: readonly Element[],
): ComposerMenuBounds | null {
  if (ancestors.length === 0) return null;
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  for (const node of ancestors) {
    const rect = node.getBoundingClientRect();
    const clientTop = rect.top + node.clientTop;
    top = Math.max(top, clientTop);
    bottom = Math.min(bottom, clientTop + node.clientHeight);
  }
  return { top, bottom };
}
