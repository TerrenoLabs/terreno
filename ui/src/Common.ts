import type {CountryCode} from "libphonenumber-js";
import type React from "react";
import type {FC, ReactElement, ReactNode} from "react";
import type {
  ImageStyle,
  ListRenderItemInfo,
  ScrollView,
  StyleProp,
  TextInput,
  TextStyle,
  ViewStyle,
} from "react-native";
import type {DimensionValue} from "react-native/Libraries/StyleSheet/StyleSheetTypes";
import type {Styles} from "react-native-google-places-autocomplete";
import type {SvgProps} from "react-native-svg";

import type {
  FontAwesome6BrandNames,
  FontAwesome6RegularNames,
  FontAwesome6SolidNames,
} from "./CommonIconTypes";
import type {DropdownPanelAlign} from "./dropdownPanelLayout";
import type {
  DataTableTestIDs,
  FieldTestIDs,
  ModalTestIDs,
  SegmentedControlTestIDs,
  WithTestID,
} from "./testing/types";

export {
  resolveDataTableRowTestID,
  resolveDataTableTestIDsFromProps,
  resolveFieldTestIDsFromProps,
  resolveModalTestIDsFromProps,
  resolveTestID,
  toDomTestProps,
  toPlatformTestProps,
  toTestProps,
} from "./testing/resolveTestId";
export type {
  DataTableTestIDs,
  FieldTestIDs,
  ModalTestIDs,
  SegmentedControlTestIDs,
  WithTestID,
} from "./testing/types";

export type PercentageString = `${number}%`;

export type NumberOrPercentage = number | PercentageString | string;

export interface InfoModalIconProps extends WithTestID {
  /**
   * The content of the information modal.
   */
  infoModalChildren?: ModalProps["children"];

  /**
   * The subtitle of the information modal.
   */
  infoModalSubtitle?: ModalProps["subtitle"];

  /**
   * The text content of the information modal.
   */
  infoModalText?: ModalProps["text"];

  /**
   * The title of the information modal.
   */
  infoModalTitle?: ModalProps["title"];
}

export interface AccordionProps extends InfoModalIconProps {
  /**
   * The content to be displayed inside the accordion.
   */
  children: React.ReactNode;

  /**
   * If true, an information modal will be included.
   * @default false
   */
  includeInfoModal?: boolean;

  /**
   * If true, the accordion will be collapsed.
   * @default true
   */
  isCollapsed?: boolean;

  /*
   * The subtitle showed below the title of the accordion.
   */
  subtitle?: string;

  /**
   * The title of the accordion.
   */
  title: string;

  /**
   * * Callback fired when the accordion is toggled.
   * */
  onToggle?: (isCollapse: boolean) => void;
}

export interface BaseProfile {
  email: string;
  id: string;
  backOffice: {
    testUser?: boolean;
  };
}

export interface ThemePrimitiveColors {
  neutral000: string;
  neutral050: string;
  neutral100: string;
  neutral200: string;
  neutral300: string;
  neutral400: string;
  neutral500: string;
  neutral600: string;
  neutral700: string;
  neutral800: string;
  neutral900: string;

  primary000: string;
  primary050: string;
  primary100: string;
  primary200: string;
  primary300: string;
  primary400: string;
  primary500: string;
  primary600: string;
  primary700: string;
  primary800: string;
  primary900: string;

  secondary000: string;
  secondary050: string;
  secondary100: string;
  secondary200: string;
  secondary300: string;
  secondary400: string;
  secondary500: string;
  secondary600: string;
  secondary700: string;
  secondary800: string;
  secondary900: string;

  accent000: string;
  accent050: string;
  accent100: string;
  accent200: string;
  accent300: string;
  accent400: string;
  accent500: string;
  accent600: string;
  accent700: string;
  accent800: string;
  accent900: string;

  error000: string;
  error100: string;
  error200: string;

  warning000: string;
  warning100: string;
  warning200: string;

  success000: string;
  success100: string;
  success200: string;
}

export interface ThemePrimitiveRadius {
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  radiusXl: number;
  radius2xl: number;
  radius3xl: number;
}

export interface ThemePrimitiveSpacing {
  spacing0: number;
  spacing1: number;
  spacing2: number;
  spacing3: number;
  spacing4: number;
  spacing5: number;
  spacing6: number;
  spacing7: number;
  spacing8: number;
  spacing9: number;
  spacing10: number;
  spacing11: number;
  spacing12: number;
}

export type ThemePrimitives = ThemePrimitiveColors & ThemePrimitiveRadius & ThemePrimitiveSpacing;

export interface TextThemeConfig {
  primary: keyof ThemePrimitiveColors;
  inverted: keyof ThemePrimitiveColors;
  secondaryLight: keyof ThemePrimitiveColors;
  extraLight: keyof ThemePrimitiveColors;
  secondaryDark: keyof ThemePrimitiveColors;
  link: keyof ThemePrimitiveColors;
  linkLight: keyof ThemePrimitiveColors;
  accent: keyof ThemePrimitiveColors;
  error: keyof ThemePrimitiveColors;
  warning: keyof ThemePrimitiveColors;
  success: keyof ThemePrimitiveColors;
}

export interface SurfaceThemeConfig {
  base: keyof ThemePrimitiveColors;
  baseAlternate: keyof ThemePrimitiveColors;
  baseHover: keyof ThemePrimitiveColors;
  primary: keyof ThemePrimitiveColors;
  secondaryExtraLight: keyof ThemePrimitiveColors;
  secondaryLight: keyof ThemePrimitiveColors;
  secondaryDark: keyof ThemePrimitiveColors;
  secondaryExtraDark: keyof ThemePrimitiveColors;
  neutral: keyof ThemePrimitiveColors;
  neutralLight: keyof ThemePrimitiveColors;
  neutralDark: keyof ThemePrimitiveColors;
  disabled: keyof ThemePrimitiveColors;
  error: keyof ThemePrimitiveColors;
  errorLight: keyof ThemePrimitiveColors;
  success: keyof ThemePrimitiveColors;
  successLight: keyof ThemePrimitiveColors;
  warning: keyof ThemePrimitiveColors;
  warningLight: keyof ThemePrimitiveColors;
}

export interface BorderThemeConfig {
  default: keyof ThemePrimitiveColors;
  dark: keyof ThemePrimitiveColors;
  activeNeutral: keyof ThemePrimitiveColors;
  activeAccent: keyof ThemePrimitiveColors;
  hover: keyof ThemePrimitiveColors;
  focus: keyof ThemePrimitiveColors;
  error: keyof ThemePrimitiveColors;
  success: keyof ThemePrimitiveColors;
  warning: keyof ThemePrimitiveColors;
}

export interface StatusThemeConfig {
  active: keyof ThemePrimitiveColors;
  doNotDisturb: keyof ThemePrimitiveColors;
  away: keyof ThemePrimitiveColors;
}

export interface RadiusThemeConfig {
  minimal: keyof ThemePrimitiveRadius;
  default: keyof ThemePrimitiveRadius;
  full: keyof ThemePrimitiveRadius;
  rounded: keyof ThemePrimitiveRadius;
}

export interface SpacingThemeConfig {
  none: keyof ThemePrimitiveSpacing;
  xs: keyof ThemePrimitiveSpacing;
  sm: keyof ThemePrimitiveSpacing;
  md: keyof ThemePrimitiveSpacing;
  lg: keyof ThemePrimitiveSpacing;
  xl: keyof ThemePrimitiveSpacing;
  "2xl": keyof ThemePrimitiveSpacing;
  "3xl": keyof ThemePrimitiveSpacing;
}

export interface TextTheme {
  primary: string;
  inverted: string;
  secondaryLight: string;
  extraLight: string;
  secondaryDark: string;
  link: string;
  linkLight: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
}

export interface SurfaceTheme {
  base: string;
  baseAlternate: string;
  baseHover: string;
  primary: string;
  secondaryExtraLight: string;
  secondaryLight: string;
  secondaryDark: string;
  secondaryExtraDark: string;
  neutral: string;
  neutralLight: string;
  neutralDark: string;
  disabled: string;
  error: string;
  errorLight: string;
  success: string;
  successLight: string;
  warning: string;
  warningLight: string;
}

export interface BorderTheme {
  default: string;
  dark: string;
  activeNeutral: string;
  activeAccent: string;
  hover: string;
  focus: string;
  error: string;
  success: string;
  warning: string;
}

export interface StatusTheme {
  active: string;
  doNotDisturb: string;
  away: string;
}

export interface RadiusTheme {
  minimal: number;
  default: number;
  full: number;
  rounded: number;
}

export interface SpacingTheme {
  none: number;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  "2xl": number;
  "3xl": number;
}

export type TextColor = keyof TextTheme;
export type SurfaceColor = keyof SurfaceTheme;
export type BorderColor = keyof BorderTheme;
export type StatusColor = keyof StatusTheme;

// TODO: we may want/need to expand icon color options from just text colors.
export type IconColor = TextColor;

export interface FontTheme {
  primary: string;
  title: string;
}
export type Font = keyof FontTheme;

// The computed theme object that is passed to the ThemeProvider.
export interface TerrenoTheme {
  text: TextTheme;
  surface: SurfaceTheme;
  border: BorderTheme;
  status: StatusTheme;
  radius: RadiusTheme;
  spacing: SpacingTheme;
  font: FontTheme;
  primitives: ThemePrimitives;
}

// A config for generating the theme object from primitives.
export interface TerrenoThemeConfig {
  text: TextThemeConfig;
  surface: SurfaceThemeConfig;
  border: BorderThemeConfig;
  status: StatusThemeConfig;
  radius: RadiusThemeConfig;
  spacing: SpacingThemeConfig;
  font: FontTheme;
  primitives: ThemePrimitives;
}

export type Direction = "up" | "right" | "down" | "left";

export type OnChangeCallback = (result: string) => void;

/**
 * Augmentable registry of custom icon names. Downstream consumers extend this
 * interface via TypeScript declaration merging to register their own icons and
 * get type-safe, autocompleted names everywhere an `iconName` is accepted.
 *
 * @example
 * ```typescript
 * declare module "@terreno/ui" {
 *   interface CustomIconRegistry {
 *     brandLogo: true;
 *     sparkle: true;
 *   }
 * }
 * ```
 */
export interface CustomIconRegistry {
  /** Built-in "bars-filter" glyph (FontAwesome Classic Solid, E0AD). */
  "bars-filter": true;
}

/** The set of custom icon names registered via {@link CustomIconRegistry}. */
export type CustomIconName = keyof CustomIconRegistry & string;

// Update if we start supporting more icon packs from Expo Icons.
export type IconName =
  | FontAwesome6SolidNames
  | FontAwesome6BrandNames
  | FontAwesome6RegularNames
  | CustomIconName;

/** Props passed to a custom icon component when it is rendered. */
export interface CustomIconProps extends WithTestID {
  /** Resolved color string, already mapped from the active theme. */
  color: string;
  /** Resolved icon size in pixels. */
  size: number;
}

/** A component that renders a custom (non-FontAwesome) icon. */
export type CustomIconComponent = FC<CustomIconProps>;

/**
 * Map of custom icon name to the component that renders it. Provided to
 * `TerrenoProvider` via the `icons` prop to register custom icons.
 */
export type IconRegistryMap = Record<string, CustomIconComponent>;

export interface FilterOption {
  label: string;
  value: string;
}

/** Small blue dot that signals a filter control differs from its default. */
export type FilterChangesBadgeProps = WithTestID;

export interface FilterSelectMenuProps extends WithTestID {
  /** Label shown to the left of the select control. */
  title: string;
  /** Selectable options for the single-select control. */
  options: FilterOption[];
  /** Currently selected value. */
  value?: string;
  /** Called with the newly selected value. */
  onChange: (value: string) => void;
  /** Text shown when no value is selected. */
  placeholder?: string;
  /** When true, shows the blue changes dot next to the title. */
  showChangesBadge?: boolean;
  /** Disables the control. */
  disabled?: boolean;
}

export interface FilterBooleanProps extends WithTestID {
  /** Label shown to the left of the toggle. */
  title: string;
  /** Whether the toggle is on. */
  value: boolean;
  /** Called with the next toggle value. The entire row is the click zone. */
  onChange: (value: boolean) => void;
  /** When true, shows the blue changes dot next to the title. */
  showChangesBadge?: boolean;
  /** Disables the toggle and the row click zone. */
  disabled?: boolean;
  /** Renders the toggle in a focused (keyboard) state. */
  focused?: boolean;
}

