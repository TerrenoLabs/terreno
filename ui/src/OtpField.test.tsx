import {describe, expect, it, mock} from "bun:test";
import {fireEvent, render} from "@testing-library/react-native";
import type {ReactElement} from "react";
import {useState} from "react";

import {OtpField} from "./OtpField";
import {ThemeProvider} from "./Theme";
import {renderWithTheme} from "./test-utils";

/**
 * Renders with a node mock per cell so tests can see which cell the field focuses. Returns the
 * focused cell numbers (1-based) in call order.
 */
const renderWithFocusSpy = (ui: ReactElement): ReturnType<typeof render> & {focused: number[]} => {
  const focused: number[] = [];
  const result = render(ui, {
    createNodeMock: (element: ReactElement) => {
      const cellTestID = (element.props as {testID?: string}).testID ?? "";
      const match = /-cell-(\d+)$/.exec(cellTestID);
      return {
        focus: () => {
          if (match) {
            focused.push(Number(match[1]));
          }
        },
      };
    },
    wrapper: ThemeProvider,
  });
  return Object.assign(result, {focused});
};

const cellValues = (getByTestId: (id: string) => {props: {value?: string}}, length = 6): string[] =>
  Array.from({length}, (_, index) => getByTestId(`otp-cell-${index + 1}`).props.value ?? "");

const ControlledOtp = ({
  onComplete,
  onChange,
}: {
  onComplete?: (code: string) => void;
  onChange?: (code: string) => void;
}): React.ReactElement => {
  const [code, setCode] = useState("");
  return (
    <OtpField
      onChange={(next) => {
        setCode(next);
        onChange?.(next);
      }}
      onComplete={onComplete}
      testID="otp"
      value={code}
    />
  );
};

