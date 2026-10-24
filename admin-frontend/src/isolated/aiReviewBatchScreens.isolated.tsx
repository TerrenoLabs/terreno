import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {EvaluatorRecord} from "../widgets/aiObservability/evaluators/evaluatorTypes";
import {AiReviewBatchesScreenWidget} from "../widgets/aiObservability/review/AiReviewBatchesScreen";
import {AiReviewBatchesView} from "../widgets/aiObservability/review/AiReviewBatchesView";
import {AiReviewBatchScreenWidget} from "../widgets/aiObservability/review/AiReviewBatchScreen";
import type {ReviewBatchDetail} from "../widgets/aiObservability/review/batchTypes";
import type {ObservabilityStatusPayload} from "../widgets/aiObservability/shell/aiObservabilityNav";
import {operatorObservabilityStatus} from "./observabilityStatusFixtures.isolated";

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
  runModes: {eval: false, online: false, review: true},
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

interface QueryState {
  data?: unknown;
  isError: boolean;
  isLoading: boolean;
  refetch: () => void;
}

const query = (data: unknown, overrides: Partial<QueryState> = {}): QueryState => ({
  data,
  isError: false,
  isLoading: false,
  refetch: mock(() => {}),
  ...overrides,
});

const createApi = (params: {
  batch?: QueryState;
  batches?: QueryState;
  create?: (body: unknown) => Promise<unknown>;
  evaluators?: EvaluatorRecord[];
  runJudge?: (body: unknown) => Promise<unknown>;
  status?: ObservabilityStatusPayload;
}): AdminApi => {
  const hooks = {
    useAiObservabilityEvaluatorsQuery: () => query(params.evaluators ?? EVALUATORS),
    useAiObservabilityPromptsQuery: () =>
      query([
        {folder: "chat", latestVersion: 1, name: "example-summarize", production: 1, type: "chat"},
        {
          folder: "evaluators",
          latestVersion: 1,
          name: "eval-judge-summary-questions",
          production: 1,
          type: "chat",
        },
      ]),
    useAiObservabilityReviewBatchesQuery: () => params.batches ?? query([]),
    useAiObservabilityReviewBatchQuery: () => params.batch ?? query(BATCH),
    useAiObservabilityStatusQuery: () => query(params.status ?? operatorObservabilityStatus()),
    useCreateAiObservabilityReviewBatchMutation: () => [
      (body: unknown) => ({unwrap: () => (params.create ?? (async () => BATCH))(body)}),
      {isError: false, isLoading: false},
    ],
    useRunAiObservabilityReviewBatchJudgeMutation: () => [
      (body: unknown) => ({unwrap: () => (params.runJudge ?? (async () => BATCH))(body)}),
      {isError: false, isLoading: false},
    ],
  };
  const api = {enhanceEndpoints: () => api, injectEndpoints: () => hooks};
  return api as unknown as AdminApi;
};