export interface FilterAccordionProps extends WithTestID {
  /** Label shown in the always-visible header row. */
  title: string;
  /** Custom content revealed when expanded. Empty by default. */
  children?: React.ReactNode;
  /** Controlled expanded state. Omit to use `defaultExpanded`. */
  expanded?: boolean;
  /** Initial expanded state when uncontrolled. */
  defaultExpanded?: boolean;
  /** Called with the next expanded state when the header row is pressed. */
  onToggle?: (expanded: boolean) => void;
  /** When true, shows the blue changes dot next to the title. */
  showChangesBadge?: boolean;
}

/**
 * Trigger and Apply button styling, mirroring `ButtonProps["variant"]` so a dropdown
 * trigger can use any button style in the design system.
 */
export type DropdownPanelVariant = NonNullable<ButtonProps["variant"]>;

export interface DropdownPanelProps extends WithTestID {
  /** Horizontal alignment of the panel against its trigger.
   * `auto` left-aligns and flips to right-aligned when the panel would overflow the
   * right edge of the viewport.
   * @default "auto"
   */
  align?: DropdownPanelAlign;
  /** Variant for the footer's Apply button. Defaults to `variant`. */
  applyButtonVariant?: DropdownPanelVariant;
  /** Composed controls rendered inside the dropdown panel. */
  children: React.ReactNode;
  /** Trigger button label. */
  label?: string;
  /** Accessible name when the visible trigger label is empty or abbreviated. */
  triggerAccessibilityLabel?: string;
  /** Trigger button icon. Defaults to the built-in `bars-filter` glyph. */
  iconName?: IconName;
  /**
   * Render the trigger as a compact `IconButton` instead of a labeled button.
   * Use for dense chrome such as table column headers. `label` is ignored.
   */
  iconOnly?: boolean;
  /**
   * Trigger size. Labeled triggers default to the standard `Button` size; icon-only
   * triggers default to `sm` (a 24px hit target, 32px at `default`).
   */
  triggerSize?: "sm" | "default";
  /** Variant for the trigger button. Defaults to `variant`. */
  triggerVariant?: DropdownPanelVariant;
  /**
   * Replaces the built-in trigger. Use when the trigger needs styling the `Button`
   * variants do not cover. The returned node is measured to anchor the panel, so it
   * must render something visible.
   */
  renderTrigger?: (props: {isOpen: boolean; toggle: () => void}) => React.ReactNode;
  /** Stretch the trigger (and its wrapper) to the width of the container. */
  fullWidth?: boolean;
  /** Controlled open state. Omit to use `defaultOpen`. */
  isOpen?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called whenever the dropdown opens or closes. */
  onOpenChange?: (isOpen: boolean) => void;
  /** Master toggle for the Apply/Clear/Cancel footer. */
  showActionButtons?: boolean;
  /** Show the Apply button in the footer. */
  showApplyButton?: boolean;
  /** Show the Clear hyperlink in the footer. */
  showClearButton?: boolean;
  /** Show the Cancel button in the footer. */
  showCancelButton?: boolean;
  applyButtonText?: string;
  clearButtonText?: string;
  cancelButtonText?: string;
  /** Called when Apply is pressed. The dropdown then closes. */
  onApply?: () => void;
  /** Called when Clear is pressed. The panel stays open. */
  onClear?: () => void;
  /** Called when Cancel or a click-outside closes the dropdown. */
  onCancel?: () => void;
  /** Primary theming for the trigger and Apply button. */
  variant?: DropdownPanelVariant;
  /** Panel width in pixels. Defaults to 320 per the design spec. */
  width?: number;
  /**
   * Ceiling for the panel height. The panel never exceeds the space available on
   * screen regardless of this value; content beyond it scrolls.
   */
  maxPanelHeight?: number;
}

/**
 * @deprecated Renamed to {@link DropdownPanelProps}. Removed in Terreno 58.
 */
export type FilterProps = DropdownPanelProps;

export type AlignContent = "start" | "end" | "center" | "between" | "around" | "stretch";
export type AlignSelf = "auto" | "start" | "end" | "center" | "baseline" | "stretch";
export type AlignItems = "start" | "end" | "center" | "baseline" | "stretch";
export type JustifyContent = "start" | "end" | "center" | "between" | "around";

export type UnsignedUpTo12 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type SignedUpTo12 =
  | -12
  | -11
  | -10
  | -9
  | -8
  | -7
  | -6
  | -5
  | -4
  | -3
  | -2
  | -1
  | UnsignedUpTo12;
export type Margin = SignedUpTo12 | "auto";
export const SPACING_MAP = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 40,
  8: 48,
  9: 56,
  10: 64,
  11: 72,
  12: 80,
};

export const getSpacing = (spacing: SignedUpTo12) => {
  if (spacing < 0) {
    return SPACING_MAP[Math.abs(spacing) as UnsignedUpTo12] * -1;
  }
  return SPACING_MAP[spacing as UnsignedUpTo12];
};

export type TextFieldType =
  | "date"
  | "datetime"
  | "decimal"
  | "decimalRange"
  | "email"
  // | "height"
  | "password"
  | "phoneNumber"
  | "number"
  | "numberRange"
  | "search"
  | "text"
  | "time"
  | "url"
  | "username";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

export const iconSizeToNumber = (size?: IconSize) => {
  return {
    "2xl": 28,
    lg: 20,
    md: 16,
    sm: 12,
    xl: 24,
    xs: 8,
  }[size || "md"];
};

export type TextSize = "sm" | "md" | "lg" | "xl" | "2xl";

export interface ValueMappingItem {
  value: number;
  label: string;
  size?: IconSize;
}

export type IconPrefix = "far" | "fas";

export interface LayerProps {
  children: ReactChildren;
}

export interface AccessibilityProps {
  accessibilityLabel: string;
  accessibilityHint: string;
  /**
   * RN/RNW accessibility role (e.g. "button") for a clickable Box. Optional —
   * most onClick Boxes get an implicit button role already (see Box.tsx); set
   * this explicitly when a screen-reader-facing role needs to be guaranteed
   * (e.g. a badge that opens a sheet).
   */
  accessibilityRole?: string;
}

export interface BoxPropsBase extends WithTestID {
  alignContent?: AlignContent;
  alignItems?: AlignItems;
  alignSelf?: AlignSelf;
  bottom?: boolean;
  children?: ReactChildren;
  color?: BoxColor;
  column?: UnsignedUpTo12;
  smColumn?: UnsignedUpTo12;
  mdColumn?: UnsignedUpTo12;
  lgColumn?: UnsignedUpTo12;
  dangerouslySetInlineStyle?: {
    __style: {
      [key: string]: unknown;
    };
  };
  direction?: "row" | "column";
  smDirection?: "row" | "column";
  mdDirection?: "row" | "column";
  lgDirection?: "row" | "column";
  xlDirection?: "row" | "column";
  display?: "none" | "flex" | "block" | "inlineBlock" | "visuallyHidden";
  smDisplay?: "none" | "flex" | "block" | "inlineBlock" | "visuallyHidden";
  mdDisplay?: "none" | "flex" | "block" | "inlineBlock" | "visuallyHidden";
  lgDisplay?: "none" | "flex" | "block" | "inlineBlock" | "visuallyHidden";
  fit?: boolean;
  flex?: "grow" | "shrink" | "none";
  gap?: SignedUpTo12;
  height?: NumberOrPercentage;
  justifyContent?: "start" | "end" | "center" | "between" | "around";
  left?: boolean;
  margin?: SignedUpTo12;
  smMargin?: SignedUpTo12;
  mdMargin?: SignedUpTo12;
  lgMargin?: SignedUpTo12;
  marginBottom?: SignedUpTo12;
  smMarginBottom?: SignedUpTo12;
  mdMarginBottom?: SignedUpTo12;
  lgMarginBottom?: SignedUpTo12;
  marginEnd?: SignedUpTo12;
  smMarginEnd?: SignedUpTo12;
  mdMarginEnd?: SignedUpTo12;
  lgMarginEnd?: SignedUpTo12;
  marginLeft?: SignedUpTo12;
  smMarginLeft?: SignedUpTo12;
  mdMarginLeft?: SignedUpTo12;
  lgMarginLeft?: SignedUpTo12;
  marginRight?: SignedUpTo12;
  smMarginRight?: SignedUpTo12;
  mdMarginRight?: SignedUpTo12;
  lgMarginRight?: SignedUpTo12;
  marginStart?: SignedUpTo12;
  smMarginStart?: SignedUpTo12;
  mdMarginStart?: SignedUpTo12;
  lgMarginStart?: SignedUpTo12;
  marginTop?: SignedUpTo12;
  smMarginTop?: SignedUpTo12;
  mdMarginTop?: SignedUpTo12;
  lgMarginTop?: SignedUpTo12;
  maxHeight?: NumberOrPercentage;
  maxWidth?: NumberOrPercentage;
  minHeight?: NumberOrPercentage;
  minWidth?: NumberOrPercentage;
  overflow?: "visible" | "hidden" | "scroll" | "scrollX" | "scrollY" | "auto";
  padding?: UnsignedUpTo12;
  smPadding?: UnsignedUpTo12;
  mdPadding?: UnsignedUpTo12;
  lgPadding?: UnsignedUpTo12;
  paddingX?: UnsignedUpTo12;
  smPaddingX?: UnsignedUpTo12;
  mdPaddingX?: UnsignedUpTo12;
  lgPaddingX?: UnsignedUpTo12;
  paddingY?: UnsignedUpTo12;
  smPaddingY?: UnsignedUpTo12;
  mdPaddingY?: UnsignedUpTo12;
  lgPaddingY?: UnsignedUpTo12;
  position?: "static" | "absolute" | "relative" | "fixed";
  right?: boolean;
  rounding?: Rounding | "circle";
  top?: boolean;
  width?: NumberOrPercentage;
  wrap?: boolean;
  zIndex?: number | "auto";

  onClick?: () => void | Promise<void>;
  className?: string;
  style?: StyleProp<ViewStyle>;
  onHoverStart?: () => void | Promise<void>;
  onHoverEnd?: () => void | Promise<void>;
  scroll?: boolean;
  shadow?: boolean;
  border?: BorderColor;
  borderBottom?: BorderColor;
  borderTop?: BorderColor;
  borderLeft?: BorderColor;
  borderRight?: BorderColor;