describe("OtpField", () => {
  it("renders six cells by default with digit labels", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(<OtpField testID="otp" />);
    for (let k = 1; k <= 6; k++) {
      const cell = getByTestId(`otp-cell-${k}`);
      expect(cell.props["aria-label"]).toBe(`Digit ${k} of 6`);
      expect(cell.props.accessibilityLabel).toBe(`Digit ${k} of 6`);
    }
    expect(queryByTestId("otp-cell-7")).toBeNull();
    expect(getByTestId("otp").props.role).toBe("group");
    expect(getByTestId("otp").props["aria-label"]).toBe("Verification code");
  });

  it("renders the requested number of cells", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(<OtpField length={4} testID="otp" />);
    expect(getByTestId("otp-cell-4").props["aria-label"]).toBe("Digit 4 of 4");
    expect(queryByTestId("otp-cell-5")).toBeNull();
  });

  it("uses a numeric keyboard and one-time-code autofill hints", () => {
    const {getByTestId} = renderWithTheme(<OtpField testID="otp" />);
    const cell = getByTestId("otp-cell-1");
    expect(cell.props.keyboardType).toBe("number-pad");
    expect(cell.props.inputMode).toBe("numeric");
    expect(cell.props.autoComplete).toBe("one-time-code");
    expect(cell.props.textContentType).toBe("oneTimeCode");
  });

  it("calls onEnter with the code on Enter in any cell", () => {
    const onEnter = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<OtpField onEnter={onEnter} testID="otp" value="1234" />);
    expect(getByTestId("otp-cell-5").props.enterKeyHint).toBe("done");
    fireEvent(getByTestId("otp-cell-5"), "submitEditing");
    expect(onEnter).toHaveBeenCalledWith("1234");
  });

  it("pasting a full code fills every cell and fires onComplete", () => {
    const onComplete = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<OtpField onComplete={onComplete} testID="otp" />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "123456");
    expect(cellValues(getByTestId)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("pasting a full code into a later cell still fills from the first cell", () => {
    const onComplete = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<ControlledOtp onComplete={onComplete} />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "9");
    fireEvent.changeText(getByTestId("otp-cell-2"), "123 456");
    expect(cellValues(getByTestId)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("typing one digit per cell builds the code and completes on the last digit", () => {
    const onComplete = mock((_code: string) => {});
    const onChange = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(
      <ControlledOtp onChange={onChange} onComplete={onComplete} />
    );
    "65432".split("").forEach((digit, index) => {
      fireEvent.changeText(getByTestId(`otp-cell-${index + 1}`), digit);
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("65432");
    fireEvent.changeText(getByTestId("otp-cell-6"), "1");
    expect(onComplete).toHaveBeenCalledWith("654321");
  });

  it("ignores non-digit input", () => {
    const onChange = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<OtpField onChange={onChange} testID="otp" />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "a");
    expect(onChange).not.toHaveBeenCalled();
    expect(getByTestId("otp-cell-1").props.value).toBe("");
  });

  it("replaces a filled cell's digit when the old digit was not selected", () => {
    const {getByTestId} = renderWithTheme(<ControlledOtp />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "1");
    fireEvent.changeText(getByTestId("otp-cell-2"), "2");
    fireEvent.changeText(getByTestId("otp-cell-1"), "17");
    expect(cellValues(getByTestId).slice(0, 2)).toEqual(["7", "2"]);
  });

  it("backspace in an empty cell deletes the previous digit", () => {
    const onChange = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<ControlledOtp onChange={onChange} />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "1");
    fireEvent.changeText(getByTestId("otp-cell-2"), "2");
    fireEvent(getByTestId("otp-cell-3"), "keyPress", {nativeEvent: {key: "Backspace"}});
    expect(onChange).toHaveBeenLastCalledWith("1");
    expect(cellValues(getByTestId).slice(0, 2)).toEqual(["1", ""]);
  });

  it("backspace in a filled cell clears it through the text change", () => {
    const onChange = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<ControlledOtp onChange={onChange} />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "1");
    fireEvent.changeText(getByTestId("otp-cell-2"), "2");
    onChange.mockClear();
    fireEvent(getByTestId("otp-cell-2"), "keyPress", {nativeEvent: {key: "Backspace"}});
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.changeText(getByTestId("otp-cell-2"), "");
    expect(onChange).toHaveBeenLastCalledWith("1");
  });

  it("backspace in the first empty cell does nothing", () => {
    const onChange = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<OtpField onChange={onChange} testID="otp" />);
    fireEvent(getByTestId("otp-cell-1"), "keyPress", {nativeEvent: {key: "Backspace"}});
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a controlled value and the error text", () => {
    const {getByTestId} = renderWithTheme(
      <OtpField errorText="That code didn't work" testID="otp" value="12" />
    );
    expect(cellValues(getByTestId).slice(0, 3)).toEqual(["1", "2", ""]);
    expect(getByTestId("otp-error")).toBeTruthy();
    expect(getByTestId("otp-cell-1").props["aria-invalid"]).toBe(true);
  });

  it("disables every cell", () => {
    const {getByTestId} = renderWithTheme(<OtpField disabled testID="otp" />);
    expect(getByTestId("otp-cell-1").props.editable).toBe(false);
    expect(getByTestId("otp-cell-6").props.editable).toBe(false);
  });

  it("shows a focus border on the focused cell and drops it on blur", () => {
    const {getByTestId} = renderWithTheme(<OtpField testID="otp" />);
    const borderWidth = (): number => {
      const style = getByTestId("otp-cell-1").props.style;
      const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
      return flat.borderWidth;
    };
    expect(borderWidth()).toBe(1);
    fireEvent(getByTestId("otp-cell-1"), "focus");
    expect(borderWidth()).toBe(3);
    fireEvent(getByTestId("otp-cell-1"), "blur");
    expect(borderWidth()).toBe(1);
  });

  it("moves focus to the first empty cell when a later cell is focused", () => {
    const {getByTestId} = renderWithTheme(<OtpField autoFocus testID="otp" value="1" />);
    const style = (k: number): {borderWidth: number} => {
      const raw = getByTestId(`otp-cell-${k}`).props.style;
      return Array.isArray(raw) ? Object.assign({}, ...raw) : raw;
    };
    fireEvent(getByTestId("otp-cell-5"), "focus");
    // The tap on cell 5 is redirected, so cell 5 never shows as focused.
    expect(style(5).borderWidth).toBe(1);
    fireEvent(getByTestId("otp-cell-2"), "focus");
    expect(style(2).borderWidth).toBe(3);
  });

  it("pasting a full code into a filled cell drops the cell's old digit", () => {
    const onComplete = mock((_code: string) => {});
    const {getByTestId} = renderWithTheme(<ControlledOtp onComplete={onComplete} />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "1");
    fireEvent.changeText(getByTestId("otp-cell-1"), "1123456");
    expect(cellValues(getByTestId)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("keeps only the cell taking the next digit in the tab order so Tab can leave", () => {
    const {getByTestId} = renderWithTheme(<ControlledOtp />);
    const tabStops = (): number[] =>
      Array.from({length: 6}, (_, index) => getByTestId(`otp-cell-${index + 1}`).props.tabIndex);
    expect(tabStops()).toEqual([0, -1, -1, -1, -1, -1]);
    fireEvent.changeText(getByTestId("otp-cell-1"), "1");
    fireEvent.changeText(getByTestId("otp-cell-2"), "2");
    expect(tabStops()).toEqual([-1, -1, 0, -1, -1, -1]);
    fireEvent.changeText(getByTestId("otp-cell-1"), "123456");
    expect(tabStops()).toEqual([-1, -1, -1, -1, -1, 0]);
  });

  it("focusing the tab-stop cell keeps focus there", () => {
    const {getByTestId, focused} = renderWithFocusSpy(<OtpField testID="otp" />);
    fireEvent(getByTestId("otp-cell-1"), "focus");
    expect(focused).toEqual([]);
  });

  it("autoFocus focuses the first empty cell", () => {
    const {focused} = renderWithFocusSpy(<OtpField autoFocus testID="otp" value="12" />);
    expect(focused).toEqual([3]);
  });

  it("typing a digit moves focus to the next cell", () => {
    const {getByTestId, focused} = renderWithFocusSpy(<ControlledOtp />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "4");
    fireEvent.changeText(getByTestId("otp-cell-2"), "2");
    expect(focused).toEqual([2, 3]);
  });

  it("pasting a full code moves focus to the last cell", () => {
    const {getByTestId, focused} = renderWithFocusSpy(<ControlledOtp />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "123456");
    expect(focused).toEqual([6]);
  });

  it("backspace in an empty cell moves focus to the previous cell", () => {
    const {getByTestId, focused} = renderWithFocusSpy(<ControlledOtp />);
    fireEvent.changeText(getByTestId("otp-cell-1"), "1");
    fireEvent.changeText(getByTestId("otp-cell-2"), "2");
    focused.length = 0;
    fireEvent(getByTestId("otp-cell-3"), "keyPress", {nativeEvent: {key: "Backspace"}});
    expect(focused).toEqual([2]);
  });

  it("a tap on a cell past the first empty one sends focus to that empty cell", () => {
    const {getByTestId, focused} = renderWithFocusSpy(<OtpField testID="otp" value="1" />);
    fireEvent(getByTestId("otp-cell-5"), "focus");
    expect(focused).toEqual([2]);
  });

  it("renders a title and helper text", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <OtpField helperText="From your authenticator app" testID="otp" title="Code" />
    );
    expect(getByText("Code")).toBeTruthy();
    expect(getByTestId("otp-helper")).toBeTruthy();
  });
});
