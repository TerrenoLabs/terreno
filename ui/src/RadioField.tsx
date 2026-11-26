import type React from "react";
import {type FC, memo, useCallback} from "react";
import {TouchableOpacity, View} from "react-native";

import type {RadioFieldProps} from "./Common";
import {Heading} from "./Heading";
import {isNarrowViewport} from "./MediaQuery";
import {Radio} from "./Radio";
import {Text} from "./Text";
import {useStableCallback} from "./useStableCallback";

const OPTION_STYLE = {flexDirection: "row", justifyContent: "space-between"} as const;
const RIGHT_TEXT_STYLE = {marginRight: 0} as const;

interface RadioOptionProps {
  accessibilityHint: string;
  label: string;
  onSelect: (value: string) => void;
  selected: boolean;
  value: string;
  variant: NonNullable<RadioFieldProps["variant"]>;
}

// Memoized so choosing an option re-renders the two options that changed, not the whole list.
const RadioOption: FC<RadioOptionProps> = memo(
  ({accessibilityHint, label, onSelect, selected, value, variant}) => {
    const handlePress = useCallback((): void => {
      onSelect(value);
    }, [onSelect, value]);

    return (
      <TouchableOpacity
        accessibilityHint={accessibilityHint}
        aria-label={label}
        aria-role="button"
        onPress={handlePress}
        style={OPTION_STYLE}
      >
        {variant === "leftText" && <Text>{label}</Text>}
        <Radio selected={selected} />
        {variant === "rightText" && (
          <View style={RIGHT_TEXT_STYLE}>
            <Text>{label}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }
);
RadioOption.displayName = "RadioOption";

export const RadioField = ({
  title,
  options,
  value,
  onChange,
  variant = "rightText",
}: RadioFieldProps): React.ReactElement => {
  const handleSelect = useStableCallback((selectedValue: string): void => {
    onChange(selectedValue);
  });

  return (
    <View style={{gap: isNarrowViewport() ? 16 : 8}}>
      <Heading size="sm">{title}</Heading>
      {options.map((option) => (
        <RadioOption
          accessibilityHint={`Select ${option} from list of options`}
          key={option.key ?? option.value}
          label={option.label ?? option.value}
          onSelect={handleSelect}
          selected={option.value === value}
          value={option.value}
          variant={variant}
        />
      ))}
    </View>
  );
};
