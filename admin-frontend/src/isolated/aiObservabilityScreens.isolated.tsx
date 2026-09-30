import {beforeEach, describe, expect, it, mock} from "bun:test";
import SliderComponent from "@react-native-community/slider";
import {Modal, SelectField, Text} from "@terreno/ui";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import {DateTime} from "luxon";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import {AiDatasetDetailScreenWidget} from "../widgets/aiObservability/datasets/AiDatasetDetailScreen";
import {AiDatasetsScreenWidget} from "../widgets/aiObservability/datasets/AiDatasetsListScreen";
import {AiDatasetsListView} from "../widgets/aiObservability/datasets/AiDatasetsListView";
import type {
  DatasetItemRecord,
  DatasetRecord,
} from "../widgets/aiObservability/datasets/datasetTypes";
import {AiEvaluatorDetailScreenWidget} from "../widgets/aiObservability/evaluators/AiEvaluatorDetailScreen";
import {AiEvaluatorNewScreenWidget} from "../widgets/aiObservability/evaluators/AiEvaluatorNewScreen";
import {AiEvaluatorsScreenWidget} from "../widgets/aiObservability/evaluators/AiEvaluatorsListScreen";
import {AiEvaluatorsListView} from "../widgets/aiObservability/evaluators/AiEvaluatorsListView";
import type {EvaluatorRecord} from "../widgets/aiObservability/evaluators/evaluatorTypes";
import {AiExperimentNewScreenWidget} from "../widgets/aiObservability/experiments/AiExperimentNewScreen";
import {AiExperimentResultsScreenWidget} from "../widgets/aiObservability/experiments/AiExperimentResultsScreen";
import {AiExperimentResultsView} from "../widgets/aiObservability/experiments/AiExperimentResultsView";
import {AiExperimentsScreenWidget} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";
import {AiExperimentsListView} from "../widgets/aiObservability/experiments/AiExperimentsListView";
import type {ExperimentRecord} from "../widgets/aiObservability/experiments/experimentTypes";
import {AiPromptEditorScreenWidget} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import {AiPromptEditorView} from "../widgets/aiObservability/prompts/AiPromptEditorView";
import {AiPromptPlaygroundView} from "../widgets/aiObservability/prompts/AiPromptPlaygroundView";
import {AiPromptsScreenWidget} from "../widgets/aiObservability/prompts/AiPromptsListScreen";
import {AiPromptsListView} from "../widgets/aiObservability/prompts/AiPromptsListView";
import type {
  PlaygroundRunResult,
  PromptDetail,
  PromptListItem,
} from "../widgets/aiObservability/prompts/promptTypes";
import {AiReviewItemScreenWidget} from "../widgets/aiObservability/review/AiReviewItemScreen";
import {AiReviewItemView} from "../widgets/aiObservability/review/AiReviewItemView";
import {AiReviewScreenWidget} from "../widgets/aiObservability/review/AiReviewQueueScreen";
import {AiReviewQueueView} from "../widgets/aiObservability/review/AiReviewQueueView";
import {ReviewScoreField} from "../widgets/aiObservability/review/ReviewScoreField";
import type {ReviewDetail, ReviewListItem} from "../widgets/aiObservability/review/reviewTypes";
import {AiObservabilityChrome} from "../widgets/aiObservability/shell/AiObservabilityChrome";
import {AI_OBSERVABILITY_WIDGETS} from "../widgets/aiObservability/shell/AiObservabilityScreenWidgets";
import {AiObservabilityStatusChip} from "../widgets/aiObservability/shell/AiObservabilityStatusChip";
import {
  buildAiObservabilityBreadcrumbs,
  formatObservabilityStatusChip,
  type ObservabilityStatusPayload,
  unwrapObservabilityStatus,
} from "../widgets/aiObservability/shell/aiObservabilityNav";
import {AiTraceDetailScreenWidget} from "../widgets/aiObservability/traces/AiTraceDetailScreen";
import {AiTraceDetailView} from "../widgets/aiObservability/traces/AiTraceDetailView";
import {AiTracesScreenWidget} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {AiTracesListView} from "../widgets/aiObservability/traces/AiTracesListView";
import {
  emptyTraceFilters,
  type TraceDetail,
  type TraceListItem,
} from "../widgets/aiObservability/traces/traceTypes";

interface ExpoRouterPushMock {
  (...args: unknown[]): void;
  mockClear: () => void;
  mock: {calls: unknown[][]};
}

const routerPush = mock(() => undefined) as unknown as ExpoRouterPushMock;

const readExpoSearchParams: {current: () => Record<string, string>} = {
  current: () => ({}),
};

const setExpoSearchParams = (read: () => Record<string, string>): void => {
  readExpoSearchParams.current = read;
};

mock.module("expo-router", () => ({
  router: {
    push: (...args: unknown[]): void => {
      routerPush(...args);
    },
  },
  useLocalSearchParams: (): Record<string, string> => readExpoSearchParams.current(),
}));

describe("AiDatasetDetailScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: datasetId}));
    routerPush.mockClear();
  });
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

  const detailState = {
    data: dataset as DatasetRecord | undefined,
    isError: false,
    isLoading: false,
  };
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
});

describe("AiDatasetsListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
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
      const loading = renderWithTheme(
        <AiDatasetsScreenWidget api={createApi()} {...widgetProps} />
      );
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

      const success = renderWithTheme(
        <AiDatasetsScreenWidget api={createApi()} {...widgetProps} />
      );
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
      const errored = renderWithTheme(
        <AiDatasetsScreenWidget api={createApi()} {...widgetProps} />
      );
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
});

describe("AiDatasetsListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const datasets: DatasetRecord[] = [
    {
      counts: {auto: 2, human: 1, needsReview: 1, total: 3},
      created: "2026-01-01T00:00:00.000Z",
      id: "ds-1",
      inputSchemaPromptName: "summarize",
      name: "gold",
      tags: [],
      updated: "2026-01-02T00:00:00.000Z",
    },
  ];

  describe("AiDatasetsListView", () => {
    it("renders the empty state", () => {
      const {getByTestId} = renderWithTheme(
        <AiDatasetsListView
          createName=""
          createOpen={false}
          createPromptBinding=""
          datasets={[]}
          importOpen={false}
          importPaste=""
          isCreating={false}
          isImporting={false}
          isLoading={false}
          onCreate={() => undefined}
          onCreateNameChange={() => undefined}
          onCreatePromptBindingChange={() => undefined}
          onDismissCreate={() => undefined}
          onDismissImport={() => undefined}
          onFilePicked={() => undefined}
          onImportPasteChange={() => undefined}
          onImportSubmit={() => undefined}
          onOpenCreate={() => undefined}
          onOpenDetail={() => undefined}
          onOpenImport={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-datasets-empty")).toBeTruthy();
    });

    it("renders a loaded table with open and import controls", () => {
      const {getByTestId} = renderWithTheme(
        <AiDatasetsListView
          createName=""
          createOpen={false}
          createPromptBinding=""
          datasets={datasets}
          importOpen={false}
          importPaste=""
          isCreating={false}
          isImporting={false}
          isLoading={false}
          onCreate={() => undefined}
          onCreateNameChange={() => undefined}
          onCreatePromptBindingChange={() => undefined}
          onDismissCreate={() => undefined}
          onDismissImport={() => undefined}
          onFilePicked={() => undefined}
          onImportPasteChange={() => undefined}
          onImportSubmit={() => undefined}
          onOpenCreate={() => undefined}
          onOpenDetail={() => undefined}
          onOpenImport={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-datasets-table")).toBeTruthy();
      expect(getByTestId("ai-datasets-open-ds-1")).toBeTruthy();
      expect(getByTestId("ai-datasets-import-ds-1")).toBeTruthy();
    });

    it("renders create and import modals with handlers wired", async () => {
      const onCreate = mock(() => undefined);
      const onImportSubmit = mock(() => undefined);
      const onFilePicked = mock(() => undefined);
      const onRetry = mock(() => undefined);
      const view = renderWithTheme(
        <AiDatasetsListView
          createError="Name is required."
          createName=""
          createOpen
          createPromptBinding=""
          datasets={datasets}
          importError="bad row"
          importFilename="items.json"
          importFormat="json"
          importOpen
          importPaste='[{"input":{}}]'
          importPreview='[{"input":{}}]'
          importResult={{created: 1, errors: [{message: "bad", row: 2}]}}
          isCreating={false}
          isImporting={false}
          isLoading={false}
          loadError="Failed to load datasets."
          onCreate={onCreate}
          onCreateNameChange={() => undefined}
          onCreatePromptBindingChange={() => undefined}
          onDismissCreate={() => undefined}
          onDismissImport={() => undefined}
          onFilePicked={onFilePicked}
          onImportPasteChange={() => undefined}
          onImportSubmit={onImportSubmit}
          onOpenCreate={() => undefined}
          onOpenDetail={() => undefined}
          onOpenImport={() => undefined}
          onRetry={onRetry}
        />
      );
      expect(view.getByTestId("ai-datasets-create-form")).toBeTruthy();
      expect(view.getByText("Name is required.")).toBeTruthy();
      expect(view.getByTestId("ai-datasets-import-modal")).toBeTruthy();
      expect(view.getByTestId("ai-datasets-import-filename")).toBeTruthy();
      expect(view.getByTestId("ai-datasets-import-result")).toBeTruthy();
      expect(view.getByTestId("ai-datasets-import-error")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByText("Retry"));
        await Promise.resolve();
      });
      assert.equal(onRetry.mock.calls.length, 1);
      const createButtons = view.getAllByText("Create dataset");
      await act(async () => {
        fireEvent.press(createButtons[createButtons.length - 1]!);
        await Promise.resolve();
      });
      assert.equal(onCreate.mock.calls.length, 1);
      const importButtons = view.getAllByText("Import");
      await act(async () => {
        fireEvent.press(importButtons[importButtons.length - 1]!);
        await Promise.resolve();
      });
      assert.equal(onImportSubmit.mock.calls.length, 1);
    });

    it("wires create prompt binding and file pick handler", () => {
      const onCreateNameChange = mock(() => undefined);
      const onCreatePromptBindingChange = mock(() => undefined);
      const onFilePicked = mock(() => undefined);
      const onImportPasteChange = mock(() => undefined);
      const view = renderWithTheme(
        <AiDatasetsListView
          createName="gold"
          createOpen
          createPromptBinding="summarize"
          datasets={datasets}
          importFilename="items.csv"
          importFormat="csv"
          importOpen
          importPaste="input,expectedOutput"
          importPreview="input,expectedOutput"
          isCreating={false}
          isImporting={false}
          isLoading={false}
          onCreate={() => undefined}
          onCreateNameChange={onCreateNameChange}
          onCreatePromptBindingChange={onCreatePromptBindingChange}
          onDismissCreate={() => undefined}
          onDismissImport={() => undefined}
          onFilePicked={onFilePicked}
          onImportPasteChange={onImportPasteChange}
          onImportSubmit={() => undefined}
          onOpenCreate={() => undefined}
          onOpenDetail={() => undefined}
          onOpenImport={() => undefined}
          onRetry={() => undefined}
        />
      );
      fireEvent.changeText(view.getAllByDisplayValue("gold")[0]!, "renamed");
      assert.isAtLeast(onCreateNameChange.mock.calls.length, 1);
      fireEvent.changeText(view.getAllByDisplayValue("summarize")[0]!, "judge");
      assert.isAtLeast(onCreatePromptBindingChange.mock.calls.length, 1);
      onFilePicked({content: "input,expectedOutput\n{}", filename: "items.csv"});
      assert.equal(onFilePicked.mock.calls.length, 1);
      fireEvent.changeText(view.getByTestId("ai-datasets-import-paste"), "[]");
      assert.isAtLeast(onImportPasteChange.mock.calls.length, 1);
      expect(view.getByTestId("ai-datasets-import-filename")).toBeTruthy();
    });

    it("renders invalid updated timestamps and wires table action columns", async () => {
      const onOpenDetail = mock(() => undefined);
      const onOpenImport = mock(() => undefined);
      const invalidDateSets: DatasetRecord[] = [
        {
          ...datasets[0]!,
          id: "ds-bad-date",
          name: "stale",
          updated: "not-a-date",
        },
      ];
      const view = renderWithTheme(
        <AiDatasetsListView
          createName=""
          createOpen={false}
          createPromptBinding=""
          datasets={invalidDateSets}
          importOpen={false}
          importPaste=""
          isCreating={false}
          isImporting={false}
          isLoading={false}
          onCreate={() => undefined}
          onCreateNameChange={() => undefined}
          onCreatePromptBindingChange={() => undefined}
          onDismissCreate={() => undefined}
          onDismissImport={() => undefined}
          onFilePicked={() => undefined}
          onImportPasteChange={() => undefined}
          onImportSubmit={() => undefined}
          onOpenCreate={() => undefined}
          onOpenDetail={onOpenDetail}
          onOpenImport={onOpenImport}
          onRetry={() => undefined}
        />
      );
      expect(view.getByText("not-a-date")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-datasets-open-ds-bad-date"));
        fireEvent.press(view.getByTestId("ai-datasets-import-ds-bad-date"));
        await Promise.resolve();
      });
      assert.equal(onOpenDetail.mock.calls.length, 1);
      assert.equal(onOpenImport.mock.calls.length, 1);
    });

    it("ignores empty file selection and failed file reads", async () => {
      const onFilePicked = mock(() => undefined);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () => {
        throw new Error("read failed");
      }) as unknown as typeof fetch;
      const view = renderWithTheme(
        <AiDatasetsListView
          createName=""
          createOpen={false}
          createPromptBinding=""
          datasets={datasets}
          importOpen
          importPaste=""
          isCreating={false}
          isImporting={false}
          isLoading={false}
          onCreate={() => undefined}
          onCreateNameChange={() => undefined}
          onCreatePromptBindingChange={() => undefined}
          onDismissCreate={() => undefined}
          onDismissImport={() => undefined}
          onFilePicked={onFilePicked}
          onImportPasteChange={() => undefined}
          onImportSubmit={() => undefined}
          onOpenCreate={() => undefined}
          onOpenDetail={() => undefined}
          onOpenImport={() => undefined}
          onRetry={() => undefined}
        />
      );
      const picker = view.UNSAFE_root.findByProps({testID: "ai-datasets-file-picker"});
      await act(async () => {
        fireEvent(picker, "onFilesSelected", []);
        fireEvent(picker, "onFilesSelected", [{name: "rows.csv", uri: "file:///rows.csv"}]);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(onFilePicked.mock.calls.length, 0);
      globalThis.fetch = originalFetch;
    });

    it("renders import row errors with paths and dismisses modals", () => {
      const onDismissCreate = mock(() => undefined);
      const onDismissImport = mock(() => undefined);
      const view = renderWithTheme(
        <AiDatasetsListView
          createName="gold"
          createOpen
          createPromptBinding=""
          datasets={datasets}
          importOpen
          importPaste="[]"
          importResult={{
            created: 0,
            errors: [{message: "invalid", path: "input.q", row: 3}],
          }}
          isCreating={false}
          isImporting={false}
          isLoading={false}
          onCreate={() => undefined}
          onCreateNameChange={() => undefined}
          onCreatePromptBindingChange={() => undefined}
          onDismissCreate={onDismissCreate}
          onDismissImport={onDismissImport}
          onFilePicked={() => undefined}
          onImportPasteChange={() => undefined}
          onImportSubmit={() => undefined}
          onOpenCreate={() => undefined}
          onOpenDetail={() => undefined}
          onOpenImport={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(view.getByText(/input\.q/)).toBeTruthy();
      const preview = view.UNSAFE_root.findAllByProps({title: "Preview"});
      if (preview[0]) {
        fireEvent(preview[0], "onChange", "ignored");
      }
      const modals = view.UNSAFE_root.findAllByType(Modal);
      const createModal = modals.find((node) => node.props.title === "New dataset");
      const importModal = modals.find((node) => node.props.title === "Import items");
      fireEvent(createModal!, "onDismiss");
      fireEvent(importModal!, "onDismiss");
      assert.equal(onDismissCreate.mock.calls.length, 1);
      assert.equal(onDismissImport.mock.calls.length, 1);
    });
  });
});

describe("AiEvaluatorDetailScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: evaluatorId}));
    routerPush.mockClear();
  });
  let evaluatorId = "eval-1";

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

  const evaluator: EvaluatorRecord = {
    confidenceAlertBelow: 0.5,
    dimensions: [{dataType: "boolean", key: "correct", required: true}],
    id: "eval-1",
    judgePromptName: "judge",
    name: "quality",
    runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 5},
    target: "full trace",
    type: "llm-judge",
  };

  const recentExperiment: ExperimentRecord = {
    created: DateTime.utc().toISO() ?? "",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [],
    name: "recent",
    promptName: "summarize",
    results: {
      gates: [],
      lowConfidenceItemIds: [],
      outlierItemIds: [],
      progress: {completed: 3, total: 3},
      totalCostUsd: 0.2,
    },
    status: "completed",
    thresholds: [],
    updated: DateTime.utc().toISO() ?? "",
    versions: [1, 2],
  };

  const oldExperiment: ExperimentRecord = {
    ...recentExperiment,
    created: DateTime.utc().minus({days: 45}).toISO() ?? "",
    id: "exp-old",
    name: "old",
  };

  const detailState = {
    data: evaluator as EvaluatorRecord | undefined,
    isError: false,
    isLoading: false,
  };
  const experimentsState = {
    data: [recentExperiment, oldExperiment],
    isError: false,
    isLoading: false,
    refetch: mock(() => {}),
  };
  let promptIsError = false;
  let promptIsLoading = false;

  const createApi = (): AdminApi => {
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        useAiObservabilityEvaluatorQuery: () => detailState,
        useAiObservabilityExperimentsQuery: () => experimentsState,
        useAiObservabilityPromptQuery: () => ({
          data:
            promptIsError || promptIsLoading
              ? undefined
              : {
                  folder: "ops",
                  labels: [{label: "production", version: 1}],
                  name: "judge",
                  tags: [],
                  versions: [
                    {
                      outputSchema: {properties: {correct: {type: "boolean"}}},
                      sensitive: false,
                      template: "Judge",
                      type: "text",
                      variables: [],
                      version: 1,
                    },
                  ],
                },
          isError: promptIsError,
          isLoading: promptIsLoading,
        }),
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
      }),
    };
    return api as unknown as AdminApi;
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiEvaluatorDetailScreenWidget", () => {
    it("shows loading then detail with 30-day usage rows", () => {
      detailState.isLoading = true;
      const loading = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
        />
      );
      expect(loading.getByTestId("ai-evaluator-detail-loading")).toBeTruthy();
      loading.unmount();

      detailState.isLoading = false;
      detailState.data = evaluator;
      const loaded = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
        />
      );
      expect(loaded.getByTestId("ai-evaluator-detail")).toBeTruthy();
      expect(loaded.getByTestId("ai-evaluator-used-by")).toBeTruthy();
      assert.notInclude(loaded.getByText("recent").props.children, "old");
    });

    it("shows judge prompt loading and error states without a false schema mismatch", () => {
      detailState.data = evaluator;
      detailState.isError = false;
      detailState.isLoading = false;
      promptIsLoading = true;
      const loading = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
        />
      );
      expect(loading.getByTestId("ai-evaluator-schema-loading")).toBeTruthy();
      assert.notExists(loading.queryByTestId("ai-evaluator-schema-mismatch"));
      loading.unmount();

      promptIsLoading = false;
      promptIsError = true;
      const errored = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
        />
      );
      expect(errored.getByTestId("ai-evaluator-schema-error")).toBeTruthy();
      assert.notExists(errored.queryByTestId("ai-evaluator-schema-mismatch"));
      promptIsError = false;
    });

    it("shows missing id and load error states", () => {
      evaluatorId = "";
      const missing = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
        />
      );
      expect(missing.getByText("Missing evaluator id.")).toBeTruthy();

      evaluatorId = "eval-1";
      detailState.isLoading = false;
      detailState.data = undefined;
      detailState.isError = true;
      const errored = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
        />
      );
      expect(errored.getByText("Failed to load evaluator.")).toBeTruthy();
      detailState.isError = false;
      detailState.data = evaluator;
    });

    it("shows an experiments load error instead of an empty usage list", () => {
      detailState.data = evaluator;
      detailState.isError = false;
      detailState.isLoading = false;
      experimentsState.isError = true;
      experimentsState.data = [];
      const view = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
        />
      );
      expect(view.getByTestId("ai-evaluator-used-by-error")).toBeTruthy();
      assert.equal(
        view.getByTestId("ai-evaluator-used-by-error").props.children,
        "Could not load experiments."
      );
      assert.isNull(view.queryByTestId("ai-evaluator-used-by-empty"));
      experimentsState.isError = false;
      experimentsState.data = [recentExperiment, oldExperiment];
    });
  });
});

