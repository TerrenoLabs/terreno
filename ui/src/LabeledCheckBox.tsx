import {type FC, useCallback} from "react";
import {Pressable} from "react-native";

import {Box} from "./Box";
import {CheckBox} from "./CheckBox";
import {Text} from "./Text";

/** The keydown event react-native-web hands a Pressable's `onKeyDown`. */
interface WebKeyDownEvent {
  key?: string;
  nativeEvent?: {key?: string};
  preventDefault?: () => void;
}

interface LabeledCheckBoxProps {
  /** Sentence shown next to the box; also the accessible name. */
  label: string;
  /** Whether the box is checked. */
  checked: boolean;
  /** Called with the new checked state. */
  onChange: (checked: boolean) => void;
  /** Blocks toggling and marks the control disabled. */
  disabled?: boolean;
  /** Smaller line under the label. It is not part of the accessible name. */
  helperText?: string;
  /** Test ID of the pressable checkbox. */
  testID?: string;
}

/**
 * A checkbox with its label as one pressable `role="checkbox"` control. Internal to the auth
 * screens and cards (trust this device, sign out other devices, I saved these codes).
 */
export const LabeledCheckBox: FC<LabeledCheckBoxProps> = ({
  label,
  checked,
  onChange,
  disabled = false,
  helperText,
  testID,
}) => {
  const handleToggle = useCallback((): void => {
    if (disabled) {
      return;
    }
    onChange(!checked);
  }, [checked, disabled, onChange]);

  // react-native-web presses a Pressable on Space only for button roles, so a checkbox handles
  // Space itself (Enter already presses it).
  const handleKeyDown = useCallback(
    (event: WebKeyDownEvent): void => {
      const key = event.key ?? event.nativeEvent?.key;
      if (key !== " " && key !== "Spacebar") {
        return;
      }
      event.preventDefault?.();
      handleToggle();
    },
    [handleToggle]
  );

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityState={{checked, disabled}}
      aria-checked={checked}
      aria-disabled={disabled}
      aria-label={label}
      disabled={disabled}
      onPress={handleToggle}
      {...({onKeyDown: handleKeyDown} as Record<string, unknown>)}
      role="checkbox"
      testID={testID}
    >
      <Box alignItems="center" direction="row" gap={2}>
        <CheckBox selected={checked} size="md" />
        <Box flex="shrink">
          <Text>{label}</Text>
          {Boolean(helperText) && (
            <Text color="secondaryLight" size="sm">
              {helperText}
            </Text>
          )}
        </Box>
      </Box>
    </Pressable>
  );
};
