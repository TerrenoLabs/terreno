import type {FC, ReactNode} from "react";
import {ActivityIndicator, Text as NativeText, Pressable, View} from "react-native";

import {useTheme} from "../Theme";
import {LastUsedPill} from "./LastUsedBadge";

interface OutlinePillProps {
  /** Visible label, centered in the pill. */
  text: string;
  /** Icon pinned to the left edge. */
  icon?: ReactNode;
  /** Called when the pill is pressed. */
  onPress: () => void | Promise<void>;
  /** Disables the pill. */
  disabled?: boolean;
  /** Shows a spinner and disables the pill. */
  loading?: boolean;
  /** Accessible name. Defaults to `text`. */
  accessibilityLabel?: string;
  /** Test ID of the pressable. */
  testID?: string;
  /** When set, highlights the pill and shows this last-used label inside it. */
  lastUsedLabel?: string;
  /** Test ID of the last-used pill. */
  lastUsedTestID?: string;
}

/**
 * A full-width sign-in method pill: neutral outline, icon pinned left, label centered.
 * A last-used method gets the secondary fill and an inline pill.
 */
export const OutlinePill: FC<OutlinePillProps> = ({
  text,
  icon,
  onPress,
  disabled = false,
  loading = false,
  accessibilityLabel,
  testID,
  lastUsedLabel,
  lastUsedTestID,
}) => {
  const {theme} = useTheme();
  if (!theme) {
    return null;
  }
  const isDisabled = disabled || loading;
  const isLastUsed = Boolean(lastUsedLabel);
  const textColor = isDisabled ? theme.text.secondaryLight : theme.text.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled}}
      aria-label={accessibilityLabel ?? text}
      disabled={isDisabled}
      onPress={() => {
        void onPress();
      }}
      style={{
        alignItems: "center",
        backgroundColor: isDisabled
          ? theme.surface.disabled
          : isLastUsed
            ? theme.surface.secondaryExtraLight
            : theme.surface.base,
        borderColor: isLastUsed ? theme.surface.secondaryLight : theme.border.default,
        borderRadius: theme.radius.rounded,
        borderWidth: isLastUsed ? 2 : 1,
        flexDirection: "row",
        minHeight: 48,
        opacity: isDisabled ? 0.6 : 1,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 8,
        width: "100%",
      }}
      testID={testID}
    >
      <View style={{alignItems: "center", justifyContent: "center", width: 28}}>{icon}</View>
      <View style={{alignItems: "center", flex: 1, minWidth: 0, paddingHorizontal: 4}}>
        <NativeText
          style={{
            color: textColor,
            fontSize: 16,
            fontWeight: "700",
            textAlign: "center",
            width: "100%",
          }}
        >
          {text}
        </NativeText>
      </View>
      <View
        style={{
          alignItems: "flex-end",
          justifyContent: "center",
          minWidth: isLastUsed || loading ? undefined : 28,
        }}
      >
        {loading ? <ActivityIndicator color={textColor} size="small" /> : null}
        {isLastUsed && !loading ? (
          <LastUsedPill
            label={lastUsedLabel ?? ""}
            testID={lastUsedTestID ?? `${testID}-last-used`}
          />
        ) : null}
      </View>
    </Pressable>
  );
};
