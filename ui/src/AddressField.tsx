import {type FC, memo, useCallback} from "react";
import {View} from "react-native";

import type {AddressFieldProps, AddressInterface} from "./Common";
import {USSTATESLIST} from "./Constants";
import {SelectField} from "./SelectField";
import {TextField} from "./TextField";
import {UnifiedAddressAutoCompleteField} from "./UnifiedAddressAutoComplete";
import {useStableCallback} from "./useStableCallback";

interface AddressTextFieldProps {
  disabled?: boolean;
  field: string;
  onFieldChange: (field: string, newValue: string) => void;
  testID: string;
  title: string;
  value: string;
}

// Memoized so typing in one address field re-renders that field, not all of them.
const AddressTextField: FC<AddressTextFieldProps> = memo(
  ({disabled, field, onFieldChange, testID, title, value}) => {
    const handleChange = useCallback(
      (result: string): void => {
        onFieldChange(field, result);
      },
      [field, onFieldChange]
    );

    return (
      <TextField
        disabled={disabled}
        id={field}
        onChange={handleChange}
        testID={testID}
        title={title}
        type="text"
        value={value}
      />
    );
  }
);
AddressTextField.displayName = "AddressTextField";

interface AddressStateFieldProps {
  onFieldChange: (field: string, newValue: string) => void;
  value: string;
}

// Memoized so the state picker and its option list skip keystrokes in the other fields.
const AddressStateField: FC<AddressStateFieldProps> = memo(({onFieldChange, value}) => {
  const handleChange = useCallback(
    (result: string | undefined): void => {
      onFieldChange("state", result!);
    },
    [onFieldChange]
  );

  return <SelectField onChange={handleChange} options={USSTATESLIST} title="State" value={value} />;
});
AddressStateField.displayName = "AddressStateField";

export const AddressField: FC<AddressFieldProps> = ({
  disabled,
  googleMapsApiKey,
  googlePlacesMobileStyles,
  includeCounty,
  value,
  testID,
  onChange,
  onBlur,
}) => {
  const handleAddressChange = useStableCallback((field: string, newValue: string): void => {
    onChange({...value, [field]: newValue});
    onBlur?.({...value, [field]: newValue});
  });

  const handleAutoCompleteChange = useStableCallback((newValue: AddressInterface): void => {
    onChange({...value, ...newValue});
  });

  const handleAddress1Change = useCallback(
    (result: string): void => {
      handleAddressChange("address1", result);
    },
    [handleAddressChange]
  );

  const {
    address1 = "",
    address2 = "",
    city = "",
    state = "",
    zipcode = "",
    countyName = "",
    countyCode = "",
  }: AddressInterface = value ?? ({} as AddressInterface);

  return (
    <>
      <View style={{marginBottom: 16}}>
        <UnifiedAddressAutoCompleteField
          disabled={disabled}
          googleMapsApiKey={googleMapsApiKey}
          googlePlacesMobileStyles={googlePlacesMobileStyles}
          handleAddressChange={handleAddress1Change}
          handleAutoCompleteChange={handleAutoCompleteChange}
          includeCounty={includeCounty}
          inputValue={address1}
          testID={`${testID}-address1`}
        />
      </View>
      <View style={{marginBottom: 16}}>
        <AddressTextField
          disabled={disabled}
          field="address2"
          onFieldChange={handleAddressChange}
          testID={`${testID}-address2`}
          title="Apt, suite, etc"
          value={address2}
        />
      </View>
      <View style={{marginBottom: 16}}>
        <AddressTextField
          disabled={disabled}
          field="city"
          onFieldChange={handleAddressChange}
          testID={`${testID}-city`}
          title="City"
          value={city}
        />
      </View>
      <View style={{marginBottom: 16}}>
        <AddressStateField onFieldChange={handleAddressChange} value={state} />
      </View>
      <View style={{marginBottom: 16}}>
        <AddressTextField
          disabled={disabled}
          field="zipcode"
          onFieldChange={handleAddressChange}
          testID={`${testID}-zip`}
          title="Zipcode"
          value={zipcode}
        />
      </View>
      {includeCounty && (
        <>
          <View style={{marginBottom: 16}}>
            <AddressTextField
              disabled={disabled}
              field="countyName"
              onFieldChange={handleAddressChange}
              testID={`${testID}-county`}
              title="County Name"
              value={countyName}
            />
          </View>
          <View style={{marginBottom: 16}}>
            <AddressTextField
              disabled={disabled}
              field="countyCode"
              onFieldChange={handleAddressChange}
              testID={`${testID}-county-code`}
              title="County Code"
              value={countyCode}
            />
          </View>
        </>
      )}
    </>
  );
};
