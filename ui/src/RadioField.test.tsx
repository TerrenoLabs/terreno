import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import type {FieldOption} from "./Common";
import {RadioField} from "./RadioField";
import {renderWithTheme} from "./test-utils";

describe("RadioField", () => {
  const defaultOptions = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
    {label: "Option C", value: "c"},
  ];

  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <RadioField onChange={() => {}} options={defaultOptions} title="Select one" value="" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders title correctly", () => {
    const {getByText} = renderWithTheme(
      <RadioField onChange={() => {}} options={defaultOptions} title="Choose an option" value="" />
    );
    expect(getByText("Choose an option")).toBeTruthy();
  });

  it("renders all options", () => {
    const {getByText} = renderWithTheme(
      <RadioField onChange={() => {}} options={defaultOptions} title="Title" value="" />
    );
    expect(getByText("Option A")).toBeTruthy();
    expect(getByText("Option B")).toBeTruthy();
    expect(getByText("Option C")).toBeTruthy();
  });

  it("shows selected option", () => {
    const {toJSON} = renderWithTheme(
      <RadioField onChange={() => {}} options={defaultOptions} title="Title" value="b" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onChange when option is selected", () => {
    const handleChange = mock((_value: string) => {});
    const {getByText} = renderWithTheme(
      <RadioField onChange={handleChange} options={defaultOptions} title="Title" value="" />
    );

    fireEvent.press(getByText("Option B"));
    expect(handleChange).toHaveBeenCalledWith("b");
  });

  it("renders with rightText variant (default)", () => {
    const {toJSON} = renderWithTheme(
      <RadioField
        onChange={() => {}}
        options={defaultOptions}
        title="Title"
        value=""
        variant="rightText"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with leftText variant", () => {
    const {toJSON} = renderWithTheme(
      <RadioField
        onChange={() => {}}
        options={defaultOptions}
        title="Title"
        value=""
        variant="leftText"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders options using value when label is not provided", () => {
    // FieldOption requires a label; untyped callers can still omit it.
    const optionsWithoutLabels = [
      {value: "first"},
      {value: "second"},
      {value: "third"},
    ] as unknown as FieldOption[];
    const {getByText} = renderWithTheme(
      <RadioField onChange={() => {}} options={optionsWithoutLabels} title="Title" value="" />
    );
    expect(getByText("first")).toBeTruthy();
    expect(getByText("second")).toBeTruthy();
    expect(getByText("third")).toBeTruthy();
  });
});
