// @vitest-environment happy-dom
//
// Composer menu geometry: the resident 390x844 clipping case, the wrong-origin
// distinction, above vs below, visual-viewport offset and shrink, the inline
// fallback, the mobile dock clearance, and the clipping-ancestor walk that
// bounds everything to what the reader can actually see.

import { describe, expect, it } from "vitest";

import {
  COMPOSER_MENU_GAP,
  composerMenuClipBounds,
  composerMenuClippingAncestors,
  composerMenuPlacement,
  type ComposerMenuBounds,
  type ComposerMenuPlacement,
} from "./composer-menu-layout";

type Scenario = Parameters<typeof composerMenuPlacement>[0];

/** Where the popup box lands for a placement, against its real anchor. */
function menuBox(
  outer: ComposerMenuBounds,
  placement: ComposerMenuPlacement,
): ComposerMenuBounds {
  if (placement.side === "above") {
    return {
      top: outer.top - COMPOSER_MENU_GAP - placement.maxHeight,
      bottom: outer.top - COMPOSER_MENU_GAP,
    };
  }
  if (placement.side === "below") {
    return {
      top: outer.bottom + COMPOSER_MENU_GAP,
      bottom: outer.bottom + COMPOSER_MENU_GAP + placement.maxHeight,
    };
  }
  return { top: outer.top, bottom: outer.top + placement.maxHeight };
}

