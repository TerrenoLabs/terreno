import {type ReactElement, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Dimensions,
  type DimensionValue,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import {createWebPortal} from "./createWebPortal";
import {resolveDocumentBodyPortalTarget} from "./resolveDocumentBodyPortalTarget";
import {useTheme} from "./Theme";
import {createBoxShadow} from "./Utilities";

export {resolveDocumentBodyPortalTarget};

export const scheduleAfterPaint = (callback: () => void): void => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
  } else {
    setTimeout(callback, 0);
  }
};

export interface WebDropdownMenuOption {
  key?: string | number;
  label: string;
  value: string;
  color?: string;
  /** Secondary line under the label (web dropdown only). */
  helperText?: string;
}

export interface WebDropdownAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebDropdownMenuProps {
  /** Controls visibility of the popup. */
  visible: boolean;
  /** Position of the trigger element so the menu can be anchored beneath it. */
  anchor: WebDropdownAnchor;
  /** Options to render in the list. */
  options: WebDropdownMenuOption[];
  /** Currently selected value (used to highlight the matching option). */
  selectedValue?: string;
  /**
   * Optional index of the currently selected option. When provided, takes
   * precedence over `selectedValue` — useful when option values aren't
   * unique (e.g. a placeholder with an empty value sharing the same string
   * representation as another option).
   */
  selectedIndex?: number;
  /** Called when an option is chosen. */
  onSelect: (value: string, index: number) => void;
  /** Called when the backdrop is pressed or Escape is hit. */
  onClose: () => void;
  /** Optional fixed width for the menu. Defaults to the trigger width. */
  width?: DimensionValue;
  /** Optional minimum width for the menu. */
  minWidth?: DimensionValue;
  /** Additional style applied to each option's label. */
  optionTextStyle?: TextStyle;
  /** Prefix for the testIDs on the menu / backdrop / option nodes. */
  testIDPrefix?: string;
  /**
   * When true, hides the type-to-filter search input at the top of the dropdown.
   * The filter resets each time the menu opens. Search is enabled by default.
   * @default false
   */
  disableSearch?: boolean;
  /**
   * When true and `options` is empty, shows a "No matching options" message.
   * Used when the parent filters options externally (e.g. search in the trigger).
   */
  showEmptyStateWhenNoOptions?: boolean;
  /**
   * When true, renders the menu in a lightweight portal overlay instead of
   * React Native's Modal so focus can remain on an external trigger input.
   * Web only.
   */
  keepTriggerFocus?: boolean;
  /** Web only. Renders the menu in a fixed portal attached to `document.body`. */
  renderInBodyPortal?: boolean;
  /**
   * `anchored` positions the menu below/above the trigger (web-style).
   * `centered` shows a centered dialog, matching Android's native picker modal.
   */
  presentation?: "anchored" | "centered";
}

interface PressableWebState {
  pressed: boolean;
  hovered?: boolean;
  focused?: boolean;
}

/**
 * Shared popup used by `RNPickerSelect` and `SelectBadge` for a consistent
 * styled dropdown across web and native. Must be anchored to a trigger element
 * via `useWebDropdownAnchor` (or an equivalent measurement) when using anchored
 * presentation.
 *
 * When search is enabled a text input appears at the top of the menu so
 * the user can type to filter options by label. `RNPickerSelect` handles
 * search in the trigger field on web instead and passes pre-filtered options
 * with `disableSearch={true}`.
 */
