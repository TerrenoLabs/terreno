import {LinearGradient} from "expo-linear-gradient";
import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  type LayoutChangeEvent,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import type {
  LoadingProps,
  SkeletonAnimation,
  SkeletonCardProps,
  SkeletonCircleProps,
  SkeletonGroupProps,
  SkeletonListProps,
  SkeletonProps,
  SkeletonTextProps,
} from "./Common";
import {getRounding, getSpacing} from "./Common";
// Primitives render plain Views rather than Box: Box renders these for its loading state, so
// importing Box here would create a cycle.
import {getTextFontSize} from "./Text";
import {useTheme} from "./Theme";
import {resolveTestID, toTestProps} from "./testing/resolveTestId";

const DEFAULT_ANIMATION: SkeletonAnimation = "pulse";
const PULSE_HALF_CYCLE_MS = 800;
const SHIMMER_CYCLE_MS = 1200;
const PULSE_MIN_OPACITY = 0.45;
const DEFAULT_LOADING_LABEL = "Loading";

// react-native-web drops pointerEvents from inline styles, so the overlay style lives here.
const styles = StyleSheet.create({
  shimmerOverlay: {
    bottom: 0,
    left: 0,
    pointerEvents: "none",
    position: "absolute",
    right: 0,
    top: 0,
  },
});

// Skeletons are decoration: the loading container announces the busy state, so each block hides
// itself from assistive tech instead of reading as a pile of empty views.
const HIDDEN_FROM_ACCESSIBILITY = {
  accessibilityElementsHidden: true,
  "aria-hidden": true,
  importantForAccessibility: "no-hide-descendants" as const,
};

interface SkeletonGroupContextValue {
  animation: SkeletonAnimation;
  progress: Animated.Value;
}

const SkeletonGroupContext = createContext<SkeletonGroupContextValue | undefined>(undefined);

// Web can read prefers-reduced-motion synchronously. Native has no synchronous API, so skeletons
// hold still until AccessibilityInfo answers rather than animating before the answer arrives.
const getInitialReducedMotion = (): boolean => {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return true;
};

const useReducedMotion = (): boolean => {
  const [isReducedMotion, setIsReducedMotion] = useState(getInitialReducedMotion);

  // Follow the OS reduce-motion setting so skeletons stop animating when the user asks for less motion.
  useEffect(() => {
    let isMounted = true;
    // Promise.resolve tolerates platforms and test doubles that return a plain value.
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.()).then((isEnabled) => {
      if (isMounted) {
        setIsReducedMotion(Boolean(isEnabled));
      }
    });
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (isEnabled) =>
      setIsReducedMotion(Boolean(isEnabled))
    );
    return () => {
      isMounted = false;
      subscription?.remove?.();
    };
  }, []);

  return isReducedMotion;
};

const buildLoop = (
  progress: Animated.Value,
  animation: SkeletonAnimation
): Animated.CompositeAnimation => {
  const useNativeDriver = Platform.OS !== "web";
  if (animation === "shimmer") {
    return Animated.loop(
      Animated.timing(progress, {duration: SHIMMER_CYCLE_MS, toValue: 1, useNativeDriver})
    );
  }
  return Animated.loop(
    Animated.sequence([
      Animated.timing(progress, {duration: PULSE_HALF_CYCLE_MS, toValue: 1, useNativeDriver}),
      Animated.timing(progress, {duration: PULSE_HALF_CYCLE_MS, toValue: 0, useNativeDriver}),
    ])
  );
};

const useAnimationLoop = ({
  animation,
  isEnabled,
  progress,
}: {
  animation: SkeletonAnimation;
  isEnabled: boolean;
  progress: Animated.Value;
}): void => {
  // Run one looping timeline per group (or per ungrouped skeleton) and stop it on unmount.
  useEffect(() => {
    if (!isEnabled || animation === "none") {
      return;
    }
    progress.setValue(0);
    const loop = buildLoop(progress, animation);
    loop.start();
    return () => loop.stop();
  }, [animation, isEnabled, progress]);
};

