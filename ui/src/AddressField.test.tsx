import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import type {ReactTestInstance} from "react-test-renderer";

import {AddressField} from "./AddressField";
import type {AddressFieldProps} from "./Common";
import {renderWithTheme} from "./test-utils";

describe("AddressField", () => {
  let mockOnChange: ReturnType<typeof mock>;
  let mockOnBlur: ReturnType<typeof mock>;

  const defaultValue = {
    address1: "123 Main St",
    address2: "Apt 4B",
    city: "Springfield",
    countyCode: "17167",
    countyName: "Sangamon",
    state: "IL",
    zipcode: "62701",
  };

  beforeEach(() => {
    mockOnChange = mock(() => {});
    mockOnBlur = mock(() => {});
  });

  afterEach(() => {
    // Reset mocks after each test
  });

  const defaultProps = {
    testID: "test-address",
    value: defaultValue,
  };

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <AddressField {...defaultProps} onBlur={mockOnBlur} onChange={mockOnChange} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders all address fields", () => {
    const {getByTestId} = renderWithTheme(
      <AddressField {...defaultProps} onBlur={mockOnBlur} onChange={mockOnChange} />
    );

    expect(getByTestId("test-address-address1")).toBeTruthy();
    expect(getByTestId("test-address-address2")).toBeTruthy();
    expect(getByTestId("test-address-city")).toBeTruthy();
    expect(getByTestId("test-address-zip")).toBeTruthy();
  });

  it("calls onChange when address fields are updated", () => {
    const {getByTestId} = renderWithTheme(
      <AddressField {...defaultProps} onBlur={mockOnBlur} onChange={mockOnChange} />
    );

    const cityInput = getByTestId("test-address-city");
    fireEvent.changeText(cityInput, "New City");

    expect(mockOnChange).toHaveBeenCalledWith({
      ...defaultValue,
      city: "New City",
    });
  });

  it("calls onBlur when a field is blurred", () => {
    const {getByTestId} = renderWithTheme(
      <AddressField {...defaultProps} onBlur={mockOnBlur} onChange={mockOnChange} />
    );
    // Reset mock since it was called during render
    mockOnBlur.mockClear();
    const zipInput = getByTestId("test-address-zip");
    fireEvent.changeText(zipInput, "90210");
    fireEvent(zipInput, "blur");

    expect(mockOnBlur).toHaveBeenCalledWith({
      ...defaultValue,
      zipcode: "90210",
    });
  });

  it("renders county fields when includeCounty is true", () => {
    const {getByTestId} = renderWithTheme(
      <AddressField {...defaultProps} includeCounty onBlur={mockOnBlur} onChange={mockOnChange} />
    );

    expect(getByTestId("test-address-county")).toBeTruthy();
    expect(getByTestId("test-address-county-code")).toBeTruthy();
  });

  it("does not render county fields when includeCounty is false", () => {
    const {queryByTestId} = renderWithTheme(
      <AddressField
        {...defaultProps}
        includeCounty={false}
        onBlur={mockOnBlur}
        onChange={mockOnChange}
      />
    );

    expect(queryByTestId("test-address-county")).toBeNull();
    expect(queryByTestId("test-address-county-code")).toBeNull();
  });

  it("disables all fields when disabled prop is true", () => {
    const {getByTestId} = renderWithTheme(
      <AddressField {...defaultProps} disabled onBlur={mockOnBlur} onChange={mockOnChange} />
    );

    const address1Input = getByTestId("test-address-address1");
    const cityInput = getByTestId("test-address-city");

    // Check that the disabled prop is passed down to the inputs
    expect(address1Input.props.accessibilityState.disabled).toBe(true);
    expect(cityInput.props.accessibilityState.disabled).toBe(true);
  });

  it("calls onChange when address2 changes", () => {
    const {getByTestId} = renderWithTheme(
      <AddressField {...defaultProps} onBlur={mockOnBlur} onChange={mockOnChange} />
    );
    fireEvent.changeText(getByTestId("test-address-address2"), "Suite 500");
    expect(mockOnChange).toHaveBeenCalledWith({...defaultValue, address2: "Suite 500"});
  });

  it("calls onChange when countyName and countyCode change", () => {
    const {getByTestId} = renderWithTheme(
      <AddressField {...defaultProps} includeCounty onBlur={mockOnBlur} onChange={mockOnChange} />
    );
    fireEvent.changeText(getByTestId("test-address-county"), "Clark");
    expect(mockOnChange).toHaveBeenCalledWith({...defaultValue, countyName: "Clark"});
    fireEvent.changeText(getByTestId("test-address-county-code"), "999");
    expect(mockOnChange).toHaveBeenCalledWith({...defaultValue, countyCode: "999"});
  });

  it("renders without throwing when value is undefined", () => {
    // Simulates an untyped caller that omits the required value at runtime.
    const missingValue = undefined as unknown as AddressFieldProps["value"];
    expect(() =>
      renderWithTheme(
        <AddressField
          onBlur={mockOnBlur}
          onChange={mockOnChange}
          testID="no-value"
          value={missingValue}
        />
      )
    ).not.toThrow();
  });

  it("invokes autocomplete callbacks with merged values", () => {
    const {UNSAFE_getAllByProps} = renderWithTheme(
      <AddressField {...defaultProps} onBlur={mockOnBlur} onChange={mockOnChange} />
    );
    const autocompletes = UNSAFE_getAllByProps({}).filter(
      (el: ReactTestInstance) =>
        typeof el.props?.handleAutoCompleteChange === "function" &&
        typeof el.props?.handleAddressChange === "function"
    );
    expect(autocompletes.length).toBeGreaterThan(0);
    const ac = autocompletes[0];
    // Trigger handleAddressChange for address1
    ac.props.handleAddressChange("456 Oak Ave");
    expect(mockOnChange).toHaveBeenCalledWith({...defaultValue, address1: "456 Oak Ave"});
    // Trigger handleAutoCompleteChange with a new address object
    ac.props.handleAutoCompleteChange({city: "Chicago", state: "IL"});
    expect(mockOnChange).toHaveBeenCalledWith({
      ...defaultValue,
      city: "Chicago",
      state: "IL",
    });
  });
});