export const WebDropdownMenu = ({
  visible,
  anchor,
  options,
  selectedValue,
  selectedIndex,
  onSelect,
  onClose,
  width,
  minWidth,
  optionTextStyle,
  testIDPrefix = "web_dropdown",
  disableSearch = false,
  showEmptyStateWhenNoOptions = false,
  keepTriggerFocus = false,
  renderInBodyPortal = false,
  presentation = "anchored",
}: WebDropdownMenuProps): ReactElement => {
  const searchable = !disableSearch;
  const {theme} = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<TextInput>(null);
  const listScrollRef = useRef<ScrollView>(null);
  const listViewportHeightRef = useRef(0);
  const optionLayoutsRef = useRef<Array<{height: number; offset: number}>>([]);

  const normalizedQuery = searchQuery.toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!searchable || normalizedQuery.length === 0) {
      return options;
    }
    return options.filter((item) => {
      if (item.label.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      const helper = item.helperText?.toLowerCase();
      if (helper?.includes(normalizedQuery)) {
        return true;
      }
      return false;
    });
  }, [normalizedQuery, options, searchable]);

  const selectedFilteredIndex = useMemo(() => {
    if (selectedIndex === undefined) {
      return -1;
    }
    return filteredOptions.findIndex((item) => options.indexOf(item) === selectedIndex);
  }, [filteredOptions, options, selectedIndex]);

  const scrollSelectedIntoView = useCallback((): void => {
    if (selectedFilteredIndex < 0 || !listScrollRef.current) {
      return;
    }
    const layout = optionLayoutsRef.current[selectedFilteredIndex];
    const viewportHeight = listViewportHeightRef.current;
    if (!layout || viewportHeight <= 0) {
      return;
    }
    const centeredOffset = layout.offset - viewportHeight / 2 + layout.height / 2;
    listScrollRef.current.scrollTo({
      animated: false,
      y: Math.max(0, centeredOffset),
    });
  }, [selectedFilteredIndex]);

  // Reset the search query each time the menu opens and auto-focus the
  // search input so the user can immediately start typing.
  useEffect(() => {
    if (!visible) {
      return;
    }
    setSearchQuery("");
    optionLayoutsRef.current = [];
    if (searchable) {
      scheduleAfterPaint(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [searchable, visible]);

  // Center the selected row in the list when the menu opens (native picker parity).
  useEffect(() => {
    if (!visible || selectedFilteredIndex < 0) {
      return;
    }
    scheduleAfterPaint(() => {
      scrollSelectedIntoView();
    });
  }, [scrollSelectedIntoView, selectedFilteredIndex, visible]);

  const handleOptionLayout = useCallback(
    (index: number, offset: number, height: number): void => {
      optionLayoutsRef.current[index] = {height, offset};
      if (visible && index === selectedFilteredIndex) {
        scheduleAfterPaint(() => {
          scrollSelectedIntoView();
        });
      }
    },
    [scrollSelectedIntoView, selectedFilteredIndex, visible]
  );

  const windowHeight = Dimensions.get("window").height;
  const windowWidth = Dimensions.get("window").width;
  const isCenteredPresentation = presentation === "centered";

  const menuMaxHeight = isCenteredPresentation ? Math.round(windowHeight * 0.55) : 300;
  const gap = 4;
  const spaceBelow = windowHeight - (anchor.y + anchor.height + gap);
  // If not enough room below the trigger, open the menu above it instead.
  const isOpenAbove =
    !isCenteredPresentation && spaceBelow < menuMaxHeight && anchor.y > spaceBelow;
  const menuTop = anchor.y + anchor.height + gap;
  const menuBottom = windowHeight - anchor.y + gap;
  const clampedMaxHeight = isCenteredPresentation
    ? menuMaxHeight
    : isOpenAbove
      ? Math.min(menuMaxHeight, anchor.y - gap)
      : Math.min(menuMaxHeight, spaceBelow);

  const anchoredMenuLayoutStyle = {
    backgroundColor: theme.surface.base,
    borderColor: theme.border.dark,
    borderRadius: 4,
    borderWidth: 1,
    boxShadow: createBoxShadow({blurRadius: 8, offsetY: 2, opacity: 0.15}),
    left: anchor.x,
    maxHeight: clampedMaxHeight,
    minWidth,
    overflow: "hidden" as const,
    ...(isOpenAbove ? {bottom: menuBottom} : {top: menuTop}),
    width: width ?? anchor.width,
    zIndex: 2,
  };

  // Centered presentation is the Android native-picker path. `boxShadow` and
  // `elevation` both paint on Android, so keep elevation-only there — matching
  // Box's `shadow` prop. iOS/web get `boxShadow`.
  const centeredMenuLayoutStyle = {
    backgroundColor: theme.surface.base,
    borderRadius: 8,
    maxHeight: clampedMaxHeight,
    maxWidth: Math.min(400, windowWidth - 48),
    overflow: "hidden" as const,
    width: Math.min(400, windowWidth - 48),
    ...(Platform.OS === "android"
      ? {elevation: 8}
      : {boxShadow: createBoxShadow({blurRadius: 12, offsetY: 4, opacity: 0.25})}),
  };

  const menuLayoutStyle = isCenteredPresentation
    ? centeredMenuLayoutStyle
    : anchoredMenuLayoutStyle;
  const usesWebPortal = keepTriggerFocus || renderInBodyPortal;

  const menuContent = (
    <>
      {searchable && (
        <View
          style={{
            borderBottomColor: theme.border.default,
            borderBottomWidth: 1,
            paddingHorizontal: 8,
            paddingVertical: 6,
          }}
        >
          <TextInput
            autoFocus
            onChangeText={setSearchQuery}
            placeholder="Search..."
            placeholderTextColor={theme.text.secondaryLight}
            ref={searchInputRef}
            style={{
              borderColor: theme.border.dark,
              borderRadius: 4,
              borderWidth: 1,
              color: theme.text.primary,
              fontSize: 14,
              paddingHorizontal: 8,
              paddingVertical: 4,
              ...(Platform.OS === "web" ? {outline: "none"} : {}),
            }}
            testID={`${testIDPrefix}_search`}
            value={searchQuery}
          />
        </View>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => {
          listViewportHeightRef.current = event.nativeEvent.layout.height;
          scheduleAfterPaint(() => {
            scrollSelectedIntoView();
          });
        }}
        ref={listScrollRef}
      >
        {filteredOptions.map((item, filteredIndex) => {
          const originalIdx = options.indexOf(item);
          const isSelected =
            selectedIndex !== undefined
              ? originalIdx === selectedIndex
              : item.value === selectedValue;
          return (
            <Pressable
              aria-role="button"
              key={item.key ?? originalIdx}
              onLayout={(event) => {
                const {height, y} = event.nativeEvent.layout;
                handleOptionLayout(filteredIndex, y, height);
              }}
              onPress={() => onSelect(item.value, originalIdx)}
              style={(state: PressableWebState) => ({
                backgroundColor:
                  isSelected || state.hovered || state.pressed
                    ? theme.surface.neutralLight
                    : theme.surface.base,
                paddingHorizontal: 12,
                paddingVertical: 10,
              })}
              testID={`${testIDPrefix}_option_${item.value}`}
            >
              <View style={{alignSelf: "stretch"}}>
                <Text
                  style={{
                    color: item.color ?? theme.text.primary,
                    fontWeight: isSelected ? "600" : "400",
                    ...optionTextStyle,
                  }}
                >
                  {item.label}
                </Text>
                {Boolean(item.helperText) && (
                  <Text
                    style={{
                      color: theme.text.secondaryDark,
                      fontSize: 12,
                      fontWeight: "400",
                      lineHeight: 16,
                      marginTop: 2,
                    }}
                  >
                    {item.helperText}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
        {(searchable || showEmptyStateWhenNoOptions) && filteredOptions.length === 0 && (
          <View style={{paddingHorizontal: 12, paddingVertical: 10}}>
            <Text
              style={{color: theme.text.secondaryLight, fontStyle: "italic"}}
              testID={`${testIDPrefix}_no_results`}
            >
              No matching options
            </Text>
          </View>
        )}
      </ScrollView>
    </>
  );

  // Close on Escape when using the portal overlay (Modal handles this itself).
  useEffect(() => {
    if (!visible || !usesWebPortal || Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keyup", closeOnEscape, false);
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("keyup", closeOnEscape, false);
      }
    };
  }, [onClose, usesWebPortal, visible]);

  if (Platform.OS === "web" && usesWebPortal) {
    if (!visible) {
      return <View testID={`${testIDPrefix}_modal`} />;
    }

    const webFixedOverlayStyle = {
      inset: 0,
      // box-none lets clicks pass to the backdrop / menu but not the empty overlay.
      pointerEvents: "box-none",
      position: "fixed",
      zIndex: 9999,
    } as unknown as ViewStyle;

    const webFixedBackdropStyle = {
      inset: 0,
      position: "fixed",
      zIndex: 1,
    } as unknown as ViewStyle;

    const webFixedMenuStyle = {
      ...menuLayoutStyle,
      position: "fixed",
    } as unknown as ViewStyle;

    const overlay = (
      <View style={webFixedOverlayStyle}>
        <Pressable
          aria-role="button"
          onPress={onClose}
          style={webFixedBackdropStyle}
          testID={`${testIDPrefix}_backdrop`}
        />
        <View style={webFixedMenuStyle} testID={`${testIDPrefix}_menu`}>
          {menuContent}
        </View>
      </View>
    );

    const portalTarget = resolveDocumentBodyPortalTarget();

    if (portalTarget) {
      return createWebPortal({children: overlay, container: portalTarget});
    }

    return overlay;
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      testID={`${testIDPrefix}_modal`}
      transparent
      visible={visible}
    >
      {isCenteredPresentation ? (
        <View
          style={{
            alignItems: "center",
            backgroundColor: "rgba(0, 0, 0, 0.45)",
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Pressable
            aria-role="button"
            onPress={onClose}
            style={{
              bottom: 0,
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
            }}
            testID={`${testIDPrefix}_backdrop`}
          />
          <View style={menuLayoutStyle} testID={`${testIDPrefix}_menu`}>
            {menuContent}
          </View>
        </View>
      ) : (
        <>
          <Pressable
            aria-role="button"
            onPress={onClose}
            style={{flex: 1, zIndex: 0}}
            testID={`${testIDPrefix}_backdrop`}
          />
          <View
            style={{
              ...anchoredMenuLayoutStyle,
              position: "absolute",
              zIndex: 1,
            }}
            testID={`${testIDPrefix}_menu`}
          >
            {menuContent}
          </View>
        </>
      )}
    </Modal>
  );
};

/**
 * Hook that wires up a `View` ref + anchor state for use with
 * `WebDropdownMenu`. Measure the trigger via `measure()` before opening so
 * the menu lines up beneath it across browsers.
 */
export const useWebDropdownAnchor = (): {
  triggerRef: React.RefObject<View | null>;
  anchor: WebDropdownAnchor;
  cancelPendingMeasurement: () => void;
  measure: (onMeasured: (anchor: WebDropdownAnchor) => void) => void;
} => {
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<WebDropdownAnchor>({height: 0, width: 0, x: 0, y: 0});
  const measurementRequestRef = useRef(0);

  const cancelPendingMeasurement = useCallback((): void => {
    measurementRequestRef.current += 1;
  }, []);

  const measure = useCallback(
    (onMeasured: (next: WebDropdownAnchor) => void): void => {
      const requestId = measurementRequestRef.current + 1;
      measurementRequestRef.current = requestId;
      const node = triggerRef.current;
      if (node && typeof node.measureInWindow === "function") {
        node.measureInWindow((x, y, w, h) => {
          if (requestId !== measurementRequestRef.current) {
            return;
          }
          const next = {height: h, width: w, x, y};
          setAnchor(next);
          onMeasured(next);
        });
        return;
      }
      onMeasured(anchor);
    },
    [anchor]
  );

  return {anchor, cancelPendingMeasurement, measure, triggerRef};
};