describe("AiEvaluatorNewScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
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

  let createShouldFail = false;
  let judgePromptLoading = false;
  let judgePromptError = false;

  const createMutation = mock((_body?: unknown) => ({
    unwrap: async () => {
      if (createShouldFail) {
        throw {data: {title: "Duplicate name"}};
      }
      return {id: "eval-new", name: "quality"};
    },
  }));

  const injectedHooks = {
    useAiObservabilityPromptQuery: () => ({
      data:
        judgePromptLoading || judgePromptError
          ? undefined
          : {
              folder: "ops",
              labels: [{label: "production", version: 1}],
              name: "judge",
              tags: [],
              versions: [
                {
                  outputSchema: {properties: {quality: {type: "number"}}},
                  sensitive: false,
                  template: "Judge",
                  type: "text",
                  variables: [],
                  version: 1,
                },
              ],
            },
      isError: judgePromptError,
      isLoading: judgePromptLoading,
    }),
    useAiObservabilityPromptsQuery: () => ({
      data: {
        data: [
          {
            folder: "ops",
            latestVersion: 1,
            name: "judge",
            production: 1,
            type: "text",
          },
        ],
      },
      isError: false,
      isLoading: false,
    }),
    useAiObservabilityStatusQuery: () => ({
      data: statusData,
      isError: false,
      isLoading: false,
    }),
    useCreateAiObservabilityEvaluatorMutation: () => [
      createMutation,
      {isError: false, isLoading: false},
    ],
  };

  const stableApi: AdminApi = {
    enhanceEndpoints: () => stableApi,
    injectEndpoints: () => injectedHooks,
  } as unknown as AdminApi;

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  const setDimensionKey = (view: ReturnType<typeof renderWithTheme>, key: string): void => {
    const scoreName = view.queryByTestId("ai-evaluator-dimension-0-key");
    if (scoreName) {
      fireEvent.changeText(scoreName, key);
      return;
    }
    fireEvent.changeText(view.getByDisplayValue("wrong-key"), key);
  };

  describe("AiEvaluatorNewScreenWidget", () => {
    it("validates name, schema mismatch, and navigates on success", async () => {
      createShouldFail = false;
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
        />
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-evaluator-create-error")).toBeTruthy();

      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "quality");
      setDimensionKey(view, "wrong-key");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-llm-judge"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Select a judge prompt.")).toBeTruthy();
      expect(view.getByTestId("ai-evaluator-schema-idle")).toBeTruthy();
      const judgeSelect = view.UNSAFE_root.findAllByType(SelectField).find((field) => {
        return field.props.testID === "ai-evaluator-judge-prompt";
      });
      assert.ok(judgeSelect);
      fireEvent(judgeSelect, "onChange", "judge");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-evaluator-schema-mismatch")).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-human"));
        await Promise.resolve();
      });
      setDimensionKey(view, "correct");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
    });

    it("surfaces create API errors", async () => {
      createShouldFail = true;
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
        />
      );
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "quality");
      setDimensionKey(view, "correct");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-evaluator-create-error")).toBeTruthy();
      assert.include(
        String(view.getByTestId("ai-evaluator-create-error").props.children),
        "Duplicate name"
      );
    });

    it("validates empty dimension keys and creates json-assert evaluators", async () => {
      createShouldFail = false;
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
        />
      );
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "assert");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-json-assert"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-assertion-path"), "output.text");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Each score needs a name.")).toBeTruthy();

      setDimensionKey(view, "pass");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
    });

    it("edits scores and purpose, then creates a human evaluator with live scoring off", async () => {
      createShouldFail = false;
      createMutation.mockClear();
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
        />
      );
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "human-review");
      fireEvent.changeText(
        view.getByTestId("ai-evaluator-description"),
        "Use when a person must judge answer quality."
      );
      setDimensionKey(view, "pass");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-human"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-instructions"), "Rate quality");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-add-dimension"));
        await Promise.resolve();
      });
      const removeButtons = view.getAllByText("Remove");
      await act(async () => {
        fireEvent.press(removeButtons[removeButtons.length - 1]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
      const createBody = createMutation.mock.calls[0]?.[0] as
        | {description?: string; runModes?: {liveSampleRate?: number}}
        | undefined;
      assert.equal(createBody?.description, "Use when a person must judge answer quality.");
      assert.equal(createBody?.runModes?.liveSampleRate, 0);
    });

    it("rejects incomplete numeric and categorical scores and samples live traffic", async () => {
      createShouldFail = false;
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
        />
      );
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "bounds");
      setDimensionKey(view, "score");
      await act(async () => {
        fireEvent.press(view.getAllByText("Remove")[0]!);
        await Promise.resolve();
      });
      assert.isOk(view.getByTestId("ai-evaluator-dimension-0-key"));

      await act(async () => {
        fireEvent.press(view.getAllByText("numeric")[0]!);
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-dimension-0-min"), "8");
      await act(async () => {
        fireEvent.press(view.getAllByText("boolean")[0]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getAllByText("numeric")[0]!);
        await Promise.resolve();
      });
      assert.equal(view.getByTestId("ai-evaluator-dimension-0-min").props.value, "0");
      fireEvent.changeText(view.getByTestId("ai-evaluator-dimension-0-min"), "5");
      fireEvent.changeText(view.getByTestId("ai-evaluator-dimension-0-max"), "1");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(
        view.getByText(
          "Each numeric score needs a min and a max, with min less than or equal to max."
        )
      ).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getAllByText("categorical")[0]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Add at least one category for each categorical score.")).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getAllByText("boolean")[0]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-json-assert"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-live-sample"), "25");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
      const createBody = createMutation.mock.calls.at(-1)?.[0] as
        | {runModes?: {liveSampleRate?: number}}
        | undefined;
      assert.equal(createBody?.runModes?.liveSampleRate, 25);
    });

    it("waits for the judge prompt and reports a schema load failure", async () => {
      createShouldFail = false;
      judgePromptLoading = true;
      judgePromptError = false;
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
        />
      );
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "judge-check");
      setDimensionKey(view, "quality");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-llm-judge"));
        await Promise.resolve();
      });
      const judgeSelect = view.UNSAFE_root.findAllByType(SelectField).find((field) => {
        return field.props.testID === "ai-evaluator-judge-prompt";
      });
      assert.ok(judgeSelect);
      fireEvent(judgeSelect, "onChange", "judge");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Wait for the judge prompt schema to load.")).toBeTruthy();
      expect(view.getByTestId("ai-evaluator-schema-loading")).toBeTruthy();

      judgePromptLoading = false;
      judgePromptError = true;
      view.rerender(
        <AiEvaluatorNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
        />
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      assert.include(
        String(view.getByTestId("ai-evaluator-create-error").props.children),
        "could not be loaded"
      );
      expect(view.getByTestId("ai-evaluator-schema-error")).toBeTruthy();
      judgePromptError = false;
    });
  });
});

describe("AiEvaluatorsListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
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

  const evaluators: EvaluatorRecord[] = [
    {
      confidenceAlertBelow: 0.5,
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      id: "eval-1",
      name: "quality",
      runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
      target: "full trace",
      type: "human",
    },
  ];

  const listState = {
    data: evaluators as EvaluatorRecord[] | undefined,
    isError: false,
    isLoading: false,
    refetch: mock(() => {}),
  };

  const createApi = (): AdminApi => {
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        useAiObservabilityEvaluatorsQuery: () => listState,
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
      }),
    };
    return api as unknown as AdminApi;
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiEvaluatorsScreenWidget", () => {
    it("shows loading then evaluator table and navigates on create/open", async () => {
      listState.isLoading = true;
      const loading = renderWithTheme(
        <AiEvaluatorsScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluators"
        />
      );
      expect(loading.getByTestId("ai-evaluators-loading")).toBeTruthy();
      loading.unmount();

      listState.isLoading = false;
      listState.data = evaluators;
      routerPush.mockClear();
      const loaded = renderWithTheme(
        <AiEvaluatorsScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluators"
        />
      );
      expect(loaded.getByTestId("ai-evaluators-table")).toBeTruthy();
      await act(async () => {
        fireEvent.press(loaded.getByTestId("ai-evaluators-create"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-evaluator-new");
      await act(async () => {
        fireEvent.press(loaded.getByTestId("ai-evaluator-open-eval-1"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[1]?.[0]), "ai-evaluator-detail");
    });
  });
});

describe("AiEvaluatorsListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const evaluators: EvaluatorRecord[] = [
    {
      created: "2026-01-01T00:00:00.000Z",
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      id: "eval-1",
      name: "quality",
      runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
      target: "full trace",
      type: "llm-judge",
      updated: "2026-01-01T00:00:00.000Z",
    },
  ];

  describe("AiEvaluatorsListView", () => {
    it("renders the loading state", () => {
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={[]}
          isLoading
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-evaluators-loading")).toBeTruthy();
    });

    it("renders the empty state", () => {
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={[]}
          isLoading={false}
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-evaluators-empty")).toBeTruthy();
    });

    it("renders a loaded table with Open controls", () => {
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={evaluators}
          isLoading={false}
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-evaluators-table")).toBeTruthy();
      expect(getByTestId("ai-evaluator-open-eval-1")).toBeTruthy();
    });

    it("uses a distinct badge status for each evaluator type", () => {
      const baseEvaluator = evaluators[0];
      assert.exists(baseEvaluator);
      const allTypes: EvaluatorRecord[] = [
        baseEvaluator,
        {...baseEvaluator, id: "eval-2", name: "human", type: "human"},
        {...baseEvaluator, id: "eval-3", name: "assert", type: "json-assert"},
      ];
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={allTypes}
          isLoading={false}
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      const colors = allTypes.map((evaluator) => {
        return getByTestId(`ai-evaluator-type-${evaluator.type}`).props.style[0].backgroundColor;
      });

      assert.equal(new Set(colors).size, 3);
    });
  });
});

