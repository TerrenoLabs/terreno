import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import type {EvaluatorRecord} from "../widgets/aiObservability/evaluators/evaluatorTypes";
import {AiReviewBatchesScreenWidget as AiReviewBatchesScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewBatchesScreen";
import {AiReviewBatchesView} from "../widgets/aiObservability/review/AiReviewBatchesView";
import {AiReviewBatchScreenWidget as AiReviewBatchScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewBatchScreen";
import type {ReviewBatchDetail} from "../widgets/aiObservability/review/batchTypes";
import type {ObservabilityStatusPayload} from "../widgets/aiObservability/shell/aiObservabilityNav";
import {
  createObservabilityServer,
  type FakeObservabilityHandler,
  type FakeObservabilityRoute,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";
import {operatorObservabilityStatus} from "./observabilityStatusFixtures.isolated";

const AiReviewBatchesScreenWidget = withObservabilityServer(AiReviewBatchesScreenWidgetBase);
const AiReviewBatchScreenWidget = withObservabilityServer(AiReviewBatchScreenWidgetBase);

const routerPush = mock((_href: string) => undefined);
const searchParams: {current: Record<string, string>} = {current: {}};

mock.module("expo-router", () => ({
  router: {
    push: (href: string): void => {
      routerPush(href);
    },
  },
  useLocalSearchParams: (): Record<string, string> => searchParams.current,
}));

const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await flushObservabilityRequests();
};

const QUESTIONS = [
  {dataType: "boolean" as const, key: "faithful", question: "Is it faithful?", required: true},
  {dataType: "boolean" as const, key: "concise", question: "Is it concise?", required: true},
];

const evaluator = (overrides: Partial<EvaluatorRecord>): EvaluatorRecord => ({
  confidenceAlertBelow: 0.5,
  dimensions: QUESTIONS,
  id: "qs",
  name: "summary-questions",
  runModes: {allowManualRun: true, availableInExperiments: false, liveSampleRate: 0},
  target: "full trace",
  type: "human",
  ...overrides,
});

const EVALUATORS: EvaluatorRecord[] = [
  evaluator({dimensions: [QUESTIONS[0] as (typeof QUESTIONS)[number]], id: "qs-small"}),
  evaluator({}),
  evaluator({id: "careful", name: "careful-judge", type: "llm-judge"}),
  evaluator({
    dimensions: [QUESTIONS[0] as (typeof QUESTIONS)[number]],
    id: "quick",
    name: "quick-judge",
    type: "llm-judge",
  }),
  evaluator({
    dimensions: [{dataType: "categorical", key: "tone", required: true}],
    id: "tone",
    name: "tone-judge",
    type: "llm-judge",
  }),
];

const judgeSummary = (evaluatorId: string, rate?: number) => ({
  agreement: {
    compared: rate === undefined ? 0 : 4,
    disagreements: [],
    errors: 0,
    itemsCompared: rate === undefined ? 0 : 2,
    matches: rate === undefined ? 0 : Math.round(rate * 4),
    questions: QUESTIONS.map((question) => ({
      compared: 2,
      covered: true,
      key: question.key,
      matches: 2,
      rate,
    })),
    rate,
  },
  completedAt: "2026-10-15T00:00:00.000Z",
  evaluatorId,
  evaluatorName: `${evaluatorId}-judge`,
  runId: `run-${evaluatorId}`,
});

const BATCH: ReviewBatchDetail = {
  counts: {done: 1, pending: 1, skipped: 0, total: 2},
  created: "2026-10-15T00:00:00.000Z",
  dimensions: QUESTIONS,
  evaluatorId: "qs",
  evaluatorName: "summary-questions",
  id: "b1",
  items: [
    {
      judgeAnswers: {careful: {scores: {concise: true, faithful: true}}},
      output: "First summary",
      reviewItemId: "r1",
      scores: {concise: true, faithful: true},
      status: "done",
      traceId: "t1",
      traceName: "summarize",
    },
    {
      judgeAnswers: {},
      output: "Second summary",
      reviewItemId: "r2",
      status: "pending",
      traceId: "t2",
      traceName: "summarize",
    },
  ],
  judgeCount: 1,
  judges: [judgeSummary("careful", 1)],
  name: "Recent summaries",
};

const BATCH_ROUTE = "GET /ai/observability/review/batches/:id";
const BATCHES_ROUTE = "GET /ai/observability/review/batches";
const CREATE_ROUTE = "POST /ai/observability/review/batches";
const JUDGE_ROUTE = "POST /ai/observability/review/batches/:id/judgeRuns";

const PROMPTS = [
  {folder: "chat", latestVersion: 1, name: "example-summarize", production: 1, type: "chat"},
  {
    folder: "evaluators",
    latestVersion: 1,
    name: "eval-judge-summary-questions",
    production: 1,
    type: "chat",
  },
];

const createServer = (params: {
  batch?: FakeObservabilityRoute;
  batches?: FakeObservabilityRoute;
  create?: FakeObservabilityHandler;
  evaluators?: EvaluatorRecord[];
  runJudge?: FakeObservabilityHandler;
  status?: ObservabilityStatusPayload;
}): FakeObservabilityServer =>
  createObservabilityServer({
    [BATCH_ROUTE]: params.batch ?? {data: BATCH},
    [BATCHES_ROUTE]: params.batches ?? {data: {data: [], more: false}},
    [CREATE_ROUTE]: params.create ?? (() => BATCH),
    "GET /ai/observability/evaluators": {data: params.evaluators ?? EVALUATORS},
    "GET /ai/observability/prompts": {data: PROMPTS},
    "GET /ai/observability/status": {data: params.status ?? operatorObservabilityStatus()},
    [JUDGE_ROUTE]: params.runJudge ?? (() => BATCH),
  });

/**
 * Make `fetch` reject (a transport failure, no response body) for requests whose path ends with
 * `pathSuffix`, so screens fall back to their generic error copy. Returns a restore function.
 */
const failTransportFor = (pathSuffix: string): (() => void) => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).pathname.endsWith(pathSuffix)) {
      throw new TypeError("Network request failed");
    }
    return previous(input, init);
  }) as typeof fetch;
  return (): void => {
    globalThis.fetch = previous;
  };
};

