import {beforeEach, describe, expect, it, mock} from "bun:test";
import SliderComponent from "@react-native-community/slider";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiDatasetDetailScreenWidget as AiDatasetDetailScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetDetailScreen";
import {AiDatasetsScreenWidget as AiDatasetsScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetsListScreen";
import {AiEvaluatorDetailScreenWidget as AiEvaluatorDetailScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorDetailScreen";
import {AiEvaluatorNewScreenWidget as AiEvaluatorNewScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorNewScreen";
import {AiEvaluatorsScreenWidget as AiEvaluatorsScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorsListScreen";
import {AiExperimentNewScreenWidget as AiExperimentNewScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentNewScreen";
import {AiExperimentResultsScreenWidget as AiExperimentResultsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentResultsScreen";
import {AiExperimentsScreenWidget as AiExperimentsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";
import {AiPromptEditorScreenWidget as AiPromptEditorScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import {AiPromptsScreenWidget as AiPromptsScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptsListScreen";
import {AiReviewItemScreenWidget as AiReviewItemScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewItemScreen";
import {AiReviewItemView} from "../widgets/aiObservability/review/AiReviewItemView";
import {AiReviewScreenWidget as AiReviewScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewQueueScreen";
import {AiReviewQueueView} from "../widgets/aiObservability/review/AiReviewQueueView";
import {ReviewScoreField} from "../widgets/aiObservability/review/ReviewScoreField";
import type {ReviewDetail, ReviewListItem} from "../widgets/aiObservability/review/reviewTypes";
import {AiObservabilityChrome as AiObservabilityChromeBase} from "../widgets/aiObservability/shell/AiObservabilityChrome";
import {AiObservabilityStatusChip as AiObservabilityStatusChipBase} from "../widgets/aiObservability/shell/AiObservabilityStatusChip";
import {AiTraceDetailScreenWidget as AiTraceDetailScreenWidgetBase} from "../widgets/aiObservability/traces/AiTraceDetailScreen";
import {AiTracesScreenWidget as AiTracesScreenWidgetBase} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {
  createObservabilityServer,
  type FakeObservabilityRoute,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const _AiDatasetDetailScreenWidget = withObservabilityServer(AiDatasetDetailScreenWidgetBase);
const _AiDatasetsScreenWidget = withObservabilityServer(AiDatasetsScreenWidgetBase);
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
const AiReviewItemScreenWidget = withObservabilityServer(AiReviewItemScreenWidgetBase);
const AiReviewScreenWidget = withObservabilityServer(AiReviewScreenWidgetBase);
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

  const ACTION_ROUTE = "POST /ai/observability/review/:id";
  const CURRENT_USER_ROUTE = "GET /auth/me";
  const DETAIL_ROUTE = "GET /ai/observability/review/:id";
  const LIST_ROUTE = "GET /ai/observability/review";
  const STATUS_ROUTE = "GET /ai/observability/status";

  let actionShouldFail = false;

  const createServer = (options?: {
    currentUserId?: string;
    detailRoute?: FakeObservabilityRoute;
    pendingItems?: ReviewListItem[];
  }): FakeObservabilityServer => {
    const pendingItems = options?.pendingItems ?? pending;
    return createObservabilityServer({
      [ACTION_ROUTE]: async () => {
        if (actionShouldFail) {
          throw {data: {title: "action failed"}, status: 500};
        }
        return detail;
      },
      [CURRENT_USER_ROUTE]: {
        data: options?.currentUserId === "" ? undefined : {id: options?.currentUserId ?? "user-1"},
      },
      [DETAIL_ROUTE]: options?.detailRoute ?? {data: detail},
      [LIST_ROUTE]: {
        data: {
          counts: {done: 0, in_progress: 0, pending: pendingItems.length, skipped: 0},
          data: pendingItems,
          more: false,
        },
      },
      [STATUS_ROUTE]: {data: statusData},
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiReviewItemScreenWidget", () => {
    it("shows loading then review item with score controls", async () => {
      const loading = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={createServer({currentUserId: "", detailRoute: {isLoading: true}})}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-review-item-loading")).toBeTruthy();
      loading.unmount();

      const server = createServer();
      const loaded = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={server}
        />
      );
      await flushObservabilityRequests();
      expect(loaded.getByTestId("ai-review-item")).toBeTruthy();
      expect(loaded.getByTestId("ai-review-score-boolean-correct")).toBeTruthy();
      assert.deepEqual(server.callsTo(DETAIL_ROUTE)[0]?.params, {id: "rev-1"});
      assert.equal(server.callsTo(LIST_ROUTE)[0]?.query.status, "pending");
    });

    it("requires scores before submit and submits on pass", async () => {
      const server = createServer();
      const view = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={server}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-submit-next"));
        await Promise.resolve();
      });
      expect(view.getByText("Score correct before submitting.")).toBeTruthy();
      assert.equal(server.callsTo(ACTION_ROUTE).length, 0);

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-score-correct-pass"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-submit-next"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      const actions = server.callsTo(ACTION_ROUTE);
      assert.equal(actions.length, 1);
      assert.deepEqual(actions[0]?.params, {id: "rev-1"});
      assert.deepInclude(actions[0]?.body as Record<string, unknown>, {
        action: "submit",
        scores: {correct: true},
      });
    });

    it("shows missing id and load error with retry", async () => {
      reviewId = "";
      const missing = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(missing.getByText(/Missing review item id/)).toBeTruthy();
      missing.unmount();
      reviewId = "rev-1";

      const errorServer = createServer({detailRoute: {isError: true}});
      const errored = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={errorServer}
        />
      );
      await flushObservabilityRequests();
      assert.equal(errorServer.callsTo(DETAIL_ROUTE).length, 1);
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      await flushObservabilityRequests();
      assert.isAtLeast(errorServer.callsTo(DETAIL_ROUTE).length, 2);
    });

    it("skips, assigns, and surfaces action errors", async () => {
      actionShouldFail = false;
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={server}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-skip"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.isAtLeast(server.callsTo(ACTION_ROUTE).length, 1);
      assert.deepInclude(server.callsTo(ACTION_ROUTE)[0]?.body as Record<string, unknown>, {
        action: "skip",
      });

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-assign"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      const actions = server.callsTo(ACTION_ROUTE);
      assert.equal(actions.length, 2);
      assert.deepInclude(actions[1]?.body as Record<string, unknown>, {
        action: "assign",
        assigneeId: "user-1",
      });

      actionShouldFail = true;
      const failing = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(failing.getByTestId("ai-review-skip"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      expect(failing.getByText("Could not skip this review.")).toBeTruthy();

      const noUserServer = createServer({currentUserId: ""});
      const noUser = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={noUserServer}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(noUser.getByTestId("ai-review-assign"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      expect(noUser.getByText("Could not identify the current admin.")).toBeTruthy();
      assert.equal(noUserServer.callsTo(ACTION_ROUTE).length, 0);
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
      const server = createServer({pendingItems: [pending[0]!, secondPending]});

      routerPush.mockClear();
      const view = renderWithTheme(
        <AiReviewItemScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={server}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByText("Next"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-review-item");

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
      await flushObservabilityRequests();
      const actions = server.callsTo(ACTION_ROUTE);
      assert.isAtLeast(actions.length, 1);
      assert.deepInclude(actions[0]?.body as Record<string, unknown>, {
        action: "submit",
        comment: "looks good",
      });
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
      navButtons[0]?.props.onClick();
      nextButtons[0]?.props.onClick();
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
    // The review route answers a list envelope (`more`), so `counts` reaches the screen.
    data: {counts: {done: 0, in_progress: 0, pending: 1, skipped: 0}, data: items, more: false},
  };

  const LIST_ROUTE = "GET /ai/observability/review";

  const createServer = (): FakeObservabilityServer => {
    return createObservabilityServer({
      [LIST_ROUTE]: listState,
      "GET /ai/observability/status": {data: statusData},
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiReviewScreenWidget", () => {
    it("shows pending queue and opens the oldest item", async () => {
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(
        <AiReviewScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review"
          server={server}
        />
      );
      await flushObservabilityRequests();
      expect(view.getByTestId("ai-review-table")).toBeTruthy();
      assert.equal(server.callsTo(LIST_ROUTE)[0]?.query.status, "pending");
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
