import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";

import {LabeledCheckBox} from "./LabeledCheckBox";
import {renderWithTheme} from "./test-utils";

describe("LabeledCheckBox", () => {
  it("is a checkbox named by its label that reports the toggled state", () => {
    const onChange = mock((_checked: boolean) => {});
    const {getByLabelText, getByTestId} = renderWithTheme(
      <LabeledCheckBox checked={false} label="Remember me" onChange={onChange} testID="remember" />
    );
    expect(getByLabelText("Remember me")).toBeTruthy();
    expect(getByTestId("remember").props.role).toBe("checkbox");
    expect(getByTestId("remember").props["aria-checked"]).toBe(false);
    fireEvent.press(getByTestId("remember"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles with Space and ignores other keys", () => {
    const onChange = mock((_checked: boolean) => {});
    const {getByTestId} = renderWithTheme(
      <LabeledCheckBox checked label="Remember me" onChange={onChange} testID="remember" />
    );
    fireEvent(getByTestId("remember"), "keyDown", {key: "Enter", preventDefault: () => {}});
    expect(onChange).not.toHaveBeenCalled();
    fireEvent(getByTestId("remember"), "keyDown", {nativeEvent: {key: " "}});
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not toggle while disabled", () => {
    const onChange = mock((_checked: boolean) => {});
    const {getByTestId} = renderWithTheme(
      <LabeledCheckBox
        checked={false}
        disabled
        label="Remember me"
        onChange={onChange}
        testID="remember"
      />
    );
    fireEvent(getByTestId("remember"), "keyDown", {key: " ", preventDefault: () => {}});
    expect(onChange).not.toHaveBeenCalled();
  });
});
