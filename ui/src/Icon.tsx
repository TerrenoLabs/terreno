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

/** True only while a static web export is rendering or hydrating. Native and client-only web paint immediately. */
const isWebStaticHydration = (): boolean => {
  if (Platform.OS !== "web") {
    return false;
  }
  if (typeof document === "undefined") {
    return true;
  }
  return (globalThis as {__EXPO_ROUTER_HYDRATE__?: boolean}).__EXPO_ROUTER_HYDRATE__ === true;
};

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
  const [hasMounted, setHasMounted] = useState(false);

  // Keep the first client paint aligned with static SSR, where the glyph font is absent.
  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (isWebStaticHydration() && !hasMounted) {
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
