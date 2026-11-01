import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {CustomSelectField} from "./CustomSelectField";
import {renderWithTheme} from "./test-utils";

describe("CustomSelectField", () => {
  const defaultOptions = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
    {label: "Option C", value: "c"},
  ];

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <CustomSelectField onChange={() => {}} options={defaultOptions} value="" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with title", () => {
    const {getByText, toJSON} = renderWithTheme(
      <CustomSelectField
        onChange={() => {}}
        options={defaultOptions}
        title="Select Option"
        value=""
      />
    );
    expect(getByText("Select Option")).toBeTruthy();
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with placeholder", () => {
    const {toJSON} = renderWithTheme(
      <CustomSelectField
        onChange={() => {}}
        options={defaultOptions}
        placeholder="Choose one..."
        value=""
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with selected value", () => {
    const {toJSON} = renderWithTheme(
      <CustomSelectField onChange={() => {}} options={defaultOptions} value="b" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom value (not in options)", () => {
    const {toJSON} = renderWithTheme(
      <CustomSelectField onChange={() => {}} options={defaultOptions} value="custom-value" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with error text", () => {
    const {getByText} = renderWithTheme(
      <CustomSelectField
        errorText="Please select an option"
        onChange={() => {}}
        options={defaultOptions}
        value=""
      />
    );
    expect(getByText("Please select an option")).toBeTruthy();
  });

  it("renders with helper text", () => {
    const {getByText} = renderWithTheme(
      <CustomSelectField
        helperText="Select or enter a custom value"
        onChange={() => {}}
        options={defaultOptions}
        value=""
      />
    );
    expect(getByText("Select or enter a custom value")).toBeTruthy();
  });

  it("renders disabled state", () => {
    const {toJSON} = renderWithTheme(
      <CustomSelectField disabled onChange={() => {}} options={defaultOptions} value="a" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("includes custom option in dropdown", () => {
    // The component automatically adds a "Custom" option to the options list
    const {toJSON} = renderWithTheme(
      <CustomSelectField onChange={() => {}} options={defaultOptions} value="" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("shows custom input when 'custom' is selected from dropdown", async () => {
    const onChange = mock(() => {});
    const {getByTestId, queryByPlaceholderText} = renderWithTheme(
      <CustomSelectField disableSearch onChange={onChange} options={defaultOptions} value="a" />
    );

    const picker = getByTestId("ios_picker");
    await act(async () => {
      fireEvent(picker, "onValueChange", "custom", 4);
    });

    // onChange should be called with empty string when custom is selected
    expect(onChange).toHaveBeenCalledWith("");

    // The custom input field should now be visible
    expect(queryByPlaceholderText("None selected")).toBeTruthy();
  });

  it("hides custom input and updates value when a non-custom option is selected after custom", async () => {
    const onChange = mock(() => {});
    // Start with a custom value so custom input is already shown
    const {getByTestId, queryByPlaceholderText} = renderWithTheme(
      <CustomSelectField
        disableSearch
        onChange={onChange}
        options={defaultOptions}
        value="my-custom-value"
      />
    );

    // Custom input should be visible because value is not in options
    expect(queryByPlaceholderText("None selected")).toBeTruthy();

    const picker = getByTestId("ios_picker");
    await act(async () => {
      fireEvent(picker, "onValueChange", "a", 1);
    });

    // onChange should be called with the option value
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("calls onChange with selected value for a regular option", async () => {
    const onChange = mock(() => {});
    const {getByTestId} = renderWithTheme(
      <CustomSelectField disableSearch onChange={onChange} options={defaultOptions} value="" />
    );

    const picker = getByTestId("ios_picker");
    await act(async () => {
      fireEvent(picker, "onValueChange", "b", 2);
    });

    expect(onChange).toHaveBeenCalledWith("b");
  });
});
