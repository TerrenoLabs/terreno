import {type FC, useCallback} from "react";
import {TouchableOpacity, View} from "react-native";

import {CheckBox} from "./CheckBox";
import type {MultiselectFieldProps} from "./Common";
import {FieldError} from "./fieldElements/FieldError";
import {FieldHelperText} from "./fieldElements/FieldHelperText";
import {Heading} from "./Heading";
import {isNarrowViewport} from "./MediaQuery";
import {Text} from "./Text";
import {resolveFieldTestIDsFromProps} from "./testing/resolveTestId";

interface OptionProps {
  isDefault: boolean;
  value: string;
  label?: string;
  selected: boolean;
  onSelect: () => void;
}

const Option: FC<OptionProps> = ({value, label, isDefault, selected, onSelect}) => {
  return (
    <View
      style={{
        display: "flex",
        flexDirection: isDefault ? "row" : "row-reverse",
        justifyContent: "space-between",
      }}
    >
      <View style={{flex: 1, flexWrap: "wrap"}}>
        <Text>{label ?? value}</Text>
      </View>
      <TouchableOpacity
        accessibilityHint={`Select ${label ?? value} from list of options`}
        aria-label={label ?? value}
        aria-role="checkbox"
        hitSlop={{bottom: 10, left: 10, right: 10, top: 10}}
        key={value}
        onPress={onSelect}
        style={{
          justifyContent: "center",
        }}
      >
        <View
          style={{
            paddingEnd: isDefault ? 0 : 8,
            paddingStart: isDefault ? 8 : 0,
          }}
        >
          <CheckBox selected={selected} />
        </View>
      </TouchableOpacity>
    </View>
  );
};

export const MultiselectField: FC<MultiselectFieldProps> = ({
  options,
  title,
  value = [],
  variant = "leftText",
  onChange,
  errorText,
  helperText,
  disabled,
  testID,
  testIDs,
}) => {
  const isMobile = isNarrowViewport();
  const isDefault = variant === "leftText";
  const fieldTestIDs = resolveFieldTestIDsFromProps({testID, testIDs});
  const selectedItems = value ?? [];

  const toggleItem = useCallback(
    (item: string): void => {
      const newSelectedItems = selectedItems.includes(item)
        ? selectedItems.filter((selected) => selected !== item)
        : [...selectedItems, item];
      onChange(newSelectedItems);
    },
    [onChange, selectedItems]
  );
  return (
    <View
      accessibilityHint="Contains a prompt and list of options to select"
      aria-label={title}
      aria-role="combobox"
      style={{
        display: "flex",
        gap: isMobile ? 16 : 8,
        width: "100%",
      }}
      testID={fieldTestIDs.input}
    >
      <Heading color="primary" size="sm" testID={fieldTestIDs.label}>
        {title}
      </Heading>
      {Boolean(errorText) && <FieldError testID={fieldTestIDs.error} text={errorText!} />}
      {disabled ? (
        <Text>{value.join(", ")}</Text>
      ) : (
        options.map((option) => (
          <Option
            isDefault={isDefault}
            key={option.key ?? option.value}
            label={option.label}
            onSelect={() => toggleItem(option.value)}
            selected={selectedItems.includes(option.value)}
            value={option.value}
          />
        ))
      )}
      {Boolean(helperText) && <FieldHelperText testID={fieldTestIDs.helper} text={helperText!} />}
    </View>
  );
};