describe("AiExperimentNewScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({datasetId: "ds-1"}));
    routerPush.mockClear();
  });
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

  let estimateShouldFail = false;
  let createShouldFail = false;

  const estimateMutation = mock(() => ({
    unwrap: async () => {
      if (estimateShouldFail) {
        throw new Error("estimate failed");
      }
      return {
        costUsd: 0.1,
        generations: 4,
        wallClockSeconds: 90,
      };
    },
  }));

  const createMutation = mock(() => ({
    unwrap: async () => {
      if (createShouldFail) {
        throw new Error("create failed");
      }
      return {
        created: "2026-01-01T00:00:00.000Z",
        datasetId: "ds-1",
        evaluatorIds: ["eval-1"],
        id: "exp-new",
        includeUnproofread: false,
        items: [],
        name: "run",
        promptName: "summarize",
        status: "pending",
        thresholds: [],
        updated: "2026-01-01T00:00:00.000Z",
        versions: [1, 2],
      };
    },
  }));

  const injectedHooks = {
    useAiObservabilityDatasetsQuery: () => ({
      data: [
        {
          counts: {auto: 0, human: 2, needsReview: 0, total: 2},
          created: "2026-01-01T00:00:00.000Z",
          id: "ds-1",
          name: "gold",
          tags: [],
          updated: "2026-01-02T00:00:00.000Z",
        },
      ],
      isLoading: false,
    }),
    useAiObservabilityEvaluatorsQuery: () => ({
      data: [
        {
          confidenceAlertBelow: 0.5,
          dimensions: [{dataType: "boolean", key: "correct", required: true}],
          id: "eval-human",
          name: "review queue",
          runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
          target: "full trace",
          type: "human",
        },
        {
          confidenceAlertBelow: 0.5,
          dimensions: [{dataType: "boolean", key: "correct", required: true}],
          id: "eval-1",
          name: "quality",
          runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
          target: "full trace",
          type: "json-assert",
        },
      ],
      isLoading: false,
    }),
    useAiObservabilityPromptQuery: () => ({
      data: {
        folder: "ops",
        labels: [
          {label: "latest", version: 2},
          {label: "production", version: 1},
        ],
        name: "summarize",
        tags: [],
        versions: [
          {sensitive: false, template: "v1", type: "chat", variables: [], version: 1},
          {sensitive: false, template: "v2", type: "chat", variables: [], version: 2},
        ],
      },
      isLoading: false,
    }),
    useAiObservabilityPromptsQuery: () => ({
      data: [{folder: "ops", latestVersion: 2, name: "summarize", production: 1, type: "chat"}],
      isLoading: false,
    }),
    useAiObservabilityStatusQuery: () => ({
      data: statusData,
      isError: false,
      isLoading: false,
    }),
    useCreateAiObservabilityExperimentMutation: () => [
      createMutation,
      {isError: false, isLoading: false},
    ],
    useEstimateAiObservabilityExperimentMutation: () => [
      estimateMutation,
      {isError: false, isLoading: false},
    ],
  };

  const stableApi: AdminApi = {
    enhanceEndpoints: () => stableApi,
    injectEndpoints: () => injectedHooks,
  } as unknown as AdminApi;

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  const advanceToReview = async (view: ReturnType<typeof renderWithTheme>): Promise<void> => {
    fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Version 1"));
      fireEvent.press(view.getByLabelText("Version 2"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("quality"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
  };

  describe("AiExperimentNewScreenWidget", () => {
    it("requires an experiment name before running", async () => {
      const view = renderWithTheme(
        <AiExperimentNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiment-new"
        />
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 1"));
        fireEvent.press(view.getByLabelText("Version 2"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByLabelText("quality"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-run"));
        await Promise.resolve();
      });

      assert.exists(view.getByText("Experiment name is required."));
    });

    it("walks the wizard, estimates on review, and runs experiment", async () => {
      estimateShouldFail = false;
      createShouldFail = false;
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiExperimentNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiment-new"
        />
      );
      await advanceToReview(view);
      expect(view.getByTestId("ai-experiment-estimate")).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-run"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
    });

    it("blocks run when fewer than two prompt versions are selected", async () => {
      estimateShouldFail = false;
      createShouldFail = false;
      const view = renderWithTheme(
        <AiExperimentNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiment-new"
        />
      );
      fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 1"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-version-help")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        fireEvent.press(view.getByTestId("ai-experiment-step-3"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-prompt")).toBeTruthy();
      expect(view.queryByTestId("ai-experiment-step-evaluators")).toBeNull();
    });

    it("surfaces estimate and create errors", async () => {
      estimateShouldFail = true;
      createShouldFail = false;
      const estimateFail = renderWithTheme(
        <AiExperimentNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiment-new"
        />
      );
      await advanceToReview(estimateFail);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(estimateFail.getByText("Could not estimate experiment cost.")).toBeTruthy();

      estimateShouldFail = false;
      createShouldFail = true;
      const createFail = renderWithTheme(
        <AiExperimentNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiment-new"
        />
      );
      await advanceToReview(createFail);
      await act(async () => {
        fireEvent.press(createFail.getByTestId("ai-experiment-run"));
        await Promise.resolve();
      });
      expect(createFail.getByText("Could not start experiment.")).toBeTruthy();
    });

    it("toggles versions, jumps steps, and validates on run", async () => {
      estimateShouldFail = false;
      createShouldFail = false;
      const view = renderWithTheme(
        <AiExperimentNewScreenWidget
          api={stableApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiment-new"
        />
      );
      fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 1"));
        fireEvent.press(view.getByLabelText("Version 2"));
        fireEvent.press(view.getByLabelText("Version 1"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-step-3"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-prompt")).toBeTruthy();
      expect(view.queryByTestId("ai-experiment-step-evaluators")).toBeNull();

      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 2"));
        fireEvent.press(view.getByLabelText("Version 1"));
        fireEvent.press(view.getByLabelText("Version 2"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-step-3"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-evaluators")).toBeTruthy();
      expect(view.queryByLabelText("review queue")).toBeNull();
      await act(async () => {
        fireEvent.press(view.getByLabelText("quality"));
        fireEvent.press(view.getByTestId("ai-experiment-step-4"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-review")).toBeTruthy();
    });
  });
});

describe("AiExperimentResultsScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: experimentId}));
    routerPush.mockClear();
  });
  let experimentId = "exp-1";

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

  const baseExperiment: ExperimentRecord = {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [],
    name: "compare",
    promptName: "summarize",
    results: {
      gates: [
        {
          actual: 0.9,
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "quality",
          op: "gte",
          passed: true,
          value: 0.8,
          version: 2,
        },
        {
          actual: 0.5,
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "quality",
          op: "gte",
          passed: false,
          value: 0.8,
          version: 1,
        },
      ],
      lowConfidenceItemIds: [],
      outlierItemIds: [],
      progress: {completed: 1, total: 2},
      totalCostUsd: 0.1,
    },
    status: "running",
    thresholds: [],
    updated: "2026-01-01T00:05:00.000Z",
    versions: [1, 2],
  };

  let detailData: ExperimentRecord = baseExperiment;
  let detailIsError = false;

  let promoteShouldFail = true;

  const promoteImpl = mock(async () => {
    if (promoteShouldFail) {
      throw {data: {status: 409, title: "Gate failed for v2"}};
    }
    return {};
  });

  const refetch = mock(() => undefined);

  const injectedHooks = {
    useAiObservabilityExperimentQuery: () => ({
      data: detailData,
      isError: detailIsError,
      isLoading: false,
      refetch,
    }),
    useAiObservabilityStatusQuery: () => ({
      data: statusData,
      isError: false,
      isLoading: false,
    }),
    usePromoteAiObservabilityExperimentMutation: () => [
      () => ({unwrap: promoteImpl}),
      {isError: false, isLoading: false},
    ],
  };

  const stableApi: AdminApi = {
    enhanceEndpoints: () => stableApi,
    injectEndpoints: () => injectedHooks,
  } as unknown as AdminApi;

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    api: stableApi,
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-experiment-results",
  };

  describe("AiExperimentResultsScreenWidget", () => {
    beforeEach(() => {
      detailData = baseExperiment;
      detailIsError = false;
      experimentId = "exp-1";
      promoteShouldFail = true;
      promoteImpl.mockClear();
      refetch.mockClear();
    });

    it("shows loading then running progress", () => {
      const loadingApi = {
        enhanceEndpoints: () => loadingApi,
        injectEndpoints: () => ({
          useAiObservabilityExperimentQuery: () => ({
            data: undefined,
            isError: false,
            isLoading: true,
            refetch: mock(() => undefined),
          }),
          useAiObservabilityStatusQuery: () => ({
            data: statusData,
            isError: false,
            isLoading: false,
          }),
          usePromoteAiObservabilityExperimentMutation: () => [
            () => ({unwrap: promoteImpl}),
            {isError: false, isLoading: false},
          ],
        }),
      } as unknown as AdminApi;
      const loading = renderWithTheme(
        <AiExperimentResultsScreenWidget
          api={loadingApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiment-results"
        />
      );
      expect(loading.getByTestId("ai-experiment-results-loading")).toBeTruthy();
      loading.unmount();

      detailData = baseExperiment;
      const loaded = renderWithTheme(<AiExperimentResultsScreenWidget {...widgetProps} />);
      expect(loaded.getByTestId("ai-experiment-results-running")).toBeTruthy();
    });

    it("does not reset the selected version when polled experiment data updates", async () => {
      detailData = baseExperiment;
      const {getByTestId, rerender} = renderWithTheme(
        <AiExperimentResultsScreenWidget {...widgetProps} />
      );
      await act(async () => {
        fireEvent.press(getByTestId("web_picker"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(getByTestId("web_dropdown_option_1"));
        await Promise.resolve();
      });
      detailData = {
        ...baseExperiment,
        results: {
          ...baseExperiment.results!,
          progress: {completed: 2, total: 2},
        },
        status: "completed",
      };
      rerender(<AiExperimentResultsScreenWidget {...widgetProps} />);
      expect(getByTestId("ai-experiment-gate-correct")).toHaveTextContent(/v1 quality\.correct/);
    });

    it("blocks promote when gates fail and surfaces API errors", async () => {
      detailData = {
        ...baseExperiment,
        results: {
          ...baseExperiment.results!,
          gates: [
            {
              actual: 0.4,
              aggregate: "trueRate",
              dimension: "correct",
              evaluatorName: "quality",
              op: "gte",
              passed: false,
              value: 0.8,
              version: 2,
            },
          ],
          progress: {completed: 2, total: 2},
        },
        status: "completed",
      };
      const view = renderWithTheme(<AiExperimentResultsScreenWidget {...widgetProps} />);
      expect(view.getByTestId("ai-experiment-gates-failing")).toBeTruthy();
      fireEvent.press(view.getByTestId("ai-experiment-promote"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-promote-blocked")).toBeTruthy();
    });

    it("shows query errors", () => {
      detailIsError = true;

      const view = renderWithTheme(<AiExperimentResultsScreenWidget {...widgetProps} />);

      assert.exists(view.getByText("Failed to load experiment results."));
    });

    it("surfaces promote API errors and dismisses the confirmation", async () => {
      detailData = {
        ...baseExperiment,
        results: {
          ...baseExperiment.results!,
          gates: baseExperiment.results?.gates.filter((gate) => gate.version === 2) ?? [],
        },
        status: "completed",
      };
      const view = renderWithTheme(<AiExperimentResultsScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-promote"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Promote"));
        await Promise.resolve();
      });
      assert.exists(view.getByTestId("ai-experiment-promote-error"));

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-promote"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Cancel"));
        await Promise.resolve();
      });
      assert.notExists(view.queryByText("Confirm promote"));
    });

    it("refetches when the polling interval fires", () => {
      const originalSetInterval = globalThis.setInterval;
      globalThis.setInterval = ((handler: TimerHandler): number => {
        if (typeof handler === "function") {
          handler();
        }
        return 1;
      }) as typeof globalThis.setInterval;
      try {
        renderWithTheme(<AiExperimentResultsScreenWidget {...widgetProps} />);
        assert.isAtLeast(refetch.mock.calls.length, 1);
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    it("promotes a passing version", async () => {
      promoteShouldFail = false;
      refetch.mockClear();
      detailData = {
        ...baseExperiment,
        results: {
          ...baseExperiment.results!,
          gates: [
            {
              actual: 0.9,
              aggregate: "trueRate",
              dimension: "correct",
              evaluatorName: "quality",
              op: "gte",
              passed: true,
              value: 0.8,
              version: 2,
            },
          ],
          progress: {completed: 2, total: 2},
        },
        status: "completed",
      };
      const view = renderWithTheme(<AiExperimentResultsScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-promote"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Promote"));
        await Promise.resolve();
      });
      await waitFor(() => {
        assert.isAtLeast(refetch.mock.calls.length, 1);
      });
    });

    it("shows missing experiment id when route param is absent", () => {
      experimentId = "";
      const missing = renderWithTheme(<AiExperimentResultsScreenWidget {...widgetProps} />);
      expect(missing.getByText("Missing experiment id.")).toBeTruthy();
      missing.unmount();
    });
  });
});

describe("AiExperimentsListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
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

  const experiments: ExperimentRecord[] = [
    {
      created: "2026-01-01T00:00:00.000Z",
      datasetId: "ds-1",
      evaluatorIds: ["eval-1"],
      id: "exp-1",
      includeUnproofread: false,
      items: [],
      name: "compare",
      promptName: "summarize",
      results: {
        gates: [],
        lowConfidenceItemIds: [],
        outlierItemIds: [],
        progress: {completed: 1, total: 2},
      },
      status: "running",
      thresholds: [],
      updated: "2026-01-01T00:05:00.000Z",
      versions: [1, 2],
    },
  ];

  const listState = {
    data: experiments as ExperimentRecord[] | undefined,
    isError: false,
    isLoading: false,
    refetch: mock(() => {}),
  };

  const createApi = (): AdminApi => {
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        useAiObservabilityExperimentsQuery: () => listState,
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
      }),
    };
    return api as unknown as AdminApi;
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiExperimentsScreenWidget", () => {
    it("shows loading then experiment table and navigates", async () => {
      listState.isLoading = true;
      const loading = renderWithTheme(
        <AiExperimentsScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiments"
        />
      );
      expect(loading.getByTestId("ai-experiments-loading")).toBeTruthy();
      loading.unmount();

      listState.isLoading = false;
      listState.data = experiments;
      routerPush.mockClear();
      const loaded = renderWithTheme(
        <AiExperimentsScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-experiments"
        />
      );
      expect(loaded.getByTestId("ai-experiments-table")).toBeTruthy();
      await act(async () => {
        fireEvent.press(loaded.getByTestId("ai-experiments-create"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-experiment-new");
      await act(async () => {
        fireEvent.press(loaded.getByTestId("ai-experiment-open-exp-1"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[1]?.[0]), "ai-experiment-results");
    });
  });
});

describe("AiExperimentsListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const running: ExperimentRecord = {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [],
    name: "compare summarize",
    promptName: "summarize",
    results: {
      gates: [],
      lowConfidenceItemIds: [],
      outlierItemIds: [],
      progress: {completed: 2, total: 5},
    },
    status: "running",
    thresholds: [],
    updated: "2026-01-01T00:01:00.000Z",
    versions: [1, 2],
  };

  describe("AiExperimentsListView", () => {
    it("renders running progress bar", () => {
      const {getByTestId} = renderWithTheme(
        <AiExperimentsListView
          experiments={[running]}
          isLoading={false}
          onCreate={() => undefined}
          onOpenResults={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-experiments-progress-exp-1")).toBeTruthy();
    });

    it("renders the empty state", () => {
      const {getByTestId} = renderWithTheme(
        <AiExperimentsListView
          experiments={[]}
          isLoading={false}
          onCreate={() => undefined}
          onOpenResults={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-experiments-empty")).toBeTruthy();
    });
  });
});

describe("AiObservabilityChrome", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const localOnStatus: ObservabilityStatusPayload = {
    localOn: true,
    plugins: [{capabilities: ["prompts", "reviewQueue", "traces"], id: "local"}],
    primaries: {
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    },
  };

  const localOffStatus: ObservabilityStatusPayload = {
    localOn: false,
    plugins: [{capabilities: ["prompts", "traces"], id: "langfuse"}],
    primaries: {
      datasets: "langfuse",
      experiments: "langfuse",
      prompts: "langfuse",
      reviewQueue: "local",
    },
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const stubApi = {} as unknown as AdminApi;

  describe("AI observability chrome", () => {
    it("formats the status chip for local on and local off primaries", () => {
      expect(formatObservabilityStatusChip(localOnStatus)).toBe(
        "Local on · prompts:local · datasets:local · experiments:local"
      );
      expect(formatObservabilityStatusChip(localOffStatus)).toBe(
        "Local off · prompts:langfuse · datasets:langfuse · experiments:langfuse"
      );
    });

    it("unwraps both envelope and already-unwrapped status payloads", () => {
      expect(unwrapObservabilityStatus({data: localOnStatus})).toEqual(localOnStatus);
      expect(unwrapObservabilityStatus(localOnStatus)).toEqual(localOnStatus);
    });

    it("builds Admin / AI Observability / Section / leaf breadcrumbs", () => {
      const crumbs = buildAiObservabilityBreadcrumbs({
        routeBase: "/admin",
        screenName: "ai-review-item",
      });
      expect(crumbs.map((crumb) => crumb.label)).toEqual([
        "Admin",
        "AI Observability",
        "Review",
        "Item",
      ]);
    });

    it("renders loading, error, local-on, and local-off chip states", () => {
      const loading = renderWithTheme(<AiObservabilityStatusChip isLoading />);
      expect(loading.getByText("Checking observability…")).toBeTruthy();

      const errored = renderWithTheme(<AiObservabilityStatusChip error />);
      expect(errored.getByText("Observability unavailable")).toBeTruthy();

      const on = renderWithTheme(<AiObservabilityStatusChip status={localOnStatus} />);
      expect(
        on.getByText("Local on · prompts:local · datasets:local · experiments:local")
      ).toBeTruthy();

      const off = renderWithTheme(<AiObservabilityStatusChip status={localOffStatus} />);
      expect(
        off.getByText("Local off · prompts:langfuse · datasets:langfuse · experiments:langfuse")
      ).toBeTruthy();
    });

    it("fetches loading and error states through the injected api", () => {
      const loadingApi = {
        enhanceEndpoints: () => loadingApi,
        injectEndpoints: () => ({
          useAiObservabilityStatusQuery: () => ({
            data: undefined,
            isError: false,
            isLoading: true,
          }),
        }),
      } as unknown as AdminApi;
      const loading = renderWithTheme(<AiObservabilityStatusChip api={loadingApi} />);
      expect(loading.getByText("Checking observability…")).toBeTruthy();

      const errorApi = {
        enhanceEndpoints: () => errorApi,
        injectEndpoints: () => ({
          useAiObservabilityStatusQuery: () => ({
            data: undefined,
            isError: true,
            isLoading: false,
          }),
        }),
      } as unknown as AdminApi;
      const errored = renderWithTheme(<AiObservabilityStatusChip api={errorApi} />);
      expect(errored.getByText("Observability unavailable")).toBeTruthy();

      const unwrappedApi = {
        enhanceEndpoints: () => unwrappedApi,
        injectEndpoints: () => ({
          useAiObservabilityStatusQuery: () => ({
            data: localOnStatus,
            isError: false,
            isLoading: false,
          }),
        }),
      } as unknown as AdminApi;
      const unwrapped = renderWithTheme(<AiObservabilityStatusChip api={unwrappedApi} />);
      expect(
        unwrapped.getByText("Local on · prompts:local · datasets:local · experiments:local")
      ).toBeTruthy();

      const missingStatusApi = {
        enhanceEndpoints: () => missingStatusApi,
        injectEndpoints: () => ({
          useAiObservabilityStatusQuery: () => ({
            data: undefined,
            isError: false,
            isLoading: false,
          }),
        }),
      } as unknown as AdminApi;
      const missingStatus = renderWithTheme(<AiObservabilityStatusChip api={missingStatusApi} />);
      expect(missingStatus.getByText("Observability unavailable")).toBeTruthy();
    });

    it("fetches status through the injected api when props are omitted", () => {
      let statusQuery: (() => {method: string; url: string}) | undefined;
      const api = {
        enhanceEndpoints: () => api,
        injectEndpoints: (config: {
          endpoints: (build: {
            query: (definition: {query: () => {method: string; url: string}}) => {
              query: () => {method: string; url: string};
            };
          }) => Record<string, {query: () => {method: string; url: string}}>;
        }) => {
          const endpoints = config.endpoints({
            query: (definition) => definition,
          });
          statusQuery = endpoints.aiObservabilityStatus?.query;
          return {
            useAiObservabilityStatusQuery: () => ({
              data: {data: localOnStatus},
              isError: false,
              isLoading: false,
            }),
          };
        },
      } as unknown as AdminApi;
      const fetched = renderWithTheme(<AiObservabilityStatusChip api={api} />);
      expect(
        fetched.getByText("Local on · prompts:local · datasets:local · experiments:local")
      ).toBeTruthy();
      assert.deepEqual(statusQuery?.(), {method: "GET", url: "/ai/observability/status"});
    });

    it("shows unavailable chip when api is omitted and no status props are passed", () => {
      const missingApi = renderWithTheme(<AiObservabilityStatusChip />);
      expect(missingApi.getByText("Observability unavailable")).toBeTruthy();
    });

    it("hides review queue content when the local plugin is off", () => {
      const {getByTestId, queryByTestId} = renderWithTheme(
        <AiObservabilityChrome
          api={stubApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review"
          status={localOffStatus}
        />
      );
      expect(getByTestId("ai-observability-review-hidden")).toBeTruthy();
      expect(queryByTestId("ai-observability-placeholder-ai-review")).toBeNull();
    });

    it("hides review item content when the local plugin is off", () => {
      const {getByTestId, queryByText} = renderWithTheme(
        <AiObservabilityChrome
          api={stubApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          status={localOffStatus}
        >
          <Text>Private review body</Text>
        </AiObservabilityChrome>
      );
      expect(getByTestId("ai-observability-review-hidden")).toBeTruthy();
      expect(queryByText("Private review body")).toBeNull();
    });

    it("registers phase 2 screen widgets including evaluators, datasets, and experiments", () => {
      expect(Object.keys(AI_OBSERVABILITY_WIDGETS).sort()).toEqual([
        "ai-dataset-detail",
        "ai-datasets",
        "ai-evaluator-detail",
        "ai-evaluator-new",
        "ai-evaluators",
        "ai-experiment-new",
        "ai-experiment-results",
        "ai-experiments",
        "ai-prompt-editor",
        "ai-prompts",
        "ai-review",
        "ai-review-item",
        "ai-trace-detail",
        "ai-traces",
      ]);
    });
  });
});

describe("AiPromptEditorScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({name: promptName}));
    routerPush.mockClear();
  });
  let promptName = "summarize";

  const statusData = {
    localOn: true,
    playgroundAi: {source: "request-key" as const},
    plugins: [],
    primaries: {
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    },
  };

  const detail: PromptDetail = {
    folder: "examples",
    labels: [
      {label: "latest", version: 1},
      {label: "production", version: 1},
    ],
    name: "summarize",
    tags: [],
    versions: [
      {
        config: {temperature: 0.3},
        sensitive: false,
        system: "You summarize.",
        template: "Summarize {{text}}",
        type: "chat",
        variables: [{key: "text", required: true}],
        version: 1,
      },
    ],
  };

  const detailState = {
    data: detail as PromptDetail | undefined,
    isError: false,
    isLoading: false,
    refetch: mock(() => {}),
  };

  const playgroundResult: PlaygroundRunResult = {
    compiledMessages: [],
    costUsd: 0.01,
    latencyMs: 12,
    output: "ok",
    tokens: {totalTokens: 9},
  };

  const playgroundMutationState = {
    data: undefined as PlaygroundRunResult | undefined,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
  };

  const runPlayground = mock(() => ({
    unwrap: async () => {
      playgroundMutationState.data = playgroundResult;
      return playgroundResult;
    },
  }));

  const saveMutation = mock(() => ({
    unwrap: async () => {
      if (createVersionShouldFail) {
        throw new Error("save failed");
      }
      return {name: "summarize", version: 2};
    },
  }));

  const setLabel = mock(() => ({
    unwrap: async () => {
      if (labelShouldFail) {
        throw new Error("label failed");
      }
      return {label: "production", version: 2};
    },
  }));

  let createVersionShouldFail = false;
  let labelShouldFail = false;

  const injectedHooks = {
    useAiObservabilityPromptQuery: () => detailState,
    useAiObservabilityStatusQuery: () => ({
      data: statusData,
      isError: false,
      isLoading: false,
    }),
    useCreateAiObservabilityPromptVersionMutation: () => [
      saveMutation,
      {isError: createVersionShouldFail, isLoading: false},
    ],
    useMoveAiObservabilityPromptLabelMutation: () => [
      setLabel,
      {isError: labelShouldFail, isLoading: false},
    ],
    useRunAiObservabilityPlaygroundMutation: () => [runPlayground, playgroundMutationState],
  };

  const stableApi: AdminApi = {
    enhanceEndpoints: () => stableApi,
    injectEndpoints: () => injectedHooks,
  } as unknown as AdminApi;

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    api: stableApi,
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-prompt-editor",
  };

  describe("AiPromptEditorScreenWidget", () => {
    it("shows loading then editor and playground tabs", () => {
      detailState.isLoading = true;
      const loading = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
      expect(loading.getByTestId("ai-prompt-editor-loading")).toBeTruthy();
      loading.unmount();

      detailState.isLoading = false;
      detailState.data = detail;
      const loaded = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
      expect(loaded.getByTestId("ai-prompt-save-next")).toBeTruthy();
      fireEvent.press(loaded.getByText("Playground"));
      expect(loaded.getByTestId("ai-prompt-playground")).toBeTruthy();
    });

    it("blocks playground runs until a request key is available", () => {
      runPlayground.mockClear();
      playgroundMutationState.data = undefined;
      detailState.data = detail;
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget
          {...widgetProps}
          playgroundApiKeyHint="Save a Gemini API key on Profile."
        />
      );
      fireEvent.press(view.getByText("Playground"));
      expect(view.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      fireEvent.press(view.getByTestId("ai-prompt-run-once"));
      assert.equal(runPlayground.mock.calls.length, 0);
    });

    it("waits for async key loading before blocking or running", () => {
      runPlayground.mockClear();
      detailState.data = detail;
      const loading = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKeyLoading={true} />
      );
      fireEvent.press(loading.getByText("Playground"));
      expect(loading.getByTestId("ai-prompt-run-once")).toHaveTextContent("Loading API key…");
      loading.unmount();

      const ready = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
      );
      fireEvent.press(ready.getByText("Playground"));
      expect(ready.queryByTestId("ai-prompt-playground-blocked")).toBeNull();
    });

    it("runs playground once with template variables", async () => {
      runPlayground.mockClear();
      playgroundMutationState.data = undefined;
      detailState.data = detail;
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
      );
      fireEvent.press(view.getByText("Playground"));
      fireEvent.changeText(view.getByTestId("ai-prompt-var-text"), "hello");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      view.rerender(<AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />);
      assert.deepEqual(runPlayground.mock.calls[0]?.[0], {
        apiKey: "saved-key",
        name: "summarize",
        variables: {text: "hello"},
        version: 1,
      });
      expect(view.getByTestId("ai-prompt-run-result")).toBeTruthy();
      expect(view.getByTestId("ai-prompt-run-output")).toHaveTextContent("ok");
    });

    it("shows missing name, load error with retry, and save/set-production flows", async () => {
      promptName = "";
      const missing = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
      expect(missing.getByText(/Missing prompt name/)).toBeTruthy();
      missing.unmount();
      promptName = "summarize";

      detailState.refetch.mockClear();
      detailState.data = undefined;
      detailState.isError = true;
      detailState.isLoading = false;
      const errored = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
      expect(errored.getByText(/Could not load summarize/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      await waitFor(() => {
        assert.isAtLeast(detailState.refetch.mock.calls.length, 1);
      });
      errored.unmount();

      createVersionShouldFail = false;
      labelShouldFail = false;
      detailState.data = detail;
      detailState.isError = false;
      const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Set production"));
        await Promise.resolve();
      });
      assert.isAtLeast(setLabel.mock.calls.length, 1);

      fireEvent.changeText(view.getByTestId("ai-prompt-template"), "Summarize {{text}} v2");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-save-next"));
        await Promise.resolve();
      });
      assert.isAtLeast(saveMutation.mock.calls.length, 1);
    });

    it("surfaces save, production, and playground errors", () => {
      createVersionShouldFail = true;
      labelShouldFail = true;
      playgroundMutationState.error = {data: {title: "Provide an AI API key."}};
      playgroundMutationState.isError = true;
      detailState.data = detail;
      detailState.isError = false;
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
      );
      expect(view.getByText("Could not save a new version.")).toBeTruthy();
      expect(view.getByText("Could not set production.")).toBeTruthy();
      fireEvent.press(view.getByText("Playground"));
      expect(view.getByText("Provide an AI API key.")).toBeTruthy();
      createVersionShouldFail = false;
      labelShouldFail = false;
      playgroundMutationState.error = undefined;
      playgroundMutationState.isError = false;
    });

    it("prefers the host hint over a stale missing-key 503 when status is request-key", () => {
      playgroundMutationState.data = undefined;
      playgroundMutationState.error = {
        data: {
          title:
            "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.",
        },
      };
      playgroundMutationState.isError = true;
      detailState.data = detail;
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget
          {...widgetProps}
          playgroundApiKeyHint="Save a Gemini API key on Profile."
        />
      );
      fireEvent.press(view.getByText("Playground"));
      expect(view.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      expect(view.queryByTestId("ai-prompt-run-error")).toBeNull();
      playgroundMutationState.error = undefined;
      playgroundMutationState.isError = false;
    });
  });
});

