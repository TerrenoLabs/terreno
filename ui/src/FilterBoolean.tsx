import {type ComponentProps, type FC, useState} from "react";
import {Pressable, View} from "react-native";

import type {FilterBooleanProps} from "./Common";
import {FilterChangesBadge} from "./FilterChangesBadge";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {resolveTestID} from "./testing/resolveTestId";

// react-native's Pressable does not type the web `onKeyDown` event, but React
// Native Web forwards it. A switch needs its own spacebar handler (per ARIA,
// Space toggles it) since role="switch" only activates on Enter on the web.
interface WebKeyDownEvent {
  key?: string;
  preventDefault: () => void;
  repeat?: boolean;
}

interface WebKeyDownProps {
  onKeyDown?: (event: WebKeyDownEvent) => void;
}

const SWITCH_WIDTH = 36;
const SWITCH_HEIGHT = 20;
const KNOB_SIZE = 16;

/**
 * A boolean filter row: a title on the left and a toggle switch on the right.
 * The entire row is the click zone, matching the design spec. Hovering tints
 * the row with the `surface-base-hover` token.
 */
export const FilterBoolean: FC<FilterBooleanProps> = ({
  title,
  value,
  onChange,
  showChangesBadge = false,
  disabled = false,
  focused = false,
  testID,
}) => {
  const {theme} = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  const trackColor = disabled
    ? theme.surface.disabled
    : value
      ? theme.surface.secondaryDark
      : theme.surface.base;
  const borderColor = focused
    ? theme.border.focus
    : disabled
      ? theme.surface.disabled
      : theme.surface.secondaryDark;

  const handlePress = (): void => {
    if (!disabled) {
      onChange(!value);
    }
  };

  const webKeyDownProps: WebKeyDownProps = {
    onKeyDown: (event) => {
      if (event.key !== " " && event.key !== "Spacebar") {
        return;
      }
      event.preventDefault();
      // A native switch activates once per press, so ignore held-key auto-repeat.
      if (event.repeat) {
        return;
      }
      handlePress();
    },
  };

  return (
    <Pressable
      {...(webKeyDownProps as Pick<ComponentProps<typeof Pressable>, "onKeyDown">)}
      accessibilityRole="switch"
      accessibilityState={{checked: value, disabled}}
      aria-checked={value}
      aria-disabled={disabled}
      disabled={disabled}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      onPress={handlePress}
      style={{
        alignItems: "center",
        backgroundColor: isHovered && !disabled ? theme.surface.baseHover : theme.surface.base,
        borderRadius: theme.radius.default,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.primitives.spacing3,
      }}
      testID={testID}
    >
      <View style={{alignItems: "center", flexDirection: "row", gap: 6}}>
        <Text size="md">{title}</Text>
        {showChangesBadge && (
          <FilterChangesBadge testID={testID ? resolveTestID(testID, "badge") : undefined} />
        )}
      </View>
      <View
        style={{
          alignItems: value ? "flex-end" : "flex-start",
          backgroundColor: trackColor,
          borderColor,
          borderRadius: SWITCH_HEIGHT,
          borderWidth: focused ? 2 : 1,
          height: SWITCH_HEIGHT,
          justifyContent: "center",
          paddingHorizontal: 1,
          width: SWITCH_WIDTH,
        }}
        testID={testID ? resolveTestID(testID, "switch") : undefined}
      >
        <View
          style={{
            backgroundColor: theme.surface.base,
            borderColor: disabled ? theme.surface.disabled : theme.surface.secondaryDark,
            borderRadius: KNOB_SIZE / 2,
            borderWidth: value ? 0 : 1,
            height: KNOB_SIZE,
            width: KNOB_SIZE,
          }}
        />
      </View>
    </Pressable>
  );
};
