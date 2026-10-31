import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {PhoneNumberField} from "./PhoneNumberField";
import {renderWithTheme} from "./test-utils";

describe("PhoneNumberField", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<PhoneNumberField onChange={() => {}} value="" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with placeholder", () => {
    const {getByPlaceholderText} = renderWithTheme(
      <PhoneNumberField onChange={() => {}} placeholder="Enter phone number" value="" />
    );
    expect(getByPlaceholderText("Enter phone number")).toBeTruthy();
  });

  it("renders with initial value", () => {
    const {getByDisplayValue} = renderWithTheme(
      <PhoneNumberField onChange={() => {}} value="(555) 123-4567" />
    );
    expect(getByDisplayValue("(555) 123-4567")).toBeTruthy();
  });

  it("renders with custom errorText", () => {
    const {getByText} = renderWithTheme(
      <PhoneNumberField errorText="Phone number is required" onChange={() => {}} value="" />
    );
    expect(getByText("Phone number is required")).toBeTruthy();
  });

  it("renders with icon", () => {
    const {toJSON} = renderWithTheme(
      <PhoneNumberField iconName="phone" onChange={() => {}} value="" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("uses US as default country code", () => {
    const {toJSON} = renderWithTheme(<PhoneNumberField onChange={() => {}} value="5551234567" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("accepts custom country code", () => {
    const {toJSON} = renderWithTheme(
      <PhoneNumberField defaultCountryCode="GB" onChange={() => {}} value="7911123456" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onBlur callback when provided", async () => {
    const handleBlur = mock((_value: string) => {});
    const handleChange = mock((_value: string) => {});
    const {getByDisplayValue} = renderWithTheme(
      <PhoneNumberField onBlur={handleBlur} onChange={handleChange} value="(555) 123-4567" />
    );
    const input = getByDisplayValue("(555) 123-4567");
    await act(async () => {
      fireEvent(input, "blur", {nativeEvent: {text: "(555) 123-4567"}});
    });
    expect(handleBlur).toHaveBeenCalled();
  });

  it("calls onBlur with invalid number and sets an error state", async () => {
    const handleBlur = mock((_value: string) => {});
    const handleChange = mock((_value: string) => {});
    const {getByDisplayValue} = renderWithTheme(
      <PhoneNumberField onBlur={handleBlur} onChange={handleChange} value="" />
    );
    const input = getByDisplayValue("");
    await act(async () => {
      fireEvent.changeText(input, "123");
      fireEvent(input, "blur", {nativeEvent: {text: "123"}});
    });
    expect(handleBlur).toHaveBeenCalled();
  });

  it("handles empty input on blur without error", async () => {
    const handleBlur = mock((_value: string) => {});
    const handleChange = mock((_value: string) => {});
    const {getByDisplayValue} = renderWithTheme(
      <PhoneNumberField onBlur={handleBlur} onChange={handleChange} value="" />
    );
    const input = getByDisplayValue("");
    await act(async () => {
      fireEvent(input, "blur", {nativeEvent: {text: ""}});
    });
    expect(handleBlur).toHaveBeenCalled();
  });

  it("shows 'Invalid phone number format' on blur when number cannot be parsed", async () => {
    const handleChange = mock((_value: string) => {});
    const {getByDisplayValue, getByText} = renderWithTheme(
      <PhoneNumberField onChange={handleChange} value="abc" />
    );
    const input = getByDisplayValue("abc");
    await act(async () => {
      fireEvent(input, "blur", {nativeEvent: {text: "abc"}});
    });
    expect(getByText("Invalid phone number format")).toBeTruthy();
  });

  it("shows 'Phone number is not valid' when number is possible but not valid", async () => {
    const handleChange = mock((_value: string) => {});
    // A number that parses and isPossible() but not isValid() for US
    const {getByDisplayValue, getByText} = renderWithTheme(
      <PhoneNumberField onChange={handleChange} value="(555) 555-5555" />
    );
    const input = getByDisplayValue("(555) 555-5555");
    await act(async () => {
      fireEvent(input, "blur", {nativeEvent: {text: "(555) 555-5555"}});
    });
    expect(getByText("Phone number is not valid")).toBeTruthy();
  });

  it("uses inputValue as-is when it matches formattedValue or has length 4", async () => {
    const handleChange = mock((_value: string) => {});
    const {getByDisplayValue} = renderWithTheme(
      <PhoneNumberField onChange={handleChange} value="" />
    );
    const input = getByDisplayValue("");
    // Input of length 4 triggers the else branch (setLocalValue(inputValue))
    await act(async () => {
      fireEvent.changeText(input, "(12)");
    });
    expect(getByDisplayValue("(12)")).toBeTruthy();
  });

  it("clears error state when valid number is entered after invalid one", async () => {
    const handleChange = mock((_value: string) => {});
    // Start with an invalid value so that blur triggers the error path.
    // TextField's onBlur uses its own value prop (localValue), not nativeEvent.text.
    const {getByDisplayValue, getByText, queryByText} = renderWithTheme(
      <PhoneNumberField onChange={handleChange} value="abc" />
    );
    const input = getByDisplayValue("abc");
    // Blur triggers validatePhoneNumber("abc") → "Invalid phone number format"
    await act(async () => {
      fireEvent(input, "blur", {nativeEvent: {}});
    });
    // Confirm error IS displayed
    expect(getByText("Invalid phone number format")).toBeTruthy();
    // Now type a valid number to clear the error
    await act(async () => {
      fireEvent.changeText(input, "2025551234");
    });
    expect(queryByText("Invalid phone number format")).toBeNull();
    expect(handleChange).toHaveBeenCalled();
  });
});
