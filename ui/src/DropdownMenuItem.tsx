import type React from "react";
import {Pressable} from "react-native";

import {Box} from "./Box";
import type {IconName, IconProps, TextColor} from "./Common";
import {Icon} from "./Icon";
import {Text} from "./Text";

export interface DropdownMenuItemProps {
  accessibilityLabel?: string;
  /** Text and icon color. Defaults to the dark secondary text color. */
  color?: TextColor;
  iconName: IconName;
  /** Icon style. Defaults to the outlined `regular` glyph. */
  iconType?: IconProps["type"];
  label: string;
  onClick: () => void;
  testID?: string;
}

/** A single icon + label row for an action menu rendered inside a `DropdownPanel`. */
export const DropdownMenuItem = ({
  accessibilityLabel,
  color = "secondaryDark",
  iconName,
  iconType = "regular",
  label,
  onClick,
  testID,
}: DropdownMenuItemProps): React.ReactElement => {
  // A plain Pressable keeps onClick synchronous with the press, which web file pickers need.
  return (
    <Pressable
      accessibilityHint={`Press to ${label.toLowerCase()}`}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="menuitem"
      onPress={onClick}
      testID={testID}
    >
      <Box alignItems="center" direction="row" gap={2} paddingX={2} paddingY={2} rounding="md">
        <Icon color={color} iconName={iconName} size="sm" type={iconType} />
        <Text color={color} size="sm">
          {label}
        </Text>
      </Box>
    </Pressable>
  );
};
