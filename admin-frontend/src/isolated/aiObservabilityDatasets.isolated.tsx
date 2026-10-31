import {beforeEach, describe, expect, it, mock} from "bun:test";
import {Modal} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiDatasetDetailScreenWidget as AiDatasetDetailScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetDetailScreen";
import {AiDatasetsScreenWidget as AiDatasetsScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetsListScreen";
import {AiDatasetsListView} from "../widgets/aiObservability/datasets/AiDatasetsListView";
import type {
  DatasetItemRecord,
  DatasetRecord,
} from "../widgets/aiObservability/datasets/datasetTypes";
import {AiEvaluatorDetailScreenWidget as AiEvaluatorDetailScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorDetailScreen";
import {AiEvaluatorNewScreenWidget as AiEvaluatorNewScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorNewScreen";
import {AiEvaluatorsScreenWidget as AiEvaluatorsScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorsListScreen";
import {AiExperimentNewScreenWidget as AiExperimentNewScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentNewScreen";
import {AiExperimentResultsScreenWidget as AiExperimentResultsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentResultsScreen";
import {AiExperimentsScreenWidget as AiExperimentsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";
import {AiPromptEditorScreenWidget as AiPromptEditorScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import {AiPromptsScreenWidget as AiPromptsScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptsListScreen";
import {AiReviewItemScreenWidget as AiReviewItemScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewItemScreen";
import {AiReviewScreenWidget as AiReviewScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewQueueScreen";
import {AiObservabilityChrome as AiObservabilityChromeBase} from "../widgets/aiObservability/shell/AiObservabilityChrome";
import {AiObservabilityStatusChip as AiObservabilityStatusChipBase} from "../widgets/aiObservability/shell/AiObservabilityStatusChip";
import {AiTraceDetailScreenWidget as AiTraceDetailScreenWidgetBase} from "../widgets/aiObservability/traces/AiTraceDetailScreen";
import {AiTracesScreenWidget as AiTracesScreenWidgetBase} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {
  createObservabilityServer,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const AiDatasetDetailScreenWidget = withObservabilityServer(AiDatasetDetailScreenWidgetBase);
const AiDatasetsScreenWidget = withObservabilityServer(AiDatasetsScreenWidgetBase);
const _AiEvaluatorDetailScreenWidget = withObservabilityServer(AiEvaluatorDetailScreenWidgetBase);
const _AiEvaluatorNewScreenWidget = withObservabilityServer(AiEvaluatorNewScreenWidgetBase);
const _AiEvaluatorsScreenWidget = withObservabilityServer(AiEvaluatorsScreenWidgetBase);
const _AiExperimentNewScreenWidget = withObservabilityServer(AiExperimentNewScreenWidgetBase);
const _AiExperimentResultsScreenWidget = withObservabilityServer(
  AiExperimentResultsScreenWidgetBase
);
const _AiExperimentsScreenWidget = withObservabilityServer(AiExperimentsScreenWidgetBase);
const _AiPromptEditorScreenWidget = withObservabilityServer(AiPromptEditorScreenWidgetBase);
const _AiPromptsScreenWidget = withObservabilityServer(AiPromptsScreenWidgetBase);
const _AiReviewItemScreenWidget = withObservabilityServer(AiReviewItemScreenWidgetBase);
const _AiReviewScreenWidget = withObservabilityServer(AiReviewScreenWidgetBase);
const _AiTraceDetailScreenWidget = withObservabilityServer(AiTraceDetailScreenWidgetBase);
const _AiTracesScreenWidget = withObservabilityServer(AiTracesScreenWidgetBase);
const _AiObservabilityChrome = withObservabilityServer(AiObservabilityChromeBase);
const _AiObservabilityStatusChip = withObservabilityServer(AiObservabilityStatusChipBase);

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
    permissions: {
      aiDataset: {create: true, list: true, read: true, update: true},
      aiExperiment: {create: true, list: true, read: true},
    },
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
  };

  const DETAIL_ROUTE = "GET /ai/observability/datasets/:id";
  const ITEMS_ROUTE = "GET /ai/observability/datasets/:id/items";
  const CREATE_ITEM_ROUTE = "POST /ai/observability/datasets/:id/items";

  const createServer = (createImpl?: () => Promise<unknown>): FakeObservabilityServer => {
    return createObservabilityServer({
      [CREATE_ITEM_ROUTE]: createImpl ?? (async () => ({})),
      [DETAIL_ROUTE]: detailState,
      [ITEMS_ROUTE]: itemsState,
      "GET /ai/observability/status": {data: statusData},
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiDatasetDetailScreenWidget", () => {
    it("shows loading then dataset detail with tabs", async () => {
      detailState.isLoading = true;
      const loading = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-dataset-detail-loading")).toBeTruthy();
      loading.unmount();

      detailState.isLoading = false;
      detailState.data = dataset;
      itemsState.data = items;
      const server = createServer();
      const loaded = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={server}
        />
      );
      await flushObservabilityRequests();
      expect(loaded.getByTestId("ai-dataset-tabs")).toBeTruthy();
      assert.deepEqual(server.callsTo(DETAIL_ROUTE)[0]?.params, {id: "ds-1"});
    });

    it("opens experiment and trace routes from the detail view", async () => {
      detailState.data = dataset;
      itemsState.data = items;
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
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
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={createServer(async () => {
            throw {data: {title: "Invalid item"}};
          })}
        />
      );
      await flushObservabilityRequests();
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

      const successServer = createServer(async () => ({}));
      const success = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={successServer}
        />
      );
      await flushObservabilityRequests();
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
      await flushObservabilityRequests();
      const [created] = successServer.callsTo(CREATE_ITEM_ROUTE);
      assert.deepInclude(created?.body as Record<string, unknown>, {
        expectedOutput: {a: "ok"},
        input: {q: "hi"},
      });
      // A successful add reloads the item list.
      assert.equal(successServer.callsTo(ITEMS_ROUTE).length, 2);
    });

    it("distinguishes item loading and load errors from an empty dataset", async () => {
      detailState.data = dataset;
      detailState.isError = false;
      itemsState.isLoading = true;
      const loading = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-dataset-items-loading")).toBeTruthy();
      loading.unmount();

      itemsState.isLoading = false;
      itemsState.isError = true;
      const server = createServer();
      const errored = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={server}
        />
      );
      await flushObservabilityRequests();
      expect(errored.getByTestId("ai-dataset-items-error")).toBeTruthy();
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      assert.equal(server.callsTo(ITEMS_ROUTE).length, 2);
      itemsState.isError = false;
    });

    it("shows missing dataset id and load error with retry", async () => {
      datasetId = "";
      const missing = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(missing.getByText(/Missing dataset id/)).toBeTruthy();
      missing.unmount();
      datasetId = "ds-1";

      const errorServer = createObservabilityServer({
        [CREATE_ITEM_ROUTE]: async () => ({}),
        [DETAIL_ROUTE]: {isError: true},
        [ITEMS_ROUTE]: itemsState,
        "GET /ai/observability/status": {data: statusData},
      });
      const errored = renderWithTheme(
        <AiDatasetDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-dataset-detail"
          server={errorServer}
        />
      );
      await flushObservabilityRequests();
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
    permissions: {
      aiDataset: {create: true, list: true, read: true, update: true},
    },
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
  }

  const listState: ListState = {
    isError: false,
    isLoading: false,
  };

  const LIST_ROUTE = "GET /ai/observability/datasets";
  const CREATE_ROUTE = "POST /ai/observability/datasets";
  const IMPORT_ROUTE = "POST /ai/observability/datasets/:id/import";

  const createServer = (overrides?: {
    createImpl?: () => Promise<unknown>;
    importImpl?: () => Promise<unknown>;
  }): FakeObservabilityServer => {
    return createObservabilityServer({
      [CREATE_ROUTE]: overrides?.createImpl ?? (async () => ({id: "ds-new", name: "new"})),
      [IMPORT_ROUTE]:
        overrides?.importImpl ??
        (async () => ({
          created: 2,
          errors: [],
        })),
      [LIST_ROUTE]: listState,
      "GET /ai/observability/status": {data: statusData},
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-datasets",
  };

  describe("AiDatasetsScreenWidget", () => {
    it("shows loading then the loaded datasets table", async () => {
      listState.isLoading = true;
      listState.data = undefined;
      const loading = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-datasets-loading")).toBeTruthy();
      loading.unmount();

      listState.isLoading = false;
      listState.data = datasets;
      const loaded = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
      expect(loaded.getByTestId("ai-datasets-table")).toBeTruthy();
    });

    it("hides import when the caller cannot update datasets", async () => {
      listState.isLoading = false;
      listState.data = datasets;
      statusData.permissions = {aiDataset: {list: true, read: true}};
      const view = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
      expect(view.queryByTestId("ai-datasets-import-ds-1")).toBeNull();
      statusData.permissions = {
        aiDataset: {create: true, list: true, read: true, update: true},
      };
    });

    it("validates create name and navigates on success", async () => {
      listState.data = datasets;
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(<AiDatasetsScreenWidget server={server} {...widgetProps} />);
      await flushObservabilityRequests();
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
      await flushObservabilityRequests();
      assert.equal(routerPush.mock.calls.length, 1);
      assert.equal(
        (server.callsTo(CREATE_ROUTE)[0]?.body as {name?: string} | undefined)?.name,
        "new-set"
      );
    });

    it("imports pasted json and surfaces API errors", async () => {
      listState.data = datasets;
      const failing = renderWithTheme(
        <AiDatasetsScreenWidget
          server={createServer({
            importImpl: async () => {
              throw {data: {title: "Import failed on row 1"}};
            },
          })}
          {...widgetProps}
        />
      );
      await flushObservabilityRequests();
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
      await flushObservabilityRequests();
      expect(failing.getByTestId("ai-datasets-import-error")).toBeTruthy();
      expect(failing.getByText("Import failed on row 1")).toBeTruthy();

      const success = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
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
      await flushObservabilityRequests();
      expect(success.getByTestId("ai-datasets-import-result")).toBeTruthy();
    });

    it("opens dataset detail, retries load errors, and handles create API failures", async () => {
      listState.data = datasets;
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-datasets-open-ds-1"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-dataset-detail");

      listState.isError = true;
      listState.data = undefined;
      const erroredServer = createServer();
      const errored = renderWithTheme(
        <AiDatasetsScreenWidget server={erroredServer} {...widgetProps} />
      );
      await flushObservabilityRequests();
      expect(errored.getByTestId("ai-datasets-load-error")).toBeTruthy();
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.isAtLeast(erroredServer.callsTo(LIST_ROUTE).length, 2);

      listState.isError = false;
      listState.data = datasets;
      const createFail = renderWithTheme(
        <AiDatasetsScreenWidget
          server={createServer({
            createImpl: async () => {
              throw new Error("fail");
            },
          })}
          {...widgetProps}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(createFail.getByTestId("ai-datasets-create"));
        await Promise.resolve();
      });
      fireEvent.changeText(createFail.getAllByDisplayValue("")[0]!, "broken");
      await act(async () => {
        fireEvent.press(createFail.getByText("Create dataset"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      expect(createFail.getByText("Could not create dataset.")).toBeTruthy();
    });

    it("imports csv paste and validates empty import", async () => {
      listState.data = datasets;
      const view = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
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
      await flushObservabilityRequests();
      expect(view.getByTestId("ai-datasets-import-result")).toBeTruthy();
    });

    it("handles file pick import and generic import failures", async () => {
      listState.data = datasets;
      const server = createServer();
      // The picked file is read with `fetch(uri)`; API requests still reach the fake server.
      const originalFetch = globalThis.fetch;
      const readFile = mock(async () => ({
        text: async () => 'input,expectedOutput\n"{""q"":""hi""}","{""a"":""ok""}"',
      }));
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("file:")) {
          return readFile();
        }
        return originalFetch(input, init);
      }) as unknown as typeof fetch;
      const view = renderWithTheme(<AiDatasetsScreenWidget server={server} {...widgetProps} />);
      await flushObservabilityRequests();
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
      await flushObservabilityRequests();
      expect(view.getByTestId("ai-datasets-import-result")).toBeTruthy();
      globalThis.fetch = originalFetch;
      assert.equal(readFile.mock.calls.length, 1);
      const [imported] = server.callsTo(IMPORT_ROUTE);
      assert.equal(imported?.params.id, "ds-1");
      assert.equal((imported?.body as {format?: string} | undefined)?.format, "csv");

      // A transport failure (no API error body) falls back to the generic message.
      const failingServer = createServer();
      const serverFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(failingServer.origin) && url.endsWith("/import")) {
          return Promise.reject(new TypeError("network"));
        }
        return serverFetch(input, init);
      }) as unknown as typeof fetch;
      const failing = renderWithTheme(
        <AiDatasetsScreenWidget server={failingServer} {...widgetProps} />
      );
      await flushObservabilityRequests();
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
      await flushObservabilityRequests();
      globalThis.fetch = serverFetch;
      expect(failing.getByText("Import failed.")).toBeTruthy();
    });

    it("dismisses create and import modals", async () => {
      listState.data = datasets;
      const view = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-datasets-create"));
        await Promise.resolve();
      });
      const createModal = view.UNSAFE_root.findAllByType(Modal).find(
        (node) => node.props.title === "New dataset" && node.props.visible
      );
      assert.isDefined(createModal);
      await act(async () => {
        createModal?.props.onDismiss();
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
        importModal?.props.onDismiss();
        await Promise.resolve();
      });
      expect(view.queryByTestId("ai-datasets-import-modal")).toBeNull();
    });

    it("creates a dataset with optional prompt binding", async () => {
      listState.data = datasets;
      routerPush.mockClear();
      const view = renderWithTheme(
        <AiDatasetsScreenWidget server={createServer()} {...widgetProps} />
      );
      await flushObservabilityRequests();
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