const useSkeletonMotion = (
  animationProp: SkeletonAnimation | undefined
): {animation: SkeletonAnimation; progress: Animated.Value} => {
  const group = useContext(SkeletonGroupContext);
  const isReducedMotion = useReducedMotion();
  const localProgress = useRef(new Animated.Value(0)).current;
  const requested = animationProp ?? group?.animation ?? DEFAULT_ANIMATION;
  const animation = isReducedMotion ? "none" : requested;
  const isSharingGroupTimeline = group !== undefined && group.animation === animation;

  useAnimationLoop({animation, isEnabled: !isSharingGroupTimeline, progress: localProgress});

  return {animation, progress: isSharingGroupTimeline ? group.progress : localProgress};
};

/**
 * Sets the animation for every skeleton inside it and drives them from one timeline, so a
 * screen of placeholders pulses together. Box and the other loading containers add one for you.
 */
export const SkeletonGroup: FC<SkeletonGroupProps> = ({animation, children}) => {
  const isReducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const resolvedAnimation = isReducedMotion ? "none" : (animation ?? DEFAULT_ANIMATION);

  useAnimationLoop({animation: resolvedAnimation, isEnabled: true, progress});

  const value = useMemo(
    () => ({animation: resolvedAnimation, progress}),
    [resolvedAnimation, progress]
  );

  return <SkeletonGroupContext.Provider value={value}>{children}</SkeletonGroupContext.Provider>;
};

const ShimmerHighlight: FC<{progress: Animated.Value; testID?: string}> = ({progress, testID}) => {
  const {colorScheme} = useTheme();
  const [width, setWidth] = useState(0);
  const highlight = colorScheme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.6)";
  // Fade to transparent white, not "transparent": Android reads that as transparent black and the
  // gradient would pass through a dark band.
  const edge = "rgba(255,255,255,0)";

  const onLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const translateX = progress.interpolate({inputRange: [0, 1], outputRange: [-width, width]});

  return (
    <View onLayout={onLayout} style={styles.shimmerOverlay} {...toTestProps(testID)}>
      {width > 0 && (
        <Animated.View style={{height: "100%", transform: [{translateX}], width}}>
          <LinearGradient
            colors={[edge, highlight, edge]}
            end={{x: 1, y: 0.5}}
            start={{x: 0, y: 0.5}}
            style={{height: "100%", width: "100%"}}
          />
        </Animated.View>
      )}
    </View>
  );
};

/**
 * A placeholder block in the shape of content that is still loading. Compose blocks to sketch
 * any layout; `SkeletonText`, `SkeletonCircle`, `SkeletonCard`, and `SkeletonList` cover the
 * common shapes.
 */
export const Skeleton: FC<SkeletonProps> = ({
  animation: animationProp,
  color = "neutralExtraLight",
  height = 16,
  rounding = "sm",
  testID,
  width = "100%",
}) => {
  const {theme} = useTheme();
  const {animation, progress} = useSkeletonMotion(animationProp);

  let borderRadius: number | string | undefined;
  if (rounding === "circle") {
    borderRadius = typeof height === "number" ? height / 2 : 9999;
  } else {
    borderRadius = getRounding(rounding);
  }

  const style = {
    backgroundColor: theme.surface[color],
    borderRadius,
    height,
    overflow: "hidden",
    width,
    ...(animation === "pulse"
      ? {
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, PULSE_MIN_OPACITY],
          }),
        }
      : {}),
  } as Animated.WithAnimatedValue<ViewStyle>;

  return (
    <Animated.View {...HIDDEN_FROM_ACCESSIBILITY} style={style} {...toTestProps(testID)}>
      {animation === "shimmer" && (
        <ShimmerHighlight progress={progress} testID={resolveTestID(testID, "shimmer")} />
      )}
    </Animated.View>
  );
};

