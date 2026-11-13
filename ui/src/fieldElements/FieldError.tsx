// This component is intended to be used as an error message for form fields, specifically for text
// fields and text areas. It is not intended to be used as a standalone component.
import type {FC} from "react";
import {Text, View} from "react-native";

import {Icon} from "../Icon";
import {useTheme} from "../Theme";
import {toTestProps} from "../testing/resolveTestId";

interface FieldErrorProps {
  text: string;
  testID?: string;
}

export const FieldError: FC<FieldErrorProps> = ({text, testID}) => {
  const {theme} = useTheme();

  return (
    <View
      nativeID={testID}
      style={{alignItems: "center", flexDirection: "row", marginVertical: 2}}
      {...toTestProps(testID)}
    >
      <Icon color="error" iconName="triangle-exclamation" size="sm" />
      <View style={{marginLeft: 4}}>
        <Text style={{color: theme.text.error, fontSize: 12}}>{text}</Text>
      </View>
    </View>
  );
};