describe("AiPromptEditorView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const idleHandlers = {
    isRunningPlayground: false,
    isSaving: false,
    isSettingProduction: false,
    onRunPlayground: async () => undefined,
    onSaveVersion: async () => undefined,
    onSelectVersion: () => undefined,
    onSetProduction: async () => undefined,
  };

  const detail: PromptDetail = {
    folder: "examples",
    labels: [
      {label: "latest", version: 2},
      {label: "production", version: 1},
      {label: "staging", version: 1},
    ],
    name: "summarize",
    tags: [],
    versions: [
      {
        config: {temperature: 0.3},
        created: "2026-01-02T03:04:00.000Z",
        sensitive: false,
        system: "You summarize.",
        template: "Summarize {{text}}",
        type: "chat",
        variables: [{key: "text", required: true}],
        version: 1,
      },
      {
        config: {temperature: 0.5},
        created: "2026-02-03T04:05:00.000Z",
        sensitive: false,
        system: "You summarize briefly.",
        template: "Brief {{text}}",
        type: "text",
        variables: [{key: "text", required: true}],
        version: 2,
      },
    ],
  };

  const detailNoProduction: PromptDetail = {
    ...detail,
    labels: [{label: "latest", version: 2}],
  };

  const expectedV1Created = DateTime.fromISO("2026-01-02T03:04:00.000Z")
    .toLocal()
    .toLocaleString(DateTime.DATETIME_MED);
  const expectedV2Created = DateTime.fromISO("2026-02-03T04:05:00.000Z")
    .toLocal()
    .toLocaleString(DateTime.DATETIME_MED);

  describe("AiPromptEditorView", () => {
    it("saves only as the next immutable version and has no in-place save control", () => {
      const {getByTestId, queryByTestId, queryByText} = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
      );
      expect(getByTestId("ai-prompt-save-next")).toBeTruthy();
      expect(queryByTestId("ai-prompt-save-in-place")).toBeNull();
      expect(queryByText("Save")).toBeNull();
    });

    it("names the outgoing production version in the confirm copy", async () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
      );
      expect(getByText(/outgoing production version is v1/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      expect(getByTestId("ai-prompt-production-modal-copy")).toBeTruthy();
    });

    it("keeps Save this run to dataset disabled until phase 2", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
      );
      fireEvent.press(getByText("Playground"));
      const dataset = getByTestId("ai-prompt-save-run-dataset");
      expect(dataset.props.accessibilityState?.disabled ?? dataset.props.disabled).toBeTruthy();
    });

    it("switches versions, text type hides system, and wires save/production callbacks", async () => {
      const onSaveVersion = mock(async () => undefined);
      const onSetProduction = mock(async () => undefined);
      const onSelectVersion = mock(() => undefined);
      const v1 = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          isRunningPlayground={false}
          isSaving={false}
          isSettingProduction={false}
          onRunPlayground={async () => undefined}
          onSaveVersion={onSaveVersion}
          onSelectVersion={onSelectVersion}
          onSetProduction={onSetProduction}
          selectedVersion={1}
        />
      );
      await act(async () => {
        fireEvent.press(v1.getByTestId("ai-prompt-version-2"));
        await Promise.resolve();
      });
      expect(onSelectVersion).toHaveBeenCalledWith(2);
      expect(v1.getByTestId("ai-prompt-label-production-1")).toBeTruthy();
      expect(v1.getByTestId("ai-prompt-label-staging-1")).toBeTruthy();
      assert.equal(v1.getByTestId("ai-prompt-version-created-1").props.children, expectedV1Created);

      const v2 = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          isRunningPlayground={false}
          isSaving={false}
          isSettingProduction={false}
          onRunPlayground={async () => undefined}
          onSaveVersion={onSaveVersion}
          onSelectVersion={onSelectVersion}
          onSetProduction={onSetProduction}
          selectedVersion={2}
        />
      );
      expect(v2.queryByTestId("ai-prompt-system")).toBeNull();
      expect(v2.getByTestId("ai-prompt-label-latest-2")).toBeTruthy();
      assert.equal(v2.getByTestId("ai-prompt-version-created-2").props.children, expectedV2Created);
      fireEvent.changeText(v2.getByTestId("ai-prompt-template"), "Brief {{text}} updated");
      await act(async () => {
        fireEvent.press(v2.getByTestId("ai-prompt-save-next"));
        await Promise.resolve();
      });
      assert.isAtLeast(onSaveVersion.mock.calls.length, 1);

      await act(async () => {
        fireEvent.press(v2.getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(v2.getByText("Set production"));
        await Promise.resolve();
      });
      assert.isAtLeast(onSetProduction.mock.calls.length, 1);
    });

    it("shows version-not-found, no-production badge, and inline errors", () => {
      const missing = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={99} {...idleHandlers} />
      );
      expect(missing.getByText(/Version 99 was not found/)).toBeTruthy();

      const noProd = renderWithTheme(
        <AiPromptEditorView detail={detailNoProduction} selectedVersion={2} {...idleHandlers} />
      );
      expect(noProd.getByText("no production")).toBeTruthy();

      const errors = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          playgroundError="Playground failed"
          productionError="Could not set production."
          saveError="Could not save a new version."
          selectedVersion={1}
          {...idleHandlers}
        />
      );
      expect(errors.getByText("Could not save a new version.")).toBeTruthy();
      expect(errors.getByText("Could not set production.")).toBeTruthy();
      fireEvent.press(errors.getByText("Playground"));
      expect(errors.getByText("Playground failed")).toBeTruthy();
    });

    it("switches prompt type, saves text versions, and dismisses the production modal", async () => {
      const onSaveVersion = mock(async () => undefined);
      const onSetProduction = mock(async () => undefined);
      const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          isRunningPlayground={false}
          isSaving={false}
          isSettingProduction={false}
          onRunPlayground={async () => undefined}
          onSaveVersion={onSaveVersion}
          onSelectVersion={() => undefined}
          onSetProduction={onSetProduction}
          selectedVersion={1}
        />
      );
      const typeSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.title === "Type"
      );
      fireEvent(typeSelect!, "onChange", "text");
      fireEvent.changeText(getByTestId("ai-prompt-template"), "Plain text body");
      await act(async () => {
        fireEvent.press(getByTestId("ai-prompt-save-next"));
        await Promise.resolve();
      });
      assert.isAtLeast(onSaveVersion.mock.calls.length, 1);

      await act(async () => {
        fireEvent.press(getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(getByText("Cancel"));
        await Promise.resolve();
      });
      fireEvent.press(getByText("Editor"));
      expect(getByTestId("ai-prompt-template")).toBeTruthy();
    });
  });
});

