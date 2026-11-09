import React, {useImperativeHandle, useRef} from "react";
import {
  type AccessibilityProps,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  type ScrollViewInstance,
  View,
  type ViewStyle,
} from "react-native";
import type {
  AlignContent,
  AlignItems,
  AlignSelf,
  BorderTheme,
  BoxProps,
  JustifyContent,
  NumberOrPercentage,
  Rounding,
  SignedUpTo12,
  SurfaceTheme,
} from "./Common";
import {getRounding, getSpacing} from "./Common";
import {
  isBreakpointAtLeast,
  type ResponsiveBreakpoint,
  useResponsiveBreakpoint,
} from "./ResponsiveBreakpoint";
import {getLoadingAccessibilityProps, resolveLoadingContent} from "./Skeleton";
import {useTheme} from "./Theme";
import {Unifier} from "./Unifier";

const ARIA_SELECTABLE_ROLES = new Set([
  "columnheader",
  "gridcell",
  "option",
  "row",
  "rowheader",
  "tab",
  "treeitem",
]);

/**
 * react-native-web turns `accessibilityState.selected` into `aria-selected`.
 * A button cannot have that attribute, so a clickable row keeps `aria-current`
 * only and drops `selected` from the state object on web.
 */
const omitSelectedState = (
  state: NonNullable<AccessibilityProps["accessibilityState"]>
): NonNullable<AccessibilityProps["accessibilityState"]> => {
  const {selected: _selected, ...rest} = state;
  return rest;
};

const ALIGN_CONTENT = {
  around: "space-around",
  between: "space-between",
  center: "center",
  end: "flex-end",
  start: "flex-start",
  stretch: "stretch",
};

const ALIGN_ITEMS = {
  baseline: "baseline",
  center: "center",
  end: "flex-end",
  start: "flex-start",
  stretch: "stretch",
};

const ALIGN_SELF = {
  around: "space-around",
  auto: "auto",
  baseline: "baseline",
  between: "space-between",
  center: "center",
  end: "flex-end",
  start: "flex-start",
  stretch: "stretch",
};

const BORDER_WIDTH = 1;

// react-native's Pressable does not type the web `onKeyDown` event, but React Native Web
// forwards it.
interface WebKeyDownEvent {
  key: string;
  preventDefault: () => void;
  repeat?: boolean;
}

interface WebKeyDownProps {
  onKeyDown?: (event: WebKeyDownEvent) => void;
}

const isValidPercentage = (value: string): boolean => {
  return /^\d+(\.\d+)?%$/.test(value);
};

const isValidWidthHeight = (value: number | string): boolean => {
  return typeof value === "number" || !Number.isNaN(Number(value)) || isValidPercentage(value);
};

/**
 * Box props that describe behavior rather than layout. Unknown props fall through
 * to the style object, so these have to be named explicitly: a callback or ref
 * object reaching a native view's style crashes on Fabric, which serializes style
 * (a ref holding a host instance is a cyclical structure) and freezes it in dev,
 * so React then throws detaching the frozen `ref.current` on unmount.
 */
const NON_STYLE_BOX_PROPS = new Set<string>([
  "accessibilityHint",
  "accessibilityLabel",
  "accessibilityLiveRegion",
  "accessibilityRole",
  "accessibilityState",
  "avoidKeyboard",
  "children",
  "dangerouslySetInlineStyle",
  "keyboardOffset",
  "loading",
  "loadingAnimation",
  "loadingComponent",
  "loadingLabel",
  "onClick",
  "onHoverEnd",
  "onHoverStart",
  "onLayout",
  "onScroll",
  "scroll",
  "scrollRef",
  "testID",
  "testIDs",
]);

const RESPONSIVE_DIRECTION_PROPS = [
  "smDirection",
  "mdDirection",
  "lgDirection",
  "xlDirection",
] as const;
const RESPONSIVE_DIRECTION_PROP_SET = new Set<string>(RESPONSIVE_DIRECTION_PROPS);

interface BoxStyleMap {
  [prop: string]: (
    value: unknown,
    all: Readonly<Record<string, unknown>>,
    breakpoint: ResponsiveBreakpoint
  ) => ViewStyle;
}

const boxStyleMapCache = new WeakMap<object, BoxStyleMap>();