describe("AiReviewBatchScreenWidget", () => {
  beforeEach(() => {
    searchParams.current = {id: "b1"};
    routerPush.mockClear();
  });

  const renderScreen = async (
    server: FakeObservabilityServer,
    props: Partial<React.ComponentProps<typeof AiReviewBatchScreenWidgetBase>> = {}
  ): Promise<ReturnType<typeof renderWithTheme>> => {
    const view = renderWithTheme(
      <AiReviewBatchScreenWidget
        config={config}
        routeBase="/admin/"
        screenName="ai-review-batch"
        server={server}
        {...props}
      />
    );
    await flushObservabilityRequests();
    return view;
  };

  it("asks for a batch id, shows loading, and retries a failed load", async () => {
    searchParams.current = {};
    const missingServer = createServer({});
    const missing = await renderScreen(missingServer);
    expect(missing.getByText("Missing batch id. Open a batch from Review batches.")).toBeTruthy();
    assert.equal(missingServer.callsTo(BATCH_ROUTE).length, 0);
    missing.unmount();

    searchParams.current = {id: "b1"};
    const loading = await renderScreen(createServer({batch: {isLoading: true}}));
    expect(loading.getByTestId("ai-review-batch-loading")).toBeTruthy();
    loading.unmount();

    const failedServer = createServer({batch: {isError: true}});
    const errored = await renderScreen(failedServer);
    expect(errored.getByText("Could not load this batch.")).toBeTruthy();
    assert.equal(failedServer.callsTo(BATCH_ROUTE).length, 1);
    assert.deepEqual(failedServer.callsTo(BATCH_ROUTE)[0]?.params, {id: "b1"});
    await press(errored.getByTestId("ai-review-batch-error-retry"));
    assert.isAtLeast(failedServer.callsTo(BATCH_ROUTE).length, 2);
  });

  it("offers judges that share questions and opens the next pending item", async () => {
    const view = await renderScreen(createServer({}), {apiKey: "key-1"});
    expect(view.getByTestId("observability-page-header-title").props.children).toBe(
      "Recent summaries"
    );
    expect(view.getByTestId("ai-review-batch-question-set")).toBeTruthy();
    expect(view.getByText("Answer 1 remaining")).toBeTruthy();
    expect(view.queryByText("tone-judge (answers 0 of 2)")).toBeNull();
    await press(view.getByTestId("ai-review-batch-answer-next"));
    expect(routerPush).toHaveBeenCalledWith("/admin/ai-review-item?id=r2");
    await press(view.getByTestId("ai-review-batch-items-table-row-r1-clickable"));
    expect(routerPush).toHaveBeenCalledWith("/admin/ai-review-item?id=r1");
  });

  it("runs the first judge that has not run yet with the caller key", async () => {
    const server = createServer({
      runJudge: () => ({
        ...BATCH,
        judgeCount: 2,
        judges: [judgeSummary("careful", 1), judgeSummary("quick", 0.75)],
      }),
      status: operatorObservabilityStatus({playgroundAi: {source: "server"}}),
    });
    const view = await renderScreen(server, {apiKey: "key-1"});
    await press(view.getByTestId("ai-review-batch-run-judge"));
    const runs = server.callsTo(JUDGE_ROUTE);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]?.params, {id: "b1"});
    assert.deepEqual(runs[0]?.body, {evaluatorId: "quick"});
    assert.equal(runs[0]?.headers["x-ai-api-key"], "key-1");
    expect(view.queryByTestId("ai-review-batch-run-error")).toBeNull();
  });

  it("reports judge runs with nothing to compare and run failures", async () => {
    // Without a saved caller key the run sends no `x-ai-api-key` header.
    const ranServer = createServer({
      runJudge: () => ({...BATCH, judges: [judgeSummary("careful", 1), judgeSummary("quick")]}),
    });
    const ran = await renderScreen(ranServer);
    await press(ran.getByTestId("ai-review-batch-run-judge"));
    const runs = ranServer.callsTo(JUDGE_ROUTE);
    assert.equal(runs.length, 1);
    assert.notProperty(runs[0]?.headers ?? {}, "x-ai-api-key");
    expect(ran.queryByTestId("ai-review-batch-run-error")).toBeNull();
    ran.unmount();

    const failed = await renderScreen(
      createServer({
        runJudge: () => {
          throw {data: {title: "Judge prompt has no production output schema"}};
        },
      }),
      {apiKey: "key-1"}
    );
    await press(failed.getByTestId("ai-review-batch-run-judge"));
    expect(failed.getByTestId("ai-review-batch-run-error")).toBeTruthy();
    expect(failed.getByText("Judge prompt has no production output schema")).toBeTruthy();
    failed.unmount();

    const generic = await renderScreen(createServer({}), {apiKey: "key-1"});
    const restore = failTransportFor("/judgeRuns");
    try {
      await press(generic.getByTestId("ai-review-batch-run-judge"));
    } finally {
      restore();
    }
    expect(generic.getByText("Could not run the judge.")).toBeTruthy();
  });

  it("explains why judges cannot run without AI", async () => {
    const noServer = await renderScreen(
      createServer({
        status: operatorObservabilityStatus({playgroundAi: {source: "unavailable"}}),
      })
    );
    expect(
      noServer.getByText("No AI service is configured on the server, so judges cannot run.")
    ).toBeTruthy();
    noServer.unmount();

    const requestKey = operatorObservabilityStatus({playgroundAi: {source: "request-key"}});
    const hinted = await renderScreen(createServer({status: requestKey}), {
      apiKeyHint: "Save a Gemini key.",
    });
    expect(hinted.getByText("Save a Gemini key.")).toBeTruthy();
    hinted.unmount();

    const fallback = await renderScreen(createServer({status: requestKey}));
    expect(fallback.getByText("Save an AI API key to run judges.")).toBeTruthy();
  });
});

