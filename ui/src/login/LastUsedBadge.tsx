import type {FC} from "react";
import {View} from "react-native";

import {Text} from "../Text";
import {useTheme} from "../Theme";

interface LastUsedPillProps {
  /** Pill text, such as "Last used". */
  label: string;
  /** Test ID for the pill. */
  testID: string;
}

/**
 * Marks the sign-in method this device used last. Sits inline after an account name, on an email
 * label, or at the right edge of a method button.
 */
export const LastUsedPill: FC<LastUsedPillProps> = ({label, testID}) => {
  const {theme} = useTheme();
  if (!theme) {
    return null;
  }
  return (
    <View
      style={{
        backgroundColor: theme.surface.secondaryExtraLight,
        borderColor: theme.surface.secondaryLight,
        borderRadius: theme.radius.rounded,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
      testID={testID}
    >
      <Text bold color="secondaryDark" size="sm">
        {label}
      </Text>
    </View>
  );
};

/** @deprecated Use {@link LastUsedPill}. Kept so existing imports keep compiling. */
export const LastUsedBadge = LastUsedPill;
