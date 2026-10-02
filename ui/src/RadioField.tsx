import type React from "react";
import {TouchableOpacity, View} from "react-native";

import type {RadioFieldProps} from "./Common";
import {Heading} from "./Heading";
import {isNarrowViewport} from "./MediaQuery";
import {Radio} from "./Radio";
import {Text} from "./Text";

export const RadioField = ({
  title,
  options,
  value,
  onChange,
  variant = "rightText",
}: RadioFieldProps): React.ReactElement => {
  return (
    <View style={{gap: isNarrowViewport() ? 16 : 8}}>
      <Heading size="sm">{title}</Heading>
      {options.map((option) => (
        <TouchableOpacity
          accessibilityHint={`Select ${option} from list of options`}
          aria-label={option.label ?? option.value}
          aria-role="button"
          key={option.key ?? option.value}
          onPress={() => onChange(option.value)}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          {variant === "leftText" && <Text>{option.label ?? option.value}</Text>}
          <Radio key={option.key ?? option.value} selected={option.value === value} />
          {variant === "rightText" && (
            <View style={{marginRight: 0}}>
              <Text>{option.label ?? option.value}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
};
