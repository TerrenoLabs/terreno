import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {
  DatasetItemRecord,
  DatasetRecord,
} from "../widgets/aiObservability/datasets/datasetTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({id: datasetId}),
}));

import {AiDatasetDetailScreenWidget} from "../widgets/aiObservability/datasets/AiDatasetDetailScreen";

let datasetId = "ds-1";

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

const dataset: DatasetRecord = {
  counts: {auto: 0, human: 1, needsReview: 0, total: 1},
  created: "2026-01-01T00:00:00.000Z",
  id: "ds-1",
  name: "gold",
  tags: [],
  updated: "2026-01-02T00:00:00.000Z",
};

const items: DatasetItemRecord[] = [
  {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    id: "item-1",
    input: {q: "hi"},
    origin: "trace",
    proofread: false,
    sourceTraceId: "trace-1",
    tags: [],
    updated: "2026-01-01T00:00:00.000Z",
  },
];

const detailState = {data: dataset as DatasetRecord | undefined, isError: false, isLoading: false};
const itemsState = {
  data: items as DatasetItemRecord[] | undefined,
  isError: false,
  isLoading: false,
  refetch: mock(() => {}),
};

const createApi = (createImpl?: () => Promise<unknown>): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityDatasetItemsQuery: () => itemsState,
      useAiObservabilityDatasetQuery: () => detailState,
      useAiObservabilityStatusQuery: () => ({
        data: statusData,
        isError: false,
        isLoading: false,
      }),
      useCreateAiObservabilityDatasetItemMutation: () => [
        () => ({unwrap: createImpl ?? (async () => ({}))}),
        {isError: false, isLoading: false},
      ],
    }),
  };
  return api as unknown as AdminApi;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("AiDatasetDetailScreenWidget", () => {
  it("shows loading then dataset detail with tabs", () => {
    detailState.isLoading = true;
    const loading = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    expect(loading.getByTestId("ai-dataset-detail-loading")).toBeTruthy();
    loading.unmount();

    detailState.isLoading = false;
    detailState.data = dataset;
    itemsState.data = items;
    const loaded = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    expect(loaded.getByTestId("ai-dataset-tabs")).toBeTruthy();
  });

  it("opens experiment and trace routes from the detail view", async () => {
    detailState.data = dataset;
    itemsState.data = items;
    routerPush.mockClear();
    const view = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-run-experiment"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-experiment-new");

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-items-table-row-item-1-clickable"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-open-trace"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[1]?.[0]), "ai-trace-detail");
  });

  it("surfaces add-item validation and API errors", async () => {
    detailState.data = dataset;
    itemsState.data = items;
    const view = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi(async () => {
          throw {data: {title: "Invalid item"}};
        })}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-add-item"));
      await Promise.resolve();
    });
    fireEvent.changeText(
      view.getAllByDisplayValue("{}")[0] ?? view.getByDisplayValue("{}"),
      "{bad json"
    );
    const addButtons = view.getAllByText("Add item");
    await act(async () => {
      fireEvent.press(addButtons[addButtons.length - 1]!);
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-dataset-add-item-error")).toBeTruthy();

    itemsState.refetch.mockClear();
    const success = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi(async () => ({}))}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    await act(async () => {
      fireEvent.press(success.getByTestId("ai-dataset-add-item"));
      await Promise.resolve();
    });
    fireEvent.changeText(
      success.getAllByDisplayValue("{}")[0] ?? success.getByDisplayValue("{}"),
      '{"q":"hi"}'
    );
    fireEvent.changeText(
      success.getAllByDisplayValue("{}")[1] ?? success.getByDisplayValue("{}"),
      '{"a":"ok"}'
    );
    const successAddButtons = success.getAllByText("Add item");
    await act(async () => {
      fireEvent.press(successAddButtons[successAddButtons.length - 1]!);
      await Promise.resolve();
    });
    expect(itemsState.refetch).toHaveBeenCalled();
  });

  it("distinguishes item loading and load errors from an empty dataset", async () => {
    detailState.data = dataset;
    detailState.isError = false;
    itemsState.isLoading = true;
    const loading = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    expect(loading.getByTestId("ai-dataset-items-loading")).toBeTruthy();
    loading.unmount();

    itemsState.isLoading = false;
    itemsState.isError = true;
    itemsState.refetch.mockClear();
    const errored = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    expect(errored.getByTestId("ai-dataset-items-error")).toBeTruthy();
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await Promise.resolve();
    });
    assert.equal(itemsState.refetch.mock.calls.length, 1);
    itemsState.isError = false;
  });

  it("shows missing dataset id and load error with retry", async () => {
    datasetId = "";
    const missing = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    expect(missing.getByText(/Missing dataset id/)).toBeTruthy();
    missing.unmount();
    datasetId = "ds-1";

    const refetch = mock(() => {});
    detailState.data = undefined;
    detailState.isError = true;
    detailState.isLoading = false;
    const errorApi = {
      enhanceEndpoints: () => errorApi,
      injectEndpoints: () => ({
        useAiObservabilityDatasetItemsQuery: () => itemsState,
        useAiObservabilityDatasetQuery: () => ({
          data: undefined,
          isError: true,
          isLoading: false,
          refetch,
        }),
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
        useCreateAiObservabilityDatasetItemMutation: () => [
          () => ({unwrap: async () => ({})}),
          {isError: false, isLoading: false},
        ],
      }),
    } as unknown as AdminApi;
    const errored = renderWithTheme(
      <AiDatasetDetailScreenWidget
        api={errorApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-detail"
      />
    );
    expect(errored.getByText("Failed to load dataset.")).toBeTruthy();
  });
});
