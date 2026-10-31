import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {forwardRef, useImperativeHandle, useRef} from "react";
import {Pressable, Text, View} from "react-native";

import type {AddressInterface} from "./Common";
import {MobileAddressAutocomplete} from "./MobileAddressAutoComplete";
import {renderWithTheme} from "./test-utils";

// Capture the props passed to GooglePlacesAutocomplete so we can exercise the inline
// callbacks (onPress, onFocus, onBlur, onChange, textInputProps, etc.)
interface CapturedGooglePlacesProps {
  placeholder?: string;
  textInputProps?: {
    onFocus?: () => void;
    onBlur?: () => void;
    onChange?: (event: {nativeEvent: {text: string}}) => void;
  };
  onPress?: (
    data: {description: string},
    details: {
      address_components: {
        long_name: string;
        short_name: string;
        types: string[];
      }[];
    }
  ) => void;
}

let lastGooglePlacesProps: CapturedGooglePlacesProps | null = null;
const setAddressTextSpy = mock(() => {});

// Mock react-native-google-places-autocomplete
mock.module("react-native-google-places-autocomplete", () => ({
  GooglePlacesAutocomplete: forwardRef((props: CapturedGooglePlacesProps, ref) => {
    lastGooglePlacesProps = props;
    const innerRef = useRef<Record<string, unknown>>({});
    useImperativeHandle(ref, () => ({
      setAddressText: setAddressTextSpy,
      ...innerRef.current,
    }));
    return (
      <View testID="google-places-autocomplete">
        <Text>{props.placeholder}</Text>
        <Pressable
          onPress={() =>
            props.onPress?.(
              {description: "123 Main St"},
              {
                address_components: [
                  {long_name: "123", short_name: "123", types: ["street_number"]},
                  {long_name: "Main St", short_name: "Main St", types: ["route"]},
                  {long_name: "San Francisco", short_name: "SF", types: ["locality"]},
                  {
                    long_name: "California",
                    short_name: "CA",
                    types: ["administrative_area_level_1"],
                  },
                  {
                    long_name: "San Francisco County",
                    short_name: "SF County",
                    types: ["administrative_area_level_2"],
                  },
                  {long_name: "United States", short_name: "US", types: ["country"]},
                  {long_name: "94105", short_name: "94105", types: ["postal_code"]},
                ],
              }
            )
          }
          testID="mock-google-places-select"
        >
          <Text>Select</Text>
        </Pressable>
      </View>
    );
  }),
}));

describe("MobileAddressAutocomplete", () => {
  const defaultProps = {
    handleAddressChange: () => {},
    handleAutoCompleteChange: () => {},
    inputValue: "",
  };

  it("renders correctly with Google API key", () => {
    const {toJSON} = renderWithTheme(
      <MobileAddressAutocomplete {...defaultProps} googleMapsApiKey="test-api-key" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("component is defined", () => {
    expect(MobileAddressAutocomplete).toBeDefined();
    expect(typeof MobileAddressAutocomplete).toBe("function");
  });

  it("renders TextField fallback without Google API key", () => {
    const {toJSON} = renderWithTheme(<MobileAddressAutocomplete {...defaultProps} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders disabled state", () => {
    const {toJSON} = renderWithTheme(
      <MobileAddressAutocomplete {...defaultProps} disabled googleMapsApiKey="test-api-key" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with input value", () => {
    const {toJSON} = renderWithTheme(
      <MobileAddressAutocomplete
        {...defaultProps}
        googleMapsApiKey="test-api-key"
        inputValue="123 Main St"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("invokes handleAutoCompleteChange with processed address components", () => {
    const handleAutoCompleteChange = mock((_address: AddressInterface) => {});
    const handleAddressChange = mock(() => {});
    setAddressTextSpy.mockClear();
    const {getByTestId} = renderWithTheme(
      <MobileAddressAutocomplete
        googleMapsApiKey="test-api-key"
        handleAddressChange={handleAddressChange}
        handleAutoCompleteChange={handleAutoCompleteChange}
        includeCounty
        inputValue=""
      />
    );
    fireEvent.press(getByTestId("mock-google-places-select"));
    expect(handleAutoCompleteChange).toHaveBeenCalled();
    const payload = handleAutoCompleteChange.mock.calls[0][0] as {address1?: string};
    expect(payload.address1).toContain("Main St");
    expect(setAddressTextSpy).toHaveBeenCalled();
  });

  it("fires onFocus, onBlur and onChange via textInputProps callbacks", () => {
    const handleAddressChange = mock(() => {});
    renderWithTheme(
      <MobileAddressAutocomplete
        googleMapsApiKey="test-api-key"
        handleAddressChange={handleAddressChange}
        handleAutoCompleteChange={() => {}}
        inputValue=""
      />
    );
    const tip = lastGooglePlacesProps?.textInputProps;
    expect(typeof tip?.onFocus).toBe("function");
    expect(typeof tip?.onBlur).toBe("function");
    expect(typeof tip?.onChange).toBe("function");
    tip?.onFocus?.();
    tip?.onBlur?.();
    tip?.onChange?.({nativeEvent: {text: "456 Oak Ave"}});
    expect(handleAddressChange).toHaveBeenCalledWith("456 Oak Ave");
  });

  it("falls back to the TextField and propagates its onChange without an API key", () => {
    const handleAddressChange = mock(() => {});
    const {root} = renderWithTheme(
      <MobileAddressAutocomplete
        handleAddressChange={handleAddressChange}
        handleAutoCompleteChange={() => {}}
        inputValue=""
        testID="mobile-fallback"
      />
    );
    // Find the TextField component with nativeID="address1" and trigger its onChange callback
    const textFields = root.findAll((n) => n.props.nativeID === "address1" && n.props.onChangeText);
    expect(textFields.length).toBeGreaterThan(0);
    textFields[0].props.onChangeText("123 Main St");
    expect(handleAddressChange).toHaveBeenCalledWith("123 Main St");
  });

  it("wrapping TouchableOpacity clears focus when pressed", () => {
    const {UNSAFE_getAllByType} = renderWithTheme(
      <MobileAddressAutocomplete
        googleMapsApiKey="test-api-key"
        handleAddressChange={() => {}}
        handleAutoCompleteChange={() => {}}
        inputValue=""
      />
    );
    const {TouchableOpacity} = require("react-native");
    const [wrapper] = UNSAFE_getAllByType(TouchableOpacity);
    expect(wrapper).toBeTruthy();
    expect(() => wrapper.props.onPress?.()).not.toThrow();
  });

  it("fires handleAddressChange from the fallback TextField onChange", () => {
    const handleAddressChange = mock(() => {});
    const {TextField} = require("./TextField") as {
      TextField: React.ComponentType<{onChange?: (v: string) => void}>;
    };
    const {UNSAFE_getByType} = renderWithTheme(
      <MobileAddressAutocomplete
        handleAddressChange={handleAddressChange}
        handleAutoCompleteChange={() => {}}
        inputValue=""
      />
    );
    const textField = UNSAFE_getByType(TextField);
    act(() => {
      textField.props.onChange?.("789 Elm St");
    });
    expect(handleAddressChange).toHaveBeenCalledWith("789 Elm St");
  });
});
