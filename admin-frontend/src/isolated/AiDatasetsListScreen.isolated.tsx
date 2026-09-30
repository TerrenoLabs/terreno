import {describe, expect, it, mock} from "bun:test";
import {Modal} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {DatasetRecord} from "../widgets/aiObservability/datasets/datasetTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({}),
}));

import {AiDatasetsScreenWidget} from "../widgets/aiObservability/datasets/AiDatasetsListScreen";

const statusData = {
  localOn: true,
  plugins: [],
  primaries: {
    datasets: "local",
    experiments: "local",
    prompts: "local",
    reviewQueue: "local",
  },
};

const datasets: DatasetRecord[] = [
  {
    counts: {auto: 0, human: 1, needsReview: 0, total: 1},
    created: "2026-01-01T00:00:00.000Z",
    id: "ds-1",
    name: "gold",
    tags: [],
    updated: "2026-01-02T00:00:00.000Z",
  },
];

interface ListState {
  data?: DatasetRecord[];
  isError: boolean;
  isLoading: boolean;
  refetch: () => void;
}

const listState: ListState = {
  isError: false,
  isLoading: false,
  refetch: mock(() => {}),
};

const createMutate = (impl: () => Promise<unknown>) => [
  () => ({unwrap: impl}),
  {isError: false, isLoading: false},
];

const createApi = (overrides?: {
  createImpl?: () => Promise<unknown>;
  importImpl?: () => Promise<unknown>;
}): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityDatasetsQuery: () => listState,
      useAiObservabilityStatusQuery: () => ({
        data: statusData,
        isError: false,
        isLoading: false,
      }),
      useCreateAiObservabilityDatasetMutation: () =>
        createMutate(overrides?.createImpl ?? (async () => ({id: "ds-new", name: "new"}))),
      useImportAiObservabilityDatasetMutation: () =>
        createMutate(
          overrides?.importImpl ??
            (async () => ({
              created: 2,
              errors: [],
            }))
        ),
    }),
  };
  return api as unknown as AdminApi;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
const widgetProps = {
  config: emptyConfig,
  routeBase: "/admin",
  screenName: "ai-datasets",
};