describe("AiReviewBatchScreenWidget", () => {
  beforeEach(() => {
    searchParams.current = {id: "b1"};
    routerPush.mockClear();
  });

  const renderScreen = (
    api: AdminApi,
    props: Partial<React.ComponentProps<typeof AiReviewBatchScreenWidget>> = {}
  ): ReturnType<typeof renderWithTheme> =>
    renderWithTheme(
      <AiReviewBatchScreenWidget
        api={api}
        config={config}
        routeBase="/admin/"
        screenName="ai-review-batch"
        {...props}
      />
    );

  it("asks for a batch id, shows loading, and retries a failed load", async () => {
    searchParams.current = {};
    const missing = renderScreen(createApi({}));
    expect(missing.getByText("Missing batch id. Open a batch from Review batches.")).toBeTruthy();
    missing.unmount();

    searchParams.current = {id: "b1"};
    const loading = renderScreen(createApi({batch: query(undefined, {isLoading: true})}));
    expect(loading.getByTestId("ai-review-batch-loading")).toBeTruthy();
    loading.unmount();

    const failed = query(undefined, {isError: true});
    const errored = renderScreen(createApi({batch: failed}));
    expect(errored.getByText("Could not load this batch.")).toBeTruthy();
    await press(errored.getByText("Retry"));
    expect(failed.refetch).toHaveBeenCalled();
  });

  it("offers judges that share questions and opens the next pending item", async () => {
    const view = renderScreen(createApi({}), {apiKey: "key-1"});
    expect(view.getByTestId("ai-review-batch-title")).toBeTruthy();
    expect(view.queryByText("tone-judge (answers 0 of 2)")).toBeNull();
    await press(view.getByTestId("ai-review-batch-answer-next"));
    expect(routerPush).toHaveBeenCalledWith("/admin/ai-review-item?id=r2");
    await press(view.getByTestId("ai-review-batch-items-table-row-r1-clickable"));
    expect(routerPush).toHaveBeenCalledWith("/admin/ai-review-item?id=r1");
  });

  it("runs the first judge that has not run yet with the caller key", async () => {
    const runJudge = mock(async (_body: unknown) => ({
      ...BATCH,
      judgeCount: 2,
      judges: [judgeSummary("careful", 1), judgeSummary("quick", 0.75)],
    }));
    const view = renderScreen(
      createApi({
        runJudge,
        status: operatorObservabilityStatus({playgroundAi: {source: "server"}}),
      }),
      {apiKey: "key-1"}
    );
    await press(view.getByTestId("ai-review-batch-run-judge"));
    expect(runJudge).toHaveBeenCalledWith({apiKey: "key-1", batchId: "b1", evaluatorId: "quick"});
    expect(view.queryByTestId("ai-review-batch-run-error")).toBeNull();
  });

  it("reports judge runs with nothing to compare and run failures", async () => {
    const noAnswers = mock(async (_body: unknown) => ({
      ...BATCH,
      judges: [judgeSummary("careful", 1), judgeSummary("quick")],
    }));
    const ran = renderScreen(createApi({runJudge: noAnswers}), {apiKey: "key-1"});
    await press(ran.getByTestId("ai-review-batch-run-judge"));
    expect(noAnswers).toHaveBeenCalled();
    ran.unmount();

    const failing = mock(async (_body: unknown) => {
      throw {data: {title: "Judge prompt has no production output schema"}};
    });
    const failed = renderScreen(createApi({runJudge: failing}), {apiKey: "key-1"});
    await press(failed.getByTestId("ai-review-batch-run-judge"));
    expect(failed.getByTestId("ai-review-batch-run-error")).toBeTruthy();
    expect(failed.getByText("Judge prompt has no production output schema")).toBeTruthy();
    failed.unmount();

    const untitled = mock(async (_body: unknown) => {
      throw new Error("network");
    });
    const generic = renderScreen(createApi({runJudge: untitled}), {apiKey: "key-1"});
    await press(generic.getByTestId("ai-review-batch-run-judge"));
    expect(generic.getByText("Could not run the judge.")).toBeTruthy();
  });

  it("explains why judges cannot run without AI", () => {
    const noServer = renderScreen(
      createApi({status: operatorObservabilityStatus({playgroundAi: {source: "unavailable"}})})
    );
    expect(
      noServer.getByText("No AI service is configured on the server, so judges cannot run.")
    ).toBeTruthy();
    noServer.unmount();

    const requestKey = operatorObservabilityStatus({playgroundAi: {source: "request-key"}});
    const hinted = renderScreen(createApi({status: requestKey}), {
      apiKeyHint: "Save a Gemini key.",
    });
    expect(hinted.getByText("Save a Gemini key.")).toBeTruthy();
    hinted.unmount();

    const fallback = renderScreen(createApi({status: requestKey}));
    expect(fallback.getByText("Save an AI API key to run judges.")).toBeTruthy();
  });
});

describe("AiReviewBatchesScreenWidget", () => {
  beforeEach(() => {
    routerPush.mockClear();
  });

  const renderScreen = (api: AdminApi): ReturnType<typeof renderWithTheme> =>
    renderWithTheme(
      <AiReviewBatchesScreenWidget
        api={api}
        config={config}
        routeBase="/admin"
        screenName="ai-review-batches"
      />
    );

  it("creates a batch from the widest question set and opens it", async () => {
    const create = mock(async (_body: unknown) => BATCH);
    const batches = query([
      {
        counts: BATCH.counts,
        created: BATCH.created,
        evaluatorId: "qs",
        evaluatorName: "summary-questions",
        id: "b1",
        judgeCount: 0,
        name: "Recent summaries",
      },
    ]);
    const view = renderScreen(createApi({batches, create}));
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
    expect(create).toHaveBeenCalledWith({
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
    const create = mock(async (_body: unknown) => {
      throw {data: {title: "No recent traces that are not already in a batch"}};
    });
    const view = renderScreen(createApi({create}));
    await press(view.getByTestId("ai-review-batch-grab-recent"));
    expect(view.getByText("No recent traces that are not already in a batch")).toBeTruthy();

    const untitled = mock(async (_body: unknown) => {
      throw new Error("network");
    });
    const generic = renderScreen(createApi({create: untitled}));
    await press(generic.getByTestId("ai-review-batch-grab-recent"));
    expect(generic.getByText("Could not create the batch.")).toBeTruthy();

    generic.unmount();

    // With no human evaluators there is nothing to batch against.
    const empty = renderScreen(createApi({create, evaluators: []}));
    await act(async () => {
      await empty.UNSAFE_root.findByType(AiReviewBatchesView).props.onCreate();
    });
    expect(empty.getByText("Choose a question set first.")).toBeTruthy();
    expect(
      empty.getByText("Create a human evaluator with one score per question first.")
    ).toBeTruthy();
  });
});
