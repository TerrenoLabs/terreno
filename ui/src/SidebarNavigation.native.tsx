import {Navigator, Slot} from "expo-router";
// Screen is not exported from expo-router's public API (exports.d.ts only exposes ScreenProps).
// Stack.Screen and Tabs.Screen use this same internal path. If expo-router upgrades break this,
// update the import path here — this is the only place in the codebase that references it.
// eslint-disable-next-line import/no-internal-modules
import {Screen} from "expo-router/build/views/Screen";
import {TabRouter} from "expo-router/react-navigation";
import {type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  Text as RNText,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";

import type {
  SidebarBadgeStatus,
  SidebarNavigationItem,
  SidebarNavigationPanelProps,
  SidebarNavigationProps,
  SurfaceTheme,
} from "./Common";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useTheme} from "./Theme";

const ITEM_HEIGHT = 44;
const BACKDROP_OPACITY = 0.5;

const SIDEBAR_BADGE_SURFACE: Record<SidebarBadgeStatus, keyof SurfaceTheme> = {
  error: "error",
  info: "secondaryDark",
  neutral: "neutralDark",
  success: "success",
  warning: "warning",
};

const SidebarBadge: FC<{badge: number | true; status: SidebarBadgeStatus}> = ({badge, status}) => {
  const {theme} = useTheme();
  const backgroundColor = theme.surface[SIDEBAR_BADGE_SURFACE[status]];
  const isDot = badge === true;

  if (isDot) {
    return <View style={{backgroundColor, borderRadius: 999, height: 18, width: 18}} />;
  }

  const value = Number(badge) > 9 ? "9+" : String(badge);

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor,
        borderRadius: 999,
        height: 18,
        justifyContent: "center",
        minWidth: 18,
        paddingHorizontal: 4,
      }}
    >
      <RNText
        style={{
          color: "#FFFFFF",
          fontSize: 11,
          fontWeight: "700",
          lineHeight: 12,
        }}
      >
        {value}
      </RNText>
    </View>
  );
};

const ANIMATION_DURATION = 300;
const DISMISS_THRESHOLD = 0.3;

const SidebarItem: FC<{
  item: SidebarNavigationItem;
  isActive: boolean;
  onPress: (route: string) => void;
  itemStyle?: StyleProp<ViewStyle>;
}> = ({item, isActive, onPress, itemStyle}) => {
  const {theme} = useTheme();

  const handlePress = useCallback(() => {
    onPress(item.route);
  }, [onPress, item.route]);

  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      onPress={handlePress}
      style={[
        {
          alignItems: "center",
          backgroundColor: isActive ? theme.surface.neutralLight : "transparent",
          borderRadius: theme.radius.default,
          flexDirection: "row",
          gap: 12,
          height: ITEM_HEIGHT,
          marginHorizontal: 8,
          paddingHorizontal: 12,
        },
        itemStyle,
      ]}
    >
      <View style={{alignItems: "center", height: 40, justifyContent: "center", width: 40}}>
        <Icon color={isActive ? "primary" : "secondaryLight"} iconName={item.iconName} size="xl" />
        {item.badge !== undefined && item.badge !== false && (
          <View style={{bottom: 0, position: "absolute", right: 0}}>
            <SidebarBadge badge={item.badge} status={item.badgeStatus ?? "success"} />
          </View>
        )}
      </View>
      <Text bold={isActive} color={isActive ? "primary" : "secondaryLight"} size="lg">
        {item.label}
      </Text>
    </Pressable>
  );
};

const SidebarHamburger: FC<{onOpen: () => void}> = ({onOpen}) => (
  <Pressable
    accessibilityLabel="Open navigation menu"
    accessibilityRole="button"
    onPress={onOpen}
    style={{alignItems: "center", height: 40, justifyContent: "center", width: 40}}
  >
    <Icon color="primary" iconName="bars" size="md" />
  </Pressable>
);

/**
 * Renders the bottom sheet overlay and children. Works without expo-router Navigator context.
 *
 * Supports two modes:
 * - Uncontrolled (default): manages open state internally and shows a floating hamburger button.
 * - Controlled: caller provides isOpen + onOpenChange and owns the trigger (e.g. a header button).
 */
