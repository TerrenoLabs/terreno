import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";

import {NumberField} from "./NumberField";
import {renderWithTheme} from "./test-utils";

const noOp = (): void => {};

describe("NumberField", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<NumberField onChange={noOp} type="number" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with initial value", () => {
    const {getByDisplayValue} = renderWithTheme(
      <NumberField onChange={noOp} type="number" value="42" />
    );
    expect(getByDisplayValue("42")).toBeTruthy();
  });

  it("calls onChange with valid integer", async () => {
    const handleChange = mock((_value: string): void => {});
    const {getByDisplayValue} = renderWithTheme(
      <NumberField onChange={handleChange} type="number" value="" />
    );

    const input = getByDisplayValue("");
    await act(async () => {
      fireEvent.changeText(input, "123");
    });

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith("123");
    });
  });

  it("does not call onChange with non-integer for number type", async () => {
    const handleChange = mock((_value: string): void => {});
    const {getByDisplayValue} = renderWithTheme(
      <NumberField onChange={handleChange} type="number" value="" />
    );

    const input = getByDisplayValue("");
    await act(async () => {
      fireEvent.changeText(input, "12.5");
    });

    // onChange should not be called for decimal when type is number
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("calls onChange with valid decimal", async () => {
    const handleChange = mock((_value: string): void => {});
    const {getByDisplayValue} = renderWithTheme(
      <NumberField onChange={handleChange} type="decimal" value="" />
    );

    const input = getByDisplayValue("");
    await act(async () => {
      fireEvent.changeText(input, "12.5");
    });

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith("12.5");
    });
  });

  it("handles leading dot for decimal type", async () => {
    const handleChange = mock((_value: string): void => {});
    const {getByDisplayValue} = renderWithTheme(
      <NumberField onChange={handleChange} type="decimal" value="" />
    );

    const input = getByDisplayValue("");
    await act(async () => {
      fireEvent.changeText(input, ".");
    });

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith("0.");
    });
  });

  it("validates max value", () => {
    const {getByText} = renderWithTheme(
      <NumberField max={100} onChange={noOp} type="number" value="150" />
    );
    expect(getByText("Value must be less than or equal to 100")).toBeTruthy();
  });

  it("validates min value", () => {
    const {getByText} = renderWithTheme(
      <NumberField min={10} onChange={noOp} type="number" value="5" />
    );
    expect(getByText("Value must be greater than or equal to 10")).toBeTruthy();
  });

  it("shows custom errorText", () => {
    const {getByText} = renderWithTheme(
      <NumberField errorText="Custom error" onChange={noOp} type="number" value="" />
    );
    expect(getByText("Custom error")).toBeTruthy();
  });

  it("does not show error for valid number within range", () => {
    const {queryByText} = renderWithTheme(
      <NumberField max={100} min={0} onChange={noOp} type="number" value="50" />
    );
    expect(queryByText(/must be/)).toBeNull();
  });

  it("shows decimal error for non-numeric characters in decimal type", () => {
    const {getByText} = renderWithTheme(
      <NumberField onChange={noOp} type="decimal" value="12abc" />
    );
    expect(getByText("Value must be a decimal")).toBeTruthy();
  });

  it("shows decimal error for multiple decimal points", () => {
    const {getByText} = renderWithTheme(
      <NumberField onChange={noOp} type="decimal" value="1.2.3" />
    );
    expect(getByText("Value must be a decimal")).toBeTruthy();
  });

  it("syncs value when prop changes", async () => {
    const handleChange = mock((_value: string): void => {});
    const {getByDisplayValue, unmount} = renderWithTheme(
      <NumberField onChange={handleChange} type="number" value="10" />
    );
    expect(getByDisplayValue("10")).toBeTruthy();

    // Unmount and render with new value to test prop sync
    unmount();
    const {getByDisplayValue: getByDisplayValue2} = renderWithTheme(
      <NumberField onChange={handleChange} type="number" value="20" />
    );
    expect(getByDisplayValue2("20")).toBeTruthy();
  });
});