/** Build a real element with mocked geometry and an inline overflow. */
function box(
  options: {
    overflowY?: string;
    top: number;
    bottom: number;
    parent?: Element;
  },
): HTMLElement {
  const element = document.createElement("div");
  if (options.overflowY) element.style.overflowY = options.overflowY;
  element.getBoundingClientRect = () =>
    ({
      top: options.top,
      bottom: options.bottom,
      height: options.bottom - options.top,
      left: 0,
      right: 390,
      width: 390,
      x: 0,
      y: options.top,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
  Object.defineProperty(element, "clientTop", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(element, "clientHeight", {
    value: options.bottom - options.top,
    configurable: true,
  });
  if (options.parent) options.parent.append(element);
  // Detached nodes have no computed style; keep fixtures in the document.
  else document.body.append(element);
  return element;
}

describe("composerMenuPlacement", () => {
  // Resident evidence: 390x844 empty conversation, nearest scroll-clipping
  // canvas 185..766, outer composer 442..570, editor inside it 462..620.
  const resident: Scenario = {
    outer: { top: 442, bottom: 570 },
    viewport: { top: 0, height: 844 },
    clip: { top: 185, bottom: 766 },
    mobile: true,
  };

  it("fits the resident clipping case inside the visible region", () => {
    const placement = composerMenuPlacement(resident);
    expect(placement.side).toBe("above");
    expect(placement.maxHeight).toBe(241);
    const popup = menuBox(resident.outer, placement);
    expect(popup.top).toBeGreaterThanOrEqual(185);
    expect(popup.bottom).toBeLessThanOrEqual(766);
    // Selected-first option geometry (border 1 + list padding 6) stays visible.
    expect(popup.top + 7).toBeGreaterThanOrEqual(185);
    expect(popup.top + 7 + 57).toBeLessThanOrEqual(766);
  });

  it("distinguishes the 462 editor origin as the wrong anchor", () => {
    const placement = composerMenuPlacement({
      ...resident,
      outer: { top: 462, bottom: 620 },
    });
    expect(placement.maxHeight).toBe(261);
    // Against the real anchor the popup is absolutely positioned against, the
    // 462 budget lands at 173: above the clip top, erased by the canvas.
    const menuTop = resident.outer.top - COMPOSER_MENU_GAP - placement.maxHeight;
    expect(menuTop).toBeLessThan(185);
    expect(resident.outer.top - COMPOSER_MENU_GAP - 241).toBeGreaterThanOrEqual(185);
  });

  it("prefers above outright once 220px of room exists there", () => {
    const scenario: Scenario = {
      outer: { top: 300, bottom: 428 },
      viewport: { top: 0, height: 844 },
      clip: null,
      mobile: false,
    };
    const placement = composerMenuPlacement(scenario);
    expect(placement.side).toBe("above");
    expect(placement.maxHeight).toBe(228);
  });

  it("opens below and caps at 360 when the composer sits near the top", () => {
    const scenario: Scenario = {
      outer: { top: 120, bottom: 248 },
      viewport: { top: 0, height: 844 },
      clip: null,
      mobile: false,
    };
    const placement = composerMenuPlacement(scenario);
    expect(placement.side).toBe("below");
    expect(placement.maxHeight).toBe(360);
    const popup = menuBox(scenario.outer, placement);
    expect(popup.bottom).toBeLessThanOrEqual(844 - 12);
  });

  it("respects an offset and shrunken visual viewport", () => {
    const scenario: Scenario = {
      outer: { top: 250, bottom: 350 },
      viewport: { top: 120, height: 500 },
      clip: null,
      mobile: false,
    };
    const placement = composerMenuPlacement(scenario);
    expect(placement.side).toBe("below");
    expect(placement.maxHeight).toBe(250);
    const popup = menuBox(scenario.outer, placement);
    expect(popup.top).toBeGreaterThanOrEqual(scenario.outer.bottom + COMPOSER_MENU_GAP);
    expect(popup.bottom).toBeLessThanOrEqual(120 + 500 - 12);
  });

  it("falls inline when neither side can afford the 140 minimum", () => {
    const scenario: Scenario = {
      outer: { top: 300, bottom: 500 },
      viewport: { top: 250, height: 200 },
      clip: { top: 250, bottom: 450 },
      mobile: true,
    };
    const placement = composerMenuPlacement(scenario);
    expect(placement.side).toBe("inline");
    expect(placement.maxHeight).toBe(140);
  });

  it("keeps the inline fallback capped at 220 in a full viewport", () => {
    const placement = composerMenuPlacement({
      outer: { top: 130, bottom: 700 },
      viewport: { top: 0, height: 844 },
      clip: null,
      mobile: false,
    });
    expect(placement.side).toBe("inline");
    expect(placement.maxHeight).toBe(220);
  });

  it("applies the mobile dock clearance below the visual viewport", () => {
    const scenario: Omit<Scenario, "mobile"> = {
      outer: { top: 120, bottom: 640 },
      viewport: { top: 0, height: 844 },
      clip: null,
    };
    expect(composerMenuPlacement({ ...scenario, mobile: true })).toEqual({
      side: "inline",
      maxHeight: 220,
    });
    expect(composerMenuPlacement({ ...scenario, mobile: false })).toEqual({
      side: "below",
      maxHeight: 184,
    });
  });

  it("never budgets an absolute popup beyond the room that exists", () => {
    const scenarios: Scenario[] = [
      resident,
      {
        outer: { top: 462, bottom: 620 },
        viewport: { top: 0, height: 844 },
        clip: { top: 185, bottom: 766 },
        mobile: true,
      },
      {
        outer: { top: 442, bottom: 570 },
        viewport: { top: 60, height: 600 },
        clip: { top: 100, bottom: 700 },
        mobile: true,
      },
    ];
    for (const scenario of scenarios) {
      const placement = composerMenuPlacement(scenario);
      expect(placement.side).not.toBe("inline");
      const popup = menuBox(scenario.outer, placement);
      if (placement.side === "above") {
        expect(popup.top).toBeGreaterThanOrEqual(
          Math.max(
            scenario.viewport.top + 64,
            (scenario.clip?.top ?? Number.NEGATIVE_INFINITY) + COMPOSER_MENU_GAP,
          ),
        );
      } else {
        expect(popup.bottom).toBeLessThanOrEqual(
          Math.min(
            scenario.viewport.top + scenario.viewport.height - 12,
            (scenario.clip?.bottom ?? Number.POSITIVE_INFINITY) - COMPOSER_MENU_GAP,
          ),
        );
      }
    }
  });
});

describe("clipping ancestor walk", () => {
  it("intersects nested scroll and clip bounds", () => {
    const canvas = box({ overflowY: "auto", top: 185, bottom: 766 });
    const pane = box({ overflowY: "scroll", top: 300, bottom: 700, parent: canvas });
    box({ top: 310, bottom: 690, parent: pane }); // visible wrapper, no clip
    const ancestors = composerMenuClippingAncestors(pane.firstElementChild);
    expect(ancestors).toEqual([pane, canvas]);
    expect(composerMenuClipBounds(ancestors)).toEqual({ top: 300, bottom: 700 });
  });

  it("respects scrolled positions through the ancestor rect", () => {
    // The canvas scrolled 60px down after the composer opened.
    const canvas = box({ overflowY: "auto", top: 125, bottom: 706 });
    expect(composerMenuClipBounds([canvas])).toEqual({ top: 125, bottom: 706 });
  });

  it("excludes the popup and its own scrolling list", () => {
    const shell = box({ overflowY: "auto", top: 0, bottom: 844 });
    const popup = box({ overflowY: "hidden", top: 75, bottom: 435, parent: shell });
    const list = box({ overflowY: "auto", top: 76, bottom: 434, parent: popup });
    expect(composerMenuClippingAncestors(list, popup)).toEqual([shell]);
    expect(composerMenuClippingAncestors(popup, popup)).toEqual([shell]);
  });

  it("treats only auto, scroll, hidden and clip as clipping", () => {
    const root = box({ top: 0, bottom: 844 });
    const scroll = box({ overflowY: "scroll", top: 10, bottom: 800, parent: root });
    const hidden = box({ overflowY: "hidden", top: 20, bottom: 700, parent: scroll });
    const clip = box({ overflowY: "clip", top: 30, bottom: 600, parent: hidden });
    const visible = box({ overflowY: "visible", top: 40, bottom: 500, parent: clip });
    expect(composerMenuClippingAncestors(visible)).toEqual([
      clip,
      hidden,
      scroll,
    ]);
    expect(composerMenuClipBounds([])).toBeNull();
  });
});
