import {afterEach, describe, it} from "bun:test";
import {SelectField} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {router, useGlobalSearchParams} from "expo-router";
import type {ScaledSize} from "react-native";
import {useWindowDimensions} from "react-native";

import {renderWithTheme} from "../../ui/src/test-utils";
import {DemoHeaderControls} from "./DemoHeaderControls";

type MockableUseWindowDimensions = typeof useWindowDimensions & {
  mockImplementation?: (impl: () => ScaledSize) => void;
};

interface SearchParamsMock {
  mockImplementation: (impl: () => Record<string, string>) => void;
}

interface SetParamsMock {
  mock: {calls: unknown[][]};
  mockClear: () => void;
}

type NavigateMock = SetParamsMock;

const setWindowWidth = (width: number): void => {
  (useWindowDimensions as MockableUseWindowDimensions).mockImplementation?.(() => ({
    fontScale: 1,
    height: 812,
    scale: 2,
    width,
  }));
};

const searchParams = useGlobalSearchParams as unknown as SearchParamsMock;
const setParams = router.setParams as unknown as SetParamsMock;
const navigate = router.navigate as unknown as NavigateMock;

describe("DemoHeaderControls", () => {
  afterEach(() => {
    setWindowWidth(375);
    searchParams.mockImplementation(() => ({}));
    setParams.mockClear();
    navigate.mockClear();
  });

  it("keeps the theme switcher in the nav header", () => {
    setWindowWidth(1400);
    searchParams.mockImplementation(() => ({theme: "dark"}));
    const {getByTestId, UNSAFE_getAllByType} = renderWithTheme(
      <DemoHeaderControls modeTarget="dev" />
    );

    assert.exists(getByTestId("preview-theme"));
    assert.exists(getByTestId("header-mode-dev-clickable"));
    const themeField = UNSAFE_getAllByType(SelectField).find(
      (node) => node.props.testID === "preview-theme"
    );
    assert.equal(themeField?.props.value, "dark");
  });

  it("writes a light/dark change into the route query", () => {
    setWindowWidth(1400);
    const {UNSAFE_getAllByType} = renderWithTheme(<DemoHeaderControls modeTarget="demo" />);
    const themeField = UNSAFE_getAllByType(SelectField).find(
      (node) => node.props.testID === "preview-theme"
    );

    act(() => {
      themeField?.props.onChange("dark");
    });

    assert.deepEqual(setParams.mock.calls[0]?.[0], {
      background: "",
      locale: "",
      reducedMotion: "",
      rtl: "",
      theme: "dark",
      viewport: "",
    });
  });

  it("keeps every active preview param when switching modes", async () => {
    setWindowWidth(1400);
    searchParams.mockImplementation(() => ({
      locale: "es",
      rtl: "1",
      theme: "dark",
      viewport: "375",
    }));
    const {getByTestId} = renderWithTheme(<DemoHeaderControls modeTarget="dev" />);

    await act(async () => {
      fireEvent.press(getByTestId("header-mode-dev-clickable"));
    });

    assert.deepEqual(navigate.mock.calls[0]?.[0], {
      params: {locale: "es", rtl: "1", theme: "dark", viewport: "375"},
      pathname: "/dev",
    });
  });
});
