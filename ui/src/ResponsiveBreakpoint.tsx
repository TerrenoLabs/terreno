import {useSyncExternalStore} from "react";
import {Dimensions, Platform} from "react-native";

export type ResponsiveBreakpoint = "xs" | "sm" | "md" | "lg" | "xl";
export type BreakpointSurface = "native" | "web";

interface UseResponsiveBreakpointOptions {
  enabled?: boolean;
  store?: ResponsiveBreakpointStore;
}

interface CreateResponsiveBreakpointStoreOptions {
  getSurface?: () => BreakpointSurface;
  getWindowWidth: () => number;
  subscribeToDimensions: (listener: (width: number) => void) => {remove: () => void};
}

interface ResponsiveDimensionsSource {
  addEventListener: (
    eventType: "change",
    listener: (event: {window: {width: number}}) => void
  ) => {remove: () => void};
  get: (dimension: "window") => {width: number};
}

export interface ResponsiveBreakpointStore {
  getServerSnapshot: () => ResponsiveBreakpoint;
  getSnapshot: () => ResponsiveBreakpoint;
  subscribe: (subscriber: () => void) => () => void;
  updateWidth: (width: number) => void;
}

export const NATIVE_BREAKPOINT_MIN_WIDTH = {
  lg: 600,
  md: 375,
  sm: 320,
  xl: 1024,
} as const;

export const WEB_BREAKPOINT_MIN_WIDTH = {
  lg: 1024,
  md: 375,
  sm: 320,
  xl: 1280,
} as const;

const BREAKPOINT_ORDER: Record<ResponsiveBreakpoint, number> = {
  lg: 3,
  md: 2,
  sm: 1,
  xl: 4,
  xs: 0,
};

export const getBreakpointSurface = (os: string = Platform.OS): BreakpointSurface => {
  if (os === "web") {
    return "web";
  }
  return "native";
};

export interface BreakpointMinWidths {
  lg: number;
  md: number;
  sm: number;
  xl: number;
}

export const getBreakpointMinWidths = (surface: BreakpointSurface): BreakpointMinWidths => {
  if (surface === "web") {
    return WEB_BREAKPOINT_MIN_WIDTH;
  }
  return NATIVE_BREAKPOINT_MIN_WIDTH;
};

export const isBreakpointAtLeast = ({
  breakpoint,
  minimum,
}: {
  breakpoint: ResponsiveBreakpoint;
  minimum: ResponsiveBreakpoint;
}): boolean => {
  return BREAKPOINT_ORDER[breakpoint] >= BREAKPOINT_ORDER[minimum];
};

export const getBreakpointForWidth = (
  width: number,
  surface: BreakpointSurface = getBreakpointSurface()
): ResponsiveBreakpoint => {
  const mins = getBreakpointMinWidths(surface);
  if (width < mins.sm) {
    return "xs";
  }
  if (width < mins.md) {
    return "sm";
  }
  if (width < mins.lg) {
    return "md";
  }
  if (width < mins.xl) {
    return "lg";
  }
  return "xl";
};

export const isSupportedDesktopViewport = ({
  breakpoint,
  surface,
}: {
  breakpoint: ResponsiveBreakpoint;
  surface: BreakpointSurface;
}): boolean => {
  if (surface === "web") {
    return isBreakpointAtLeast({breakpoint, minimum: "lg"});
  }
  return isBreakpointAtLeast({breakpoint, minimum: "xl"});
};

/** True when `width` is at or above the desktop floor for `surface` (web `lg`, native `xl`). */
export const isSupportedDesktopWidth = ({
  surface = getBreakpointSurface(),
  width,
}: {
  surface?: BreakpointSurface;
  width: number;
}): boolean => {
  return isSupportedDesktopViewport({
    breakpoint: getBreakpointForWidth(width, surface),
    surface,
  });
};

const getServerBreakpointSnapshot = (): ResponsiveBreakpoint => {
  return "xs";
};

export const createResponsiveBreakpointStore = ({
  getSurface = getBreakpointSurface,
  getWindowWidth,
  subscribeToDimensions,
}: CreateResponsiveBreakpointStoreOptions): ResponsiveBreakpointStore => {
  const subscribers = new Set<() => void>();
  let currentWindowWidth = getWindowWidth();
  let dimensionSubscription: {remove: () => void} | undefined;

  const updateWidth = (width: number): void => {
    if (width === currentWindowWidth) {
      return;
    }
    currentWindowWidth = width;
    for (const notifySubscriber of subscribers) {
      notifySubscriber();
    }
  };

  const subscribe = (subscriber: () => void): (() => void) => {
    subscribers.add(subscriber);

    if (!dimensionSubscription) {
      dimensionSubscription = subscribeToDimensions(updateWidth);
      updateWidth(getWindowWidth());
    }

    return (): void => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        dimensionSubscription?.remove();
        dimensionSubscription = undefined;
      }
    };
  };

  return {
    getServerSnapshot: getServerBreakpointSnapshot,
    getSnapshot: (): ResponsiveBreakpoint =>
      getBreakpointForWidth(currentWindowWidth, getSurface()),
    subscribe,
    updateWidth,
  };
};

export const createNativeResponsiveBreakpointStore = (
  dimensions: ResponsiveDimensionsSource
): ResponsiveBreakpointStore => {
  return createResponsiveBreakpointStore({
    getWindowWidth: (): number => dimensions.get("window").width,
    subscribeToDimensions: (listener): {remove: () => void} =>
      dimensions.addEventListener("change", ({window}): void => {
        listener(window.width);
      }),
  });
};

export const sharedResponsiveBreakpointStore = createNativeResponsiveBreakpointStore(Dimensions);

const subscribeToNothing = (): (() => void) => {
  return (): void => {};
};

export const useResponsiveBreakpoint = ({
  enabled = true,
  store = sharedResponsiveBreakpointStore,
}: UseResponsiveBreakpointOptions = {}): ResponsiveBreakpoint => {
  return useSyncExternalStore(
    enabled ? store.subscribe : subscribeToNothing,
    store.getSnapshot,
    store.getServerSnapshot
  );
};