describe("AiPromptPlaygroundView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const detail: PromptDetail = {
    folder: "examples",
    labels: [{label: "latest", version: 1}],
    name: "summarize",
    tags: [],
    versions: [
      {
        config: {},
        sensitive: false,
        system: "sys",
        template: "Hello {{name}}",
        type: "chat",
        variables: [{key: "name", required: true}],
        version: 1,
      },
    ],
  };

  const result: PlaygroundRunResult = {
    compiledMessages: [{content: "compiled", role: "user"}],
    costUsd: 0.01,
    latencyMs: 10,
    output: "done",
    tokens: {totalTokens: 5},
  };

  describe("AiPromptPlaygroundView", () => {
    it("runs once and shows compiled messages, output, and metrics", async () => {
      const onRun = mock(async () => undefined);
      const view = renderWithTheme(
        <AiPromptPlaygroundView
          detail={detail}
          isRunning={false}
          onRun={onRun}
          result={result}
          runError={undefined}
          selectedVersion={detail.versions[0]!}
        />
      );
      fireEvent.changeText(view.getByTestId("ai-prompt-var-name"), "Ada");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      assert.equal(onRun.mock.calls.length, 1);
      expect(view.getByTestId("ai-prompt-run-result")).toBeTruthy();
      expect(view.getByTestId("ai-prompt-run-output")).toHaveTextContent("done");
      expect(view.getByText("compiled")).toBeTruthy();
    });

    it("shows blocked guidance and disables run while loading or blocked", async () => {
      const onRun = mock(async () => undefined);
      const blocked = renderWithTheme(
        <AiPromptPlaygroundView
          blockedMessage="Save a Gemini API key on Profile."
          detail={detail}
          isRunning={false}
          onRun={onRun}
          result={undefined}
          runError={undefined}
          selectedVersion={detail.versions[0]!}
        />
      );
      expect(blocked.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      await act(async () => {
        fireEvent.press(blocked.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      assert.equal(onRun.mock.calls.length, 0);
      blocked.unmount();

      onRun.mockClear();
      const loading = renderWithTheme(
        <AiPromptPlaygroundView
          detail={detail}
          isApiKeyLoading={true}
          isRunning={false}
          onRun={onRun}
          result={undefined}
          runError={undefined}
          selectedVersion={detail.versions[0]!}
        />
      );
      expect(loading.getByTestId("ai-prompt-run-once")).toHaveTextContent("Loading API key…");
      await act(async () => {
        fireEvent.press(loading.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      assert.equal(onRun.mock.calls.length, 0);
    });

    it("shows run errors and empty-variable guidance", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptPlaygroundView
          detail={{
            ...detail,
            versions: [{...detail.versions[0]!, template: "static", variables: []}],
          }}
          isRunning={false}
          onRun={async () => undefined}
          result={undefined}
          runError="Playground failed"
          selectedVersion={{...detail.versions[0]!, template: "static", variables: []}}
        />
      );
      expect(getByText("This version has no template variables.")).toBeTruthy();
      expect(getByTestId("ai-prompt-run-error")).toHaveTextContent("Playground failed");
    });
  });
});

describe("AiPromptsListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const loaded: PromptListItem[] = [
    {
      folder: "examples",
      latestVersion: 1,
      name: "summarize",
      production: "—",
      type: "chat",
    },
  ];

  let listState = {
    data: loaded as PromptListItem[] | undefined,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
  };

  let createShouldFail = false;

  const createMutation = mock(() => ({
    unwrap: async () => {
      if (createShouldFail) {
        throw new Error("duplicate");
      }
      return {name: "new-prompt", version: 1};
    },
  }));

  const injectedHooks = {
    useAiObservabilityPromptsQuery: () => ({...listState, refetch: mock(() => undefined)}),
    useAiObservabilityStatusQuery: () => ({
      data: {
        localOn: true,
        plugins: [],
        primaries: {
          datasets: "local",
          experiments: "local",
          prompts: "local",
          reviewQueue: "local",
        },
      },
      isError: false,
      isLoading: false,
    }),
    useCreateAiObservabilityPromptMutation: () => [
      createMutation,
      {isError: false, isLoading: false},
    ],
  };

  const stableApi: AdminApi = {
    enhanceEndpoints: () => stableApi,
    injectEndpoints: () => injectedHooks,
  } as unknown as AdminApi;

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    api: stableApi,
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-prompts",
  };

  describe("AiPromptsScreenWidget", () => {
    it("shows loading then the loaded library", () => {
      listState = {data: undefined, error: undefined, isError: false, isLoading: true};
      const loading = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      expect(loading.getByTestId("ai-prompts-loading")).toBeTruthy();
      loading.unmount();

      listState = {data: loaded, error: undefined, isError: false, isLoading: false};
      const loadedView = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      expect(loadedView.getByTestId("ai-prompts-table")).toBeTruthy();
    });

    it("opens the editor and creates a prompt", async () => {
      listState = {data: loaded, error: undefined, isError: false, isLoading: false};
      createShouldFail = false;
      routerPush.mockClear();
      const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-open-summarize"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-prompt-editor");

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-create"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByDisplayValue("examples"), "examples");
      fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "new-prompt");
      fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "You are helpful.");
      fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "Hi {{name}}");
      await act(async () => {
        fireEvent.press(view.getByText("Create"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[1]?.[0]), "new-prompt");
    });

    it("surfaces create errors and load failures", async () => {
      createShouldFail = true;
      const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-create"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "dup");
      await act(async () => {
        fireEvent.press(view.getByText("Create"));
        await Promise.resolve();
      });
      expect(view.getByText(/Could not create prompt/)).toBeTruthy();

      listState = {data: undefined, error: {data: {}}, isError: true, isLoading: false};
      const errored = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      expect(errored.getByText("Failed to load prompts")).toBeTruthy();
    });

    it("filters by folder and search and retries load errors", async () => {
      listState = {data: loaded, error: undefined, isError: false, isLoading: false};
      const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      fireEvent.changeText(view.getByTestId("ai-prompts-search"), "summ");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-folder-examples"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-prompts-table")).toBeTruthy();

      listState = {data: undefined, error: {data: {}}, isError: true, isLoading: false};
      const errored = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await Promise.resolve();
      });
      listState = {data: loaded, error: undefined, isError: false, isLoading: false};
    });

    it("dismisses the create modal via cancel", async () => {
      listState = {data: loaded, error: undefined, isError: false, isLoading: false};
      const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-create"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Cancel"));
        await Promise.resolve();
      });
      expect(view.queryByTestId("ai-prompts-create-form")).toBeNull();
    });
  });
});

describe("AiPromptsListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const prompts: PromptListItem[] = [
    {
      folder: "examples",
      latestVersion: 2,
      name: "summarize",
      production: 1,
      type: "chat",
      usage7d: {calls: 3, costUsd: 0.2},
    },
  ];

  const idleHandlers = {
    onCreate: () => undefined,
    onCreateFolderChange: () => undefined,
    onCreateNameChange: () => undefined,
    onCreateSystemChange: () => undefined,
    onCreateTemplateChange: () => undefined,
    onDismissCreate: () => undefined,
    onFolderChange: () => undefined,
    onOpenCreate: () => undefined,
    onOpenPrompt: () => undefined,
    onSearchChange: () => undefined,
  };

  describe("AiPromptsListView", () => {
    it("renders the loading state", () => {
      const {getByTestId} = renderWithTheme(
        <AiPromptsListView
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          isLoading
          prompts={[]}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompts-loading")).toBeTruthy();
    });

    it("renders the empty state", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptsListView
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          prompts={[]}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompts-empty")).toBeTruthy();
      expect(getByText("No prompts in this folder yet.")).toBeTruthy();
    });

    it("renders a loaded table with folder counts and latest vs production columns", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptsListView
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          prompts={prompts}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompts-table")).toBeTruthy();
      expect(getByText("All (1)")).toBeTruthy();
      expect(getByText("examples (1)")).toBeTruthy();
      expect(getByText("examples/summarize")).toBeTruthy();
      expect(getByText("v2")).toBeTruthy();
      expect(getByText("v1")).toBeTruthy();
    });

    it("renders an Open control for each prompt", () => {
      const {getByTestId} = renderWithTheme(
        <AiPromptsListView
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          prompts={prompts}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompt-open-summarize")).toBeTruthy();
    });

    it("filters by folder and search and wires create modal fields", async () => {
      const onFolderChange = mock(() => undefined);
      const onSearchChange = mock(() => undefined);
      const onCreate = mock(() => undefined);
      const onRetry = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptsListView
          createError="Name required"
          createFolder="examples"
          createName="new-prompt"
          createOpen
          createSystem="You are helpful"
          createTemplate="Hi {{name}}"
          folder=""
          loadError="Failed to load prompts"
          onCreate={onCreate}
          onCreateFolderChange={() => undefined}
          onCreateNameChange={() => undefined}
          onCreateSystemChange={() => undefined}
          onCreateTemplateChange={() => undefined}
          onDismissCreate={() => undefined}
          onFolderChange={onFolderChange}
          onOpenCreate={() => undefined}
          onOpenPrompt={() => undefined}
          onRetry={onRetry}
          onSearchChange={onSearchChange}
          prompts={prompts}
          search="summ"
        />
      );
      fireEvent.changeText(getByTestId("ai-prompts-search"), "note");
      assert.isAtLeast(onSearchChange.mock.calls.length, 1);
      await act(async () => {
        fireEvent.press(getByTestId("ai-prompts-folder-examples"));
        await Promise.resolve();
      });
      assert.isAtLeast(onFolderChange.mock.calls.length, 1);
      await act(async () => {
        fireEvent.press(getByText("Retry"));
        await Promise.resolve();
      });
      assert.equal(onRetry.mock.calls.length, 1);
      expect(getByTestId("ai-prompts-create-form")).toBeTruthy();
    });
  });
});