  avoidKeyboard?: boolean;
  keyboardOffset?: number;
  scrollRef?: React.RefObject<ScrollView | null>;
  onScroll?: (offsetY: number) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

// If onClick is provided, add accessibility props.
export type BoxProps =
  | (BoxPropsBase & {onClick?: undefined})
  | (BoxPropsBase & {onClick: () => void} & AccessibilityProps);
export type BoxColor = SurfaceColor | "transparent";

export type CardProps = BoxProps & {
  /**
   * The visual variant of the card.
   * - "container": A simple surface wrapper for arbitrary children (default).
   * - "display": A structured card with a colored header, title, description, and optional action button.
   * @default "container"
   */
  variant?: "container" | "display";

  /**
   * The size of the display card.
   * - "large": On desktop, horizontal layout with image/header on the left (160px wide). On mobile, vertical with a full-width image.
   * - "default": 600px wide with the same horizontal layout as large on desktop. On mobile, vertical layout with a full-width image.
   * - "small": Always vertical layout — image/header stacked above content (160px wide on mobile).
   * @default "default"
   */
  size?: "small" | "default" | "large";

  /**
   * The title displayed in the card body. Used in the "display" variant.
   */
  title?: string;

  /**
   * A short description displayed below the title. Used in the "display" variant.
   */
  description?: string;

  /**
   * The label for the action button. Used in the "display" variant.
   */
  buttonText?: string;

  /**
   * Callback invoked when the action button is pressed. Used in the "display" variant.
   */
  buttonOnClick?: () => void | Promise<void>;

  /**
   * URI of an image to display at the top of the card. When provided in the "display" variant,
   * replaces the colored header with a full-width cover image.
   */
  imageUri?: string;

  /**
   * Accessibility label for the card image.
   */
  imageAlt?: string;

  /**
   * Height in pixels for the image area when imageUri is provided.
   * @default 160
   */
  imageHeight?: number;
};

export type EditableCardProps = BoxProps & {
  /**
   * The name of an icon shown before the title.
   */
  iconName?: IconName;

  /**
   * The title of the summarized information.
   */
  title?: string;

  /**
   * Props for a badge rendered next to the title.
   */
  badge?: BadgeProps;

  /**
   * The summarized information itself, displayed below the title.
   */
  description?: string;

  /**
   * Secondary text displayed below the description, in a muted style.
   */
  helperText?: string;

  /**
   * Callback invoked when the edit button is pressed. The edit button is only rendered when this
   * is provided.
   */
  onEdit?: () => void | Promise<void>;

  /**
   * Accessibility label for the edit button.
   * @default "Edit"
   */
  editAccessibilityLabel?: string;

  /**
   * If true, the card is highlighted to draw attention to it, e.g. for content that needs review.
   * @default false
   */
  attention?: boolean;
};

export interface ErrorBoundaryProps {
  onError?: (error: Error, stack: string) => void;
  children?: ReactNode;
}

export interface IconProps extends WithTestID {
  iconName: IconName;
  type?:
    | "regular"
    | "brand"
    | "solid"
    | "light"
    | "thin"
    | "duotone"
    | "sharpSolid"
    | "sharpLight"
    | "sharp";
  color?: IconColor;
  size?: IconSize;
}

export type TooltipPosition = "top" | "bottom" | "left" | "right";

export type IndicatorDirection = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export interface SegmentedControlBadgeConfig {
  count: number;
  status?: "info" | "error" | "warning" | "success" | "neutral";
}

export interface SegmentedControlProps extends WithTestID {
  testIDs?: SegmentedControlTestIDs;
  items: string[];
  size?: "md" | "lg"; // default "md"
  onChange: (activeIndex: number) => void;
  selectedIndex?: number;
  maxItems?: number;
  badges?: SegmentedControlBadgeConfig[];
}

export interface TimezonePickerProps {
  timezone?: string;
  onChange: (tz: string | undefined) => void | Promise<void>;
  showLabel?: boolean; // defaults to true
  width?: number | string; // defaults to 100
}

// extend TextStyle to include "outline" since it exists for web
export interface TextStyleWithOutline extends TextStyle {
  outline?: string;
}

interface BaseFieldProps extends WithTestID {
  id?: string;
  testIDs?: FieldTestIDs;
  title?: string;
  placeholder?: string;
  iconName?: IconName;
  onIconClick?: () => void;
  onBlur?: OnChangeCallback;
  onChange: OnChangeCallback;
  onEnter?: () => void;
  onFocus?: () => void;
  onSubmitEditing?: () => void;
  blurOnSubmit?: boolean;
  disabled?: boolean; // default false
  value?: string;
}

export interface HelperTextProps {
  helperText?: string;
}

export interface ErrorTextProps {
  errorText?: string;
}

export interface AiSuggestionProps {
  /**
   * Persisted suggestion state. `ready` renders expanded; `hidden` and `added` render
   * condensed into the collapsed header row (re-expandable with "Show") so a hidden or
   * accepted suggestion never disappears entirely.
   */
  status: "not-started" | "generating" | "ready" | "added" | "hidden";
  text?: string;
  /** Adds the suggestion text to the note. Stays available after adding for re-adds. */
  onAdd?: () => void;
  /** Persists a hide. Called for any non-`added` status when the user presses "Hide". */
  onHide?: () => void;
  /** Persists an un-hide. Called for any non-`added` status when the user presses "Show". */
  onShow?: () => void;
  onFeedback?: (feedback: "like" | "dislike" | null) => void;
  feedback?: "like" | "dislike" | null;
  notStartedText?: string;
  generatingText?: string;
}

export interface TextFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {
  type?: "email" | "password" | "phoneNumber" | "search" | "text" | "url";

  /**
   * Renders the show/hide eye control on `type="password"`. Set to `false` for fields where
   * revealing the value is not acceptable, such as a shared or on-camera screen.
   * @default true
   */
  showVisibilityToggle?: boolean;

  autoComplete?: "current-password" | "on" | "off" | "username";
  returnKeyType?: "done" | "go" | "next" | "search" | "send";

  grow?: boolean;
  multiline?: boolean;
  rows?: number;

  inputRef?: (ref: TextInput | null) => void;
  trimOnBlur?: boolean;

  aiSuggestion?: AiSuggestionProps;
}

export interface TextAreaProps extends Omit<TextFieldProps, "multiline" | "type"> {}

export interface NumberFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {
  type: "number" | "decimal";
  min?: number;
  max?: number;
}

export interface NumberRangeFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {
  type: "numberRange" | "decimalRange";
  min: number;
  max: number;
}

export interface DateTimeFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {
  type: "date" | "datetime" | "time";
  value?: string; // ISO string always
  onChange: (date: string) => void;
  onTimezoneChange?: (timezone: string) => void;
  dateFormat?: string;
  pickerType?: "default" | "compact" | "inline" | "spinner";
  showTimezone?: boolean; // defaults to true
  timezone?: string;
}

export interface EmailFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {}

export interface PhoneNumberFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {
  /**
   * Defaults to "US"
   */
  defaultCountryCode?: CountryCode;
}

export interface URLFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {}

export interface SearchFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {}

export interface PercentFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {}

export interface CurrencyFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {}

export interface HeightFieldProps extends BaseFieldProps, HelperTextProps, ErrorTextProps {
  /** Minimum height in total inches */
  min?: number;
  /** Maximum height in total inches */
  max?: number;
}

export interface AddressFieldProps
  extends Omit<BaseFieldProps, "value" | "onChange" | "onBlur">,
    HelperTextProps,
    ErrorTextProps {
  includeCounty?: boolean;
  googleMapsApiKey?: string;
  googlePlacesMobileStyles?: Styles;
  value: AddressInterface;
  onChange: (value: AddressInterface) => void;
  onBlur?: (value: AddressInterface) => void;
}

export type Rounding =
  | "minimal" // alias "sm"
  | "default" // alias "md"
  | "full" // alias "lg"
  | "rounded" // alias "3xl"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl";

const ROUNDING_MAP = {
  "2xl": 128,
  "3xl": 360,
  default: 3,
  full: 16,
  lg: 16,
  md: 4,
  minimal: 2,
  rounded: 360,
  sm: 2,
  xl: 32,
};

export const getRounding = (rounding: Rounding) => {
  return ROUNDING_MAP[rounding];
};

export interface HeadingProps extends WithTestID {
  align?: "left" | "right" | "center" | "justify"; // default "left"
  children?: React.ReactNode;
  color?: TextColor;
  overflow?: "normal" | "breakWord"; // default "breakWord"
  size?: "sm" | "md" | "lg" | "xl" | "2xl"; // default "sm"
  truncate?: boolean; // default false
}

export interface MetaProps {
  itemProp?: string;
  content?: string;
  itemType?: string;
  key?: string;
  property?: string;
  children?: ReactNode;
}

export interface ImageProps {
  alt?: string;
  color: BoxColor;
  naturalHeight?: number;
  naturalWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  src: string;
  children?: ReactChildren;
  fit?: "cover" | "contain" | "none";
  onError?: () => void;
  onLoad?: () => void;
  size?: string;
  srcSet?: string;
  fullWidth?: boolean;
  style?: ImageStyle;
}

export interface BackButtonInterface {
  onBack: () => void;
}

export interface BooleanFieldProps extends WithTestID, HelperTextProps, ErrorTextProps {
  testIDs?: FieldTestIDs;
  title?: string;
  variant?: "simple" | "title"; // default "simple"
  disabled?: boolean;
  disabledHelperText?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export interface CheckBoxProps extends WithTestID {
  /**
   * The background color of the checkbox.
   * @default "default"
   */
  bgColor?: "default" | "accent" | "black";

  /**
   * If true, the checkbox is selected.
   */
  selected: boolean;

  /**
   * The size of the checkbox.
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
}

export interface LayoutRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutChangeEvent {
  nativeEvent: {
    layout: LayoutRectangle;
  };
}

export interface SplitPageListItem {
  id: string;
}

export interface SplitPageProps<TItem extends SplitPageListItem = SplitPageListItem> {
  /**
   * can accept either one React Child or any array of ReactChild. If this is not provided,
   * renderContent must return one or many ReactChild.
   */
  children?: ReactChild | ReactChild[] | null;
  /**
   * The names of the tabs that will be generated per ReactChild provided.
   * Tabs will not be generated if renderContent is provided in place of children
   */
  tabs?: string[];
  // The select limit for the number of tabs that can be selected
  selectLimit?: number;
  // Provide in mobile if you have a bottomTabBar so that split page can adjust accordingly
  bottomNavBarHeight?: number;
  // boolean to initiate and handle state from the app that has imported @terreno/ui
  showItemList?: boolean;
  loading?: boolean;
  color?: SurfaceColor;
  keyboardOffset?: number;
  renderListViewItem: (itemInfo: ListRenderItemInfo<TItem>) => ReactElement | null;
  renderListViewHeader?: () => ReactElement | null;
  renderContent?: (index?: number) => ReactElement | ReactElement[] | null;
  listViewData: TItem[];
  listViewExtraData?: unknown;
  listViewWidth?: number;
  listViewMaxWidth?: number;
  renderChild?: () => ReactChild;
  onSelectionChange?: (value?: ListRenderItemInfo<TItem>) => void | Promise<void>;
}

export type PermissionKind =
  | "location"
  | "locationAlways"
  | "camera"
  | "microphone"
  | "photo"
  | "contacts"
  | "event"
  | "reminder"
  | "bluetooth"
  | "notification"
  | "backgroundRefresh"
  | "speechRecognition"
  | "mediaLibrary"
  | "motion";
export type PermissionStatus =
  | "authorized"
  | "denied"
  | "softDenied"
  | "restricted"
  | "undetermined";

export interface AddressInterface {
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zipcode: string;
  countyName?: string;
  countyCode?: string;
}

export interface TransformValueOptions {
  func?: (value: string) => string;
  options?: {
    [key: string]: unknown;
  };
}

// TODO: Tighten up type to exclude string, which is almost never an acceptable type for React
// Native children (except Heading or Text for example.).
export type ReactChild = ReactNode;
export type ReactChildren = ReactNode;
export type WithChildren<P> = P & {children?: ReactNode};

export interface AddressAutocompleteProps extends WithTestID {
  disabled?: boolean;
  googleMapsApiKey?: string;
  includeCounty?: boolean;
  inputValue: string;
  styles?: Styles;
  handleAddressChange: OnChangeCallback;
  handleAutoCompleteChange: (value: AddressInterface) => void;
  googlePlacesMobileStyles?: Styles;
}

export interface ActionSheetProps extends WithTestID {
  children?: React.ReactNode;
  ref?: React.MutableRefObject<{
    /**
     * Open or close the ActionSheet.
     */
    setModalVisible(visible?: boolean): void;

    /**
     * Open the Action Sheet.
     */
    show(): void;

    /**
     * Close the ActionSheet.
     */
    hide(): void;

    /**
     * Attach this to any child ScrollView Component's onScrollEndDrag,
     * onMomentumScrollEnd,onScrollAnimationEnd callbacks to handle the ActionSheet
     * closing and bouncing back properly.
     */
    handleChildScrollEnd(): void;

    /**
     * Snap ActionSheet to given offset
     */
    snapToOffset(offset: number): void;
  }>;
  /**
   * Animate the opening and closing of ActionSheet.

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `true`
   */
  animated?: boolean;

  /**
   * Use if you want to show the ActionSheet Partially on Opening.
   * **Requires `gestureEnabled=true`**

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default:`1`
   */

  initialOffsetFromBottom?: number;

  /**
   * When touch ends and user has not moved farther from the set springOffset,
   * the ActionSheet will return to previous position.

   | Type | Required |
   | ---- | -------- |
   | number | no |

   Default: `50`
   */
  springOffset?: number;
  /**
   * Add elevation to the ActionSheet container.

   | Type | Required |
   | ---- | -------- |
   | number | no |

   Default: `0`

   #
   */
  elevation?: number;

