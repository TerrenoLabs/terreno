import {beforeEach, describe, expect, it, mock} from "bun:test";
import {Modal} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiDatasetDetailScreenWidget as AiDatasetDetailScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetDetailScreen";
import {AiDatasetItemScreenWidget as AiDatasetItemScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetItemScreen";
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
  type FakeObservabilityRoute,
  type FakeObservabilityServer,
  type FakeQueryState,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const AiDatasetDetailScreenWidget = withObservabilityServer(AiDatasetDetailScreenWidgetBase);
const AiDatasetItemScreenWidget = withObservabilityServer(AiDatasetItemScreenWidgetBase);
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
const routerReplace = mock(() => undefined) as unknown as ExpoRouterPushMock;

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
    replace: (...args: unknown[]): void => {
      routerReplace(...args);
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

    it("opens the expected-output page from a row and from add item", async () => {
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
      const itemHref = String(routerPush.mock.calls[1]?.[0]);
      assert.include(itemHref, "ai-dataset-item");
      assert.include(itemHref, "itemId=item-1");

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-dataset-add-item"));
        await Promise.resolve();
      });
      const createHref = String(routerPush.mock.calls[2]?.[0]);
      assert.include(createHref, "ai-dataset-item");
      assert.notInclude(createHref, "itemId=");
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

describe("AiDatasetItemScreen", () => {
  const ITEM_ROUTE = "PATCH /ai/observability/datasets/:id/items/:itemId";
  const CREATE_ROUTE = "POST /ai/observability/datasets/:id/items";
  const OPEN_TRACE_HREF = "ai-trace-detail?id=trace-1";
  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  const schemaDataset: DatasetRecord = {
    counts: {auto: 0, human: 1, needsReview: 0, total: 1},
    created: "2026-01-01T00:00:00.000Z",
    expectedOutputSchema: {
      properties: {
        crisis: {type: "boolean"},
        route: {enum: ["none", "988"], type: "string"},
      },
      type: "object",
    },
    id: "ds-1",
    name: "gold",
    tags: [],
    updated: "2026-01-02T00:00:00.000Z",
  };
  const plainDataset: DatasetRecord = {
    ...schemaDataset,
    expectedOutputSchema: undefined,
    id: "ds-2",
  };

  const existingItem: DatasetItemRecord = {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    expectedOutput: {crisis: true, route: "988"},
    id: "item-1",
    input: {q: "hi"},
    origin: "trace",
    outcomeClass: "tp",
    proofread: false,
    sourceTraceId: "trace-1",
    tags: [],
    updated: "2026-01-01T00:00:00.000Z",
  };

  const statusWith = (canUpdate: boolean): Record<string, unknown> => ({
    localOn: true,
    permissions: {
      aiDataset: {create: true, list: true, read: true, update: canUpdate},
      aiExperiment: {create: true, list: true, read: true},
    },
    plugins: [],
    primaries: {
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    },
  });

  const renderItemScreen = (
    server: FakeObservabilityServer
  ): ReturnType<typeof renderWithTheme> => {
    return renderWithTheme(
      <AiDatasetItemScreenWidget
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-item"
        server={server}
      />
    );
  };

  const buildServer = ({
    canUpdate = true,
    dataset = schemaDataset,
    datasetState,
    items = [existingItem],
    itemsState,
    itemRoute,
    createRoute,
  }: {
    canUpdate?: boolean;
    createRoute?: FakeObservabilityRoute;
    dataset?: DatasetRecord;
    datasetState?: FakeQueryState;
    itemRoute?: FakeObservabilityRoute;
    items?: DatasetItemRecord[];
    itemsState?: FakeQueryState;
  } = {}): FakeObservabilityServer => {
    return createObservabilityServer({
      [CREATE_ROUTE]: createRoute ?? (async () => ({})),
      "GET /ai/observability/datasets/:id": datasetState ?? {data: dataset},
      "GET /ai/observability/datasets/:id/items": itemsState ?? {data: items},
      "GET /ai/observability/status": {data: statusWith(canUpdate)},
      [ITEM_ROUTE]: itemRoute ?? (async () => ({})),
    });
  };

  beforeEach(() => {
    routerPush.mockClear();
    routerReplace.mockClear();
    setExpoSearchParams(() => ({datasetId: "ds-1", itemId: "item-1"}));
  });

  it("shows the missing dataset message without a dataset id", async () => {
    setExpoSearchParams(() => ({}));
    const view = renderItemScreen(buildServer());
    await flushObservabilityRequests();
    assert.exists(view.getByText("Missing dataset id."));
  });

  it("shows a loader while the dataset or its items load", async () => {
    const datasetLoading = renderItemScreen(buildServer({datasetState: {isLoading: true}}));
    await flushObservabilityRequests();
    assert.exists(datasetLoading.getByTestId("ai-dataset-item-loading"));
    datasetLoading.unmount();

    const itemsLoading = renderItemScreen(buildServer({itemsState: {isLoading: true}}));
    await flushObservabilityRequests();
    assert.exists(itemsLoading.getByTestId("ai-dataset-item-loading"));
  });

  it("refills the form when the item param changes on a mounted screen", async () => {
    const secondItem: DatasetItemRecord = {
      ...existingItem,
      expectedOutput: {crisis: false, route: "none"},
      id: "item-2",
      outcomeClass: "fp",
      proofread: true,
    };
    const server = buildServer({items: [existingItem, secondItem]});
    const screen = (): React.ReactElement => (
      <AiDatasetItemScreenWidget
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-dataset-item"
        server={server}
      />
    );
    const view = renderWithTheme(screen());
    await flushObservabilityRequests();
    assert.exists(view.getByText("Edit expected output"));

    setExpoSearchParams(() => ({datasetId: "ds-1", itemId: "item-2"}));
    view.rerender(screen());
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    const patches = server.callsTo(ITEM_ROUTE);
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]?.params, {id: "ds-1", itemId: "item-2"});
    assert.deepEqual(patches[0]?.body, {
      expectedOutput: {crisis: false, route: "none"},
      outcomeClass: "fp",
      proofread: true,
    });
  });

  it("shows load failures for the dataset and for a missing item", async () => {
    const datasetFailed = renderItemScreen(buildServer({datasetState: {isError: true}}));
    await flushObservabilityRequests();
    assert.exists(datasetFailed.getByText("Failed to load dataset."));
    datasetFailed.unmount();

    setExpoSearchParams(() => ({datasetId: "ds-1", itemId: "missing-item"}));
    const itemMissing = renderItemScreen(buildServer());
    await flushObservabilityRequests();
    assert.exists(itemMissing.getByText("Failed to load dataset item."));
  });

  it("edits an existing item as a form and saves the expected output back", async () => {
    const server = buildServer();
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    assert.exists(view.getByText("Edit expected output"));
    assert.exists(view.getByTestId("ai-dataset-item-expected"));

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-proofread-clickable"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    const patches = server.callsTo(ITEM_ROUTE);
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]?.params, {id: "ds-1", itemId: "item-1"});
    assert.deepEqual(patches[0]?.body, {
      expectedOutput: {crisis: true, route: "988"},
      outcomeClass: "tp",
      proofread: true,
    });
    assert.include(String(routerPush.mock.calls.at(-1)?.[0]), "ai-dataset-detail?id=ds-1");
  });

  it("saves a needs-review item and opens the next one that needs review", async () => {
    const queued = {...existingItem, id: "item-2", proofread: false};
    const golden = {...existingItem, id: "item-3", proofread: true};
    const server = buildServer({items: [existingItem, queued, golden]});
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    assert.exists(view.getByText("Save and next"));

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    assert.equal(server.callsTo(ITEM_ROUTE).length, 1);
    assert.equal(routerReplace.mock.calls.length, 1);
    assert.include(String(routerReplace.mock.calls[0]?.[0]), "ai-dataset-item?datasetId=ds-1");
    assert.include(String(routerReplace.mock.calls[0]?.[0]), "itemId=item-2");
    assert.equal(routerPush.mock.calls.length, 0);
  });

  it("finishes the review queue on the Needs review tab after the last item", async () => {
    const golden = {...existingItem, id: "item-3", proofread: true};
    const server = buildServer({items: [existingItem, golden]});
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    assert.exists(view.getByText("Save and finish review"));

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    assert.equal(routerReplace.mock.calls.length, 0);
    assert.equal(
      routerPush.mock.calls.at(-1)?.[0],
      "/admin/ai-dataset-detail?id=ds-1&tab=needsReview"
    );
  });

  it("returns to the dataset after saving a golden item", async () => {
    const golden = {...existingItem, proofread: true};
    const server = buildServer({items: [golden]});
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    assert.exists(view.getByText("Save expected output"));

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    assert.equal(routerReplace.mock.calls.length, 0);
    assert.equal(routerPush.mock.calls.at(-1)?.[0], "/admin/ai-dataset-detail?id=ds-1");
  });

  it("starts a new item from the sibling input and the schema-shaped expected output", async () => {
    setExpoSearchParams(() => ({datasetId: "ds-1"}));
    const server = buildServer();
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    assert.exists(view.getByText("New dataset item"));

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    const created = server.callsTo(CREATE_ROUTE);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0]?.body, {
      expectedOutput: {crisis: false, route: ""},
      input: {q: ""},
      origin: "manual",
      outcomeClass: null,
      proofread: true,
    });
    assert.include(String(routerPush.mock.calls.at(-1)?.[0]), "ai-dataset-detail?id=ds-1");
  });

  it("starts a new item on a dataset without a schema or sibling items", async () => {
    setExpoSearchParams(() => ({datasetId: "ds-2"}));
    const server = createObservabilityServer({
      [CREATE_ROUTE]: async () => ({}),
      "GET /ai/observability/datasets/:id": {data: plainDataset},
      "GET /ai/observability/datasets/:id/items": {data: []},
      "GET /ai/observability/status": {data: statusWith(true)},
    });
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    const created = server.callsTo(CREATE_ROUTE);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0]?.body, {
      expectedOutput: "",
      input: "",
      origin: "manual",
      outcomeClass: null,
      proofread: true,
    });
  });

  it("copies the blank shape of a sibling item's expected output on a dataset without a schema", async () => {
    setExpoSearchParams(() => ({datasetId: "ds-2"}));
    const sibling: DatasetItemRecord = {
      ...existingItem,
      datasetId: "ds-2",
      expectedOutput: {note: "hello", score: 4},
    };
    const server = buildServer({dataset: plainDataset, items: [sibling]});
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    assert.deepEqual(server.callsTo(CREATE_ROUTE)[0]?.body, {
      expectedOutput: {note: "", score: null},
      input: {q: ""},
      origin: "manual",
      outcomeClass: null,
      proofread: true,
    });
  });

  it("shows the server's error title when saving fails", async () => {
    const server = buildServer({
      itemRoute: () => {
        throw {data: {title: "Route is required"}, status: 400};
      },
    });
    const view = renderItemScreen(server);
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-save"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    assert.exists(view.getByTestId("ai-dataset-item-error"));
    assert.exists(view.getByText("Route is required"));
  });

  it("opens the source trace of an existing item", async () => {
    const view = renderItemScreen(buildServer());
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-item-open-trace"));
      await Promise.resolve();
    });

    assert.include(String(routerPush.mock.calls.at(-1)?.[0]), OPEN_TRACE_HREF);
  });

  it("shows a read-only item when the user cannot update datasets", async () => {
    const server = buildServer({canUpdate: false});
    const view = renderItemScreen(server);
    await flushObservabilityRequests();

    assert.exists(view.getByText("You can view this item. Saving needs dataset update."));
    assert.isNull(view.queryByTestId("ai-dataset-item-save"));
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
    beforeEach(() => {
      listState.data = datasets;
      listState.isError = false;
      listState.isLoading = false;
    });

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
      statusData.permissions = {
        aiDataset: {create: false, list: true, read: true, update: false},
      };
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

      fireEvent.changeText(view.getByTestId("ai-datasets-create-name"), "new-set");
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
      expect(errored.getByText("Could not load datasets.")).toBeTruthy();
      await act(async () => {
        fireEvent.press(errored.getByText("Try again"));
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
      fireEvent.changeText(createFail.getByTestId("ai-datasets-create-name"), "broken");
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
      expect(failing.getByText("Could not import these items.")).toBeTruthy();
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
      const server = createServer();
      const view = renderWithTheme(<AiDatasetsScreenWidget server={server} {...widgetProps} />);
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-datasets-create"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-datasets-create-name"), "bound-set");
      fireEvent.changeText(view.getByTestId("ai-datasets-create-binding"), "summarize");
      await act(async () => {
        fireEvent.press(view.getByText("Create dataset"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.equal(routerPush.mock.calls.length, 1);
      assert.equal(routerPush.mock.calls[0]?.[0], "/admin/ai-dataset-detail?id=ds-new");
      assert.deepEqual(server.callsTo(CREATE_ROUTE)[0]?.body, {
        inputSchemaPromptName: "summarize",
        name: "bound-set",
      });
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
      const onFilePicked = mock((_args: {content: string; filename: string}): void => undefined);
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
        fireEvent.press(view.getByText("Try again"));
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
      const onFilePicked = mock((_args: {content: string; filename: string}): void => undefined);
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
      const onFilePicked = mock((_args: {content: string; filename: string}): void => undefined);
      const onFileReadError = mock((_message: string) => undefined);
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
          onFileReadError={onFileReadError}
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
      assert.equal(onFileReadError.mock.calls.length, 1);
      assert.include(String(onFileReadError.mock.calls[0]?.[0]), "Could not read that file");
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
