import {type FC, type ReactNode, useContext, useEffect, useState} from "react";
import {Dimensions, Platform, Pressable, ScrollView, View, type ViewStyle} from "react-native";

import {Button} from "./Button";
import type {DropdownPanelProps} from "./Common";
import {createWebPortal} from "./createWebPortal";
import {
  computeDropdownPanelLayout,
  DROPDOWN_PANEL_GAP,
  type DropdownPanelLayout,
} from "./dropdownPanelLayout";
import {Icon} from "./Icon";
import {Portal, PortalContext} from "./PortalHost";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveTestID} from "./testing/resolveTestId";
import {createBoxShadow} from "./Utilities";
import {useWebDropdownAnchor} from "./WebDropdownMenu";

const DEFAULT_WIDTH = 320;
const ICON_TRIGGER_SIZE = {default: 32, sm: 24} as const;
/** Fallback trigger height for the inline overlay before the trigger has been measured. */
const TRIGGER_OFFSET = 44;

/**
 * Compositional dropdown panel. Renders a trigger that opens a floating panel
 * containing any composed content — the filter controls (`FilterSelectMenu`,
 * `FilterBoolean`, `FilterAccordion`) it was designed for, or anything else that
 * needs a panel with an optional Apply / Clear / Cancel footer. Clicking outside
 * the panel closes it.
 *
 * The panel always escapes its ancestors' clipping and stacking contexts: on web
 * it renders in a portal on `document.body` with fixed positioning, and on native
 * it renders through the `TerrenoProvider` portal host (falling back to an inline
 * absolute overlay when no host is mounted). It is anchored to the trigger and
 * kept inside the viewport — right-aligning rather than running off the right
 * edge, flipping above the trigger when there is no room below, and scrolling its
 * body when the content is taller than the space available.
 */