  /**
   * Color of the gestureEnabled Indicator.

   | Type | Required |
   | ---- | -------- |
   | string | no |

   Default: `"#f0f0f0"`
   */
  indicatorColor?: string;

  /**
   * Normally when the ActionSheet is fully opened, a small portion from the bottom is hidden by
   * default. Use this prop if you want the ActionSheet to hover over the bottom of screen and not
   * hide a little behind it.

   | Type | Required |
   | ---- | -------- |
   | number | no |

   Default:`0`
   */
  extraScroll?: number;
  /**
   * Color of the overlay/backdrop.

   | Type | Required |
   | ---- | -------- |
   | string | no |

   Default: `"black"`
   */
  overlayColor?: string;

  /**
   * Keep the header always visible even when gestures are disabled.

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `false`
   */
  headerAlwaysVisible?: boolean;

  /**
   * Delay draw of ActionSheet on open for android.

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `false`
   */

  delayActionSheetDraw?: boolean;

  /**
   * Delay draw of ActionSheet on open for android time.

   | Type | Required |
   | ---- | -------- |
   | number (ms) | no |

   Default: `50`
   */

  delayActionSheetDrawTime?: number;

  /**
   * Your custom header component. Using this will hide the default indicator.

   | Type | Required |
   | ---- | -------- |
   | React.Component | no |
   */
  CustomHeaderComponent?: React.ReactNode;

  /**
   * Any custom styles for the container.

   | Type | Required |
   | ---- | -------- |
   | Object | no |
   */
  containerStyle?: ViewStyle;

  /**
   * Control closing ActionSheet by touching on backdrop.

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `true`
   */
  closeOnTouchBackdrop?: boolean;

  /**
   * Speed of opening animation. Higher means the ActionSheet will open more quickly.

   | Type | Required |
   | ---- | -------- |
   | number | no |

   Default: `12`
   */
  openAnimationSpeed?: number;
  /**
   * Duration of closing animation.

   | Type | Required |
   | ---- | -------- |
   | number | no |

   Default: `300`
   */
  closeAnimationDuration?: number;
  /**
   *
   How much you want the ActionSheet to bounce when it is opened.

   | Type | Required |
   | ---- | -------- |
   | number | no |

   Default: `8`
   */
  bounciness?: number;

  /**
   * Will the ActionSheet close on `hardwareBackPress` event.

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `true`
   */
  closeOnPressBack?: boolean;
  /**
   * Default opacity of the overlay/backdrop.

   | Type | Required |
   | ---- | -------- |
   | number 0 - 1 | no |

   Default: `0.3`
   */
  defaultOverlayOpacity?: number;

  /**
   * Enables gesture control of ActionSheet

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `false`
   */
  gestureEnabled?: boolean;

  /**
   * Bounces the ActionSheet on open.

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `false`
   */
  bounceOnOpen?: boolean;

  /**
   * Setting the keyboard persistence of the ScrollView component, should be one of "never",
   * "always", or "handled"

   | Type | Required |
   | ---- | -------- |
   | string | no |

   Default: `"never"`
   */
  keyboardShouldPersistTaps?: boolean | "always" | "never" | "handled";

  /**
   * Determine whether the modal should go under the system statusbar.

   | Type | Required |
   | ---- | -------- |
   | boolean | no |

   Default: `true`
   */
  statusBarTranslucent?: boolean;

  /**
   * Prevent ActionSheet from closing on
   * gesture or tapping on backdrop.
   * Instead snap it to `bottomOffset` location
   *
   *
   * | Type | Required |
   | ---- | -------- |
   | boolean | no |
   */
  closable?: boolean;

  /**
   * Allow ActionSheet to draw under the StatusBar.
   * This is enabled by default.
   *
   *
   * | Type | Required |
   | ---- | -------- |
   | boolean | no |
   Default: `true`
   */
  drawUnderStatusBar?: boolean;

  /**
   * Snap ActionSheet to this location if `closable` is set to false;
   *
   *
   * | Type | Required |
   | ---- | -------- |
   | number | no |
   */

  bottomOffset?: number;

  /**
   * Change how ActionSheet behaves when keyboard is opened.
   *
   *
   * | Type | Required |
   | ---- | -------- |
   | "padding" | "position" | no |
   Default:`padding`
   */

  keyboardMode?: "padding" | "position";

  /**
   *
   Event called when the ActionSheet closes.


   * | Type | Required |
   | ---- | -------- |
   | function | no |


   #
   */

  onClose?: () => void;

  /**
   * An event called when the ActionSheet Opens.

   | Type | Required |
   | ---- | -------- |
   | function | no |
   */
  onOpen?: () => void;

  /**
   * Event called when position of ActionSheet changes.
   */
  onPositionChanged?: (hasReachedTop: boolean) => void;
}

export type AvatarStatus = "offline" | "online" | "outOfOffice" | "activeMobile" | "imagePicker";

export interface AvatarImagePickerEvent {
  avatarImageFormat?: string;
  base64?: string;
  uri?: string;
  height?: number;
  width?: number;
}

export interface CustomSvgProps extends SvgProps {
  doNotDisturb?: boolean;
}

export interface AvatarProps extends WithTestID {
  /**
   * The name of the user. This is used for the placeholder treatment if an image is not available.
   */
  name: string;
  /**
   * Adds a white border around Avatar so it's visible when displayed on other images.
   */
  hasBorder?: boolean;
  /**
   * xs: 24px, sm: 32px, md: 48px, lg: 64px, xl: 120px.
   */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /**
   * The URL of the user's image.
   */
  src?: string;
  /**
   * Function to handle the avatar image edit
   */
  onChange?: (val: AvatarImagePickerEvent) => void;
  /**
   * The status of the user to display with the avatar.
   */
  status?: AvatarStatus;
  /**
   * If true, the status will have a "Z" to indicate the user has snoozed notifications.
   */
  doNotDisturb?: boolean;
  /**
   * Accessibility label for the avatar image.
   */
  accessibilityLabel?: string;
}

export interface BadgeProps extends WithTestID {
  /**
   * When status is "custom", determines the badge's background color.
   */
  customBackgroundColor?: string;
  /**
   * When status is "custom", determines the badge's border color.
   */
  customBorderColor?: string;
  /**
   * When status is "custom", determines the badge's icon color
   */
  customIconColor?: IconColor;
  /**
   * When status is "custom", determines the badge's icon
   */
  customIconName?: IconName;
  /**
   * When status is "custom", determines the badge's text color.
   */
  customTextColor?: string;
  /**
   * The name of the icon to display in the badge.
   */
  iconName?: IconName;

  // TODO: improve type discrimination
  // used for numberOnly variant to display "${maxValue}+" when value is greater than max

  /**
   * The maximum value to display. Used for "numberOnly" variant to display "${maxValue}+" when
   * value is greater than max.
   */
  maxValue?: number;

  /**
   * If true, the badge will have a secondary style.
   * @default false
   */
  secondary?: boolean;

  /**
   * The status of the badge. Determines its color and appearance.
   * @default "info"
   */
  status?: "info" | "error" | "warning" | "success" | "neutral" | "active" | "custom";

  /**
   * For the "status" variant, whether the dot uses the bold (saturated) or
   * subtle (light) tone.
   * @default "bold"
   */
  color?: "bold" | "subtle";

  /**
   * The text or number to display inside the badge.
   */
  value?: number | string;

  /**
   * The variant of the badge. "status" renders a small colored dot (no text)
   * used to indicate an active/modified state.
   */
  variant?: "iconOnly" | "numberOnly" | "status";
}

export type ThumbsUpDownFeedbackValue = "positive" | "negative";

export interface ThumbsUpDownFeedbackProps extends WithTestID {
  /**
   * If true, both options are non-interactive and rendered in a muted color.
   * @default false
   */
  disabled?: boolean;
  /**
   * Accessibility label for the negative (thumbs down) option.
   * @default "Thumbs down"
   */
  negativeAccessibilityLabel?: string;
  /**
   * Called with the newly selected value, or undefined when the current value is deselected.
   */
  onChange: (value?: ThumbsUpDownFeedbackValue) => void | Promise<void>;
  /**
   * Accessibility label for the positive (thumbs up) option.
   * @default "Thumbs up"
   */
  positiveAccessibilityLabel?: string;
  /**
   * The currently selected feedback. Leave undefined for no selection.
   */
  value?: ThumbsUpDownFeedbackValue;
}

export type PopoverStatus = "loading" | "loaded" | "error";

export interface PopoverProps extends WithTestID {
  /**
   * The body of the document, rendered under the header when status is "loaded". Use this for
   * rich content; prefer `text` for a plain summary.
   */
  children?: React.ReactNode;
  /**
   * Supporting copy shown under the error title.
   * @default "Something went wrong while loading this document. Check your connection and try again."
   */
  errorText?: string;
  /**
   * Title shown in the error state.
   * @default "Couldn't load this document"
   */
  errorTitle?: string;
  /**
   * The currently selected feedback on the document. Only shown when `onFeedbackChange` is set.
   */
  feedback?: ThumbsUpDownFeedbackValue;
  /**
   * Height of the popover. The popover is the same height in every status: the body scrolls when
   * it overflows, and the spinner and error message are centered in the remaining space.
   * @default 480
   */
  height?: NumberOrPercentage;
  /**
   * Header text shown while the document is loading.
   * @default "Loading document..."
   */
  loadingText?: string;
  /**
   * Called when the close button is pressed.
   */
  onClose: () => void | Promise<void>;
  /**
   * Called with the newly selected feedback, or undefined when the current value is deselected.
   * When omitted, the thumbs up/down controls are hidden.
   */
  onFeedbackChange?: (value?: ThumbsUpDownFeedbackValue) => void | Promise<void>;
  /**
   * Called when the "Open" action is pressed. When omitted, the action is hidden.
   */
  onOpen?: () => void | Promise<void>;
  /**
   * Called when the "Try again" button is pressed in the error state. When omitted, the button
   * is hidden.
   */
  onRetry?: () => void | Promise<void>;
  /**
   * Text of the action that opens the full document.
   * @default "Open"
   */
  openText?: string;
  /**
   * Text of the button that retries loading in the error state.
   * @default "Try again"
   */
  retryText?: string;
  /**
   * The state of the document being previewed.
   * @default "loaded"
   */
  status?: PopoverStatus;
  /**
   * Secondary header line, usually the document's date.
   */
  subtitle?: string;
  /**
   * A plain text summary of the document, rendered when no `children` are provided.
   */
  text?: string;
  /**
   * The document's title, shown in the header when status is "loaded".
   */
  title?: string;
  /**
   * Width of the popover.
   * @default 480
   */
  width?: NumberOrPercentage;
}

export interface SelectBadgeProps {
  /**
   * When status is "custom", determines the badge's background color.
   */
  customBackgroundColor?: string;
  /**
   * When status is "custom", determines the badge's border color.
   */
  customBorderColor?: string;
  /**
   * When status is "custom", determines the badge's text color.
   */
  customTextColor?: string;
  /**
   * If true, the badge will be disabled and not interactive.
   * @default false
   */
  disabled?: boolean;
  /**
   * The options available for the dropdown badge.
   * Each option should have a label and a value.
   */
  options: FieldOption[];
  /**
   * The current value of the select field.
   */
  value?: string;
  /**
   * If true, the badge will have a secondary style.
   * @default false
   */
  secondary?: boolean;
  /**
   * The status of the badge. Determines its color and appearance.
   * @default "info"
   */
  status?: "info" | "error" | "warning" | "success" | "neutral" | "custom";
  /**
   * The function to call when the selected value changes.
   */
  onChange: (value: string) => void;
}

export interface BannerButtonProps {
  /**
   * Text to display on optional banner button, will display button if provided
   */
  buttonText: string;
  /**
   * Icon to display on optional banner button
   */
  buttonIconName?: IconName;
}

export interface BannerPropsBase {
  /**
   * Used to identify if banner has been dismissed by the user.
   * When provided, dismissal state is persisted to AsyncStorage.
   * When omitted, dismissal is ephemeral (resets on remount).
   */
  id?: string;
  /**
   * The text to display in the main body of the banner.
   */
  text: string;
  /**
   * The status of the banner changes the color of the banner.
   * @default "info"
   */
  status?: "info" | "alert" | "warning";
  /**
   * Allows the banner to be dismissed and removed by clicking X button on the right.
   * @default false
   */
  dismissible?: boolean; // default false
  /**
   * Renders triangle with exclamation mark icon to the left of banner content.
   * @default false
   */
  hasIcon?: boolean;
  /**
   * Function called when optional button on banner is clicked.
   */
  buttonOnClick?: () => void | Promise<void>;
}

export type BannerProps =
  | (BannerPropsBase & {buttonOnClick?: undefined})
  | (BannerPropsBase & {buttonOnClick: () => void | Promise<void>} & BannerButtonProps);

export interface BodyProps {
  scroll?: boolean;
  loading?: boolean;
  padding?: UnsignedUpTo12;
  height?: number | string;
  avoidKeyboard?: boolean; // default true
  children?: ReactNode;
}

export type ButtonPressAnimation = "scale" | "opacity" | "none";

export interface ButtonProps extends WithTestID {
  /** Accessible name. Defaults to `text`. */
  accessibilityLabel?: string;
  /**
   * The text content of the confirmation modal.
   * @default "Are you sure you want to continue?"
   */
  confirmationText?: string;
  /**
   * If true, the button will be disabled.
   * @default false
   */
  disabled?: boolean;
  /**
   * If true, the button will take the full width of its container.
   * @default false
   */
  fullWidth?: boolean;
  /**
   * The name of the icon to display in the button.
   */
  iconName?: IconName;
  /**
   * The position of the icon within the button.
   * @default "left"
   */
  iconPosition?: "left" | "right";
  /**
   * If true, a loading spinner will be shown in the button.
   */
  loading?: boolean;
  /**
   * The title of the confirmation modal.
   * @default "Confirm"
   */
  modalTitle?: string;
  /**
   * The subtitle of the confirmation modal.
   */
  modalSubTitle?: string;
  /**
   * The press animation to use when the button is touched.
   * @default "scale"
   */
  pressAnimation?: ButtonPressAnimation;
  /**
   * The text content of the button.
   */
  text: string;
  /**
   * The position of the tooltip.
   */
  tooltipIdealPosition?: TooltipPosition;
  /**
   * Include an arrow in the tooltip. Pointing to the button.
   * @default false
   */
  tooltipIncludeArrow?: boolean;
  /**
   * The text content of the tooltip.
   */
  tooltipText?: string;
  /**
   * The size of the button.
   * @default "default"
   */
  size?: "default" | "sm";
  /**
   * Controls the button's interaction state. Use Default for standard button appearance
   * and Active to indicate a selected or currently engaged state.
   * @default "default"
   */
  state?: "default" | "active";
  /**
   * The type of the button, which determines its style.
   * @default "primary"
   */
  variant?: "primary" | "secondary" | "muted" | "outline" | "destructive" | "ghost";
  /**
   * If true, a confirmation modal will be shown before the onClick action.
   */
  withConfirmation?: boolean;
  /**
   * The function to call when the button is clicked.
   */
  onClick: () => void | Promise<void>;
}

/**
 * Props for the SocialLoginButton component.
 * Used for OAuth social login buttons (Google, GitHub, Apple).
 */
export interface SocialLoginButtonProps extends WithTestID {
  /**
   * The OAuth provider for the social login.
   */
  provider: "google" | "github" | "apple";

