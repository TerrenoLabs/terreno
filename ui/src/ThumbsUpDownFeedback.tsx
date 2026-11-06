import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import {type ComponentProps, type FC, useCallback} from "react";
import {Pressable} from "react-native";

import {Box} from "./Box";
import type {ThumbsUpDownFeedbackProps, ThumbsUpDownFeedbackValue} from "./Common";
import {useTheme} from "./Theme";

/**
 * MaterialIcons pads its artwork inside the em box and the thumbs are wider than they are tall, so
 * this font size is the one that paints a 16px wide thumb — the Figma bounding box.
 */
const ICON_SIZE = 19.2;

const ICON_NAME_MAP = {
  negative: {selected: "thumb-down-alt", unselected: "thumb-down-off-alt"},
  positive: {selected: "thumb-up-alt", unselected: "thumb-up-off-alt"},
} as const;

const TAP_TARGET_SIZE = 32;

/**
 * react-native-web only activates a Pressable on the spacebar when the element is a native button or
 * has role="button", so a checkbox needs its own spacebar handler (per ARIA, spacebar is the
 * activation key for a checkbox). Not typed by react-native, so it is spread in separately.
 */
interface WebKeyDownEvent {
  key?: string;
  preventDefault: () => void;
  repeat?: boolean;
}

interface WebKeyDownProps {
  onKeyDown?: (event: WebKeyDownEvent) => void;
}

/**
 * A pair of thumbs up / thumbs down options for collecting binary feedback, e.g. on an AI
 * generated response. The selected option switches from an outlined to a filled thumb; pressing it
 * again clears the selection and calls `onChange` with undefined.
 */
export const ThumbsUpDownFeedback: FC<ThumbsUpDownFeedbackProps> = ({
  disabled = false,
  negativeAccessibilityLabel = "Thumbs down",
  onChange,
  positiveAccessibilityLabel = "Thumbs up",
  testID,
  value,
}) => {
  const {theme} = useTheme();

  const handlePress = useCallback(
    async (pressedValue: ThumbsUpDownFeedbackValue) => {
      if (disabled) {
        return;
      }
      await onChange(value === pressedValue ? undefined : pressedValue);
    },
    [disabled, onChange, value]
  );

  const handleKeyDown = useCallback(
    async (optionValue: ThumbsUpDownFeedbackValue, event: WebKeyDownEvent) => {
      if (event.key !== " " && event.key !== "Spacebar") {
        return;
      }
      event.preventDefault();
      // A native button activates once per press, so ignore auto-repeat from a held spacebar.
      if (event.repeat) {
        return;
      }
      await handlePress(optionValue);
    },
    [handlePress]
  );

  const renderOption = (optionValue: ThumbsUpDownFeedbackValue) => {
    const isSelected = value === optionValue;
    const isPositive = optionValue === "positive";
    const iconColor = disabled ? theme.surface.disabled : theme.surface.secondaryDark;
    const iconName =
      ICON_NAME_MAP[isPositive ? "positive" : "negative"][isSelected ? "selected" : "unselected"];
    const webKeyDownProps: WebKeyDownProps = {
      onKeyDown: async (event) => handleKeyDown(optionValue, event),
    };

    return (
      <Pressable
        {...(webKeyDownProps as Pick<ComponentProps<typeof Pressable>, "onKeyDown">)}
        accessibilityLabel={isPositive ? positiveAccessibilityLabel : negativeAccessibilityLabel}
        accessibilityRole="checkbox"
        accessibilityState={{checked: isSelected, disabled, selected: isSelected}}
        aria-checked={isSelected}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={async () => handlePress(optionValue)}
        style={{
          alignItems: "center",
          backgroundColor: "transparent",
          borderRadius: TAP_TARGET_SIZE / 2,
          height: TAP_TARGET_SIZE,
          justifyContent: "center",
          width: TAP_TARGET_SIZE,
        }}
        testID={testID ? `${testID}-${isPositive ? "positive" : "negative"}` : undefined}
      >
        <MaterialIcons color={iconColor} name={iconName} selectable={undefined} size={ICON_SIZE} />
      </Pressable>
    );
  };

  return (
    <Box alignItems="center" direction="row" testID={testID}>
      {renderOption("positive")}
      {renderOption("negative")}
    </Box>
  );
};
