import {describe, expect, it, mock} from "bun:test";

import {registerExpoTestEnvironment} from "./registerExpoTestEnvironment";

registerExpoTestEnvironment({setProcessEnv: false});

// Everything below loads react-native, so it is required after the environment is registered.
const {createElement} = require("react") as typeof import("react");
const {fireEvent, renderHook, waitFor} =
  require("@testing-library/react-native") as typeof import("@testing-library/react-native");
const {configureStore, createSlice} =
  require("@reduxjs/toolkit") as typeof import("@reduxjs/toolkit");
const {useSelector} = require("react-redux") as typeof import("react-redux");
const {Box, Button, Text, useTheme} = require("@terreno/ui") as typeof import("@terreno/ui");
const {createTerrenoWrapper, loadReduxProvider, renderWithTerreno} =
  require("./renderWithTerreno") as typeof import("./renderWithTerreno");

const createCounterStore = (): ReturnType<typeof configureStore<{counter: {count: number}}>> =>
  configureStore({
    reducer: {
      counter: createSlice({initialState: {count: 3}, name: "counter", reducers: {}}).reducer,
    },
  });

const Counter = (): ReturnType<typeof createElement> => {
  const count = useSelector((state: {counter: {count: number}}) => state.counter.count);
  return createElement(Text, null, `Count ${count}`);
};

describe("renderWithTerreno", () => {
  it("renders @terreno/ui components inside TerrenoProvider", async () => {
    const onClick = mock(() => {});
    const {getByTestId, getByText} = renderWithTerreno(
      createElement(
        Box,
        {testID: "box"},
        createElement(Text, null, "Hello"),
        createElement(Button, {onClick, testID: "go", text: "Go"})
      )
    );
    expect(getByTestId("box")).toBeTruthy();
    expect(getByText("Hello")).toBeTruthy();
    fireEvent.press(getByTestId("go"));
    await waitFor(() => expect(onClick).toHaveBeenCalled());
  });

  it("provides a Redux store", () => {
    const {getByText} = renderWithTerreno(createElement(Counter), {store: createCounterStore()});
    expect(getByText("Count 3")).toBeTruthy();
  });

  it("passes theme options to TerrenoProvider and nests an extra wrapper", () => {
    const Inner = ({children}: {children: unknown}): ReturnType<typeof createElement> =>
      createElement(Box, {testID: "inner"}, children as never);
    const {result} = renderHook(() => useTheme(), {
      wrapper: createTerrenoWrapper({
        theme: {initialPrimitives: {primary400: "#123456"}},
        wrapper: Inner,
      }),
    });
    expect(result.current.theme.primitives.primary400).toBe("#123456");
    const {getByTestId} = renderWithTerreno(createElement(Text, null, "x"), {wrapper: Inner});
    expect(getByTestId("inner")).toBeTruthy();
  });
});

describe("loadReduxProvider", () => {
  it("returns react-redux's Provider", () => {
    expect<unknown>(loadReduxProvider()).toBe(
      (require("react-redux") as {Provider: unknown}).Provider
    );
  });

  it("explains that a store needs react-redux when the package is missing", () => {
    const missing = (): never => {
      throw new Error("Cannot find package 'react-redux'");
    };
    expect(() => loadReduxProvider(missing)).toThrow(
      "renderWithTerreno: passing `store` requires the `react-redux` package"
    );
  });
});
