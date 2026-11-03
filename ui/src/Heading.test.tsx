import {describe, expect, it} from "bun:test";

import {Heading} from "./Heading";
import {renderWithTheme} from "./test-utils";

describe("Heading", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<Heading>Test Heading</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders text content correctly", () => {
    const {getByText} = renderWithTheme(<Heading>Hello World</Heading>);
    expect(getByText("Hello World")).toBeTruthy();
  });

  it("renders with sm size", () => {
    const {toJSON} = renderWithTheme(<Heading size="sm">Small Heading</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with md size", () => {
    const {toJSON} = renderWithTheme(<Heading size="md">Medium Heading</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with lg size", () => {
    const {toJSON} = renderWithTheme(<Heading size="lg">Large Heading</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with xl size", () => {
    const {toJSON} = renderWithTheme(<Heading size="xl">Extra Large Heading</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with 2xl size", () => {
    const {toJSON} = renderWithTheme(<Heading size="2xl">2XL Heading</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("applies center alignment", () => {
    const {toJSON} = renderWithTheme(<Heading align="center">Centered</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("applies right alignment", () => {
    const {toJSON} = renderWithTheme(<Heading align="right">Right Aligned</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("applies secondary color", () => {
    const {toJSON} = renderWithTheme(<Heading color="secondaryDark">Secondary</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("applies accent color", () => {
    const {toJSON} = renderWithTheme(<Heading color="accent">Accent</Heading>);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with testID", () => {
    const {getByTestId} = renderWithTheme(<Heading testID="test-heading">Test</Heading>);
    expect(getByTestId("test-heading")).toBeTruthy();
  });

  it("is plain text without a level", () => {
    const {getByText} = renderWithTheme(<Heading>Plain</Heading>);
    const heading = getByText("Plain");
    expect(heading.props.role).toBeUndefined();
    expect(heading.props["aria-level"]).toBeUndefined();
  });

  it("exposes a heading role and level when level is set", () => {
    const {getByRole} = renderWithTheme(<Heading level={2}>Section</Heading>);
    const heading = getByRole("heading", {name: "Section"});
    expect(heading.props.role).toBe("heading");
    expect(heading.props["aria-level"]).toBe(2);
  });
});
