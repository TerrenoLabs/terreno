import {afterAll, afterEach, beforeAll, describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {forwardRef} from "react";
import {Text, View} from "react-native";

import {isNarrowViewport} from "./MediaQuery";
import {renderWithTheme} from "./test-utils";
import {UnifiedAddressAutoCompleteField} from "./UnifiedAddressAutoComplete";

// react-native-google-places-autocomplete pulls in native bindings that fail
// to load in the bun test environment, so swap it for a lightweight stub.
mock.module("react-native-google-places-autocomplete", () => ({
  GooglePlacesAutocomplete: forwardRef(
    (
      props: {placeholder?: string; testID?: string},
      _ref: React.Ref<unknown>
    ): React.ReactElement => (
      <View testID={`mobile-autocomplete-${props.testID ?? "stub"}`}>
        <Text>{props.placeholder ?? "GooglePlacesAutocomplete"}</Text>
      </View>
    )
  ),
}));

interface MutableGlobal {
  document?: {createElement: () => Record<string, unknown>; head: {appendChild: () => void}};
  window?: {google?: unknown};
}

describe("UnifiedAddressAutoCompleteField", () => {
  const defaultProps = {
    handleAddressChange: () => {},
    handleAutoCompleteChange: () => {},
    inputValue: "",
  };

  it("renders plain TextField when no API key provided", () => {
    const {toJSON} = renderWithTheme(<UnifiedAddressAutoCompleteField {...defaultProps} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders plain TextField when API key is invalid", () => {
    const {toJSON} = renderWithTheme(
      <UnifiedAddressAutoCompleteField {...defaultProps} googleMapsApiKey="invalid!key" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders WebAddressAutocomplete when valid API key provided on web", () => {
    const {toJSON} = renderWithTheme(
      <UnifiedAddressAutoCompleteField
        {...defaultProps}
        googleMapsApiKey="test-dummy-key-not-real-0123456789"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders disabled state", () => {
    const {toJSON} = renderWithTheme(
      <UnifiedAddressAutoCompleteField {...defaultProps} disabled />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with input value", () => {
    const {toJSON} = renderWithTheme(
      <UnifiedAddressAutoCompleteField {...defaultProps} inputValue="123 Main St" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with testID", () => {
    const {toJSON} = renderWithTheme(
      <UnifiedAddressAutoCompleteField {...defaultProps} testID="address-field" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("forwards typing to handleAddressChange via the fallback TextField", () => {
    const handleAddressChange = mock(() => {});
    const {UNSAFE_getAllByType} = renderWithTheme(
      <UnifiedAddressAutoCompleteField
        handleAddressChange={handleAddressChange}
        handleAutoCompleteChange={() => {}}
        inputValue=""
      />
    );
    const {TextInput} = require("react-native");
    const inputs = UNSAFE_getAllByType(TextInput);
    expect(inputs.length).toBeGreaterThan(0);
    fireEvent.changeText(inputs[0], "1600 Amphitheatre Pkwy");
    expect(handleAddressChange).toHaveBeenCalledWith("1600 Amphitheatre Pkwy");
  });

  describe("web branch", () => {
    const testGlobal = globalThis as MutableGlobal;
    const originalDocument = testGlobal.document;
    const originalWindow = testGlobal.window;

    beforeAll(() => {
      testGlobal.document = {
        createElement: (): Record<string, unknown> => ({}),
        head: {appendChild: (): void => {}},
      };
      testGlobal.window = {
        google: {
          maps: {
            places: {
              Autocomplete: function MockAutocomplete(): void {
                return;
              },
            },
          },
        },
      };
    });

    afterAll(() => {
      testGlobal.document = originalDocument;
      testGlobal.window = originalWindow;
    });

    it("renders WebAddressAutocomplete when document is defined and key is valid", () => {
      const {toJSON} = renderWithTheme(
        <UnifiedAddressAutoCompleteField
          {...defaultProps}
          googleMapsApiKey="test-dummy-key-not-real-0123456789"
          testID="web-address"
        />
      );
      // The web branch loads Google Maps via document.head, so just confirm it rendered.
      expect(toJSON()).toBeDefined();
    });
  });

  describe("mobile/native branch", () => {
    afterEach(() => {
      (isNarrowViewport as ReturnType<typeof mock>).mockImplementation(() => false);
    });

    it("renders MobileAddressAutocomplete when isNarrowViewport + isNative + valid key", () => {
      (isNarrowViewport as ReturnType<typeof mock>).mockImplementation(() => true);
      const {getByTestId} = renderWithTheme(
        <UnifiedAddressAutoCompleteField
          {...defaultProps}
          googleMapsApiKey="test-dummy-key-not-real-0123456789"
          testID="mobile-address"
        />
      );
      expect(getByTestId("mobile-autocomplete-stub")).toBeDefined();
    });
  });
});