/** Lines of placeholder text sized to match `Text` at the same `size`. */
export const SkeletonText: FC<SkeletonTextProps> = ({
  animation,
  lastLineWidth = "60%",
  lines = 3,
  size = "md",
  testID,
}) => {
  const fontSize = getTextFontSize(size);
  const lineCount = Math.max(1, Math.floor(lines));

  return (
    <View
      {...HIDDEN_FROM_ACCESSIBILITY}
      style={{gap: Math.round(fontSize / 2), width: "100%"}}
      {...toTestProps(testID)}
    >
      {Array.from({length: lineCount}, (_unused, index) => (
        <Skeleton
          animation={animation}
          height={fontSize}
          key={index}
          testID={resolveTestID(testID, `line.${index}`)}
          width={lineCount > 1 && index === lineCount - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </View>
  );
};

/** A round placeholder for avatars and icons. */
export const SkeletonCircle: FC<SkeletonCircleProps> = ({animation, size = 40, testID}) => {
  return (
    <Skeleton animation={animation} height={size} rounding="circle" testID={testID} width={size} />
  );
};

const SkeletonRow: FC<{
  animation?: SkeletonAnimation;
  lines: number;
  showAvatar: boolean;
  testID?: string;
}> = ({animation, lines, showAvatar, testID}) => {
  return (
    <View
      style={{alignItems: "flex-start", flexDirection: "row", gap: getSpacing(3), width: "100%"}}
      {...toTestProps(testID)}
    >
      {showAvatar && (
        <SkeletonCircle animation={animation} testID={resolveTestID(testID, "avatar")} />
      )}
      <View style={{flex: 1, gap: getSpacing(2), minWidth: 0}}>
        <Skeleton
          animation={animation}
          height={getTextFontSize("lg")}
          testID={resolveTestID(testID, "title")}
          width="40%"
        />
        {lines > 0 && (
          <SkeletonText
            animation={animation}
            lines={lines}
            testID={resolveTestID(testID, "text")}
          />
        )}
      </View>
    </View>
  );
};

/** A card-shaped placeholder: optional media, optional avatar, a title bar, and text lines. */
export const SkeletonCard: FC<SkeletonCardProps> = ({
  animation,
  lines = 2,
  mediaHeight = 160,
  showAvatar = true,
  showMedia = false,
  testID,
}) => {
  return (
    <View
      {...HIDDEN_FROM_ACCESSIBILITY}
      style={{gap: getSpacing(4), width: "100%"}}
      {...toTestProps(testID)}
    >
      {showMedia && (
        <Skeleton
          animation={animation}
          height={mediaHeight}
          rounding="md"
          testID={resolveTestID(testID, "media")}
        />
      )}
      <SkeletonRow
        animation={animation}
        lines={lines}
        showAvatar={showAvatar}
        testID={resolveTestID(testID, "body")}
      />
    </View>
  );
};

/** Repeated list-row placeholders, for lists and tables that are still fetching. */
export const SkeletonList: FC<SkeletonListProps> = ({
  animation,
  lines = 2,
  rows = 3,
  showAvatar = true,
  testID,
}) => {
  const rowCount = Math.max(1, Math.floor(rows));

  return (
    <View
      {...HIDDEN_FROM_ACCESSIBILITY}
      style={{gap: getSpacing(4), width: "100%"}}
      {...toTestProps(testID)}
    >
      {Array.from({length: rowCount}, (_unused, index) => (
        <SkeletonRow
          animation={animation}
          key={index}
          lines={lines}
          showAvatar={showAvatar}
          testID={resolveTestID(testID, `row.${index}`)}
        />
      ))}
    </View>
  );
};

/**
 * What a loading container renders: its children when not loading, otherwise its
 * `loadingComponent` (or the container's own default) inside a `SkeletonGroup`. Components that
 * accept `LoadingProps` use this so they all treat loading the same way.
 */
export const resolveLoadingContent = ({
  children,
  defaultLoadingComponent,
  loading,
  loadingAnimation,
  loadingComponent,
}: LoadingProps & {
  children?: ReactNode;
  defaultLoadingComponent?: ReactNode;
}): ReactNode => {
  if (!loading) {
    return children;
  }
  return (
    <SkeletonGroup animation={loadingAnimation}>
      {loadingComponent ?? defaultLoadingComponent ?? <SkeletonText />}
    </SkeletonGroup>
  );
};

/** Accessibility props a loading container sets so screen readers hear one busy announcement. */
export const getLoadingAccessibilityProps = ({
  loading,
  loadingLabel,
}: Pick<LoadingProps, "loading" | "loadingLabel">): {
  "aria-busy"?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: {busy: boolean};
} => {
  if (!loading) {
    return {};
  }
  return {
    accessibilityLabel: loadingLabel ?? DEFAULT_LOADING_LABEL,
    accessibilityState: {busy: true},
    "aria-busy": true,
  };
};