describe("AiReviewBatchesScreenWidget", () => {
  beforeEach(() => {
    routerPush.mockClear();
  });

  const renderScreen = async (
    server: FakeObservabilityServer
  ): Promise<ReturnType<typeof renderWithTheme>> => {
    const view = renderWithTheme(
      <AiReviewBatchesScreenWidget
        config={config}
        routeBase="/admin"
        screenName="ai-review-batches"
        server={server}
      />
    );
    await flushObservabilityRequests();
    return view;
  };

  it("creates a batch from the widest question set and opens it", async () => {
    const server = createServer({
      batches: {
        data: {
          data: [
            {
              counts: BATCH.counts,
              created: BATCH.created,
              evaluatorId: "qs",
              evaluatorName: "summary-questions",
              id: "b1",
              judgeCount: 0,
              name: "Recent summaries",
            },
          ],
          more: false,
        },
      },
    });
    const view = await renderScreen(server);
    const props = view.UNSAFE_root.findByType(AiReviewBatchesView).props;
    expect(props.questionSetId).toBe("qs");
    expect(props.questionSetOptions.map((option: {label: string}) => option.label)).toEqual([
      "summary-questions (1 question)",
      "summary-questions (2 questions)",
    ]);
    expect(props.promptOptions).toEqual([{label: "example-summarize", value: "example-summarize"}]);

    await act(async () => {
      props.onNameChange("  My batch  ");
      props.onPromptChange("example-summarize");
    });
    await press(view.getByTestId("ai-review-batch-grab-recent"));
    const creates = server.callsTo(CREATE_ROUTE);
    assert.equal(creates.length, 1);
    assert.deepEqual(creates[0]?.body, {
      evaluatorId: "qs",
      limit: 10,
      name: "My batch",
      promptName: "example-summarize",
    });
    expect(routerPush).toHaveBeenCalledWith("/admin/ai-review-batch?id=b1");

    await press(view.getByTestId("ai-review-batches-open-b1"));
    expect(routerPush).toHaveBeenCalledTimes(2);
  });

  it("shows create errors and requires a question set", async () => {
    const titled = () => {
      throw {data: {title: "No recent traces that are not already in a batch"}};
    };
    const view = await renderScreen(createServer({create: titled}));
    await press(view.getByTestId("ai-review-batch-grab-recent"));
    expect(view.getByText("No recent traces that are not already in a batch")).toBeTruthy();
    view.unmount();

    const generic = await renderScreen(createServer({}));
    const restore = failTransportFor("/review/batches");
    try {
      await press(generic.getByTestId("ai-review-batch-grab-recent"));
    } finally {
      restore();
    }
    expect(generic.getByText("Could not create the batch.")).toBeTruthy();
    generic.unmount();

    // With no human evaluators there is nothing to batch against.
    const emptyServer = createServer({create: titled, evaluators: []});
    const empty = await renderScreen(emptyServer);
    // The header button is disabled without a question set; call its handler to cover the guard.
    const grab = empty.UNSAFE_root.find(
      (node) => node.props.testID === "ai-review-batch-grab-recent" && "onClick" in node.props
    );
    expect(grab.props.disabled).toBe(true);
    await act(async () => {
      await grab.props.onClick();
    });
    expect(empty.getByText("Choose a question set first.")).toBeTruthy();
    expect(
      empty.getByText("Create a human evaluator with one score per question first.")
    ).toBeTruthy();
    assert.equal(emptyServer.callsTo(CREATE_ROUTE).length, 0);
  });
});