const BoxComponent = React.forwardRef((props: BoxProps, ref) => {
  const {theme} = useTheme();
  const resolvedTestID = props.testID;
  const internalScrollRef = useRef<ScrollViewInstance>(null);
  const scrollRef = props.scrollRef ?? internalScrollRef;
  const hasResponsiveDirection = Boolean(
    props.smDirection || props.mdDirection || props.lgDirection || props.xlDirection
  );
  const breakpoint = useResponsiveBreakpoint({enabled: hasResponsiveDirection});

  useImperativeHandle(ref, () => ({
    scrollTo: (y: number) => {
      if (scrollRef?.current) {
        // HACK HACK HACK...but it works. Probably need to do some onContentSizeChange or onLayout
        // to avoid this, but it works well enough.
        setTimeout(() => {
          scrollRef?.current?.scrollTo({y});
        }, 50);
      }
    },
    scrollToEnd: () => {
      if (scrollRef?.current) {
        // HACK HACK HACK...but it works. Probably need to do some onContentSizeChange or onLayout
        // to avoid this, but it works well enough.
        setTimeout(() => {
          scrollRef?.current?.scrollToEnd();
        }, 50);
      }
    },
  }));

  let cachedBoxStyleMap = boxStyleMapCache.get(theme);
  if (!cachedBoxStyleMap) {
    cachedBoxStyleMap = {
      alignContent: (value: AlignContent) => ({alignContent: ALIGN_CONTENT[value]}),
      alignItems: (value: AlignItems) => ({alignItems: ALIGN_ITEMS[value]}),
      alignSelf: (value: AlignSelf) => ({alignSelf: ALIGN_SELF[value]}),
      border: (value: keyof BorderTheme) => {
        if (!value) {
          return {};
        }
        return {borderColor: theme.border[value], borderWidth: BORDER_WIDTH};
      },
      borderBottom: (value: keyof BorderTheme) => {
        if (!value) {
          return {};
        }
        return {borderBottomColor: theme.border[value], borderBottomWidth: BORDER_WIDTH};
      },
      borderLeft: (value: keyof BorderTheme) => {
        if (!value) {
          return {};
        }
        return {borderLeftColor: theme.border[value], borderLeftWidth: BORDER_WIDTH};
      },
      borderRight: (value: keyof BorderTheme) => {
        if (!value) {
          return {};
        }
        return {borderRightColor: theme.border[value], borderRightWidth: BORDER_WIDTH};
      },
      borderTop: (value: keyof BorderTheme) => {
        if (!value) {
          return {};
        }
        return {borderTopColor: theme.border[value], borderTopWidth: BORDER_WIDTH};
      },
      bottom: (bottom) => ({bottom: bottom ? 0 : undefined}),
      color: (value: keyof SurfaceTheme) => ({backgroundColor: theme.surface[value]}),
      direction: (value: "row" | "column") => ({display: "flex", flexDirection: value}),
      display: (value: "none" | "flex" | "block" | "inlineBlock" | "visuallyHidden") => {
        if (value === "none") {
          return {display: "none"};
        }
        return value === "flex" ? {flex: undefined} : {flex: 0, flexDirection: "row"};
      },
      flex: (value: string) => {
        if (value === "grow") {
          return {display: "flex", flexGrow: 1, flexShrink: 1};
        } else if (value === "shrink") {
          return {display: "flex", flexShrink: 1};
        } else {
          return {display: "flex", flex: 0};
        }
      },
      gap: (value) => ({gap: getSpacing(value as SignedUpTo12)}),
      height: (value, allProps) => {
        if (!isValidWidthHeight(value as NumberOrPercentage)) {
          console.warn(
            `Box: height prop must be a number or percentage string (e.g., "50%"), received: ${value}`
          );
          return {};
        }
        const heightValue = value as NumberOrPercentage;
        if (allProps.border && !Number.isNaN(Number(heightValue))) {
          return {height: Number(heightValue) + 2 * 2};
        }
        return {height: heightValue};
      },
      justifyContent: (value: JustifyContent) => ({justifyContent: ALIGN_CONTENT[value]}),
      left: (left) => ({left: left ? 0 : undefined}),
      lgDirection: (value: "row" | "column", _allProps, responsiveBreakpoint) =>
        isBreakpointAtLeast({breakpoint: responsiveBreakpoint, minimum: "lg"})
          ? {display: "flex", flexDirection: value}
          : {},
      margin: (value) => ({margin: getSpacing(value as SignedUpTo12)}),
      marginBottom: (value) => ({marginBottom: getSpacing(value as SignedUpTo12)}),
      marginLeft: (value) => ({marginLeft: getSpacing(value as SignedUpTo12)}),
      marginRight: (value) => ({marginRight: getSpacing(value as SignedUpTo12)}),
      marginTop: (value) => ({marginTop: getSpacing(value as SignedUpTo12)}),
      maxHeight: (value) => {
        if (!isValidWidthHeight(value as NumberOrPercentage)) {
          console.warn(
            `Box: maxHeight prop must be a number or percentage string (e.g., "50%"), received: ${value}`
          );
          return {};
        }
        return {maxHeight: value as NumberOrPercentage};
      },
      maxWidth: (value) => {
        if (!isValidWidthHeight(value as NumberOrPercentage)) {
          console.warn(
            `Box: maxWidth prop must be a number or percentage string (e.g., "50%"), received: ${value}`
          );
          return {};
        }
        return {maxWidth: value as NumberOrPercentage};
      },
      mdDirection: (value: "row" | "column", _allProps, responsiveBreakpoint) =>
        isBreakpointAtLeast({breakpoint: responsiveBreakpoint, minimum: "md"})
          ? {display: "flex", flexDirection: value}
          : {},
      minHeight: (value) => {
        if (!isValidWidthHeight(value as NumberOrPercentage)) {
          console.warn(
            `Box: minHeight prop must be a number or percentage string (e.g., "50%"), received: ${value}`
          );
          return {};
        }
        return {minHeight: value as NumberOrPercentage};
      },
      minWidth: (value) => {
        if (!isValidWidthHeight(value as NumberOrPercentage)) {
          console.warn(
            `Box: minWidth prop must be a number or percentage string (e.g., "50%"), received: ${value}`
          );
          return {};
        }
        return {minWidth: value as NumberOrPercentage};
      },
      overflow: (value) => {
        if (value === "scrollY" || value === "scroll") {
          return {overflow: "scroll"};
        }
        return {overflow: value};
      },
      padding: (value) => ({padding: getSpacing(value as SignedUpTo12)}),
      paddingX: (value) => ({
        paddingLeft: getSpacing(value as SignedUpTo12),
        paddingRight: getSpacing(value as SignedUpTo12),
      }),
      paddingY: (value) => ({
        paddingBottom: getSpacing(value as SignedUpTo12),
        paddingTop: getSpacing(value as SignedUpTo12),
      }),
      position: (value) => ({position: value}),
      right: (right) => ({right: right ? 0 : undefined}),
      rounding: (rounding, allProps) => {
        if (rounding === "circle") {
          if (!allProps.height && !allProps.width) {
            console.warn("Cannot use Box rounding='circle' without height or width.");
            return {borderRadius: undefined};
          }
          return {borderRadius: (allProps.height ?? allProps.width) as NumberOrPercentage};
        }

        if (rounding) {
          return {borderRadius: getRounding(rounding as Rounding)};
        }

        return {borderRadius: undefined};
      },
      shadow: (value) => {
        if (!value) {
          return {};
        }
        if (Platform.OS === "ios" || Platform.OS === "web") {
          return {
            boxShadow: "2px 2px 2px rgba(153, 153, 153, 1.0)",
          };
        } else {
          return {elevation: 4};
        }
      },
      smDirection: (value: "row" | "column", _allProps, responsiveBreakpoint) =>
        isBreakpointAtLeast({breakpoint: responsiveBreakpoint, minimum: "sm"})
          ? {display: "flex", flexDirection: value}
          : {},
      top: (top) => ({top: top ? 0 : undefined}),
      width: (value, allProps) => {
        if (!isValidWidthHeight(value as NumberOrPercentage)) {
          console.warn(
            `Box: width prop must be a number or percentage string (e.g., "50%"), received: ${value}`
          );
          return {};
        }
        const widthValue = value as NumberOrPercentage;
        if (allProps.border && !Number.isNaN(Number(widthValue))) {
          return {width: Number(widthValue) + 2 * 2};
        }
        return {width: widthValue};
      },
      // Defaults to alignItems: "flex-start" so wrapped lines size to their content instead of
      // stretching, but never overrides an explicit alignItems (prop order would decide the winner).
      wrap: (value, allProps) => ({
        alignItems: allProps.alignItems
          ? ALIGN_ITEMS[allProps.alignItems as AlignItems]
          : "flex-start",
        flexWrap: value ? "wrap" : "nowrap",
      }),
      xlDirection: (value: "row" | "column", _allProps, responsiveBreakpoint) =>
        isBreakpointAtLeast({breakpoint: responsiveBreakpoint, minimum: "xl"})
          ? {display: "flex", flexDirection: value}
          : {},
      zIndex: (value) => ({
        zIndex: typeof value === "number" || value === "auto" ? value : undefined,
      }),
    } as BoxStyleMap;
    boxStyleMapCache.set(theme, cachedBoxStyleMap);
  }
  const boxStyleMap = cachedBoxStyleMap;

  const propsAsRecord = props as Readonly<Record<string, unknown>>;

  const propsToStyle = (): ViewStyle => {
    let style: ViewStyle = {};
    for (const prop of Object.keys(props) as Array<keyof typeof props>) {
      const value = props[prop];
      if (RESPONSIVE_DIRECTION_PROP_SET.has(prop as string)) {
        continue;
      }
      if (boxStyleMap[prop]) {
        Object.assign(style, boxStyleMap[prop](value, propsAsRecord, breakpoint));
      } else if (!NON_STYLE_BOX_PROPS.has(prop as string)) {
        (style as Record<string, unknown>)[prop as string] = value;
        // console.warn(`Box: unknown property ${prop}`);
      }
    }

    // Responsive direction specificity is deterministic and independent of JSX prop order.
    for (const responsiveProp of RESPONSIVE_DIRECTION_PROPS) {
      const responsiveValue = props[responsiveProp];
      if (responsiveValue) {
        Object.assign(
          style,
          boxStyleMap[responsiveProp](responsiveValue, propsAsRecord, breakpoint)
        );
      }
    }

    // Finally, dangerously set overrides.
    if (props.dangerouslySetInlineStyle) {
      style = {...style, ...(props.dangerouslySetInlineStyle.__style as ViewStyle)};
    }

    return style;
  };

  const boxStyle = propsToStyle();

  const onHoverIn = async () => {
    await props.onHoverStart?.();
  };

  const onHoverOut = async () => {
    await props.onHoverEnd?.();
  };

  let box: React.ReactElement;

  const isLoading = props.loading === true;
  const children = resolveLoadingContent({
    children: props.children,
    loading: isLoading,
    loadingAnimation: props.loadingAnimation,
    loadingComponent: props.loadingComponent,
  });
  const loadingAccessibilityProps = getLoadingAccessibilityProps({
    loading: isLoading,
    loadingLabel: props.loadingLabel,
  });

  const accessibilityState =
    props.accessibilityState || isLoading
      ? {...props.accessibilityState, ...loadingAccessibilityProps.accessibilityState}
      : undefined;
  const accessibilityRoleProp = (props as AccessibilityProps).accessibilityRole;
  // ARIA allows aria-selected only on selectable roles. Any other Box, such as a clickable
  // list row (a button), marks the selected item with aria-current instead.
  const sendsAriaSelected = ARIA_SELECTABLE_ROLES.has(accessibilityRoleProp ?? "");
  const selectedAriaProps =
    accessibilityState?.selected === undefined
      ? {}
      : sendsAriaSelected
        ? {"aria-selected": accessibilityState.selected}
        : {"aria-current": accessibilityState.selected ? ("true" as const) : undefined};
  const hostAccessibilityState =
    accessibilityState &&
    Platform.OS === "web" &&
    accessibilityState.selected !== undefined &&
    !sendsAriaSelected
      ? omitSelectedState(accessibilityState)
      : accessibilityState;
  const accessibilityStateProps = accessibilityState
    ? {
        ...(hostAccessibilityState && Object.keys(hostAccessibilityState).length > 0
          ? {accessibilityState: hostAccessibilityState}
          : {}),
        ...(accessibilityState.checked !== undefined
          ? {"aria-checked": accessibilityState.checked}
          : {}),
        ...(accessibilityState.disabled !== undefined
          ? {"aria-disabled": accessibilityState.disabled}
          : {}),
        ...selectedAriaProps,
        ...(accessibilityState.busy !== undefined ? {"aria-busy": accessibilityState.busy} : {}),
      }
    : {};

  // Adding the accessibilityRole of button throws a warning in React Native since we nest buttons
  // within Box and RN does not support nested buttons — so this stays on `aria-role` (which RN
  // itself translates to accessibilityRole under the hood) by default; an explicit
  // `accessibilityRole` prop is only forwarded literally when the caller opts in.
  if (props.onClick) {
    const explicitAccessibilityRole = accessibilityRoleProp;
    // Content is not there yet while loading, so presses are held until it is.
    const isDisabled = accessibilityState?.disabled === true || isLoading;
    // Per ARIA, Space toggles a checkbox or switch; react-native-web only maps Space to buttons.
    const toggleKeyDownProps: WebKeyDownProps =
      explicitAccessibilityRole === "checkbox" || explicitAccessibilityRole === "switch"
        ? {
            onKeyDown: (event) => {
              if (event.key !== " " && event.key !== "Spacebar") {
                return;
              }
              event.preventDefault();
              if (isDisabled || event.repeat) {
                return;
              }
              void props.onClick?.();
            },
          }
        : {};
    box = (
      <Pressable
        // RN 0.88 types `onKeyDown` with a native event that has no `key`; RNW passes the DOM event.
        {...(toggleKeyDownProps as object)}
        accessibilityHint={(props as AccessibilityProps).accessibilityHint}
        {...(explicitAccessibilityRole
          ? {accessibilityRole: explicitAccessibilityRole as never}
          : {})}
        {...accessibilityStateProps}
        aria-label={
          loadingAccessibilityProps.accessibilityLabel ??
          (props as AccessibilityProps).accessibilityLabel
        }
        aria-role="button"
        {...(isDisabled ? {disabled: true} : {})}
        onLayout={props.onLayout}
        onPointerEnter={onHoverIn}
        onPointerLeave={onHoverOut}
        onPress={async () => {
          if (isDisabled) {
            return;
          }
          await Unifier.utils.haptic();
          await props.onClick?.();
        }}
        style={boxStyle}
        testID={resolvedTestID ? `${resolvedTestID}-clickable` : undefined}
      >
        {children}
      </Pressable>
    );
  } else {
    const accessibilityHint = (props as AccessibilityProps).accessibilityHint;
    const accessibilityLabel =
      loadingAccessibilityProps.accessibilityLabel ??
      (props as AccessibilityProps).accessibilityLabel;
    box = (
      <View
        {...(accessibilityHint ? {accessibilityHint} : {})}
        {...(accessibilityLabel ? {accessibilityLabel} : {})}
        {...(props.accessibilityLiveRegion ? {"aria-live": props.accessibilityLiveRegion} : {})}
        {...accessibilityStateProps}
        {...(props.onLayout ? {onLayout: props.onLayout} : {})}
        onPointerEnter={onHoverIn}
        onPointerLeave={onHoverOut}
        style={boxStyle}
        testID={resolvedTestID}
      >
        {children}
      </View>
    );
  }

  if (props.scroll) {
    const {justifyContent, alignContent, alignItems, ...scrollStyle} = boxStyle;

    box = (
      <ScrollView
        contentContainerStyle={{alignContent, alignItems, justifyContent}}
        horizontal={props.overflow === "scrollX"}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onScroll={(event) => {
          if (props.onScroll && event) {
            props.onScroll(event.nativeEvent.contentOffset.y);
          }
        }}
        ref={props.scrollRef || scrollRef}
        scrollEventThrottle={50}
        style={scrollStyle}
      >
        {box}
      </ScrollView>
    );
  }

  if (props.avoidKeyboard) {
    box = (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={props.keyboardOffset}
        style={{display: "flex", flex: 1}}
      >
        <SafeAreaView style={{display: "flex", flex: 1}}>{box}</SafeAreaView>
      </KeyboardAvoidingView>
    );
  }
  return box;
});

BoxComponent.displayName = "Box";

export const Box = React.memo(BoxComponent);
