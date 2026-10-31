import {describe, expect, it} from "bun:test";
import {createRef} from "react";

import {DateTimeActionSheet} from "./DateTimeActionSheet";
import {renderWithTheme} from "./test-utils";

// Note: @react-native-picker/picker, react-native-calendars, and expo-localization
// are mocked globally in bunSetup.ts

describe("DateTimeActionSheet", () => {
  const defaultProps = {
    actionSheetRef: createRef<unknown>(),
    onChange: () => {},
    onDismiss: () => {},
    visible: true,
  };

  it("renders correctly with datetime type", () => {
    const {toJSON} = renderWithTheme(
      <DateTimeActionSheet {...defaultProps} type="datetime" value="2024-01-15T10:30:00.000Z" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("component is defined", () => {
    expect(DateTimeActionSheet).toBeDefined();
    expect(typeof DateTimeActionSheet).toBe("function");
  });

  it("renders correctly with date type", () => {
    const {toJSON} = renderWithTheme(
      <DateTimeActionSheet {...defaultProps} type="date" value="2024-01-15T00:00:00.000Z" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders correctly with time type", () => {
    const {toJSON} = renderWithTheme(
      <DateTimeActionSheet {...defaultProps} type="time" value="2024-01-15T10:30:00.000Z" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders correctly when not visible", () => {
    const {toJSON} = renderWithTheme(
      <DateTimeActionSheet
        {...defaultProps}
        type="datetime"
        value="2024-01-15T10:30:00.000Z"
        visible={false}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with custom timezone", () => {
    const {toJSON} = renderWithTheme(
      <DateTimeActionSheet
        {...defaultProps}
        timezone="America/Los_Angeles"
        type="datetime"
        value="2024-01-15T10:30:00.000Z"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