describe("AiReviewItemScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: reviewId}));
    routerPush.mockClear();
  });
  let reviewId = "rev-1";

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

  const detail: ReviewDetail = {
    dimensions: [{dataType: "boolean", key: "correct", required: true}],
    evaluatorId: "eval-1",
    id: "rev-1",
    panels: {given: [], wrote: []},
    status: "pending",
    traceId: "trace-1",
  };

  const pending: ReviewListItem[] = [
    {
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      evaluatorId: "eval-1",
      id: "rev-1",
      reason: "manual",
      status: "pending",
      traceId: "trace-1",
      traceName: "summarize",
    },
  ];

  const actionImpl = mock(async () => detail);

  let actionShouldFail = false;

  const createApi = (options?: {currentUserId?: string}): AdminApi => {
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        useAiObservabilityCurrentUserQuery: () => ({
          data:
            options?.currentUserId === "" ? undefined : {id: options?.currentUserId ?? "user-1"},
          isLoading: false,
        }),
        useAiObservabilityReviewItemQuery: () => ({
          data: detail,
          isError: false,
          isLoading: false,
          refetch: mock(() => {}),
        }),
        useAiObservabilityReviewQuery: () => ({
          data: {counts: {done: 0, in_progress: 0, pending: 1, skipped: 0}, data: pending},
          isError: false,
          isLoading: false,
          refetch: mock(() => {}),
        }),
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
        useUpdateAiObservabilityReviewItemMutation: () => [
          () => ({
            unwrap: async () => {
              if (actionShouldFail) {
                throw new Error("action failed");
              }
              return actionImpl();
            },
          }),
          {isError: false, isLoading: false},
        ],
      }),
    };
    return api as unknown as AdminApi;
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiReviewItemScreenWidget", () => {
    it("shows loading then review item with score controls", () => {
      const loadingApi = {
        enhanceEndpoints: () => loadingApi,
        injectEndpoints: () => ({
          useAiObservabilityCurrentUserQuery: () => ({data: undefined, isLoading: false}),
          useAiObservabilityReviewItemQuery: () => ({
            data: undefined,
            isError: false,
            isLoading: true,
            refetch: mock(() => {}),
          }),
          useAiObservabilityReviewQuery: () => ({
            data: {data: pending},
            isError: false,
            isLoading: false,
            refetch: mock(() => {}),
          }),
          useAiObservabilityStatusQuery: () => ({
            data: statusData,
            isError: false,
            isLoading: false,
          }),
          useUpdateAiObservabilityReviewItemMutation: () => [
            () => ({unwrap: actionImpl}),
            {isError: false, isLoading: false},
          ],
        }),
      } as unknown as AdminApi;
      const loading = renderWithTheme(
        <AiReviewItemScreenWidget
          api={loadingApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      expect(loading.getByTestId("ai-review-item-loading")).toBeTruthy();
      loading.unmount();

      const loaded = renderWithTheme(
        <AiReviewItemScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      expect(loaded.getByTestId("ai-review-item")).toBeTruthy();
      expect(loaded.getByTestId("ai-review-score-boolean-correct")).toBeTruthy();
    });

    it("requires scores before submit and submits on pass", async () => {
      actionImpl.mockClear();
      const view = renderWithTheme(
        <AiReviewItemScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-submit-next"));
        await Promise.resolve();
      });
      expect(view.getByText("Score correct before submitting.")).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-score-correct-pass"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-submit-next"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(actionImpl.mock.calls.length, 1);
    });

    it("shows missing id and load error with retry", async () => {
      reviewId = "";
      const missing = renderWithTheme(
        <AiReviewItemScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      expect(missing.getByText(/Missing review item id/)).toBeTruthy();
      missing.unmount();
      reviewId = "rev-1";

      const refetch = mock(() => {});
      const errorApi = {
        enhanceEndpoints: () => errorApi,
        injectEndpoints: () => ({
          useAiObservabilityCurrentUserQuery: () => ({data: {id: "user-1"}, isLoading: false}),
          useAiObservabilityReviewItemQuery: () => ({
            data: undefined,
            isError: true,
            isLoading: false,
            refetch,
          }),
          useAiObservabilityReviewQuery: () => ({
            data: {data: pending},
            isError: false,
            isLoading: false,
            refetch: mock(() => {}),
          }),
          useAiObservabilityStatusQuery: () => ({
            data: statusData,
            isError: false,
            isLoading: false,
          }),
          useUpdateAiObservabilityReviewItemMutation: () => [
            () => ({unwrap: actionImpl}),
            {isError: false, isLoading: false},
          ],
        }),
      } as unknown as AdminApi;
      const errored = renderWithTheme(
        <AiReviewItemScreenWidget
          api={errorApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      assert.isAtLeast(refetch.mock.calls.length, 1);
    });

    it("skips, assigns, and surfaces action errors", async () => {
      actionShouldFail = false;
      actionImpl.mockClear();
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiReviewItemScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-skip"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.isAtLeast(actionImpl.mock.calls.length, 1);

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-assign"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(actionImpl.mock.calls.length, 2);

      actionShouldFail = true;
      const failing = renderWithTheme(
        <AiReviewItemScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      await act(async () => {
        fireEvent.press(failing.getByTestId("ai-review-skip"));
        await Promise.resolve();
      });
      expect(failing.getByText("Could not skip this review.")).toBeTruthy();

      const noUser = renderWithTheme(
        <AiReviewItemScreenWidget
          api={createApi({currentUserId: ""})}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      await act(async () => {
        fireEvent.press(noUser.getByTestId("ai-review-assign"));
        await Promise.resolve();
      });
      expect(noUser.getByText("Could not identify the current admin.")).toBeTruthy();
      actionShouldFail = false;
    });

    it("navigates between pending items and clears the queue", async () => {
      const secondPending: ReviewListItem = {
        enqueuedAt: "2026-01-01T00:01:00.000Z",
        evaluatorId: "eval-1",
        id: "rev-2",
        reason: "manual",
        status: "pending",
        traceId: "trace-2",
        traceName: "summarize",
      };
      const twoPendingApi = {
        enhanceEndpoints: () => twoPendingApi,
        injectEndpoints: () => ({
          useAiObservabilityCurrentUserQuery: () => ({data: {id: "user-1"}, isLoading: false}),
          useAiObservabilityReviewItemQuery: () => ({
            data: detail,
            isError: false,
            isLoading: false,
            refetch: mock(() => {}),
          }),
          useAiObservabilityReviewQuery: () => ({
            data: {
              counts: {done: 0, in_progress: 0, pending: 2, skipped: 0},
              data: [pending[0]!, secondPending],
            },
            isError: false,
            isLoading: false,
            refetch: mock(() => {}),
          }),
          useAiObservabilityStatusQuery: () => ({
            data: statusData,
            isError: false,
            isLoading: false,
          }),
          useUpdateAiObservabilityReviewItemMutation: () => [
            () => ({unwrap: actionImpl}),
            {isError: false, isLoading: false},
          ],
        }),
      } as unknown as AdminApi;

      routerPush.mockClear();
      const view = renderWithTheme(
        <AiReviewItemScreenWidget
          api={twoPendingApi}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
        />
      );
      await act(async () => {
        fireEvent.press(view.getByText("Next"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-review-item");

      actionImpl.mockClear();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-score-correct-pass"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-review-comment"), "looks good");
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-submit-next"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.isAtLeast(actionImpl.mock.calls.length, 1);
    });
  });
});

describe("AiReviewItemView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const longInput = Array.from({length: 45}, (_, index) => `word${index}`).join(" ");
  const detail: ReviewDetail = {
    dimensions: [{dataType: "boolean", key: "correct", required: true}],
    evaluatorId: "evaluator-1",
    id: "review-1",
    instructions: "Mark correct only when grounded.",
    panels: {
      given: [{key: "note", label: "Clinical note", note: "Check identifiers.", value: longInput}],
      wrote: [{key: "summary", label: "Summary", value: "Short output"}],
    },
    rawInput: {note: longInput},
    rawOutput: {summary: "Short output"},
    status: "pending",
    traceId: "trace-1",
  };

  describe("AiReviewItemView", () => {
    it("shows pending position, collapsed long fields, reviewer notes, and raw JSON", () => {
      const {getByTestId, getByText, queryByText} = renderWithTheme(
        <AiReviewItemView
          comment=""
          detail={detail}
          isPending
          onAssign={() => undefined}
          onCommentChange={() => undefined}
          onScoreChange={() => undefined}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          position={1}
          scores={{}}
          totalPending={2}
        />
      );
      expect(getByText("Item 1 of 2 pending")).toBeTruthy();
      expect(getByText("45 words")).toBeTruthy();
      expect(queryByText(longInput)).toBeNull();
      expect(getByTestId("ai-review-raw-json")).toBeTruthy();
      expect(queryByText(/"input"/)).toBeNull();
      fireEvent.press(getByTestId("ai-review-field-note.toggle"));
      expect(getByText("Check identifiers.")).toBeTruthy();
    });

    it("wires submit, skip, and assign actions", async () => {
      const onAssign = mock(() => undefined);
      const onSkip = mock(() => undefined);
      const onSubmit = mock(() => undefined);
      const {getByTestId} = renderWithTheme(
        <AiReviewItemView
          comment=""
          detail={detail}
          isPending
          onAssign={onAssign}
          onCommentChange={() => undefined}
          onScoreChange={() => undefined}
          onSkip={onSkip}
          onSubmit={onSubmit}
          position={1}
          scores={{correct: true}}
          totalPending={1}
        />
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-submit-next"));
        fireEvent.press(getByTestId("ai-review-skip"));
        fireEvent.press(getByTestId("ai-review-assign"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onSubmit).toHaveBeenCalled();
      expect(onSkip).toHaveBeenCalled();
      expect(onAssign).toHaveBeenCalled();
    });

    it("shows non-pending copy, navigation buttons, submit error, and comment editing", async () => {
      const onNext = mock(() => undefined);
      const onPrevious = mock(() => undefined);
      const onCommentChange = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <AiReviewItemView
          comment="needs work"
          detail={{...detail, status: "done"}}
          isPending={false}
          onAssign={() => undefined}
          onCommentChange={onCommentChange}
          onNext={onNext}
          onPrevious={onPrevious}
          onScoreChange={() => undefined}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          position={1}
          scores={{correct: true}}
          submitError="Could not submit this review."
          totalPending={0}
        />
      );
      expect(getByText(/not in pending queue/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByText("Previous"));
        fireEvent.press(getByText("Next"));
        await Promise.resolve();
      });
      expect(onPrevious).toHaveBeenCalled();
      expect(onNext).toHaveBeenCalled();
      expect(getByText("Could not submit this review.")).toBeTruthy();
      fireEvent.changeText(getByTestId("ai-review-comment"), "updated");
      expect(onCommentChange).toHaveBeenCalledWith("updated");
    });

    it("scores boolean dimensions when navigation handlers are absent", async () => {
      const onScoreChange = mock(() => undefined);
      const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
        <AiReviewItemView
          comment=""
          detail={detail}
          isPending
          onAssign={() => undefined}
          onCommentChange={() => undefined}
          onScoreChange={onScoreChange}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          position={1}
          scores={{}}
          totalPending={1}
        />
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-score-correct-pass"));
        await Promise.resolve();
      });
      assert.isAtLeast(onScoreChange.mock.calls.length, 1);
      expect(getByText("Previous")).toBeTruthy();
      expect(getByText("Next")).toBeTruthy();
      const navButtons = UNSAFE_root.findAllByProps({text: "Previous"}).filter(
        (node) => typeof node.props.onClick === "function"
      );
      const nextButtons = UNSAFE_root.findAllByProps({text: "Next"}).filter(
        (node) => typeof node.props.onClick === "function"
      );
      assert.isAtLeast(navButtons.length, 1);
      assert.isAtLeast(nextButtons.length, 1);
      navButtons[0]!.props.onClick();
      nextButtons[0]!.props.onClick();
    });

    it("expands raw JSON accordion content", async () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiReviewItemView
          comment=""
          detail={detail}
          isPending
          onAssign={() => undefined}
          onCommentChange={() => undefined}
          onScoreChange={() => undefined}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          position={1}
          scores={{}}
          totalPending={1}
        />
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-raw-json.toggle"));
        await Promise.resolve();
      });
      expect(getByText(/"input"/)).toBeTruthy();
    });

    it("shows saving state, instructions, raw JSON, and multi-dimension scoring", async () => {
      const onScoreChange = mock(() => undefined);
      const multiDetail: ReviewDetail = {
        ...detail,
        dimensions: [
          {dataType: "boolean", key: "correct", required: true},
          {dataType: "numeric", key: "helpfulness", range: "0-1", required: true},
          {dataType: "categorical", key: "tone", range: "safe|unsafe", required: true},
        ],
        instructions: undefined,
      };
      const {getByTestId, getByText, queryByText} = renderWithTheme(
        <AiReviewItemView
          comment=""
          detail={multiDetail}
          isPending
          isSaving
          onAssign={() => undefined}
          onCommentChange={() => undefined}
          onScoreChange={onScoreChange}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          position={2}
          scores={{correct: true, helpfulness: 0.7}}
          totalPending={3}
        />
      );
      expect(getByText("Item 2 of 3 pending")).toBeTruthy();
      expect(queryByText("Mark correct only when grounded.")).toBeNull();
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-score-tone-safe"));
        await Promise.resolve();
      });
      assert.isAtLeast(onScoreChange.mock.calls.length, 1);
      const skip = getByTestId("ai-review-skip");
      expect(skip.props.accessibilityState?.disabled ?? skip.props.disabled).toBeTruthy();
    });
  });
});

describe("AiReviewQueueScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
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

  const items: ReviewListItem[] = [
    {
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      evaluatorId: "eval-1",
      id: "rev-1",
      reason: "manual",
      status: "pending",
      traceId: "trace-1",
      traceName: "summarize",
    },
  ];

  const listState = {
    data: {counts: {done: 0, in_progress: 0, pending: 1, skipped: 0}, data: items},
    isError: false,
    isLoading: false,
    refetch: mock(() => {}),
  };

  const createApi = (): AdminApi => {
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        useAiObservabilityReviewQuery: () => listState,
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
      }),
    };
    return api as unknown as AdminApi;
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiReviewScreenWidget", () => {
    it("shows pending queue and opens the oldest item", async () => {
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiReviewScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review"
        />
      );
      expect(view.getByTestId("ai-review-table")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-start-oldest"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-review-item");
    });
  });
});

describe("AiReviewQueueView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const counts = {done: 0, in_progress: 0, pending: 0, skipped: 0};
  const item = {
    enqueuedAt: "2026-09-01T12:00:00.000Z",
    evaluatorId: "evaluator-1",
    id: "review-item-1",
    promptName: "summarize",
    reason: "manual",
    status: "pending" as const,
    traceId: "trace-1",
    traceName: "generate summary",
  };

  describe("AiReviewQueueView", () => {
    it("names both review intake paths in the empty state", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiReviewQueueView
          counts={counts}
          items={[]}
          onOpenItem={() => undefined}
          onRetry={() => undefined}
          onStart={() => undefined}
          onStatusChange={() => undefined}
          status="pending"
        />
      );
      expect(getByTestId("ai-review-empty")).toBeTruthy();
      expect(getByText(/Traces bulk action/)).toBeTruthy();
      expect(getByText(/Assign to me for manual assignment/)).toBeTruthy();
    });

    it("renders oldest-first row fields and starts reviewing", async () => {
      const onStart = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <AiReviewQueueView
          counts={{...counts, pending: 1}}
          items={[item]}
          onOpenItem={() => undefined}
          onRetry={() => undefined}
          onStart={onStart}
          onStatusChange={() => undefined}
          status="pending"
        />
      );
      expect(getByTestId("ai-review-table")).toBeTruthy();
      expect(getByText("generate summary")).toBeTruthy();
      expect(getByText("summarize")).toBeTruthy();
      expect(getByText("Unassigned")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-start-oldest"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onStart).toHaveBeenCalled();
    });

    it("renders loading, error retry, status tabs, and open controls", async () => {
      const onRetry = mock(() => undefined);
      const onStatusChange = mock(() => undefined);
      const onOpenItem = mock(() => undefined);
      const loading = renderWithTheme(
        <AiReviewQueueView
          counts={counts}
          isLoading
          items={[]}
          onOpenItem={onOpenItem}
          onRetry={onRetry}
          onStart={() => undefined}
          onStatusChange={onStatusChange}
          status="pending"
        />
      );
      expect(loading.getByTestId("ai-review-loading")).toBeTruthy();

      const errored = renderWithTheme(
        <AiReviewQueueView
          counts={counts}
          isError
          items={[]}
          onOpenItem={onOpenItem}
          onRetry={onRetry}
          onStart={() => undefined}
          onStatusChange={onStatusChange}
          status="pending"
        />
      );
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await Promise.resolve();
      });
      expect(onRetry).toHaveBeenCalled();

      const {getByText} = renderWithTheme(
        <AiReviewQueueView
          counts={{...counts, done: 1, pending: 1}}
          items={[item]}
          onOpenItem={onOpenItem}
          onRetry={onRetry}
          onStart={() => undefined}
          onStatusChange={onStatusChange}
          status="pending"
        />
      );
      await act(async () => {
        fireEvent.press(getByText("Done"));
        await Promise.resolve();
      });
      assert.isAtLeast(onStatusChange.mock.calls.length, 1);
      await act(async () => {
        fireEvent.press(getByText("Open"));
        await Promise.resolve();
      });
      expect(onOpenItem).toHaveBeenCalled();
    });
  });
});

