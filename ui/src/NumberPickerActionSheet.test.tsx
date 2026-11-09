import {describe, expect, it, mock} from "bun:test";
import {act, render} from "@testing-library/react-native";
import {createRef} from "react";
import type {ReactTestInstance} from "react-test-renderer";

import type {ActionSheet} from "./ActionSheet";
import {NumberPickerActionSheet} from "./NumberPickerActionSheet";
import {ThemeProvider} from "./Theme";

describe("NumberPickerActionSheet", () => {
  it("component is defined", () => {
    expect(NumberPickerActionSheet).toBeDefined();
    expect(typeof NumberPickerActionSheet).toBe("function");
  });

  it("renders correctly", () => {
    const actionSheetRef = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <NumberPickerActionSheet
          actionSheetRef={actionSheetRef}
          max={100}
          min={0}
          onChange={() => {}}
          value="50"
        />
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with different range", () => {
    const actionSheetRef = createRef<ActionSheet>();
    const {toJSON} = render(
      <ThemeProvider>
        <NumberPickerActionSheet
          actionSheetRef={actionSheetRef}
          max={500}
          min={100}
          onChange={() => {}}
          value="250"
        />
      </ThemeProvider>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("invokes onChange when picker value changes", () => {
    const actionSheetRef = createRef<ActionSheet>();
    const handleChange = mock((_val: string) => {});
    const {UNSAFE_getAllByProps} = render(
      <ThemeProvider>
        <NumberPickerActionSheet
          actionSheetRef={actionSheetRef}
          max={10}
          min={0}
          onChange={handleChange}
          value="5"
        />
      </ThemeProvider>
    );
    const pickers = UNSAFE_getAllByProps({selectedValue: "5"});
    const picker = pickers.find(
      (p: ReactTestInstance) => typeof p.props.onValueChange === "function"
    );
    act(() => {
      if (picker) {
        picker.props.onValueChange(7);
      }
    });
    expect(handleChange).toHaveBeenCalledWith("7");
  });

  it("closes the action sheet when Close button is pressed", () => {
    const setModalVisible = mock((_v: boolean) => {});
    const actionSheetRef = createRef<ActionSheet>();
    const {UNSAFE_getAllByProps} = render(
      <ThemeProvider>
        <NumberPickerActionSheet
          actionSheetRef={actionSheetRef}
          max={10}
          min={0}
          onChange={() => {}}
          value="5"
        />
      </ThemeProvider>
    );
    // Replace the ref target with a mock after mount so the Button's onClick
    // invokes our spy instead of the real ActionSheet instance.
    (actionSheetRef as unknown as {current: {setModalVisible: typeof setModalVisible}}).current = {
      setModalVisible,
    };
    const closeButtons = UNSAFE_getAllByProps({text: "Close"});
    const closeButton = closeButtons.find(
      (b: ReactTestInstance) => typeof b.props.onClick === "function"
    );
    expect(closeButton).toBeDefined();
    act(() => {
      closeButton?.props.onClick();
    });
    expect(setModalVisible).toHaveBeenCalledWith(false);
  });
});
