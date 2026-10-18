/**
 * Positioning math for `DropdownPanel`. Kept free of React and React Native so the
 * clipping rules (right-align on overflow, viewport clamp, flip above) can be unit
 * tested directly on both platforms.
 */

/** Trigger box in window coordinates, as returned by `measureInWindow`. */
export interface DropdownPanelAnchor {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * `start` pins the panel's left edge to the trigger, `end` pins its right edge, and
 * `auto` starts left-aligned and flips to right-aligned when the panel would run past
 * the right edge of the viewport.
 */
export type DropdownPanelAlign = "auto" | "start" | "end";

export interface DropdownPanelLayoutInput {
  align?: DropdownPanelAlign;
  anchor: DropdownPanelAnchor;
  /** Space between the trigger and the panel. */
  gap?: number;
  /** Caller-supplied ceiling, applied on top of the space available on screen. */
  maxPanelHeight?: number;
  panelWidth: number;
  /** Minimum space kept between the panel and every viewport edge. */
  screenMargin?: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface DropdownPanelLayout {
  /** Set instead of `top` when the panel is flipped above the trigger. */
  bottom?: number;
  left: number;
  maxHeight: number;
  placement: "above" | "below";
  top?: number;
  /**
   * Requested panel width, shrunk to what fits between the screen margins. Moving a
   * panel that is wider than the viewport cannot keep it on screen, so it narrows.
   */
  width: number;
}

export const DROPDOWN_PANEL_GAP = 4;
export const DROPDOWN_PANEL_SCREEN_MARGIN = 8;
/**
 * A panel shorter than this is unusable, so a cramped viewport gets a scrolling panel
 * rather than a squashed one.
 */
export const DROPDOWN_PANEL_MIN_HEIGHT = 160;

const clampLeft = ({
  left,
  panelWidth,
  screenMargin,
  viewportWidth,
}: {
  left: number;
  panelWidth: number;
  screenMargin: number;
  viewportWidth: number;
}): number => {
  const maxLeft = viewportWidth - panelWidth - screenMargin;
  // A panel wider than the viewport can only honour the left margin.
  if (maxLeft <= screenMargin) {
    return screenMargin;
  }
  return Math.max(screenMargin, Math.min(left, maxLeft));
};

/**
 * Resolves where an open dropdown panel should sit relative to its trigger.
 *
 * The panel is anchored to the trigger, kept inside the viewport on both axes, and
 * flipped above the trigger when the space below is too small to use.
 */
export const computeDropdownPanelLayout = ({
  align = "auto",
  anchor,
  gap = DROPDOWN_PANEL_GAP,
  maxPanelHeight,
  panelWidth,
  screenMargin = DROPDOWN_PANEL_SCREEN_MARGIN,
  viewportHeight,
  viewportWidth,
}: DropdownPanelLayoutInput): DropdownPanelLayout => {
  // Everything downstream positions the panel at the width it will actually render at,
  // so a panel too wide for the viewport narrows instead of running past the margin.
  const availableWidth = viewportWidth - screenMargin * 2;
  const width = availableWidth > 0 ? Math.min(panelWidth, availableWidth) : panelWidth;

  const startLeft = anchor.x;
  const endLeft = anchor.x + anchor.width - width;
  const overflowsRight = startLeft + width > viewportWidth - screenMargin;

  let desiredLeft = startLeft;
  if (align === "end" || (align === "auto" && overflowsRight)) {
    desiredLeft = endLeft;
  }

  const left = clampLeft({left: desiredLeft, panelWidth: width, screenMargin, viewportWidth});

  const belowTop = anchor.y + anchor.height + gap;
  const spaceBelow = viewportHeight - belowTop - screenMargin;
  const spaceAbove = anchor.y - gap - screenMargin;
  const flipAbove = spaceBelow < DROPDOWN_PANEL_MIN_HEIGHT && spaceAbove > spaceBelow;

  const available = Math.max(
    flipAbove ? spaceAbove : spaceBelow,
    Math.min(DROPDOWN_PANEL_MIN_HEIGHT, viewportHeight)
  );
  const maxHeight = maxPanelHeight === undefined ? available : Math.min(maxPanelHeight, available);

  if (flipAbove) {
    return {
      bottom: Math.max(screenMargin, viewportHeight - anchor.y + gap),
      left,
      maxHeight,
      placement: "above",
      width,
    };
  }

  return {left, maxHeight, placement: "below", top: belowTop, width};
};
