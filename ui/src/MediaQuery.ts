import {Dimensions} from "react-native";

import {
  getBreakpointForWidth,
  getBreakpointSurface,
  isBreakpointAtLeast,
  isSupportedDesktopViewport,
  type ResponsiveBreakpoint,
} from "./ResponsiveBreakpoint";

export {
  type BreakpointSurface,
  getBreakpointForWidth,
  getBreakpointMinWidths,
  getBreakpointSurface,
  isBreakpointAtLeast,
  isSupportedDesktopViewport,
  isSupportedDesktopWidth,
  NATIVE_BREAKPOINT_MIN_WIDTH,
  type ResponsiveBreakpoint,
  WEB_BREAKPOINT_MIN_WIDTH,
} from "./ResponsiveBreakpoint";

export const mediaQuery = (): ResponsiveBreakpoint => {
  return getBreakpointForWidth(Dimensions.get("window").width);
};

export const mediaQueryLargerThan = (size: ResponsiveBreakpoint): boolean => {
  const media = mediaQuery();
  return isBreakpointAtLeast({breakpoint: media, minimum: size});
};

export const mediaQuerySmallerThan = (size: ResponsiveBreakpoint): boolean => {
  const media = mediaQuery();
  return !isBreakpointAtLeast({breakpoint: media, minimum: size}) || media === size;
};

/**
 * True when the current window is below the desktop breakpoint.
 * On web that floor is `lg` (1024). On native that floor is `xl`.
 * Reads the window size at call time and does not subscribe to resize.
 */
export const isNarrowViewport = (): boolean => {
  return !isSupportedDesktopViewport({
    breakpoint: mediaQuery(),
    surface: getBreakpointSurface(),
  });
};

/**
 * @deprecated Use `isNarrowViewport`. Supported while callers migrate.
 * Same result as `isNarrowViewport`.
 */
export const isMobileDevice = (): boolean => {
  return isNarrowViewport();
};