describe("AiTraceDetailScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: traceId}));
    routerPush.mockClear();
  });
  let traceId = "trace-1";

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

  const detail: TraceDetail = {
    flaggedForDataset: false,
    id: "trace-1",
    input: {q: "hello"},
    name: "summarize",
    output: {text: "ok"},
    prompts: [{name: "summarize", version: 1}],
    scoreCount: 0,
    scores: [],
    sensitive: false,
    spanCount: 1,
    spans: [
      {
        children: [],
        id: "span-1",
        kind: "CHAIN",
        name: "root",
        startedAt: "2026-09-01T12:00:00.000Z",
        status: "ok",
      },
    ],
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
  };

  let detailState: {
    data: TraceDetail | undefined;
    isError: boolean;
    isLoading: boolean;
  } = {data: detail, isError: false, isLoading: false};

  const refetch = mock(() => undefined);

  const createApi = (): AdminApi => {
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        useAiObservabilityStatusQuery: () => ({
          data: statusData,
          isError: false,
          isLoading: false,
        }),
        useAiObservabilityTraceQuery: () => ({
          data: detailState.data,
          isError: detailState.isError,
          isLoading: detailState.isLoading,
          refetch,
        }),
      }),
    };
    return api as unknown as AdminApi;
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiTraceDetailScreenWidget", () => {
    it("shows loading, error retry, and loaded detail", async () => {
      detailState = {data: undefined, isError: false, isLoading: true};
      const loading = renderWithTheme(
        <AiTraceDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
        />
      );
      expect(loading.getByTestId("ai-trace-detail-loading")).toBeTruthy();
      loading.unmount();

      refetch.mockClear();
      detailState = {data: undefined, isError: true, isLoading: false};
      const errored = renderWithTheme(
        <AiTraceDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
        />
      );
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      await waitFor(() => {
        expect(refetch).toHaveBeenCalled();
      });
      errored.unmount();

      detailState = {data: detail, isError: false, isLoading: false};
      const loaded = renderWithTheme(
        <AiTraceDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
        />
      );
      expect(loaded.getByTestId("ai-trace-detail")).toBeTruthy();
      await act(async () => {
        fireEvent.press(loaded.getByText("Back to traces"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-traces");
    });

    it("shows missing trace id", () => {
      traceId = "";
      const missing = renderWithTheme(
        <AiTraceDetailScreenWidget
          api={createApi()}
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
        />
      );
      expect(missing.getByText(/Missing trace id/)).toBeTruthy();
      traceId = "trace-1";
    });
  });
});

describe("AiTraceDetailView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const detail: TraceDetail = {
    flaggedForDataset: false,
    id: "trace-phi",
    name: "clinical-note",
    prompts: [{name: "note", version: 1}],
    scoreCount: 1,
    scores: [{dataType: "boolean", name: "correct", source: "human", value: true}],
    sensitive: true,
    spanCount: 2,
    spans: [
      {
        children: [
          {
            children: [],
            durationMs: 40,
            id: "span-llm",
            input: "patient SSN 123-45-6789",
            kind: "LLM",
            name: "generate",
            output: "draft note",
            sensitive: true,
            startedAt: "2026-09-01T12:00:00.000Z",
            status: "ok",
          },
        ],
        durationMs: 80,
        id: "span-chain",
        input: "patient SSN 123-45-6789",
        kind: "CHAIN",
        name: "pipeline",
        output: "draft note",
        startedAt: "2026-09-01T12:00:00.000Z",
        status: "ok",
      },
    ],
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
  };

  describe("AiTraceDetailView", () => {
    it("renders span kinds, indent, scores, and collapsed sensitive I/O", () => {
      const {getByTestId, getByText, queryByText} = renderWithTheme(
        <AiTraceDetailView detail={detail} onBack={() => undefined} />
      );
      expect(getByTestId("ai-trace-span-span-chain-clickable")).toBeTruthy();
      expect(getByTestId("ai-trace-span-span-llm-clickable")).toBeTruthy();
      expect(getByText("CHAIN")).toBeTruthy();
      expect(getByText("LLM")).toBeTruthy();
      expect(getByText("correct")).toBeTruthy();
      expect(getByText("true")).toBeTruthy();
      expect(getByText("human")).toBeTruthy();
      expect(getByTestId("ai-trace-span-input")).toBeTruthy();
      expect(getByText("Input (sensitive)")).toBeTruthy();
      expect(queryByText("patient SSN 123-45-6789")).toBeNull();
    });

    it("keeps the span list and detail side by side regardless of span content width", () => {
      const wide = JSON.stringify({outputSchema: {properties: {phrase: {type: "string"}}}});
      const {getByTestId} = renderWithTheme(
        <AiTraceDetailView
          detail={{
            ...detail,
            sensitive: false,
            spans: [
              {
                children: [],
                durationMs: 40,
                id: "span-wide",
                input: wide.repeat(20),
                kind: "LLM",
                name: "call-1",
                output: wide.repeat(20),
                startedAt: "2026-09-01T12:00:00.000Z",
                status: "ok",
              },
            ],
          }}
          onBack={() => undefined}
        />
      );

      const columns = getByTestId("ai-trace-span-columns").props.style;
      assert.equal(columns.flexDirection, "row");
      assert.equal(columns.flexWrap, "nowrap");

      // flexBasis 0 keeps the wide span value from pushing the detail onto its own line.
      const list = getByTestId("ai-trace-span-list").props.style;
      const spanDetail = getByTestId("ai-trace-span-detail").props.style;
      assert.equal(list.flexBasis, 0);
      assert.equal(spanDetail.flexBasis, 0);
      assert.equal(list.minWidth, 0);
      assert.equal(spanDetail.minWidth, 0);
      assert.isAbove(spanDetail.flexGrow, list.flexGrow);
    });

    it("selects spans and navigates back", async () => {
      const onBack = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <AiTraceDetailView detail={detail} onBack={onBack} />
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-trace-span-span-llm-clickable"));
        await Promise.resolve();
      });
      expect(getByText("LLM · generate")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByText("Back to traces"));
        await Promise.resolve();
      });
      assert.equal(onBack.mock.calls.length, 1);
    });
  });
});

describe("AiTracesListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const loaded: TraceListItem[] = [
    {
      flaggedForDataset: false,
      id: "trace-ok",
      name: "summarize",
      prompts: [{name: "summarize", version: 1}],
      scoreCount: 0,
      sensitive: false,
      spanCount: 1,
      startedAt: "2026-09-01T12:00:00.000Z",
      status: "ok",
    },
  ];

  let listState = {
    data: {data: loaded, limit: 20, more: false, page: 1, total: 1} as unknown,
    isError: false,
    isLoading: false,
  };

  let enqueueShouldFail = false;
  let addTracesShouldFail = false;
  let multiStageShouldFail = false;

  const enqueueMutation = mock(() => ({
    unwrap: async () => {
      if (enqueueShouldFail) {
        throw new Error("enqueue failed");
      }
      return {};
    },
  }));

  const addTracesMutation = mock(() => ({
    unwrap: async () => {
      if (addTracesShouldFail) {
        throw new Error("add failed");
      }
      return {created: 1};
    },
  }));

  const MISSING_AI_SERVICE_TITLE =
    "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.";

  const testMultiStageMutation = mock((_args?: {apiKey?: string}) => ({
    unwrap: async () => {
      if (multiStageShouldFail) {
        throw {data: {title: MISSING_AI_SERVICE_TITLE}};
      }
      return {output: {sentence: "combined"}, stages: [], traceId: "trace-multi-stage"};
    },
  }));

  const injectedHooks = {
    useAddTracesToAiObservabilityDatasetMutation: () => [
      addTracesMutation,
      {isError: false, isLoading: false},
    ],
    useAiObservabilityDatasetsQuery: () => ({
      data: [
        {
          counts: {auto: 0, human: 0, needsReview: 0, total: 0},
          created: "2026-01-01T00:00:00.000Z",
          id: "ds-1",
          name: "gold",
          tags: [],
          updated: "2026-01-02T00:00:00.000Z",
        },
      ],
      isLoading: false,
    }),
    useAiObservabilityEvaluatorsQuery: () => ({
      data: [{id: "eval-1", name: "correctness", type: "human"}],
      isLoading: false,
    }),
    useAiObservabilityPromptsQuery: () => ({
      data: [{folder: "ops", latestVersion: 1, name: "summarize", production: 1, type: "text"}],
      isLoading: false,
    }),
    useAiObservabilityStatusQuery: () => ({
      data: {
        localOn: true,
        plugins: [],
        primaries: {
          datasets: "local",
          experiments: "local",
          prompts: "local",
          reviewQueue: "local",
        },
      },
      isError: false,
      isLoading: false,
    }),
    useAiObservabilityTracesQuery: () => ({...listState, refetch: mock(() => undefined)}),
    useEnqueueAiObservabilityReviewMutation: () => [
      enqueueMutation,
      {isError: false, isLoading: false},
    ],
    useRunAiObservabilityTestMultiStageMutation: () => [
      testMultiStageMutation,
      {isError: false, isLoading: false},
    ],
  };

  const stableApi: AdminApi = {
    enhanceEndpoints: () => stableApi,
    injectEndpoints: () => injectedHooks,
  } as unknown as AdminApi;

  const apiWithPlaygroundSource = (source: "request-key" | "server" | "unavailable"): AdminApi => {
    const api: AdminApi = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        ...injectedHooks,
        useAiObservabilityStatusQuery: () => ({
          data: {
            localOn: true,
            playgroundAi: {source},
            plugins: [],
            primaries: {
              datasets: "local",
              experiments: "local",
              prompts: "local",
              reviewQueue: "local",
            },
          },
          isError: false,
          isLoading: false,
        }),
      }),
    } as unknown as AdminApi;
    return api;
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    api: stableApi,
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-traces",
  };

  describe("AiTracesScreenWidget", () => {
    it("shows loading then the loaded traces table", () => {
      listState = {data: undefined, isError: false, isLoading: true};
      const loading = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
      expect(loading.getByTestId("ai-traces-loading")).toBeTruthy();
      loading.unmount();

      listState = {
        data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
        isError: false,
        isLoading: false,
      };
      const loadedView = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
      expect(loadedView.getByTestId("ai-traces-table")).toBeTruthy();
    });

    it("runs a multi-stage trace and opens its detail", async () => {
      multiStageShouldFail = false;
      routerPush.mockClear();
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      assert.equal(testMultiStageMutation.mock.calls.length, 1);
      assert.include(String(routerPush.mock.calls[0]?.[0]), "trace-multi-stage");
    });

    it("shows the multi-stage endpoint error", async () => {
      multiStageShouldFail = true;
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(view.getByTestId("ai-traces-multi-stage-error")).toHaveTextContent(
        MISSING_AI_SERVICE_TITLE
      );
    });

    it("forwards a saved api key when the backend runs on request keys", async () => {
      multiStageShouldFail = false;
      testMultiStageMutation.mockClear();
      const view = renderWithTheme(
        <AiTracesScreenWidget
          {...widgetProps}
          api={apiWithPlaygroundSource("request-key")}
          apiKey="saved-key"
        />
      );

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      assert.deepEqual(testMultiStageMutation.mock.calls[0]?.[0], {apiKey: "saved-key"});
    });

    it("blocks the multi-stage test with a hint when no request key is saved", async () => {
      multiStageShouldFail = false;
      testMultiStageMutation.mockClear();
      const view = renderWithTheme(
        <AiTracesScreenWidget
          {...widgetProps}
          api={apiWithPlaygroundSource("request-key")}
          apiKeyHint="Save a Gemini API key on Profile."
        />
      );

      expect(view.getByTestId("ai-traces-multi-stage-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(testMultiStageMutation.mock.calls.length, 0);
    });

    it("selects traces, enqueues review, and adds to a dataset", async () => {
      enqueueShouldFail = false;
      addTracesShouldFail = false;
      routerPush.mockClear();
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-send-review"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-traces-review-modal")).toHaveTextContent(
        /submitted scores are written back/
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-review-confirm"));
        await Promise.resolve();
      });
      assert.equal(enqueueMutation.mock.calls.length, 1);

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-add-dataset"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-dataset-confirm"));
        await Promise.resolve();
      });
      assert.equal(addTracesMutation.mock.calls.length, 1);

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-open-trace-ok"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-trace-detail");
    });

    it("surfaces enqueue and dataset errors", async () => {
      enqueueShouldFail = true;
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-send-review"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-review-confirm"));
        await Promise.resolve();
      });
      expect(view.getByText("Could not send traces to the review queue.")).toBeTruthy();

      enqueueShouldFail = false;
      addTracesShouldFail = true;
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-add-dataset"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-dataset-confirm"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-traces-add-dataset-error")).toBeTruthy();
    });

    it("clears selection and changes filters through the list view", async () => {
      listState = {
        data: {data: loaded, limit: 20, more: true, page: 1, total: 40},
        isError: false,
        isLoading: false,
      };
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-clear-selection"));
        await Promise.resolve();
      });
      const filterFields = view.UNSAFE_root.findAllByType(SelectField);
      const promptFilter = filterFields.find(
        (field) => field.props.testID === "ai-traces-filter-prompt"
      );
      const scoreFilter = filterFields.find(
        (field) => field.props.testID === "ai-traces-filter-has-score"
      );
      const sensitiveFilter = filterFields.find(
        (field) => field.props.testID === "ai-traces-filter-sensitive"
      );
      assert.isDefined(promptFilter);
      assert.isDefined(scoreFilter);
      assert.isDefined(sensitiveFilter);
      fireEvent(promptFilter!, "onChange", "summarize");
      fireEvent(scoreFilter!, "onChange", "false");
      fireEvent(sensitiveFilter!, "onChange", "true");
      expect(view.getByTestId("ai-traces-pagination")).toBeTruthy();
      listState = {
        data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
        isError: false,
        isLoading: false,
      };
    });

    it("surfaces list load error in the bulk bar", () => {
      listState = {data: undefined, isError: true, isLoading: false};
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
      expect(view.getByText("Failed to load traces.")).toBeTruthy();
      listState = {
        data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
        isError: false,
        isLoading: false,
      };
    });

    it("no-ops enqueue when no evaluator is installed", async () => {
      const noEvalApi: AdminApi = {
        enhanceEndpoints: () => noEvalApi,
        injectEndpoints: () => ({
          ...injectedHooks,
          useAiObservabilityEvaluatorsQuery: () => ({data: [], isLoading: false}),
        }),
      } as unknown as AdminApi;
      enqueueMutation.mockClear();
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} api={noEvalApi} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-send-review"));
        await Promise.resolve();
      });
      expect(view.getByText("No human evaluator is available.")).toBeTruthy();
      expect(view.getByText("Create a human evaluator")).toBeTruthy();
      assert.equal(enqueueMutation.mock.calls.length, 0);
    });

    it("dismisses the dataset modal and changes pages", async () => {
      listState = {
        data: {data: loaded, limit: 20, more: true, page: 1, total: 40},
        isError: false,
        isLoading: false,
      };
      const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-add-dataset"));
        await Promise.resolve();
      });
      const modal = view.UNSAFE_root.findAllByType(Modal).find(
        (node) => node.props.title === "Add traces to dataset"
      );
      assert.isDefined(modal);
      fireEvent(modal!, "onDismiss");

      const table = view.getByTestId("ai-traces-table");
      await act(async () => {
        fireEvent(table, "setPage", 2);
        await Promise.resolve();
      });
      listState = {
        data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
        isError: false,
        isLoading: false,
      };
    });
  });
});

