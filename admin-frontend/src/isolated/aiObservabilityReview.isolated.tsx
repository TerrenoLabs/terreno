import {beforeEach, describe, expect, it, mock} from "bun:test";
import SliderComponent from "@react-native-community/slider";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiReviewItemScreenWidget as AiReviewItemScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewItemScreen";
import {
  AiReviewItemHeaderMeta,
  AiReviewItemNav,
  AiReviewItemView,
  reviewItemTitle,
} from "../widgets/aiObservability/review/AiReviewItemView";
import {AiReviewScreenWidget as AiReviewScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewQueueScreen";
import {
  AiReviewQueueActions,
  AiReviewQueueView,
} from "../widgets/aiObservability/review/AiReviewQueueView";
import {ReviewScoreField} from "../widgets/aiObservability/review/ReviewScoreField";
import type {ReviewDetail, ReviewListItem} from "../widgets/aiObservability/review/reviewTypes";
import {
  createObservabilityServer,
  type FakeObservabilityRoute,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const AiReviewItemScreenWidget = withObservabilityServer(AiReviewItemScreenWidgetBase);
const AiReviewScreenWidget = withObservabilityServer(AiReviewScreenWidgetBase);

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

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

/** A review list envelope; `more` keeps it a list envelope so `counts` reaches the screen. */
const reviewList = (items: ReviewListItem[]): Record<string, unknown> => ({
  counts: {done: 0, in_progress: 0, pending: items.length, skipped: 0},
  data: items,
  more: false,
});

describe("AiReviewItemScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: reviewId}));
    routerPush.mockClear();
  });
  let reviewId = "rev-1";

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
    listRoute?: FakeObservabilityRoute;
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
      [LIST_ROUTE]: options?.listRoute ?? {data: reviewList(pendingItems)},
      [STATUS_ROUTE]: {data: statusData},
    });
  };

  const renderScreen = async (
    server: FakeObservabilityServer
  ): Promise<ReturnType<typeof renderWithTheme>> => {
    const view = renderWithTheme(
      <AiReviewItemScreenWidget
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-review-item"
        server={server}
      />
    );
    await flushObservabilityRequests();
    return view;
  };

  describe("AiReviewItemScreenWidget", () => {
    it("shows loading then review item with score controls", async () => {
      const loading = await renderScreen(
        createServer({currentUserId: "", detailRoute: {isLoading: true}})
      );
      expect(loading.getByTestId("ai-review-item-loading")).toBeTruthy();
      loading.unmount();

      const server = createServer();
      const loaded = await renderScreen(server);
      expect(loaded.getByTestId("ai-review-item")).toBeTruthy();
      expect(loaded.getByTestId("ai-review-question-correct")).toBeTruthy();
      assert.deepEqual(server.callsTo(DETAIL_ROUTE)[0]?.params, {id: "rev-1"});
      assert.equal(server.callsTo(LIST_ROUTE)[0]?.query.status, "pending");
    });

    it("requires scores before submit and submits on pass", async () => {
      const server = createServer();
      const view = await renderScreen(server);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-submit-next"));
        await Promise.resolve();
      });
      expect(view.getByText(`Answer "correct" before submitting.`)).toBeTruthy();
      assert.equal(server.callsTo(ACTION_ROUTE).length, 0);

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-question-correct-yes"));
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
      const missing = await renderScreen(createServer());
      expect(missing.getByText(/Missing review item id/)).toBeTruthy();
      missing.unmount();
      reviewId = "rev-1";

      const errorServer = createServer({detailRoute: {isError: true}});
      const errored = await renderScreen(errorServer);
      expect(errored.getByText("Could not load this review item.")).toBeTruthy();
      assert.equal(errorServer.callsTo(DETAIL_ROUTE).length, 1);
      await act(async () => {
        fireEvent.press(errored.getByTestId("ai-review-item-error-retry"));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      await flushObservabilityRequests();
      assert.isAtLeast(errorServer.callsTo(DETAIL_ROUTE).length, 2);
    });

    it("skips, assigns, and surfaces action errors", async () => {
      actionShouldFail = false;
      const server = createServer();
      const view = await renderScreen(server);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-skip"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.equal(server.callsTo(ACTION_ROUTE).length, 1);
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
      const failing = await renderScreen(createServer());
      await act(async () => {
        fireEvent.press(failing.getByTestId("ai-review-skip"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      expect(failing.getByText("Could not skip this review.")).toBeTruthy();

      const noUserServer = createServer({currentUserId: ""});
      const noUser = await renderScreen(noUserServer);
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
      const server = createServer({pendingItems: [...pending, secondPending]});
      const view = await renderScreen(server);
      expect(view.getByText("Item 1 of 2")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByText("Next"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(String(routerPush.mock.calls[0]?.[0]), "/admin/ai-review-item?id=rev-2");

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-question-correct-yes"));
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
      assert.equal(actions.length, 1);
      assert.deepInclude(actions[0]?.body as Record<string, unknown>, {
        action: "submit",
        comment: "looks good",
        scores: {correct: true},
      });
      assert.equal(String(routerPush.mock.calls.at(-1)?.[0]), "/admin/ai-review-item?id=rev-2");
    });

    it("walks pending and in-progress items of the item's batch", async () => {
      const batchItem = (id: string, status: ReviewListItem["status"]): ReviewListItem => ({
        batchId: "b1",
        enqueuedAt: "2026-01-01T00:00:00.000Z",
        evaluatorId: "eval-1",
        id,
        reason: "manual",
        status,
        traceId: `trace-${id}`,
        traceName: "summarize",
      });
      const batchItems = [
        batchItem("rev-1", "pending"),
        batchItem("rev-2", "in_progress"),
        batchItem("rev-3", "done"),
      ];
      // The global pending queue and the batch queue share a route; branch on `batchId`.
      const server = createServer({
        detailRoute: {data: {...detail, batchId: "b1"}},
        listRoute: (request) => reviewList(request.query.batchId === "b1" ? batchItems : []),
      });
      const view = await renderScreen(server);
      const batchQueueCalls = server
        .callsTo(LIST_ROUTE)
        .filter((request) => request.query.batchId !== undefined);
      assert.isAtLeast(batchQueueCalls.length, 1);
      assert.deepEqual(batchQueueCalls.at(-1)?.query, {batchId: "b1"});
      expect(view.getByText("Item 1 of 2")).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-question-correct-yes"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-submit-next"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.equal(server.callsTo(ACTION_ROUTE).length, 1);
      assert.equal(String(routerPush.mock.calls.at(-1)?.[0]), "/admin/ai-review-item?id=rev-2");
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
          onAssign={() => undefined}
          onCommentChange={() => undefined}
          onScoreChange={() => undefined}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          scores={{}}
        />
      );
      expect(reviewItemTitle({isPending: true, position: 1, totalPending: 2})).toBe("Item 1 of 2");
      expect(reviewItemTitle({isPending: false, position: 1, totalPending: 0})).toBe("Review item");
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
          onAssign={onAssign}
          onCommentChange={() => undefined}
          onScoreChange={() => undefined}
          onSkip={onSkip}
          onSubmit={onSubmit}
          scores={{correct: true}}
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
        <>
          <AiReviewItemHeaderMeta detail={{...detail, status: "done"}} isPending={false} />
          <AiReviewItemNav onNext={onNext} onPrevious={onPrevious} />
          <AiReviewItemView
            comment="needs work"
            detail={{...detail, status: "done"}}
            onAssign={() => undefined}
            onCommentChange={onCommentChange}
            onScoreChange={() => undefined}
            onSkip={() => undefined}
            onSubmit={() => undefined}
            scores={{correct: true}}
            submitError="Could not submit this review."
          />
        </>
      );
      expect(getByText("Not in the pending queue")).toBeTruthy();
      expect(getByText("From a trace")).toBeTruthy();
      expect(getByTestId("ai-review-item-status")).toBeTruthy();
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
        <>
          <AiReviewItemNav />
          <AiReviewItemView
            comment=""
            detail={detail}
            onAssign={() => undefined}
            onCommentChange={() => undefined}
            onScoreChange={onScoreChange}
            onSkip={() => undefined}
            onSubmit={() => undefined}
            scores={{}}
          />
        </>
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-question-correct-yes"));
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
          onAssign={() => undefined}
          onCommentChange={() => undefined}
          onScoreChange={() => undefined}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          scores={{}}
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
          isSaving
          onAssign={() => undefined}
          onCommentChange={() => undefined}
          onScoreChange={onScoreChange}
          onSkip={() => undefined}
          onSubmit={() => undefined}
          scores={{correct: true, helpfulness: 0.7}}
        />
      );
      // Scores without question text are labelled by their humanized key, not "2. helpfulness".
      expect(getByText("Helpfulness")).toBeTruthy();
      expect(queryByText("2. helpfulness")).toBeNull();
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

  const EVALUATORS_ROUTE = "GET /ai/observability/evaluators";
  const LIST_ROUTE = "GET /ai/observability/review";

  const createServer = (): FakeObservabilityServer => {
    return createObservabilityServer({
      [EVALUATORS_ROUTE]: {
        data: [{dimensions: [], id: "eval-1", name: "summary-questions", type: "human"}],
      },
      [LIST_ROUTE]: {data: reviewList(items)},
      "GET /ai/observability/status": {data: statusData},
    });
  };

  describe("AiReviewScreenWidget", () => {
    it("shows pending queue and opens the oldest item", async () => {
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
      assert.isAtLeast(server.callsTo(EVALUATORS_ROUTE).length, 1);
      expect(view.getByText("summary-questions")).toBeTruthy();
      expect(
        view.getByText(
          "Answer yes or no questions about AI outputs, oldest first. Items arrive from Traces and from review batches."
        )
      ).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-start-oldest"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(String(routerPush.mock.calls[0]?.[0]), "/admin/ai-review-item?id=rev-1");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-review-open-batches"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(String(routerPush.mock.calls.at(-1)?.[0]), "/admin/ai-review-batches");
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
    it("names both review intake paths in the empty state and links to Traces", async () => {
      const onOpenTraces = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <AiReviewQueueView
          counts={counts}
          items={[]}
          onOpenItem={() => undefined}
          onOpenTraces={onOpenTraces}
          onRetry={() => undefined}
          onStatusChange={() => undefined}
          status="pending"
        />
      );
      expect(getByTestId("ai-review-empty")).toBeTruthy();
      expect(getByText(/send them to human review, or start a review batch/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-empty-action"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onOpenTraces).toHaveBeenCalled();
    });

    it("renders oldest-first row fields and starts reviewing", async () => {
      const onStart = mock(() => undefined);
      const {getByTestId, getByText, queryByText} = renderWithTheme(
        <>
          <AiReviewQueueActions canStart onStart={onStart} />
          <AiReviewQueueView
            counts={{...counts, pending: 1}}
            items={[item, {...item, batchId: "b1", id: "review-item-2", outputPreview: "Short"}]}
            onOpenItem={() => undefined}
            onRetry={() => undefined}
            onStatusChange={() => undefined}
            status="pending"
          />
        </>
      );
      expect(getByTestId("ai-review-table")).toBeTruthy();
      expect(getByTestId("ai-review-open-review-item-1")).toBeTruthy();
      expect(getByText("From Traces")).toBeTruthy();
      expect(getByText("Short")).toBeTruthy();
      expect(getByText("Review oldest pending")).toBeTruthy();
      expect(queryByText("Open")).toBeNull();
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-start-oldest"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onStart).toHaveBeenCalled();
    });

    it("labels where each untitled review item came from", () => {
      const {getByText} = renderWithTheme(
        <AiReviewQueueView
          counts={{...counts, pending: 3}}
          items={[
            {...item, batchId: "b1", id: "review-item-batch"},
            {...item, id: "review-item-eval", reason: "eval"},
            {...item, id: "review-item-other", reason: "other"},
          ]}
          onOpenItem={() => undefined}
          onRetry={() => undefined}
          onStatusChange={() => undefined}
          status="pending"
        />
      );
      expect(getByText("From a review batch")).toBeTruthy();
      expect(getByText("From an experiment")).toBeTruthy();
      expect(getByText("From Traces")).toBeTruthy();
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
          onStatusChange={onStatusChange}
          status="pending"
        />
      );
      expect(errored.getByText("Could not load the review queue.")).toBeTruthy();
      await act(async () => {
        fireEvent.press(errored.getByTestId("ai-review-error-retry"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onRetry).toHaveBeenCalled();

      const {getByTestId, getByText} = renderWithTheme(
        <AiReviewQueueView
          counts={{...counts, done: 1, pending: 1}}
          items={[item]}
          onOpenItem={onOpenItem}
          onRetry={onRetry}
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
        fireEvent.press(getByTestId("ai-review-open-review-item-1"));
        await Promise.resolve();
      });
      expect(onOpenItem).toHaveBeenCalledWith("review-item-1");
    });
  });
});

describe("ReviewScoreField", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  describe("ReviewScoreField", () => {
    it("renders boolean dimensions as one Yes/No control", async () => {
      const onChange = mock(() => undefined);
      const {getByTestId, getByText, queryByText} = renderWithTheme(
        <ReviewScoreField
          dimension={{dataType: "boolean", key: "is_correct", required: true}}
          onChange={onChange}
          value={false}
        />
      );
      expect(getByTestId("ai-review-score-boolean-is_correct")).toBeTruthy();
      expect(getByTestId("ai-review-score-is_correct-answer")).toBeTruthy();
      expect(getByText("Is correct")).toBeTruthy();
      expect(queryByText("Pass")).toBeNull();
      expect(queryByText("Fail")).toBeNull();
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-score-is_correct-yes"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(onChange).toHaveBeenCalledWith(true);
      await act(async () => {
        fireEvent.press(getByTestId("ai-review-score-is_correct-no"));
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
      expect(getByText("Helpfulness")).toBeTruthy();
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
      const [input] = getAllByDisplayValue("");
      assert.exists(input);
      fireEvent.changeText(input as NonNullable<typeof input>, "custom");
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
