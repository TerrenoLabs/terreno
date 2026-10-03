import {afterEach, describe, it} from "bun:test";
import {configureStore} from "@reduxjs/toolkit";
import {TerrenoProvider} from "@terreno/ui";
import {act, fireEvent, type RenderResult, render} from "@testing-library/react-native";
import {assert} from "chai";
import {router, useLocalSearchParams} from "expo-router";
import type React from "react";
import type {ReactNode} from "react";
import {SafeAreaProvider} from "react-native-safe-area-context";
import {Provider} from "react-redux";

import {terrenoApi} from "@/store/sdk";

import DocumentsScreen from "./documents";

const SAFE_AREA_METRICS = {
  frame: {height: 844, width: 390, x: 0, y: 0},
  insets: {bottom: 0, left: 0, right: 0, top: 0},
};

const searchParams = useLocalSearchParams as unknown as {
  mockImplementation: (impl: () => {section?: string | string[]}) => void;
};

const setParams = router.setParams as unknown as {
  mockClear: () => void;
  mock: {calls: unknown[][]};
};
const push = router.push as unknown as {mockClear: () => void; mock: {calls: unknown[][]}};

const store = configureStore({
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(terrenoApi.middleware),
  reducer: {
    betterAuth: (state: {userId: string | null} = {userId: null}): {userId: string | null} => state,
    [terrenoApi.reducerPath]: terrenoApi.reducer,
  },
});

const Wrapper: React.FC<{children: ReactNode}> = ({children}) => (
  <Provider store={store}>
    <TerrenoProvider>
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>
    </TerrenoProvider>
  </Provider>
);

const renderDocuments = (): RenderResult => render(<DocumentsScreen />, {wrapper: Wrapper});

describe("DocumentsScreen", () => {
  afterEach((): void => {
    searchParams.mockImplementation(() => ({}));
    setParams.mockClear();
    push.mockClear();
  });

  it("opens on Files and switches sections from the control and the URL", (): void => {
    const view = renderDocuments();
    assert.exists(view.getByTestId("documents-screen"));
    assert.exists(view.getByTestId("document-refresh-button"));

    fireEvent.press(view.getByText("Consents"));
    assert.deepEqual(setParams.mock.calls[0]?.[0], {section: "consents"});

    searchParams.mockImplementation(() => ({section: "consents"}));
    view.rerender(<DocumentsScreen />);
    assert.exists(view.getByText("My Consents"));

    searchParams.mockImplementation(() => ({section: ["pdf"]}));
    view.rerender(<DocumentsScreen />);
    assert.exists(view.getByTestId("pdf-screen"));

    searchParams.mockImplementation(() => ({section: "not-a-section"}));
    view.rerender(<DocumentsScreen />);
    assert.exists(view.getByTestId("document-refresh-button"));
  });

  it("opens storage settings from the files browser", async (): Promise<void> => {
    const view = renderDocuments();
    await act(async (): Promise<void> => {
      fireEvent.press(view.getByLabelText("Storage settings"));
    });
    assert.equal(push.mock.calls[0]?.[0], "/gcs-settings");
  });
});