export const DropdownPanel: FC<DropdownPanelProps> = ({
  align = "auto",
  applyButtonVariant,
  children,
  label = "Filter",
  triggerAccessibilityLabel,
  iconName = "bars-filter",
  iconOnly = false,
  triggerSize,
  triggerVariant,
  renderTrigger,
  fullWidth = false,
  isOpen,
  defaultOpen = false,
  onOpenChange,
  showActionButtons = true,
  showApplyButton = true,
  showClearButton = true,
  showCancelButton = true,
  applyButtonText = "Apply",
  clearButtonText = "Clear",
  cancelButtonText = "Cancel",
  onApply,
  onClear,
  onCancel,
  variant = "primary",
  width = DEFAULT_WIDTH,
  maxPanelHeight,
  testID,
}) => {
  const {theme} = useTheme();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [anchorReady, setAnchorReady] = useState(false);
  const {anchor, cancelPendingMeasurement, measure, triggerRef} = useWebDropdownAnchor();
  // Native portals need a host; without one the panel falls back to an inline overlay so
  // apps (and tests) that render outside TerrenoProvider still get a usable dropdown.
  const hasPortalHost = useContext(PortalContext) !== null;

  const isControlled = isOpen !== undefined;
  const open = isControlled ? isOpen : internalOpen;

  // Measure-then-show: measure the trigger when the panel opens and only reveal
  // the portaled panel once the anchor is known, so it never flashes at the
  // default (0, 0) position before jumping into place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-measure on open transitions; `measure` is recreated each render.
  useEffect(() => {
    setAnchorReady(false);
    if (!open) {
      cancelPendingMeasurement();
      return;
    }

    measure((): void => setAnchorReady(true));
    return cancelPendingMeasurement;
  }, [open]);

  // Return focus to the trigger after any in-panel dismissal so keyboard users
  // can continue from the control that opened the popup (web only).
  const restoreTriggerFocus = (): void => {
    if (Platform.OS !== "web" || !triggerRef.current) {
      return;
    }
    const node = triggerRef.current as unknown as {
      querySelector?: (selector: string) => {focus?: () => void} | null;
    };
    node.querySelector?.('[role="button"]')?.focus?.();
  };

  const setOpen = (next: boolean): void => {
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  const handleApply = (): void => {
    onApply?.();
    setOpen(false);
    restoreTriggerFocus();
  };

  const handleClear = (): void => {
    // Clearing resets the values but keeps the panel open so the user can
    // immediately pick new ones without reopening it.
    onClear?.();
  };

  const handleCancel = (): void => {
    onCancel?.();
    setOpen(false);
    restoreTriggerFocus();
  };

  const toggle = (): void => setOpen(!open);

  const showFooter = showActionButtons && (showApplyButton || showClearButton || showCancelButton);

  const layout: DropdownPanelLayout = computeDropdownPanelLayout({
    align,
    anchor,
    maxPanelHeight,
    panelWidth: width,
    viewportHeight: Dimensions.get("window").height,
    viewportWidth: Dimensions.get("window").width,
  });

  const panelSurfaceStyle: ViewStyle = {
    backgroundColor: theme.surface.base,
    borderColor: theme.border.default,
    borderRadius: theme.radius.default,
    borderWidth: 1,
    boxShadow: createBoxShadow({
      blurRadius: 12,
      color: theme.primitives.neutral900,
      offsetY: 4,
      opacity: 0.15,
    }),
    maxHeight: layout.maxHeight,
    width: layout.width,
  };

  const panelBody: ReactNode = (
    <>
      <ScrollView
        contentContainerStyle={{padding: theme.spacing.sm}}
        keyboardShouldPersistTaps="handled"
        style={{flexShrink: 1}}
      >
        {children}
      </ScrollView>
      {showFooter && (
        <View
          style={{
            alignItems: "center",
            borderTopColor: theme.border.default,
            borderTopWidth: 1,
            flexDirection: "row",
            justifyContent: "space-between",
            padding: theme.spacing.md,
          }}
        >
          {showClearButton ? (
            <Pressable
              onPress={handleClear}
              testID={testID ? resolveTestID(testID, "clear") : undefined}
            >
              <Text color="link" underline>
                {clearButtonText}
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: theme.spacing.sm,
              justifyContent: "flex-end",
            }}
          >
            {showCancelButton && (
              <Button
                onClick={handleCancel}
                testID={testID ? resolveTestID(testID, "cancel") : undefined}
                text={cancelButtonText}
                variant="outline"
              />
            )}
            {showApplyButton && (
              <Button
                onClick={handleApply}
                testID={testID ? resolveTestID(testID, "apply") : undefined}
                text={applyButtonText}
                variant={applyButtonVariant ?? variant}
              />
            )}
          </View>
        </View>
      )}
    </>
  );

  const positionedPanelStyle = (position: "absolute" | "fixed"): ViewStyle =>
    ({
      ...panelSurfaceStyle,
      bottom: layout.bottom,
      left: layout.left,
      position,
      top: layout.top,
    }) as unknown as ViewStyle;

  const renderOverlay = (): ReactNode => {
    // Web: portal to document.body with fixed positioning so the panel escapes
    // every ancestor stacking context and floats above all page content.
    if (Platform.OS === "web" && typeof document !== "undefined") {
      // Wait for the trigger measurement so the panel appears already anchored.
      if (!anchorReady) {
        return null;
      }
      const overlay = (
        <View
          style={
            {
              inset: 0,
              // box-none lets clicks pass to the backdrop / panel but not the empty overlay.
              pointerEvents: "box-none",
              position: "fixed",
              zIndex: 9999,
            } as unknown as ViewStyle
          }
        >
          <Pressable
            aria-role="button"
            onPress={handleCancel}
            style={{inset: 0, position: "fixed", zIndex: 1} as unknown as ViewStyle}
            testID={testID ? resolveTestID(testID, "backdrop") : undefined}
          />
          <View
            style={{...positionedPanelStyle("fixed"), zIndex: 2}}
            testID={testID ? resolveTestID(testID, "panel") : undefined}
          >
            {panelBody}
          </View>
        </View>
      );

      const target = document.body instanceof HTMLElement ? document.body : null;
      return target ? createWebPortal({children: overlay, container: target}) : overlay;
    }

    // Native: teleport to the portal host so the panel is not clipped by a scroll view or
    // card, positioned from the window coordinates the host shares. Without a host the
    // panel stays inline and is anchored directly beneath the trigger.
    const panelStyle: ViewStyle = hasPortalHost
      ? {...positionedPanelStyle("absolute"), zIndex: 11}
      : {
          ...panelSurfaceStyle,
          left: 0,
          position: "absolute",
          top: (anchor.height || TRIGGER_OFFSET) + DROPDOWN_PANEL_GAP,
          zIndex: 11,
        };

    if (hasPortalHost && !anchorReady) {
      return null;
    }

    const nativeOverlay = (
      <>
        <Pressable
          aria-role="button"
          onPress={handleCancel}
          style={{bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10}}
          testID={testID ? resolveTestID(testID, "backdrop") : undefined}
        />
        <View style={panelStyle} testID={testID ? resolveTestID(testID, "panel") : undefined}>
          {panelBody}
        </View>
      </>
    );

    return hasPortalHost ? <Portal>{nativeOverlay}</Portal> : nativeOverlay;
  };

  const renderDefaultTrigger = (): ReactNode => {
    if (iconOnly) {
      return (
        <Pressable
          accessibilityLabel={triggerAccessibilityLabel ?? label ?? "Filter"}
          accessibilityRole="button"
          aria-label={triggerAccessibilityLabel ?? label ?? "Filter"}
          hitSlop={8}
          onPress={toggle}
          style={{
            alignItems: "center",
            backgroundColor: open ? theme.surface.neutralLight : theme.surface.base,
            borderRadius: theme.radius.rounded,
            height: ICON_TRIGGER_SIZE[triggerSize ?? "sm"],
            justifyContent: "center",
            width: ICON_TRIGGER_SIZE[triggerSize ?? "sm"],
          }}
          testID={testID ? resolveTestID(testID, "trigger") : undefined}
        >
          <Icon
            color="secondaryLight"
            iconName={iconName}
            size={(triggerSize ?? "sm") === "sm" ? "sm" : "md"}
          />
        </Pressable>
      );
    }

    return (
      <Button
        accessibilityLabel={triggerAccessibilityLabel}
        fullWidth={fullWidth}
        iconName={iconName}
        onClick={toggle}
        size={triggerSize ?? "default"}
        testID={testID ? resolveTestID(testID, "trigger") : undefined}
        text={label}
        variant={triggerVariant ?? variant}
      />
    );
  };

  return (
    <View style={{position: "relative", width: fullWidth ? "100%" : undefined}} testID={testID}>
      {/* The wrapper is what gets measured, so it must hug the trigger. A stretched
          wrapper anchors the panel to the start of the whole row instead — which looks
          right only while the trigger happens to sit at that edge. */}
      <View
        collapsable={false}
        ref={triggerRef}
        style={{alignSelf: fullWidth ? "stretch" : "flex-start"}}
      >
        {renderTrigger ? renderTrigger({isOpen: Boolean(open), toggle}) : renderDefaultTrigger()}
      </View>
      {Boolean(open) && renderOverlay()}
    </View>
  );
};

/**
 * @deprecated Renamed to {@link DropdownPanel} — the component is a general
 * compositional dropdown, not filter-specific. Removed in Terreno 58.
 */
export const Filter = DropdownPanel;
