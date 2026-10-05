import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {type FC, memo, useEffect, useState} from "react";
import {View} from "react-native";

import {type IconProps, iconSizeToNumber} from "./Common";
import {useCustomIcon} from "./IconRegistry";
import {useTheme} from "./Theme";

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
  const [hasMounted, setHasMounted] = useState(false);

  // Font Awesome glyphs are not available during static SSR; defer until mount.
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // A registered custom icon takes precedence over the FontAwesome glyph set.
  if (CustomIcon) {
    return <CustomIcon color={iconColor} size={iconSize} testID={testID} />;
  }

  if (!hasMounted) {
    return <View style={{height: iconSize, width: iconSize}} testID={testID} />;
  }

  return (
    <FontAwesome6
      brand={type === "brand"}
      color={iconColor}
      duotone={type === "duotone"}
      light={type === "light" || type === "sharpLight"}
      name={iconName}
      regular={type === "regular"}
      selectable={undefined}
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
