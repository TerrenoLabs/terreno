import {afterEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import type {ScaledSize} from "react-native";
import {useWindowDimensions} from "react-native";

import {renderWithTheme} from "../../ui/src/test-utils";
import {defaultPreviewState} from "../previewState";
import {DemoPreviewBar} from "./DemoPreviewBar";

type MockableUseWindowDimensions = typeof useWindowDimensions & {
  mockImplementation?: (impl: () => ScaledSize) => void;
};

const setWindowWidth = (width: number): void => {
  (useWindowDimensions as MockableUseWindowDimensions).mockImplementation?.(() => ({
    fontScale: 1,
    height: 812,
    scale: 2,
    width,
  }));
};

const noop = (): void => {};

describe("DemoPreviewBar", () => {
  afterEach(() => {
    setWindowWidth(375);
  });

  it("shows the theme, viewport, and background dropdowns in the header on wide windows", () => {
    setWindowWidth(1400);
    const {queryByTestId, UNSAFE_getAllByProps} = renderWithTheme(
      <DemoPreviewBar onChange={noop} shareQuery="" state={defaultPreviewState()} />
    );
    expect(queryByTestId("preview-theme")).toBeTruthy();
    assert.isAtLeast(UNSAFE_getAllByProps({label: "Follow system"}).length, 1);
    expect(queryByTestId("preview-viewport")).toBeTruthy();
    expect(queryByTestId("preview-background")).toBeTruthy();
  });

  it("moves every preview control into the settings modal on narrow windows", async () => {
    setWindowWidth(375);
    const {getByTestId, queryByTestId} = renderWithTheme(
      <DemoPreviewBar onChange={noop} shareQuery="" state={defaultPreviewState()} />
    );
    expect(queryByTestId("preview-theme")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("preview-settings"));
    });

    expect(queryByTestId("preview-theme")).toBeTruthy();
    expect(queryByTestId("preview-viewport")).toBeTruthy();
    expect(queryByTestId("preview-background")).toBeTruthy();
    expect(queryByTestId("preview-rtl")).toBeTruthy();
  });

  it("keeps a free-form locale from the URL selectable", async () => {
    setWindowWidth(1400);
    const {getByTestId, UNSAFE_getAllByProps} = renderWithTheme(
      <DemoPreviewBar
        onChange={noop}
        shareQuery="locale=fr"
        state={{...defaultPreviewState(), locale: "fr"}}
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("preview-settings"));
    });

    // The picker offers the URL locale alongside the built-in options.
    const localePickerValues = UNSAFE_getAllByProps({value: "fr"}).map(
      (node) => node.props.label ?? node.props.value
    );
    expect(localePickerValues).toContain("fr");
    expect(UNSAFE_getAllByProps({label: "fr"}).length).toBeGreaterThan(0);
  });

  it("writes the RTL toggle back through onChange", async () => {
    setWindowWidth(1400);
    const onChange = mock(noop);
    const {getByTestId} = renderWithTheme(
      <DemoPreviewBar onChange={onChange} shareQuery="" state={defaultPreviewState()} />
    );

    await act(async () => {
      fireEvent.press(getByTestId("preview-settings"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("preview-rtl.switch"));
    });

    expect(onChange).toHaveBeenCalledWith({...defaultPreviewState(), rtl: true});
  });
});
