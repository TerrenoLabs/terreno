import type {FC} from "react";
import {View} from "react-native";

import type {SelectFieldProps} from "./Common";
import {FieldError} from "./fieldElements/FieldError";
import {FieldHelperText} from "./fieldElements/FieldHelperText";
import {FieldTitle} from "./fieldElements/FieldTitle";
import {RNPickerSelect} from "./PickerSelect";
import {resolveFieldTestIDsFromProps} from "./testing/resolveTestId";

export const SelectField: FC<SelectFieldProps> = ({
  disabled = false,
  errorText,
  helperText,
  options,
  requireValue = false,
  placeholder = "Please select an option.",
  disableSearch = false,
  renderMenuInBodyPortal = false,
  title,
  value,
  onChange,
  testID,
  testIDs,
}) => {
  const clearOption = {label: placeholder ?? "---", value: ""};
  const fieldTestIDs = resolveFieldTestIDsFromProps({testID, testIDs});

  return (
    <View style={{minWidth: 0, width: "100%"}}>
      {Boolean(title) && <FieldTitle testID={fieldTestIDs.label} text={title!} />}
      {Boolean(errorText) && <FieldError testID={fieldTestIDs.error} text={errorText!} />}
      <View style={{alignSelf: "stretch", minWidth: 0, width: "100%"}}>
        <RNPickerSelect
          disabled={disabled}
          disableSearch={disableSearch}
          items={options}
          onValueChange={(v) => {
            if (v === undefined || v === null || v === "") {
              onChange("");
            } else {
              onChange(String(v));
            }
          }}
          placeholder={!requireValue ? clearOption : {}}
          renderMenuInBodyPortal={renderMenuInBodyPortal}
          textInputProps={{
            accessibilityLabel: title ?? placeholder,
            testID: fieldTestIDs.input,
          }}
          value={value ?? ""}
        />
      </View>
      {Boolean(helperText) && <FieldHelperText testID={fieldTestIDs.helper} text={helperText!} />}
    </View>
  );
};