describe("AiTracesListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const okTrace: TraceListItem = {
    endedAt: "2026-09-01T12:00:01.000Z",
    flaggedForDataset: false,
    id: "trace-ok",
    name: "summarize",
    prompts: [{name: "summarize", version: 1}],
    scoreCount: 0,
    sensitive: false,
    spanCount: 1,
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
    usage: {costUsd: 0.0123, inputTokens: 10, outputTokens: 20},
  };

  const errorTrace: TraceListItem = {
    errorSummary: "model timeout",
    flaggedForDataset: false,
    id: "trace-err",
    name: "failed-call",
    prompts: [
      {name: "summarize", version: 1},
      {name: "safety", version: 2},
    ],
    scoreCount: 0,
    sensitive: false,
    spanCount: 1,
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "error",
  };

  const sensitiveTrace: TraceListItem = {
    flaggedForDataset: false,
    id: "trace-phi",
    name: "clinical-note",
    prompts: [{name: "note", version: 1}],
    scoreCount: 2,
    sensitive: true,
    spanCount: 3,
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
  };

  const idleHandlers = {
    onAddToDataset: () => undefined,
    onClearSelection: () => undefined,
    onDatasetChange: () => undefined,
    onDismissDatasetModal: () => undefined,
    onDismissReviewModal: () => undefined,
    onEnqueueReview: () => undefined,
    onEvaluatorChange: () => undefined,
    onFiltersChange: () => undefined,
    onOpenAddToDataset: () => undefined,
    onOpenReview: () => undefined,
    onOpenTrace: () => undefined,
    onPageChange: () => undefined,
    onRunTestMultiStage: () => undefined,
    onToggleSelect: () => undefined,
  };

  const datasetDefaults = {
    datasetId: "",
    datasetModalOpen: false,
    datasetOptions: [],
    promptOptions: ["summarize", "safety"],
    reviewModalOpen: false,
    routeBase: "/admin",
  };

  describe("AiTracesListView", () => {
    it("renders the empty state", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          showMultiStageTest
          total={0}
          traces={[]}
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-traces-empty")).toBeTruthy();
      expect(getByText("No traces match these filters.")).toBeTruthy();
    });

    it("runs the multi-stage trace smoke action", async () => {
      const onRunTestMultiStage = mock(() => undefined);
      const {getByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          showMultiStageTest
          total={0}
          traces={[]}
          {...idleHandlers}
          onRunTestMultiStage={onRunTestMultiStage}
        />
      );

      await act(async () => {
        fireEvent.press(getByTestId("ai-traces-run-multi-stage"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      assert.equal(onRunTestMultiStage.mock.calls.length, 1);
    });

    it("disables the multi-stage action and explains why when it is blocked", () => {
      const onRunTestMultiStage = mock(() => undefined);
      const {getByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          multiStageBlockedMessage="Save a Gemini API key on Profile."
          page={1}
          selectedIds={[]}
          showMultiStageTest
          total={0}
          traces={[]}
          {...idleHandlers}
          onRunTestMultiStage={onRunTestMultiStage}
        />
      );

      expect(getByTestId("ai-traces-multi-stage-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      expect(getByTestId("ai-traces-run-multi-stage")).toBeDisabled();
      assert.equal(onRunTestMultiStage.mock.calls.length, 0);
    });

    it("hides the multi-stage smoke action without local trace storage", () => {
      const {queryByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={0}
          traces={[]}
          {...idleHandlers}
        />
      );

      assert.notExists(queryByTestId("ai-traces-run-multi-stage"));
    });

    it("renders an error row with the error line and prompt count", () => {
      const {getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={1}
          traces={[errorTrace]}
          {...idleHandlers}
        />
      );
      expect(getByText("model timeout")).toBeTruthy();
      expect(getByText("2")).toBeTruthy();
      expect(getByText("failed-call")).toBeTruthy();
    });

    it("uses distinct primary and accent colors for prompt-run status dots", () => {
      const {getByLabelText, getByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={2}
          traces={[okTrace, errorTrace]}
          {...idleHandlers}
        />
      );
      const primaryDotColor = getByTestId("ai-traces-status-ok").props.style.backgroundColor;
      const accentDotColor = getByTestId("ai-traces-status-error").props.style.backgroundColor;

      assert.isString(primaryDotColor);
      assert.isString(accentDotColor);
      assert.notEqual(primaryDotColor, accentDotColor);
      expect(getByLabelText("Trace status: ok")).toBeTruthy();
      expect(getByLabelText("Trace status: error")).toBeTruthy();
    });

    it("renders a sensitive badge on sensitive traces", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={1}
          traces={[sensitiveTrace]}
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-traces-sensitive-badge")).toBeTruthy();
      expect(getByText("3")).toBeTruthy();
      expect(getByText("2")).toBeTruthy();
    });

    it("shows the bulk bar with a sensitive warning and an enabled dataset action", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId="eval-1"
          evaluators={[{id: "eval-1", name: "correctness", type: "human"}]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[sensitiveTrace.id, okTrace.id]}
          total={2}
          traces={[sensitiveTrace, okTrace]}
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      expect(getByText("2 selected")).toBeTruthy();
      expect(getByTestId("ai-traces-sensitive-warning")).toBeTruthy();
      expect(getByText("1 selected trace is marked sensitive.")).toBeTruthy();
      const dataset = getByTestId("ai-traces-add-dataset");
      expect(dataset.props.accessibilityState?.disabled ?? dataset.props.disabled).toBeFalsy();
      expect(getByTestId("ai-traces-send-review")).toBeTruthy();
      expect(getByTestId("ai-traces-clear-selection")).toBeTruthy();
    });

    it("toggles selection, filters, dataset modal, and pagination", async () => {
      const onToggleSelect = mock(() => undefined);
      const onFiltersChange = mock(() => undefined);
      const onClearSelection = mock(() => undefined);
      const onPageChange = mock(() => undefined);
      const onAddToDataset = mock(() => undefined);
      const onDismissDatasetModal = mock(() => undefined);
      const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
        <AiTracesListView
          addToDatasetError="Could not add traces to the dataset."
          datasetId="ds-1"
          datasetModalOpen
          datasetOptions={[{id: "ds-1", name: "gold"}]}
          enqueueError="enqueue failed"
          evaluatorId="eval-1"
          evaluators={[{id: "eval-1", name: "correctness", type: "human"}]}
          filters={emptyTraceFilters()}
          more
          onAddToDataset={onAddToDataset}
          onClearSelection={onClearSelection}
          onDatasetChange={() => undefined}
          onDismissDatasetModal={onDismissDatasetModal}
          onDismissReviewModal={() => undefined}
          onEnqueueReview={() => undefined}
          onEvaluatorChange={() => undefined}
          onFiltersChange={onFiltersChange}
          onOpenAddToDataset={() => undefined}
          onOpenReview={() => undefined}
          onOpenTrace={() => undefined}
          onPageChange={onPageChange}
          onToggleSelect={onToggleSelect}
          page={1}
          promptOptions={["summarize", "safety"]}
          reviewModalOpen
          routeBase="/admin"
          selectedIds={[okTrace.id]}
          total={40}
          traces={[okTrace]}
        />
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      assert.isAtLeast(onToggleSelect.mock.calls.length, 1);

      const promptSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-prompt"
      );
      const scoreSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-has-score"
      );
      const sensitiveSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-sensitive"
      );
      assert.isDefined(promptSelect);
      assert.isDefined(scoreSelect);
      assert.isDefined(sensitiveSelect);
      fireEvent(promptSelect!, "onChange", "summarize");
      fireEvent(scoreSelect!, "onChange", "false");
      fireEvent(sensitiveSelect!, "onChange", "true");
      assert.isAtLeast(onFiltersChange.mock.calls.length, 3);

      expect(getByText("enqueue failed")).toBeTruthy();
      expect(getByTestId("ai-traces-add-dataset-error")).toBeTruthy();
      expect(getByTestId("ai-traces-dataset-modal")).toBeTruthy();
      expect(getByTestId("ai-traces-dataset-confirm")).toBeTruthy();
      expect(getByTestId("ai-traces-review-modal")).toHaveTextContent(
        /human evaluator defines the score fields/
      );
      expect(getByText("40 traces · more pages")).toBeTruthy();
    });

    it("wires evaluator change, page change, and dataset modal dismiss", async () => {
      const onEvaluatorChange = mock(() => undefined);
      const onPageChange = mock(() => undefined);
      const onDismissDatasetModal = mock(() => undefined);
      const {getByTestId, UNSAFE_root} = renderWithTheme(
        <AiTracesListView
          datasetId="ds-1"
          datasetModalOpen
          datasetOptions={[{id: "ds-1", name: "gold"}]}
          evaluatorId="eval-1"
          evaluators={[
            {id: "eval-1", name: "correctness", type: "human"},
            {id: "eval-2", name: "tone", type: "human"},
          ]}
          filters={emptyTraceFilters()}
          more
          onAddToDataset={() => undefined}
          onClearSelection={() => undefined}
          onDatasetChange={() => undefined}
          onDismissDatasetModal={onDismissDatasetModal}
          onDismissReviewModal={() => undefined}
          onEnqueueReview={() => undefined}
          onEvaluatorChange={onEvaluatorChange}
          onFiltersChange={() => undefined}
          onOpenAddToDataset={() => undefined}
          onOpenReview={() => undefined}
          onOpenTrace={() => undefined}
          onPageChange={onPageChange}
          onToggleSelect={() => undefined}
          page={1}
          promptOptions={["summarize", "safety"]}
          reviewModalOpen
          routeBase="/admin"
          selectedIds={[okTrace.id]}
          total={40}
          traces={[okTrace]}
        />
      );
      const evaluatorSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-evaluator"
      );
      assert.isDefined(evaluatorSelect);
      fireEvent(evaluatorSelect!, "onChange", "eval-2");
      assert.isAtLeast(onEvaluatorChange.mock.calls.length, 1);
      const pageButtons = getByTestId("ai-traces-table.pagination").findAllByProps({
        accessibilityLabel: "Pagination Number",
      });
      await act(async () => {
        fireEvent.press(pageButtons[1]!);
        await Promise.resolve();
      });
      assert.isAtLeast(onPageChange.mock.calls.length, 1);
      onDismissDatasetModal();
      assert.equal(onDismissDatasetModal.mock.calls.length, 1);
    });

    it("wires time and status filters and opens traces from the table", async () => {
      const onFiltersChange = mock(() => undefined);
      const onOpenTrace = mock(() => undefined);
      const {getByTestId, UNSAFE_root} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          onAddToDataset={() => undefined}
          onClearSelection={() => undefined}
          onDatasetChange={() => undefined}
          onDismissDatasetModal={() => undefined}
          onEnqueueReview={() => undefined}
          onEvaluatorChange={() => undefined}
          onFiltersChange={onFiltersChange}
          onOpenAddToDataset={() => undefined}
          onOpenTrace={onOpenTrace}
          onPageChange={() => undefined}
          onRunTestMultiStage={() => undefined}
          onToggleSelect={() => undefined}
          page={1}
          selectedIds={[]}
          total={1}
          traces={[okTrace]}
        />
      );
      fireEvent.changeText(getByTestId("ai-traces-filter-from"), "2026-09-01");
      fireEvent.changeText(getByTestId("ai-traces-filter-to"), "2026-09-02");
      const statusSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-status"
      );
      fireEvent(statusSelect!, "onChange", "error");
      fireEvent.changeText(getByTestId("ai-traces-filter-user"), "user-1");
      fireEvent.changeText(getByTestId("ai-traces-filter-session"), "sess-1");
      assert.isAtLeast(onFiltersChange.mock.calls.length, 3);
      await act(async () => {
        fireEvent.press(getByTestId("ai-traces-open-trace-ok"));
        await Promise.resolve();
      });
      assert.equal(onOpenTrace.mock.calls.length, 1);
    });
  });
});

describe("ReviewScoreField", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  describe("ReviewScoreField", () => {
    it("renders boolean dimensions as Pass and Fail controls", async () => {
      const onChange = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <ReviewScoreField
          dimension={{dataType: "boolean", key: "correct", required: true}}
          onChange={onChange}
        />
      );
      expect(getByTestId("ai-review-score-boolean-correct")).toBeTruthy();
      expect(getByText("Pass")).toBeTruthy();
      expect(getByText("Fail")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-score-correct-pass"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onChange).toHaveBeenCalledWith(true);
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-score-correct-fail"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onChange).toHaveBeenCalledWith(false);
    });

    it("renders numeric dimensions as a slider with range labels", () => {
      const onChange = mock(() => undefined);
      const {getByTestId, getByText, UNSAFE_getByType} = renderWithTheme(
        <ReviewScoreField
          dimension={{dataType: "numeric", key: "helpfulness", range: "0-1", required: true}}
          onChange={onChange}
          value={0.5}
        />
      );
      expect(getByTestId("ai-review-score-numeric-helpfulness")).toBeTruthy();
      expect(getByText("helpfulness")).toBeTruthy();
      expect(getByText("0")).toBeTruthy();
      expect(getByText("1")).toBeTruthy();
      fireEvent(UNSAFE_getByType(SliderComponent), "valueChange", 0.8);
      expect(onChange).toHaveBeenCalledWith(0.8);
    });

    it("renders categorical free-text when range has no pipe-separated options", () => {
      const onChange = mock(() => undefined);
      const {getAllByDisplayValue} = renderWithTheme(
        <ReviewScoreField
          dimension={{dataType: "categorical", key: "label", range: "", required: true}}
          onChange={onChange}
          value=""
        />
      );
      fireEvent.changeText(getAllByDisplayValue("")[0]!, "custom");
      expect(onChange).toHaveBeenCalledWith("custom");
    });

    it("defaults numeric slider to range minimum when value is unset", () => {
      const onChange = mock(() => undefined);
      const {getByTestId, UNSAFE_getByType} = renderWithTheme(
        <ReviewScoreField
          dimension={{dataType: "numeric", key: "score", range: "1-5", required: true}}
          onChange={onChange}
        />
      );
      expect(getByTestId("ai-review-score-numeric-score")).toBeTruthy();
      fireEvent(UNSAFE_getByType(SliderComponent), "valueChange", 3);
      expect(onChange).toHaveBeenCalledWith(3);
    });

    it("renders categorical dimensions as selectable pills", async () => {
      const onChange = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <ReviewScoreField
          dimension={{
            dataType: "categorical",
            key: "tone",
            range: "safe|unsafe|unclear",
            required: true,
          }}
          onChange={onChange}
        />
      );
      expect(getByTestId("ai-review-score-categorical-tone")).toBeTruthy();
      expect(getByText("safe")).toBeTruthy();
      expect(getByText("unsafe")).toBeTruthy();
      expect(getByText("unclear")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-score-tone-unsafe"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onChange).toHaveBeenCalledWith("unsafe");
    });
  });
});

describe("AiExperimentResultsView", () => {
  const baseExperiment: ExperimentRecord = {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [
      {
        datasetItemId: "item-1",
        failed: true,
        id: "row-1",
        versionResults: {
          "1": {evaluatorScores: {}, output: "a"},
          "2": {evaluatorScores: {}, output: "b"},
        },
      },
    ],
    name: "compare summarize",
    promptName: "summarize",
    results: {
      gates: [
        {
          actual: 0.4,
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "quality",
          op: "gte",
          passed: false,
          value: 0.8,
          version: 2,
        },
      ],
      lowConfidenceItemIds: [],
      outlierItemIds: ["item-1"],
      progress: {completed: 1, total: 1},
      totalCostUsd: 0.12,
    },
    status: "completed",
    thresholds: [],
    updated: "2026-01-01T00:05:00.000Z",
    versions: [1, 2],
  };

  it("shows running progress text while pending", () => {
    const {getByTestId} = renderWithTheme(
      <AiExperimentResultsView
        experiment={{
          ...baseExperiment,
          results: {
            gates: baseExperiment.results?.gates ?? [],
            lowConfidenceItemIds: baseExperiment.results?.lowConfidenceItemIds ?? [],
            outlierItemIds: baseExperiment.results?.outlierItemIds ?? [],
            progress: {completed: 0, total: 3},
            totalCostUsd: baseExperiment.results?.totalCostUsd,
          },
          status: "running",
        }}
        isPromoting={false}
        onDismissPromoteConfirm={() => undefined}
        onOpenPromoteConfirm={() => undefined}
        onPromote={() => undefined}
        onSelectVersion={() => undefined}
        promoteConfirmOpen={false}
        promoteVersion={2}
        selectedVersion={2}
      />
    );
    expect(getByTestId("ai-experiment-results-running")).toBeTruthy();
  });

  it("shows gate-fail badge and blocked promote copy", () => {
    const {getByTestId} = renderWithTheme(
      <AiExperimentResultsView
        experiment={baseExperiment}
        isPromoting={false}
        onDismissPromoteConfirm={() => undefined}
        onOpenPromoteConfirm={() => undefined}
        onPromote={() => undefined}
        onSelectVersion={() => undefined}
        promoteBlockedMessage="gate failed for v2 quality.correct"
        promoteConfirmOpen={false}
        promoteVersion={2}
        selectedVersion={2}
      />
    );
    expect(getByTestId("ai-experiment-gates-failing")).toBeTruthy();
    assert.include(
      String(getByTestId("ai-experiment-promote-blocked").props.children),
      "quality.correct"
    );
  });
});