export const SidebarNavigationPanel: FC<SidebarNavigationPanelProps> = ({
  topItems,
  bottomItems,
  activeRoute,
  onNavigate,
  children,
  panelStyle,
  itemStyle,
  isOpen: isOpenProp,
  onOpenChange,
}) => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const isControlled = isOpenProp !== undefined;
  const [isOpenInternal, setIsOpenInternal] = useState(false);
  const isOpen = isControlled ? isOpenProp : isOpenInternal;

  const sheetHeight = useMemo(() => Dimensions.get("window").height * 0.65, []);
  const slideAnim = useRef(new Animated.Value(sheetHeight)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const capturedSlideValue = useRef(0);

  // Play open animation whenever isOpen becomes true
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    slideAnim.setValue(sheetHeight);
    backdropAnim.setValue(0);
    Animated.parallel([
      Animated.timing(slideAnim, {
        duration: ANIMATION_DURATION,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        duration: ANIMATION_DURATION,
        toValue: BACKDROP_OPACITY,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isOpen, slideAnim, backdropAnim, sheetHeight]);

  // Play close animation then update state
  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        duration: ANIMATION_DURATION,
        toValue: sheetHeight,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        duration: ANIMATION_DURATION,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (isControlled) {
        onOpenChange?.(false);
      } else {
        setIsOpenInternal(false);
      }
    });
  }, [isControlled, onOpenChange, slideAnim, backdropAnim, sheetHeight]);

  const handleOpen = useCallback(() => {
    if (isControlled) {
      onOpenChange?.(true);
    } else {
      setIsOpenInternal(true);
    }
  }, [isControlled, onOpenChange]);

  const handleNavigate = useCallback(
    (route: string) => {
      handleClose();
      onNavigate(route);
    },
    [handleClose, onNavigate]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, {dx, dy}) => Math.abs(dy) > Math.abs(dx) && dy > 4,
        onPanResponderGrant: () => {
          slideAnim.stopAnimation((value) => {
            capturedSlideValue.current = value;
          });
          backdropAnim.stopAnimation();
        },
        onPanResponderMove: (_, {dy}) => {
          const next = capturedSlideValue.current + dy;
          if (next < 0) {
            return;
          }
          slideAnim.setValue(next);
          backdropAnim.setValue(BACKDROP_OPACITY * Math.max(0, 1 - next / sheetHeight));
        },
        onPanResponderRelease: (_, {dy, vy}) => {
          if (dy > sheetHeight * DISMISS_THRESHOLD || vy > 0.5) {
            handleClose();
          } else {
            Animated.parallel([
              Animated.timing(slideAnim, {
                duration: 200,
                toValue: 0,
                useNativeDriver: true,
              }),
              Animated.timing(backdropAnim, {
                duration: 200,
                toValue: BACKDROP_OPACITY,
                useNativeDriver: true,
              }),
            ]).start();
          }
        },
      }),
    [slideAnim, backdropAnim, sheetHeight, handleClose]
  );

  return (
    <View style={{flex: 1}}>
      {children}

      {/* Floating hamburger — only shown in uncontrolled (standalone) mode */}
      {!isControlled && (
        <Pressable
          accessibilityLabel="Open navigation menu"
          accessibilityRole="button"
          onPress={handleOpen}
          style={{
            alignItems: "center",
            height: 44,
            justifyContent: "center",
            left: 16,
            position: "absolute",
            top: insets.top + 16,
            width: 44,
            zIndex: 10,
          }}
        >
          <Icon color="primary" iconName="bars" size="md" />
        </Pressable>
      )}

      {isOpen && (
        <>
          {/* Backdrop */}
          <Pressable
            accessibilityElementsHidden
            onPress={handleClose}
            style={{bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 100}}
          >
            <Animated.View style={{backgroundColor: "#000", flex: 1, opacity: backdropAnim}} />
          </Pressable>

          {/* Bottom sheet */}
          <Animated.View
            style={[
              {
                backgroundColor: theme.surface.base,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                bottom: 0,
                height: sheetHeight,
                left: 0,
                position: "absolute",
                right: 0,
                transform: [{translateY: slideAnim}],
                zIndex: 200,
              },
              panelStyle,
            ]}
          >
            {/* Drag bar */}
            <View
              {...panResponder.panHandlers}
              accessibilityHint="Drag down to close"
              accessibilityLabel="Navigation menu drag handle"
              accessibilityRole="adjustable"
              style={{alignItems: "center", paddingBottom: 8, paddingTop: 12}}
            >
              <View
                style={{
                  backgroundColor: theme.border.default,
                  borderRadius: 2,
                  height: 4,
                  width: 36,
                }}
              />
            </View>

            {/* Nav items */}
            <View style={{gap: 4, paddingBottom: insets.bottom + 8}}>
              {[...topItems, ...bottomItems].map((item) => (
                <SidebarItem
                  isActive={activeRoute === item.route}
                  item={item}
                  itemStyle={itemStyle}
                  key={item.label}
                  onPress={handleNavigate}
                />
              ))}
            </View>
          </Animated.View>
        </>
      )}
    </View>
  );
};