  /**
   * The function to call when the button is pressed.
   * Should initiate the OAuth flow.
   */
  onPress: () => Promise<void>;

  /**
   * If true, a loading spinner will be shown in the button.
   */
  loading?: boolean;

  /**
   * The visual variant of the button.
   * - "primary": Uses the provider's brand colors
   * - "outline": Uses an outline style with neutral colors
   * @default "primary"
   */
  variant?: "primary" | "outline";

  /**
   * If true, the button will be disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * If true, the button will take the full width of its container.
   * @default true
   */
  fullWidth?: boolean;

  /**
   * Custom text for the button. Defaults to "Continue with {Provider}".
   */
  text?: string;
}

export interface CustomSelectFieldProps extends WithTestID {
  testIDs?: FieldTestIDs;
  /**
   * The current value of the custom select field.
   */
  value: string | undefined;

  /**
   * The function to call when the custom select field value changes.
   */
  onChange: (value: string | undefined) => void;

  /**
   * The options available for selection in the select field.
   * Each option should have a label and a value.
   */
  options: FieldOption[];

  /**
   * The placeholder text to display when no option is selected.
   */

  placeholder?: string;
  /**
   * If true, the select field will be disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * The error text to display if there is an error.
   */
  errorText?: string;

  /**
   * The helper text to display below the select field.
   */
  helperText?: string;

  /**
   * The title of the custom select field.
   */
  title?: string;

  /**
   * When true, hides the type-to-filter search UI. Search is enabled by default.
   * @default false
   */
  disableSearch?: boolean;
}

export interface DateTimeActionSheetProps {
  value?: string;
  type?: "date" | "time" | "datetime";
  // Returns an ISO 8601 string. If mode is "time", the date portion is today.
  onChange: OnChangeCallback;
  // noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  // biome-ignore lint/suspicious/noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  actionSheetRef: React.RefObject<any>;
  visible: boolean;
  onDismiss: () => void;
  timezone?: string;
}

export interface DecimalRangeActionSheetProps {
  value: string;
  min: number;
  max: number;
  onChange: OnChangeCallback;
  // noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  // biome-ignore lint/suspicious/noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  actionSheetRef: React.RefObject<any>;
}

export interface DecimalRangeActionSheetState {
  whole: string;
  decimal: string;
}

export interface DismissButtonProps {
  /**
   * The accessibility hint describes the results of performing an action on a control or view.
   * It should be a very brief description of the result of interacting with the button.
   */
  accessibilityHint: string;

  /**
   * The accessibility label attribute identifies the user interface element.
   * It should be a very brief description of the element, such as "Dismiss".
   */
  accessibilityLabel: string;
  /**
   * A function to call when the button is clicked,
   * function should result in hiding the element rendering the dismiss button.
   */
  onClick: () => void;
  /**
   * Color of the icon on the dismiss button
   * @default "primary"
   */
  color?: IconColor;
}
export interface ErrorPageProps {
  error: Error;
  resetError: () => void;
}

export type FieldProps =
  | TextFieldProps
  | NumberFieldProps
  | NumberRangeFieldProps
  | DateTimeFieldProps
  | (MultiselectFieldProps & {type: "multiselect"})
  | (TextAreaProps & {type: "textarea"})
  | (SelectFieldProps & {type: "select"})
  | (CustomSelectFieldProps & {type: "customSelect"})
  | (EmailFieldProps & {type: "email"})
  | (PhoneNumberFieldProps & {type: "phoneNumber"})
  | (BooleanFieldProps & {type: "boolean"})
  | (RadioFieldProps & {type: "radio"})
  | (SignatureFieldProps & {type: "signature"})
  | (SearchFieldProps & {type: "search"})
  | (AddressFieldProps & {type: "address"});
// | (CurrencyFieldProps & {type: "currency"});
// | (PercentFieldProps & {type: "percent"});
// | URLFieldProps

export interface HeightActionSheetProps {
  value?: string;
  onChange: OnChangeCallback;
  // noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  // biome-ignore lint/suspicious/noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  actionSheetRef: React.RefObject<any>;
  /** Minimum height in total inches */
  min?: number;
  /** Maximum height in total inches */
  max?: number;
  /** Title shown at the top of the action sheet */
  title?: string;
}

export interface LinkifyMatch {
  index: number;
  lastIndex: number;
  raw: string;
  schema: string;
  text: string;
  url: string;
}

export interface LinkifyItLike {
  pretest: (text: string) => boolean;
  test: (text: string) => boolean;
  match: (text: string) => LinkifyMatch[] | null;
}

export interface HyperlinkProps {
  linkDefault?: boolean;
  linkify?: LinkifyItLike;
  linkStyle?: StyleProp<TextStyle>;
  linkText?: string | ((url: string) => string);
  onPress?: (url: string) => void;
  onLongPress?: (url: string, text: string) => void;
  injectViewProps?: (url: string) => Record<string, unknown>;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle | TextStyle>;
}

export interface IconButtonProps extends WithTestID {
  /**
   * The accessibility hint describes the results of performing an action on a control or view.
   * It should be a very brief description of the result of interacting with the button.
   */
  accessibilityHint?: string;

  /**
   * The accessibility label attribute identifies the user interface element.
   * It should be a very brief description of the element, such as "Add", "Play", "Deleted", etc.
   */
  accessibilityLabel: string;

  /**
   * The heading of the confirmation modal.
   * @default "Confirm"
   */
  confirmationHeading?: string;

  /**
   * The text content of the confirmation modal.
   * @default "Are you sure you want to continue?"
   */
  confirmationText?: string;

  /**
   * If true, the button will be disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Show a small indicator icon in the lower right corner of the button.
   */
  indicator?: "error" | "warning" | "success" | "primary" | "neutral";

  /**
   * The text or number to display in the indicator. If not provided,
   * the indicator will be a solid circle.
   */
  indicatorText?: number | string;

  /**
   * The name of the icon to display in the button.
   */
  iconName: IconName;

  /**
   * If true, a loading spinner will be shown in the button.
   */
  loading?: boolean;

  /**
   * The size of the button.
   * @default "default"
   */
  size?: "default" | "sm";

  /**
   * Controls the button's interaction state. Use Default for standard button appearance
   * and Active to indicate a selected or currently engaged state.
   * @default "default"
   */
  state?: "default" | "active";

  /**
   * The ideal position of the tooltip.
   */
  tooltipIdealPosition?: TooltipPosition;

  /**
   * Include an arrow in the tooltip. Pointing to the button.
   * @default false
   */
  tooltipIncludeArrow?: boolean;

  /**
   * The text content of the tooltip.
   */
  tooltipText?: string;

  /**
   * The variant of the button, which determines its style.
   * @default "primary"
   */
  variant?: "primary" | "secondary" | "muted" | "destructive" | "navigation" | "ghost";

  /**
   * If true, a confirmation modal will be shown before the onClick action.
   * @default false
   */
  withConfirmation?: boolean;

