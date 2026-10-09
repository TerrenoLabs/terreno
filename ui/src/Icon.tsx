import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {type FC, memo, useEffect, useState} from "react";
import {Platform, View} from "react-native";

import {type IconProps, iconSizeToNumber} from "./Common";
import {useCustomIcon} from "./IconRegistry";
import {useTheme} from "./Theme";

interface FontAwesomeGlyphProps {
  brand: boolean;
  color: string;
  duotone: boolean;
  light: boolean;
  name: string;
  regular: boolean;
  sharp: boolean;
  size: number;
  solid: boolean;
  testID?: string;
  thin: boolean;
}

/**
 * Static web HTML sets `__EXPO_ROUTER_HYDRATE__` and never clears it. Remember that the
 * first hydration pass finished so later-mounted glyphs paint immediately.
 */
let didFinishStaticHydration = false;
let placeholderCommits = 0;

/** True only while a static web export is rendering or hydrating. Native and client-only web paint immediately. */
const isWebStaticHydration = (): boolean => {
  if (didFinishStaticHydration || Platform.OS !== "web") {
    return false;
  }
  if (typeof document === "undefined") {
    return true;
  }
  return (globalThis as {__EXPO_ROUTER_HYDRATE__?: boolean}).__EXPO_ROUTER_HYDRATE__ === true;
};

/** Test hook so hydration cases do not leak across files. */
export const resetIconStaticHydrationForTests = (): void => {
  didFinishStaticHydration = false;
  placeholderCommits = 0;
};

/** How many times a glyph rendered the empty SSR placeholder. */
export const iconPlaceholderCommitsForTests = (): number => placeholderCommits;

const FontAwesomeGlyph: FC<FontAwesomeGlyphProps> = ({
  brand,
  color,
  duotone,
  light,
  name,
  regular,
  sharp,
  size,
  solid,
  testID,
  thin,
}) => {
  const deferGlyph = isWebStaticHydration();
  const [showGlyph, setShowGlyph] = useState(!deferGlyph);

  // Swap the SSR placeholder for the glyph once, and stop deferring icons mounted later.
  useEffect(() => {
    if (!deferGlyph) {
      return;
    }
    didFinishStaticHydration = true;
    setShowGlyph(true);
  }, [deferGlyph]);

  if (!showGlyph) {
    placeholderCommits += 1;
    return <View style={{height: size, width: size}} testID={testID} />;
  }

  return (
    <FontAwesome6
      brand={brand}
      color={color}
      duotone={duotone}
      light={light}
      name={name}
      regular={regular}
      selectable={undefined}
      sharp={sharp}
      size={size}
      solid={solid}
      testID={testID}
      thin={thin}
    />
  );
};

const IconComponent: FC<IconProps> = ({
  color = "primary",
  size = "md",
  iconName,
  type = "solid",
  testID,
}) => {
  const {theme} = useTheme();
  const CustomIcon = useCustomIcon(iconName);
  const iconColor = theme.text[color] ?? color;
  const iconSize = iconSizeToNumber(size);

  // A registered custom icon takes precedence over the FontAwesome glyph set.
  if (CustomIcon) {
    return <CustomIcon color={iconColor} size={iconSize} testID={testID} />;
  }

  return (
    <FontAwesomeGlyph
      brand={type === "brand"}
      color={iconColor}
      duotone={type === "duotone"}
      light={type === "light" || type === "sharpLight"}
      name={iconName}
      regular={type === "regular"}
      sharp={type === "sharp"}
      size={iconSize}
      solid={type === "solid" || type === "sharpSolid"}
      testID={testID}
      thin={type === "thin"}
    />
  );
};

IconComponent.displayName = "Icon";

export const Icon = memo(IconComponent);