describe("AiDatasetsScreenWidget", () => {
  it("shows loading then the loaded datasets table", () => {
    listState.isLoading = true;
    listState.data = undefined;
    const loading = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    expect(loading.getByTestId("ai-datasets-loading")).toBeTruthy();
    loading.unmount();

    listState.isLoading = false;
    listState.data = datasets;
    const loaded = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    expect(loaded.getByTestId("ai-datasets-table")).toBeTruthy();
  });

  it("validates create name and navigates on success", async () => {
    listState.data = datasets;
    routerPush.mockClear();
    const view = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-create"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByText("Create dataset"));
      await Promise.resolve();
    });
    expect(view.getByText("Name is required.")).toBeTruthy();

    fireEvent.changeText(
      view.getAllByDisplayValue("")[0] ?? view.getByLabelText("Name"),
      "new-set"
    );
    await act(async () => {
      fireEvent.press(view.getByText("Create dataset"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(routerPush.mock.calls.length, 1);
  });

  it("imports pasted json and surfaces API errors", async () => {
    listState.data = datasets;
    const failing = renderWithTheme(
      <AiDatasetsScreenWidget
        api={createApi({
          importImpl: async () => {
            throw {data: {title: "Import failed on row 1"}};
          },
        })}
        {...widgetProps}
      />
    );
    await act(async () => {
      fireEvent.press(failing.getByTestId("ai-datasets-import-ds-1"));
      await Promise.resolve();
    });
    fireEvent.changeText(
      failing.getByTestId("ai-datasets-import-paste"),
      '[{"input":{"q":"hi"},"expectedOutput":{"a":"ok"}}]'
    );
    const importButtons = failing.getAllByText("Import");
    await act(async () => {
      fireEvent.press(importButtons[importButtons.length - 1]!);
      await Promise.resolve();
    });
    expect(failing.getByTestId("ai-datasets-import-error")).toBeTruthy();

    const success = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    await act(async () => {
      fireEvent.press(success.getByTestId("ai-datasets-import-ds-1"));
      await Promise.resolve();
    });
    fireEvent.changeText(
      success.getByTestId("ai-datasets-import-paste"),
      '[{"input":{"q":"hi"},"expectedOutput":{"a":"ok"}}]'
    );
    const successImportButtons = success.getAllByText("Import");
    await act(async () => {
      fireEvent.press(successImportButtons[successImportButtons.length - 1]!);
      await Promise.resolve();
    });
    expect(success.getByTestId("ai-datasets-import-result")).toBeTruthy();
  });

  it("opens dataset detail, retries load errors, and handles create API failures", async () => {
    listState.data = datasets;
    routerPush.mockClear();
    const view = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-open-ds-1"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-dataset-detail");

    listState.isError = true;
    listState.data = undefined;
    const errored = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    expect(errored.getByTestId("ai-datasets-load-error")).toBeTruthy();
    listState.refetch.mockClear();
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.isAtLeast(listState.refetch.mock.calls.length, 1);

    listState.isError = false;
    listState.data = datasets;
    const createFail = renderWithTheme(
      <AiDatasetsScreenWidget
        api={createApi({
          createImpl: async () => {
            throw new Error("fail");
          },
        })}
        {...widgetProps}
      />
    );
    await act(async () => {
      fireEvent.press(createFail.getByTestId("ai-datasets-create"));
      await Promise.resolve();
    });
    fireEvent.changeText(createFail.getAllByDisplayValue("")[0]!, "broken");
    await act(async () => {
      fireEvent.press(createFail.getByText("Create dataset"));
      await Promise.resolve();
    });
    expect(createFail.getByText("Could not create dataset.")).toBeTruthy();
  });

  it("imports csv paste and validates empty import", async () => {
    listState.data = datasets;
    const view = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-import-ds-1"));
      await Promise.resolve();
    });
    const emptyImportButtons = view.getAllByText("Import");
    await act(async () => {
      fireEvent.press(emptyImportButtons[emptyImportButtons.length - 1]!);
      await Promise.resolve();
    });
    expect(view.getByText("Choose a file or paste import content.")).toBeTruthy();

    fireEvent.changeText(
      view.getByTestId("ai-datasets-import-paste"),
      'input,expectedOutput\n"{""q"":""hi""}","{""a"":""ok""}"'
    );
    const csvImportButtons = view.getAllByText("Import");
    await act(async () => {
      fireEvent.press(csvImportButtons[csvImportButtons.length - 1]!);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(view.getByTestId("ai-datasets-import-result")).toBeTruthy();
  });

  it("handles file pick import and generic import failures", async () => {
    listState.data = datasets;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => ({
      text: async () => 'input,expectedOutput\n"{""q"":""hi""}","{""a"":""ok""}"',
    })) as unknown as typeof fetch;
    const view = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-import-ds-1"));
      await Promise.resolve();
    });
    const picker = view.UNSAFE_root.findByProps({testID: "ai-datasets-file-picker"});
    await act(async () => {
      fireEvent(picker, "onFilesSelected", [{name: "rows.csv", uri: "file:///rows.csv"}]);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const importButtons = view.getAllByText("Import");
    await act(async () => {
      fireEvent.press(importButtons[importButtons.length - 1]!);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(view.getByTestId("ai-datasets-import-result")).toBeTruthy();
    globalThis.fetch = originalFetch;

    const failing = renderWithTheme(
      <AiDatasetsScreenWidget
        api={createApi({
          importImpl: async () => {
            throw new Error("network");
          },
        })}
        {...widgetProps}
      />
    );
    await act(async () => {
      fireEvent.press(failing.getByTestId("ai-datasets-import-ds-1"));
      await Promise.resolve();
    });
    fireEvent.changeText(
      failing.getByTestId("ai-datasets-import-paste"),
      '[{"input":{"q":"hi"},"expectedOutput":{"a":"ok"}}]'
    );
    const failImportButtons = failing.getAllByText("Import");
    await act(async () => {
      fireEvent.press(failImportButtons[failImportButtons.length - 1]!);
      await Promise.resolve();
    });
    expect(failing.getByText("Import failed.")).toBeTruthy();
  });

  it("dismisses create and import modals", async () => {
    listState.data = datasets;
    const view = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-create"));
      await Promise.resolve();
    });
    const createModal = view.UNSAFE_root.findAllByType(Modal).find(
      (node) => node.props.title === "New dataset" && node.props.visible
    );
    assert.isDefined(createModal);
    await act(async () => {
      createModal!.props.onDismiss();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-import-ds-1"));
      await Promise.resolve();
    });
    const importModal = view.UNSAFE_root.findAllByType(Modal).find(
      (node) => node.props.title === "Import items" && node.props.visible
    );
    assert.isDefined(importModal);
    await act(async () => {
      importModal!.props.onDismiss();
      await Promise.resolve();
    });
    expect(view.queryByTestId("ai-datasets-import-modal")).toBeNull();
  });

  it("creates a dataset with optional prompt binding", async () => {
    listState.data = datasets;
    routerPush.mockClear();
    const view = renderWithTheme(<AiDatasetsScreenWidget api={createApi()} {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-create"));
      await Promise.resolve();
    });
    const emptyFields = view.getAllByDisplayValue("");
    fireEvent.changeText(emptyFields[0]!, "bound-set");
    if (emptyFields[1]) {
      fireEvent.changeText(emptyFields[1], "summarize");
    }
    await act(async () => {
      fireEvent.press(view.getByText("Create dataset"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(routerPush.mock.calls.length, 1);
  });
});