  /**
   * The function to call when the button is clicked.
   */
  onClick: () => void | Promise<void>;
}

export interface InfoTooltipButtonProps {
  text: string;
  size?: IconSize;
}

export interface ModalProps extends WithTestID {
  testIDs?: ModalTestIDs;
  /**
   * The content of the modal.
   */
  children?: React.ReactElement;
  /**
   * If true, the modal will be closed when the background is clicked.
   * @default false
   */
  persistOnBackgroundClick?: boolean;
  /**
   * If true, the primary button will be disabled.
   * @default false
   */
  primaryButtonDisabled?: boolean;
  /**
   * The text content of the primary button.
   */
  primaryButtonText?: string;
  /**
   * The text content of the secondary button.
   */
  secondaryButtonText?: string;
  /**
   * The size of the modal.
   * @default "sm"
   */
  size?: "sm" | "md" | "lg";
  /**
   * The subtitle of the modal.
   */
  subtitle?: string;
  /**
   * The text content of the modal.
   */
  text?: string;
  /**
   * The title of the modal.
   */
  title?: string;
  /**
   * If true, the modal will be visible.
   */
  visible: boolean;
  /**
   */
  onDismiss: () => void;
  /**
   * The function to call when the primary button is clicked.
   */
  // noExplicitAny: callback value type varies by consumer context
  // biome-ignore lint/suspicious/noExplicitAny: callback value type varies by consumer context
  primaryButtonOnClick?: (value?: any) => void | Promise<void>;
  /**
   * The function to call when the secondary button is clicked.
   */
  // noExplicitAny: callback value type varies by consumer context
  // biome-ignore lint/suspicious/noExplicitAny: callback value type varies by consumer context
  secondaryButtonOnClick?: (value?: any) => void | Promise<void>;
}

export interface NumberPickerActionSheetProps {
  value: string;
  min: number;
  max: number;
  onChange: OnChangeCallback;
  // noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  // biome-ignore lint/suspicious/noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  actionSheetRef: React.RefObject<any>;
}

export interface PageProps extends WithTestID {
  // noExplicitAny: React Navigation type varies by navigation stack configuration
  // biome-ignore lint/suspicious/noExplicitAny: React Navigation type varies by navigation stack configuration
  navigation?: any;
  scroll?: boolean;
  loading?: boolean;
  loadingText?: string;
  display?: "flex" | "none" | "block" | "inlineBlock";
  title?: string;
  backButton?: boolean;
  /** When set, invoked instead of `router.back()` for the header back arrow. */
  onBack?: () => void;
  closeButton?: boolean;
  direction?: "row" | "column";
  padding?: UnsignedUpTo12;
  /** Page body surface; use `transparent` when a parent (e.g. admin shell) supplies the canvas color. */
  color?: BoxColor;
  maxWidth?: number | string;
  keyboardOffset?: number;
  footer?: ReactNode;
  rightButton?: string;
  rightButtonOnClick?: () => void;
  children?: ReactChildren;
  onError?: (error: Error, stack: string) => void;
  /**
   * When true, wraps content in SafeAreaView so it respects top/bottom device
   * insets (camera notches, home indicator, status bar). Opt-in to avoid
   * regressing existing screens that handle insets at the navigation level.
   */
  safeArea?: boolean;
}

export interface ProgressBarProps {
  color: SurfaceColor;
  completed: number;
}

export interface RadioProps {
  selected?: boolean;
}

export interface RadioFieldProps {
  title: string;
  variant?: "leftText" | "rightText"; // default "rightText"
  value: string;
  onChange: (value: string) => void;
  options: FieldOption[];
}

export interface SignatureFieldProps {
  disabled?: boolean; // default "default"
  value?: string;
  onChange: (value: string) => void;
  title?: string; // default "Signature"
  onStart?: () => void;
  onEnd?: () => void;
  disabledText?: string;
  errorText?: string;
  fullWidth?: boolean;
}

/**
 * A selectable signature typeface. `key` is the stable identifier consumers persist
 * (so a stored signature keeps rendering in the same style even if `fontFamily` or
 * `label` are later renamed); `fontFamily` is the loaded font family used for rendering;
 * `label` is the human-readable name shown in the font picker.
 */
export interface SignatureFont {
  key: string;
  label: string;
  fontFamily: string;
}

/**
 * The persisted value of a typed signature: the name the signer typed and the `key` of
 * the font they chose. Kept minimal so consumers can store it directly and re-render the
 * signature deterministically.
 */
export interface TypedSignatureValue {
  typedName: string;
  fontKey: string;
}

export interface TypedSignatureFieldProps extends WithTestID {
  testIDs?: FieldTestIDs;
  /** Section title rendered above the field. Defaults to "Signature". */
  title?: string;
  /** Controlled value. When omitted the field starts empty with the first font selected. */
  value?: TypedSignatureValue;
  onChange: (value: TypedSignatureValue) => void;
  /**
   * Selectable fonts. Defaults to the library's bundled signature fonts. When supplying a
   * custom list, the consumer is responsible for loading those font families (e.g. via
   * expo-font) so the preview renders correctly.
   */
  fonts?: SignatureFont[];
  /** Label for the name input. Defaults to "Full name". */
  nameLabel?: string;
  /** Placeholder for the name input. Defaults to "Type your full name". */
  placeholder?: string;
  helperText?: string;
  errorText?: string;
  disabled?: boolean; // default false
}

/** Which capture method the signer is using in a {@link SignatureCaptureFieldProps} field. */
export type SignatureMode = "draw" | "type";

/** A signature captured by drawing: a base64 PNG data URL. */
export interface DrawnSignatureValue {
  mode: "draw";
  image: string;
}

/** A signature captured by typing: a name plus the chosen font key. */
export interface TypedSignatureCaptureValue extends TypedSignatureValue {
  mode: "type";
}

/**
 * The persisted value of a signature capture field. The `mode` discriminant tells consumers
 * how to render it: `draw` carries a base64 PNG `image`; `type` carries a `typedName` and
 * `fontKey`.
 */
export type SignatureCaptureValue = DrawnSignatureValue | TypedSignatureCaptureValue;

export interface SignatureCaptureFieldProps extends WithTestID {
  testIDs?: FieldTestIDs;
  /** Section title rendered above the field. Defaults to "Signature". */
  title?: string;
  /** Controlled value. When omitted the field starts empty in `defaultMode`. */
  value?: SignatureCaptureValue;
  onChange: (value: SignatureCaptureValue) => void;
  /**
   * Which capture method is shown first when the field is empty. Ignored once `value` has a
   * mode. Defaults to "type".
   */
  defaultMode?: SignatureMode;
  /**
   * Fonts offered in "type" mode. Defaults to the library's bundled signature fonts. When
   * supplying a custom list, the consumer must load those font families themselves.
   */
  fonts?: SignatureFont[];
  /** Label for the typed name input. Defaults to "Full name". */
  nameLabel?: string;
  /** Placeholder for the typed name input. Defaults to "Type your full name". */
  placeholder?: string;
  /** Stretches the draw pad to the full available width. */
  fullWidth?: boolean;
  /** Fired when the signer starts drawing — use to disable a parent ScrollView. */
  onStart?: () => void;
  /** Fired when the signer stops drawing — use to re-enable a parent ScrollView. */
  onEnd?: () => void;
  helperText?: string;
  errorText?: string;
  disabled?: boolean; // default false
}

export interface SideDrawerProps {
  // Position of the drawer relative to the child
  position?: "right" | "left";
  // Used to open/hide drawer. Use the onClose and onOpen props to control state
  isOpen: boolean;
  // Content within the drawer
  renderContent: () => ReactElement | ReactElement[];
  // TODO: Allow the hardware back button on Android to close the SideDrawer
  onClose?: () => void;
  onOpen?: () => void;
  drawerType?: "front" | "back" | "slide" | "permanent";
  // Content that is wrapped by the drawer. The drawer will use the height of the child it wraps.
  // Can be overwritten via styles prop
  children?: ReactElement;
  drawerStyles?: StyleProp<ViewStyle>;
}

export interface SpinnerProps extends WithTestID {
  size?: "sm" | "md";
  color?: "light" | "dark" | "accent" | "secondary";
}

export interface ColumnSortInterface {
  column: number;
  direction: "asc" | "desc";
}

export interface TableProps {
  /**
   * Must be instances of TableHeader, TableRow, and/or TableFooter components.
   */
  children: React.ReactNode | React.ReactNode[];
  /**
   * Width of columns in the table. This is used to calculate the width of each column.
   * Can be numbers for pixels or strings for percentages.
   */
  // in figma/ jos documentation for the component, TableTitle,
  // she included the width as prop size
  /**
   * The size of the table title.
   * Can be one of "sm", "md", "lg", or "xl".
   */
  // size: "sm" | "md" | "lg" | "xl";
  //   const width = {
  //   sm: 82,
  //   md: 161,
  //   lg: 233,
  //   xl: 302,
  // };
  columns: Array<number | string>;
  /**
   * Specify a border width for Table: "sm" is 1px.
   */
  borderStyle?: "sm" | "none";
  /**
   * Use numbers for pixels: `maxHeight={100}` and strings for percentages: `maxHeight="100%"`.
   */
  maxHeight?: DimensionValue;
  /**
   * If true, the header will stick to the top of the table when scrolling. Defaults to true.
   */
  stickyHeader?: boolean;
  /**
   * If true, alternate rows will have a light gray background. Defaults to true.
   */
  alternateRowBackground?: boolean;

  /**
   * Control sort outside of the Table
   */
  sort?: ColumnSortInterface;
  /**
   * Set the page outside of the Table
   */
  page?: number;
  /**
   * Set the page outside of the Table
   */
  setPage?: (page: number) => void;
  /**
   * Set the total number of pages of the Table
   */
  totalPages?: number;
  /**
   * If true, the table will render a next page button. Defaults to true.
   */
  more?: boolean;
  /**
   * Extra controls to render below the table next to pagination
   */
  extraControls?: React.ReactElement;
}

export interface PaginationProps extends WithTestID {
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
}

export interface LineChartProps extends WithTestID {
  /** Summary announced for the whole chart. */
  accessibilityLabel?: string;
  /** Single series of labeled numeric points. */
  data: Array<{color?: string; label: string; value: number}>;
  /** Copy shown when `data` is empty. */
  emptyText?: string;
  /** Formats the numeric value in tooltips. */
  formatValue?: (value: number) => string;
  /** Plot height in pixels. */
  height?: number;
  /** Series name shown under the plot. */
  legendLabel?: string;
  /** When true, shows a spinner instead of the plot. */
  loading?: boolean;
}

export interface AreaChartProps extends LineChartProps {}
export interface BarChartProps extends LineChartProps {}

export interface DonutChartProps extends LineChartProps {}

export interface DashboardGridProps extends WithTestID {
  children?: React.ReactNode;
  /** Column counts by breakpoint. Defaults to `{sm: 1, md: 2, lg: 3}`. */
  columns?: {lg: number; md: number; sm: number};
  gap?: UnsignedUpTo12;
}

/**
 * Data Table
 */
export interface DataTableCellData {
  value: unknown;
  highlight?: SurfaceColor;
  textSize?: "sm" | "md" | "lg";
}

export type DataTableCustomComponentMap = Record<
  string,
  React.ComponentType<{column: DataTableColumn; cellData: DataTableCellData}>
>;

export interface DataTableColumnFilterChoiceOption {
  label: string;
  value: string;
}

export interface DataTableColumnFilterRenderArgs {
  field: string;
  onChange: (value: unknown) => void;
  value: unknown;
}

export interface DataTableColumnFilter {
  field: string;
  kind: "text" | "boolean" | "numberRange" | "dateRange" | "choice";
  label?: string;
  /** When true, choice filters include an Empty option for null/unset field values. */
  allowEmpty?: boolean;
  options?: DataTableColumnFilterChoiceOption[];
  renderFilter?: (args: DataTableColumnFilterRenderArgs) => React.ReactNode;
}

export interface DataTableQueryParams {
  [field: string]: unknown;
  $or?: Array<Record<string, unknown>>;
}

export interface DataTableColumn {
  title: string;
  columnType: "text" | "number" | "date" | "boolean" | string;
  width: number;
  highlight?: SurfaceColor;
  sortable?: boolean;
  infoModalText?: string;
  filter?: DataTableColumnFilter;
}

export interface DataTableProps extends WithTestID {
  testIDs?: DataTableTestIDs;
  data: DataTableCellData[][];
  columns: DataTableColumn[];
  /** Filter definitions that are not attached to a visible column. */
  additionalFilters?: DataTableColumnFilter[];
  /** Content shown below the header when `data` is empty. */
  emptyContent?: React.ReactNode;
  alternateRowBackground?: boolean;
  totalPages?: number;
  page?: number;
  setPage?: (page: number) => void;
  pinnedColumns?: number;
  sortColumn?: ColumnSortInterface;
  setSortColumn?: (sortColumn?: ColumnSortInterface) => void;
  rowHeight?: number;
  headerHeight?: number;
  defaultTextSize?: "sm" | "md" | "lg";
  /**
   * When tapping the eye icon, a modal is shown with more info about the row.
   */
  moreContentComponent?: React.ComponentType<
    {
      column: DataTableColumn;
      rowData: DataTableCellData[];
      rowIndex: number;
    } & Record<string, unknown>
  >;
  // Extra data to pass to the more modal.
  moreContentExtraData?: Record<string, unknown>[];
  // Allows handling of custom column types.
  customColumnComponentMap?: DataTableCustomComponentMap;
  /**
   * Returns a stable key for row test ids. Defaults to row index when omitted.
   */
  getRowTestID?: (row: DataTableCellData[], rowIndex: number) => string | number;
  /** Toolbar search string (controlled). Omit with `searchFields` to hide search. */
  search?: string;
  /** Fields included in generic `$or` search params. */
  searchFields?: string[];
  onSearchChange?: (search: string) => void;
  /** Controlled column filter draft/applied values keyed by field (and `field_gte` / `field_lte`). */
  filterValues?: Record<string, unknown>;
  onFilterValuesChange?: (next: Record<string, unknown>) => void;
  /** Fires when debounced search or applied filters change. Excludes page, limit, and sort. */
  onQueryChange?: (params: DataTableQueryParams) => void;
}

export interface DataTableCellProps {
  value: DataTableCellData;
  columnDef: DataTableColumn;
  colIndex: number;
  isPinnedHorizontal: boolean;
  isPinnedRow?: boolean;
  pinnedColumns: number;
  columnWidths: number[];
  backgroundColor: string;
  highlight?: SurfaceColor;
  customColumnComponentMap?: DataTableCustomComponentMap;
  height: number;
  textSize?: "sm" | "md" | "lg";
}

export interface TableHeaderProps {
  /**
   * Must be an instance of TableRow.
   */
  children: React.ReactNode | React.ReactNode[];
  /**
   * Display `visuallyHidden` ensures the component is visually hidden but still is read by screen
   * readers.
   */
  display?: "tableHeaderGroup" | "visuallyHidden";
  /**
   * If true, the table header will be sticky and the table body will be scrollable. Not yet
   * implemented.
   */
  sticky?: boolean;
  color?: BoxColor;
}

export interface TableHeaderCellProps extends InfoModalIconProps {
  /**
   * The content of the table header cell.
   */
  children?: ReactElement;
  index: number;
  sortable?: boolean;
  onSortChange?: (direction: "asc" | "desc" | undefined) => void;
  /**
   * The alignment of the text/components in the cell. Most cells should be left aligned,
   * unless the column is for a badge, icon, or boolean, then center align.
   * It should be right if the column is right aligned text or numbers.
   */
  align?: "left" | "center" | "right";
  /**
   * If title is provided, the text will be wrapped in a TableTitle, saving you from having to
   * wrap the text yourself. Alignments will match between the cell and the title.
   */
  title?: string;
  /**
   * If provided, a tooltip icon will be shown and a tooltip will be shown when hovering over the
   * icon.
   */
  infoText?: string;
}

export interface TableRowProps {
  /**
   * Must be instances of TableCell or TableHeaderCell.
   */
  children: React.ReactNode | React.ReactNode[];
  /**
   * Header rows have an extra thick bottom border.
   */
  headerRow?: boolean;
  /**
   * Whether the row should start expanded or not.
   */
  expanded?: boolean;
  /**
   * When the row is expanded, the drawerContents are shown. If not
   */
  drawerContents?: React.ReactNode | React.ReactNode[];
  /**
   * Background color of the row. Defaults to white.
   */
  color?: BoxColor;
}

export type TableFilters = Record<string, string[]>;

export interface TableSearch {
  search: string;
  field: string;
}

export interface TableContextType {
  columns: Array<number | string>;
  hasDrawerContents: boolean;
  sortColumn?: ColumnSortInterface | undefined;
  setSortColumn?: (sort: ColumnSortInterface | undefined) => void;
  stickyHeader?: boolean;
  borderStyle?: "sm" | "none";
  alternateRowBackground?: boolean;
  page?: number;
}

export interface TableContextProviderProps extends TableContextType {
  children: React.ReactNode;
}

export interface TextProps extends WithTestID {
  align?: "left" | "right" | "center" | "justify"; // default "left"
  children?: React.ReactNode;
  bold?: boolean; // default false
  color?: TextColor;
  italic?: boolean; // default false
  size?: TextSize; // default "md"
  truncate?: boolean; // default false
  underline?: boolean;
  numberOfLines?: number;
  skipLinking?: boolean;
}

export interface TextFieldPickerActionSheetProps {
  value?: string;
  mode?: "date" | "time";
  onChange: OnChangeCallback;
  // noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  // biome-ignore lint/suspicious/noExplicitAny: ActionSheet class lives in ActionSheet.tsx which imports from Common.ts; typing this would create a circular import
  actionSheetRef: React.RefObject<any>;
}

export interface ToastProps {
  title: string;
  /**
   * Stable toast id, forwarded by `useToast` from the caller's options. Used to
   * disambiguate the action button's testID so two stacked action toasts do not
   * both answer to `toast-action-button`.
   */
  id?: string;
  variant?: "error" | "info" | "success" | "warning";
  secondary?: boolean;
  size?: "sm" | "lg";
  onDismiss?: () => void;
  persistent?: boolean;
  // TODO enforce these should only show if size is "lg" with type discrinimation
  subtitle?: string;
  /**
   * Optional action button label. Renders only when `buttonOnClick` is also provided.
   */
  buttonText?: string;
  /**
   * Optional action button handler. Renders only when `buttonText` is also provided.
   */
  buttonOnClick?: () => void | Promise<void>;
}

export interface TooltipProps {
  /**
   * The content of the tooltip.
   */
  children: React.ReactElement;

