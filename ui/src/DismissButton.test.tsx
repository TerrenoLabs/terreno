import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";

import {DismissButton} from "./DismissButton";
import {renderWithTheme} from "./test-utils";

describe("DismissButton", () => {
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(
      <DismissButton
        accessibilityHint="Dismisses the message"
        accessibilityLabel="Dismiss"
        onClick={() => {}}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls onClick when pressed", () => {
    const handleClick = mock(() => {});
    const {getByLabelText} = renderWithTheme(
      <DismissButton
        accessibilityHint="Dismisses the message"
        accessibilityLabel="Dismiss"
        onClick={handleClick}
      />
    );

    fireEvent.press(getByLabelText("Dismiss"));
    expect(handleClick).toHaveBeenCalled();
  });

  it("renders with primary color (default)", () => {
    const {toJSON} = renderWithTheme(
      <DismissButton
        accessibilityHint="Dismisses the message"
        accessibilityLabel="Dismiss"
        color="primary"
        onClick={() => {}}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with inverted color", () => {
    const {toJSON} = renderWithTheme(
      <DismissButton
        accessibilityHint="Dismisses the message"
        accessibilityLabel="Dismiss"
        color="inverted"
        onClick={() => {}}
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("has correct accessibility props", () => {
    const {getByLabelText} = renderWithTheme(
      <DismissButton
        accessibilityHint="Closes the dialog"
        accessibilityLabel="Close"
        onClick={() => {}}
      />
    );
    expect(getByLabelText("Close")).toBeTruthy();
  });
});