const SidebarHeader: FC<{onOpen: () => void}> = ({onOpen}) => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const {state, descriptors} = Navigator.useContext();
  const activeRoute = state.routes[state.index];
  const {headerLeft, headerRight, title} = (descriptors[activeRoute?.key]?.options ?? {}) as {
    headerLeft?: (props: object) => ReactNode;
    headerRight?: (props: object) => ReactNode;
    title?: string;
  };

  return (
    <View
      style={{
        backgroundColor: theme.surface.base,
        borderBottomColor: theme.border.default,
        borderBottomWidth: 1,
        paddingTop: insets.top,
      }}
    >
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          height: 44,
          justifyContent: "space-between",
          paddingHorizontal: 16,
        }}
      >
        <View style={{alignItems: "center", flexDirection: "row", gap: 12}}>
          <SidebarHamburger onOpen={onOpen} />
          {headerLeft?.({})}
        </View>
        {Boolean(title) && (
          <View
            style={{
              alignItems: "center",
              bottom: 0,
              justifyContent: "center",
              left: 0,
              pointerEvents: "none",
              position: "absolute",
              right: 0,
              top: 0,
            }}
          >
            <Text bold size="lg">
              {title}
            </Text>
          </View>
        )}
        {Boolean(headerRight) && <View style={{alignItems: "flex-end"}}>{headerRight?.({})}</View>}
      </View>
    </View>
  );
};

/** Renders the content panel and bottom sheet for the active screen. */
const SidebarNavigatorContent: FC<{
  topItems: SidebarNavigationItem[];
  bottomItems: SidebarNavigationItem[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onNavigate?: (route: string) => void;
  panelStyle?: StyleProp<ViewStyle>;
  itemStyle?: StyleProp<ViewStyle>;
}> = ({topItems, bottomItems, isOpen, onOpenChange, onNavigate, panelStyle, itemStyle}) => {
  const {state, navigation} = Navigator.useContext();
  const activeRoute = state.routes[state.index];

  const handleNavigate = useCallback(
    (route: string) => {
      navigation.navigate(route);
      onNavigate?.(route);
    },
    [navigation, onNavigate]
  );

  return (
    <SidebarNavigationPanel
      activeRoute={activeRoute?.name}
      bottomItems={bottomItems}
      isOpen={isOpen}
      itemStyle={itemStyle}
      onNavigate={handleNavigate}
      onOpenChange={onOpenChange}
      panelStyle={panelStyle}
      topItems={topItems}
    >
      <Slot />
    </SidebarNavigationPanel>
  );
};

/**
 * Custom expo-router navigator with a header bar and hamburger-triggered bottom sheet.
 * Use in _layout.tsx files:
 *
 * ```tsx
 * export default function SidebarLayout() {
 *   return (
 *     <SidebarNavigation
 *       topItems={[{label: "Home", route: "index", iconName: "house"}]}
 *       bottomItems={[{label: "Settings", route: "settings", iconName: "gear"}]}
 *     />
 *   );
 * }
 * ```
 */
const SidebarNavigationBase: FC<SidebarNavigationProps> = ({
  topItems,
  bottomItems,
  onNavigate,
  initialRouteName: _initialRouteName,
  screenOptions,
  panelStyle,
  itemStyle,
  children,
}) => {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <Navigator router={TabRouter} screenOptions={screenOptions}>
      <View style={{flex: 1}}>
        <SidebarHeader onOpen={() => setIsSheetOpen(true)} />
        <SidebarNavigatorContent
          bottomItems={bottomItems}
          isOpen={isSheetOpen}
          itemStyle={itemStyle}
          onNavigate={onNavigate}
          onOpenChange={setIsSheetOpen}
          panelStyle={panelStyle}
          topItems={topItems}
        />
      </View>
      {children}
    </Navigator>
  );
};

export const SidebarNavigation = Object.assign(SidebarNavigationBase, {Screen});