  /**
   * If true, an arrow will be included in the tooltip.
   * @default false
   */
  includeArrow?: boolean;

  /**
   * The ideal position of the tooltip.
   * @default "top"
   */
  idealPosition?: "top" | "bottom" | "left" | "right";

  /**
   * The text content of the tooltip. If text is undefined,
   * the children will be rendered without a tooltip.
   */
  text?: string;
}

export type LinkProps = TextProps & {
  text: string;
} & (
    | {
        href: string;
        onClick?: never;
      }
    | {
        href?: never;
        onClick: () => void | Promise<void>;
      }
  );

export type TapToEditProps =
  | (BaseTapToEditProps &
      Omit<TextFieldProps, "onChange" | "value"> & {
        type: "password" | "text" | "url";
      })
  | (BaseTapToEditProps &
      Omit<NumberFieldProps, "onChange" | "value"> & {
        type: "number" | "decimal";
      })
  | (BaseTapToEditProps &
      Omit<NumberRangeFieldProps, "onChange" | "value"> & {
        type: "numberRange" | "decimalRange";
      })
  | (BaseTapToEditProps &
      Omit<DateTimeFieldProps, "onChange" | "value"> & {
        type: "date" | "datetime" | "time";
      })
  | (BaseTapToEditProps &
      Omit<MultiselectFieldProps, "onChange" | "value"> & {
        type: "multiselect";
      })
  | (BaseTapToEditProps &
      Omit<TextAreaProps, "onChange" | "value"> & {
        type: "textarea";
      })
  | (BaseTapToEditProps &
      Omit<SelectFieldProps, "onChange" | "value"> & {
        type: "select";
      })
  | (BaseTapToEditProps &
      Omit<CustomSelectFieldProps, "onChange" | "value"> & {
        type: "customSelect";
      })
  | (BaseTapToEditProps &
      Omit<EmailFieldProps, "onChange" | "value"> & {
        type: "email";
      })
  | (BaseTapToEditProps &
      Omit<PhoneNumberFieldProps, "onChange" | "value"> & {
        type: "phoneNumber";
      })
  | (BaseTapToEditProps &
      Omit<BooleanFieldProps, "onChange" | "value"> & {
        type: "boolean";
      })
  | (BaseTapToEditProps &
      Omit<RadioFieldProps, "onChange" | "value"> & {
        type: "radio";
      })
  | (BaseTapToEditProps &
      Omit<SignatureFieldProps, "onChange" | "value"> & {
        type: "signature";
      })
  | (BaseTapToEditProps &
      Omit<SearchFieldProps, "onChange" | "value"> & {
        type: "search";
      })
  | (BaseTapToEditProps &
      Omit<AddressFieldProps, "onChange" | "value"> & {
        type: "address";
      });

export interface BaseTapToEditProps extends Omit<FieldProps, "onChange" | "value"> {
  /**
   * Root test id. Forwards to the Field input and suffixes action controls for e2e:
   * `{testID}.edit-clickable`, `{testID}.cancel`, `{testID}.clear`, `{testID}.save`.
   * The edit control is a pressable Box (`-clickable` is appended by Box).
   * Cancel/Clear/Save only render when the user opened edit from inside the
   * component, not when `isEditing` is true.
   */
  testID?: string;
  title: string;
  // noExplicitAny: value type varies across TapToEdit field types (text, number, date, etc.)
  // biome-ignore lint/suspicious/noExplicitAny: value type varies across TapToEdit field types (text, number, date, etc.)
  value: any;

  /**
   * Not required if not editable.
   */
  // noExplicitAny: value type varies across TapToEdit field types
  // biome-ignore lint/suspicious/noExplicitAny: value type varies across TapToEdit field types
  setValue?: (value: any) => void;

  /**
   * Not required if not editable.
   */
  // noExplicitAny: value type varies across TapToEdit field types
  // biome-ignore lint/suspicious/noExplicitAny: value type varies across TapToEdit field types
  onSave?: (value: any) => void | Promise<void>;

  /**
   * If false, the field will not be editable and will be disabled
   * @default true
   */
  editable?: boolean;

  /**
   * Enable edit mode from outside the component.
   */
  isEditing?: boolean;
  // noExplicitAny: input value type varies across TapToEdit field types
  // biome-ignore lint/suspicious/noExplicitAny: input value type varies across TapToEdit field types
  transform?: (value: any) => string;
  /**
   * Show a confirmation modal before saving the value.
   * @default false
   */
  withConfirmation?: boolean;

  /**
   * The text content of the confirmation modal.
   * @default "Are you sure you want save your changes?"
   */
  confirmationText?: string;

  /**
   * The title of the confirmation modal.
   * @default "Confirm"
   */
  confirmationTitle?: string;

  /**
   * Field helperText, a description of the field surfaced in the UI
   * @default "Confirm"
   */
  helperText?: string;

  /**
   * Only display the helperText in the UI while editing. if false, the helperText is always shown below the value.
   * @default true
   */
  onlyShowHelperTextWhileEditing?: boolean;

  /**
   * Show a clear button in the button row alongside Cancel/Save for clearing the field value.
   * @default false
   */
  showClearButton?: boolean;

  // openApi to supported in future
  // openApiModel?: string;
  // openApiField?: string;
}

export interface APIError {
  status: number;
  data: {
    title: string;
    detail?: string;
    id?: string;
    links?: string;
    about?: string;
    status?: number;
    code?: string;
    source?: string;
    pointer?: string;
    parameter?: string;
    meta?: {[id: string]: unknown};
  };
}

export type OpenApiPropertyType =
  | "string"
  | "date"
  | "datetime"
  | "boolean"
  | "array"
  | "object"
  | "number"
  | "any";

export interface OpenApiProperty {
  type?: OpenApiPropertyType;
  format?: string;
  properties?: OpenApiProperty;
  items?: OpenApiProperty[];
  description?: string;
  // TODO: is this actually there?
  required?: string[];
  enum?: string[];
}

export interface ModelFields {
  type: "object" | "array";
  required: string[];
  properties: {[name: string]: OpenApiProperty};
}

export interface OpenAPISpec {
  paths: {
    // noExplicitAny: OpenAPI path items are deeply accessed with chained property lookups
    // biome-ignore lint/suspicious/noExplicitAny: OpenAPI path items are deeply accessed with chained property lookups
    [key: string]: any;
  };
}

// noExplicitAny: ModelFieldConfig is a passthrough for arbitrary field configuration objects from various model contexts
// biome-ignore lint/suspicious/noExplicitAny: ModelFieldConfig is a passthrough for arbitrary field configuration objects from various model contexts
export type ModelFieldConfig = any;

export interface OpenAPIProviderProps {
  children: React.ReactElement;
  specUrl?: string;
}

export interface OpenAPIContextType {
  spec: OpenAPISpec | null;
  getModelFields: (modelName: string) => ModelFields | null;
  getModelField: (modelName: string, field: string) => OpenApiProperty | null;
}

// The config for a single column in the table display of a model.
export interface ModelAdminFieldConfig {
  fieldKey: string; // Dot notation representation of the field.
  title: string;
  description?: string;
  type: OpenApiPropertyType;
  width?: number;
  minWidth?: number;
  options?: string[];
  sort?: string;
  CustomComponent?: (props: ModelAdminCustomComponentProps) => React.ReactElement | null;
}

// The props for a custom column component for ModelAdmin.
export interface ModelAdminCustomComponentProps extends Omit<FieldProps, "name"> {
  // noExplicitAny: document shape varies by model used with ModelAdmin
  // biome-ignore lint/suspicious/noExplicitAny: document shape varies by model used with ModelAdmin
  doc: any;
  fieldKey: string; // Dot notation representation of the field.
  // user: User;
  editing: boolean; // Allow for inline editing of the field.
}

export interface MultiselectFieldProps extends WithTestID, HelperTextProps, ErrorTextProps {
  testIDs?: FieldTestIDs;
  /**
   * The available options for the multiselect field.
   */
  options: FieldOption[];

  /**
   * The title of the multiselect field.
   */
  title: string;

  /**
   * The selected values of the multiselect field.
   */
  value: string[];

  /**
   * The variant of the multiselect field, which determines the position of the text.
   * @default "rightText"
   */
  variant?: "rightText" | "leftText";

  /**
   * The function to call when the selected values change.
   */
  onChange: (selected: string[]) => void;

  /**
   * The disabled state of multiselect. Removes checkboxes and only shows the values.
   */

  disabled?: boolean;
}

export interface TableTitleProps {
  /**
   * The text content of the table title.
   */
  title: string;

  /**
   * Most titles should be left aligned, but some may be centered, such as badges or booleans.
   * It should match the alignment of the column.
   * @default "left"
   */
  align?: "left" | "center" | "right";
}

export interface TableBooleanProps {
  /**
   * If true, the component is in editing mode.
   * @default false
   */
  isEditing?: boolean;

  /**
   * The function to call when the value is saved.
   */
  onSave?: () => void | Promise<void>;

  /**
   * The boolean value to be displayed or edited.
   */
  value: boolean;
}

export interface TableDateProps {
  /**
   * If true, the date is annotated.
   * @default false
   */
  annotated?: boolean;

  /**
   * If true, the component is in editing mode.
   * @default false
   */
  isEditing?: boolean;

  /**
   * The function to call when the value is saved.
   */
  onSave?: () => void;

  /**
   * The date value to be displayed or edited. Can be a string or a Date object.
   */
  value: string | Date;
}

export interface TableIconButtonProps {
  /**
   * The name of the icon button to display in the table.
   * Can be one of "edit", "saveAndClose", "insert", "drawerOpen", or "drawerClose".
   */
  tableIconButtonName: "edit" | "saveAndClose" | "insert" | "drawerOpen" | "drawerClose";

  /**
   * The function to call when the icon button is clicked.
   */
  onClick: () => void | Promise<void>;
}

export interface FieldOption {
  /**
   * The label to display for the option.
   */
  label: string;

  /**
   * Optional secondary line shown under the label in custom web dropdown menus.
   */
  helperText?: string;

  /**
   * The key of the option. Useful for uniquely identifying the option.
   */
  key?: string;

  /**
   * The value of the option.
   */
  value: string;
}

// Split up SelectField so if value is passed as a string,
export interface SelectFieldPropsBase extends WithTestID {
  testIDs?: FieldTestIDs;
  /**
   * If true, the select field will be disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * The error text to display if there is an error.
   */
  errorText?: string;

  /**
   * The helper text to display below the select field.
   */
  helperText?: string;

  /**
   * The function to call when the selected value changes.
   * If requireValue is false and value is undefined, onChange will return empty string.
   */
  onChange: (value: string) => void;

  /**
   * The options available for selection in the select field.
   * Each option should have a label and a value.
   */
  options: FieldOption[];

  /**
   * The placeholder text to display when no option is selected.
   */
  placeholder?: string;

  /**
   * When true, hides the type-to-filter search UI. On web, search normally happens
   * in the trigger field; on native, search appears in the dropdown menu and
   * Android uses a centered modal similar to the platform picker. Search is enabled
   * by default.
   * @default false
   */
  disableSearch?: boolean;

  /**
   * Web only. When true, the dropdown menu renders in a fixed portal on
   * `document.body` (zIndex 9999) instead of a React Native `Modal`. Use this
   * when the select lives inside another portaled/high-zIndex overlay (e.g. the
   * `Filter` panel) where a `Modal` would stack behind the overlay and be
   * invisible and unclickable.
   * @default false
   */
  renderMenuInBodyPortal?: boolean;

  /**
   * The title of the select field.
   */
  title?: string;
}

export interface SelectFieldPropsWithoutRequire extends SelectFieldPropsBase {
  /**
   * Whether the select field should have an empty "---" button to return undefined.
   * @default false
   */
  requireValue?: false;

  /**
   * The current value of the select field (optional when requireValue is false).
   */
  value?: string;
}

export interface SelectFieldPropsWithRequire extends SelectFieldPropsBase {
  /**
   * When requireValue is true, the value is required and onChange will return a string.
   */
  requireValue: true;

  /**
   * The current value of the select field (required when requireValue is true).
   */
  value: string;

  /**
   * The function to call when the required select field value changes.
   */
  onChange: (value: string) => void;
}

export type SelectFieldProps = SelectFieldPropsWithoutRequire | SelectFieldPropsWithRequire;

export interface TableBadgeProps {
  /**
   * The icon name of the badge.
   */
  badgeIconName?: BadgeProps["iconName"];

  /**
   * The status of the badge.
   * @default "info"
   */
  badgeStatus?: BadgeProps["status"];

  /**
   * If true, the component is in editing mode.
   * @default false
   */
  isEditing?: boolean;

  /**
   * The options available for editing the badge.
   */
  editingOptions?: FieldOption[];

  /**
   * The function to call when the badge status is saved.
   */
  onSave?: (newStatus: string | undefined) => void | Promise<void>;

  /**
   * The value of the badge.
   */
  value: string;
}

export interface TableTextProps {
  /**
   * Whether the text field is in editing mode.
   */
  isEditing?: boolean;
  /**
   * The text to display in the text field.
   */
  value: string;
  /**
   * Callback to save the text field value.
   */
  onSave?: () => void | Promise<void>;
  /**
   * The alignment of the text field. Most text fields should be left aligned.
   * @default "left"
   */
  align?: "left" | "center" | "right";
}

export interface TableNumberProps {
  /**
   * Whether the text field is in editing mode.
   */
  isEditing?: boolean;
  /**
   * The number to display in the text field.
   */
  value: string;
  /**
   * Callback to save the text field value.
   */
  onSave?: () => void | Promise<void>;
  /**
   * Numbers generally should be right aligned for ease of scanability.
   * @default "right"
   */
  align?: "left" | "right";
}

export interface SliderProps extends HelperTextProps, ErrorTextProps {
  /**
   * The title of the slider field.
   */
  title?: string;

  /**
   * The current value of the slider.
   */
  value: number;

  /**
   * The function to call when the slider value changes.
   */
  onChange: (value: number) => void;

  /**
   * The minimum value of the slider.
   * @default 0
   */
  minimumValue?: number;

  /**
   * The maximum value of the slider.
   * @default 1
   */
  maximumValue?: number;

  /**
   * The step value of the slider.
   * @default 0
   */
  step?: number;

  /**
   * If true, the slider will be disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * The color of the track to the left of the thumb.
   */
  minimumTrackTintColor?: string;

  /**
   * The color of the track to the right of the thumb.
   */
  maximumTrackTintColor?: string;

  /**
   * The color of the thumb.
   */
  thumbTintColor?: string;

  /**
   * If true, the slider will show the current value as text.
   * @default false
   */
  showSelection?: boolean;

  /**
   * Labels to show below the slider track.
   */
  labels?: {
    /**
     * The minimum value label.
     */
    min?: string;
    /**
     * The maximum value label.
     */
    max?: string;
    /**
     * Additional labels with their positions (0-1 range).
     */
    custom?: Array<{index: number; label: string}>;
  };

  /**
   * If true, displays min and max labels inline on both ends of the track.
   * @default false
   */
  inlineLabels?: boolean;

  /**
   * If true, icons will be displayed instead of numeric values when valueMapping is provided.
   * @default false
   */
  useIcons?: boolean;

  /**
   * Graphics/icons to display instead of numeric values.
   * Maps slider values to icon names or any string.
   */
  valueMapping?: ValueMappingItem[];
}

export interface UserInactivityProps {
  /**
   * Children components to embed inside UserInactivity's View.
   * If any children component is pressed, `onAction` is called after
   * `timeForInactivity` milliseconds.
   */
  children: React.ReactNode;

  /**
   * If it's explicitly set to `true` after the component has already been initialized,
   * the timer restarts and the view is considered active until the new timer expires.
   * @default true
   */
  isActive?: boolean;

  /**
   * Callback triggered anytime UserInactivity's View isn't touched for more than
   * `timeForInactivity` milliseconds.
   * The `active` argument is true if and only if the View wasn't touched for more
   * than `timeForInactivity` milliseconds.
   */
  onAction: (active: boolean) => void;

  /**
   * If set to true, the timer is not reset when the keyboard appears
   * or disappears.
   * @default false
   */
  skipKeyboard?: boolean;

  /**
   * Optional custom style for UserInactivity's View.
   * @default { flex: 1 }
   */
  style?: StyleProp<ViewStyle>;

  /**
   * Number of milliseconds after which the view is considered inactive.
   * If it changed, the timer restarts and the view is considered active until
   * the new timer expires.
   * @default 10000
   */
  timeForInactivity?: number;
}

/**
 * Maps badge status keys to their semantic meaning for sidebar navigation items.
 */
export const SIDEBAR_BADGE_STATUS_MAP = {
  error: "error",
  info: "info",
  neutral: "neutral",
  success: "success",
  warning: "warning",
} as const;

export type SidebarBadgeStatus = keyof typeof SIDEBAR_BADGE_STATUS_MAP;

export interface SidebarNavigationItem {
  /**
   * Display text for the navigation item.
   */
  label: string;
  /**
   * Route name matching the expo-router file-based route (e.g. "index", "dashboard").
   */
  route: string;
  /**
   * FontAwesome 6 icon name rendered alongside the label.
   */
  iconName: IconName;
  /**
   * Badge displayed on the icon. A number shows a count (capped at 99+); true shows a dot indicator.
   */
  badge?: number | boolean;
  /**
   * Color status of the badge. Defaults to "error".
   */
  badgeStatus?: SidebarBadgeStatus;
}

/**
 * Props for the SidebarNavigation custom expo-router navigator.
 * Used in _layout.tsx files to provide sidebar navigation.
 */
export interface SidebarNavigationProps {
  /**
   * Navigation items displayed at the top of the sidebar.
   */
  topItems: SidebarNavigationItem[];
  /**
   * Navigation items displayed at the bottom of the sidebar.
   */
  bottomItems: SidebarNavigationItem[];
  /**
   * Optional callback fired after a navigation item is pressed.
   */
  onNavigate?: (route: string) => void;
  /**
   * The route to show when the navigator first renders.
   */
  initialRouteName?: string;
  /**
   * Screen options passed through to the underlying Navigator.
   */
  screenOptions?: Record<string, unknown>;
  /**
   * Additional styles applied to the sidebar panel container.
   */
  panelStyle?: StyleProp<ViewStyle>;
  /**
   * Additional styles applied to each navigation item.
   */
  itemStyle?: StyleProp<ViewStyle>;
  /**
   * Optional Screen definitions passed to the underlying Navigator,
   * e.g. <Screen name="index" options={{title: "Home"}} />.
   */
  children?: React.ReactNode;
}

/**
 * Props for the standalone SidebarNavigationPanel (no expo-router dependency).
 * Useful for demos, testing, or non-expo-router apps.
 */
export interface SidebarNavigationPanelProps {
  /**
   * Navigation items displayed at the top of the sidebar.
   */
  topItems: SidebarNavigationItem[];
  /**
   * Navigation items displayed at the bottom of the sidebar.
   */
  bottomItems: SidebarNavigationItem[];
  /**
   * The currently active route, used to highlight the matching item.
   */
  activeRoute?: string;
  /**
   * Called when a navigation item is pressed.
   */
  onNavigate: (route: string) => void;
  /**
   * Main content rendered beside (web) or behind (mobile) the sidebar.
   */
  children: React.ReactNode;
  /**
   * Additional styles applied to the sidebar panel container.
   */
  panelStyle?: StyleProp<ViewStyle>;
  /**
   * Additional styles applied to each navigation item.
   */
  itemStyle?: StyleProp<ViewStyle>;
  /**
   * Controlled open state. When provided, the panel hides its internal hamburger
   * button and defers open/close to the caller.
   *
   * @platform mobile — the web sidebar is always visible; this prop is ignored on web.
   */
  isOpen?: boolean;
  /**
   * Called when the panel requests an open or close (controlled mode only).
   *
   * @platform mobile — the web sidebar is always visible; this prop is ignored on web.
   */
  onOpenChange?: (isOpen: boolean) => void;
}
