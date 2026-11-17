import {expect, test} from "./fixtures/test";
import {AI_FEEDBACK_USER} from "./fixtures/testUsers";
import {getAdminToken} from "./helpers/adminAuth";
import {ensureSummarizeFeedbackFixtures} from "./helpers/aiObservabilityFixtures";
import {loginAs} from "./helpers/login";
import {openSyncTodos} from "./helpers/syncdbSuite";
import {clearTodosAs, createTodoAs} from "./helpers/todosApi";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const COMMENT = "Missed a todo";

interface SummarizeBody {
  data?: {output?: string; traceId?: string};
  output?: string;
  traceId?: string;
}

interface TraceRow {
  _id?: string;
  id?: string;
}

interface ReviewRow {
  reason?: string;
  status?: string;
  traceId?: string;
}

const rowId = (row: TraceRow): string | undefined => row.id ?? row._id;

test.describe("AI feedback on the summary card", () => {
  // e2e backends skip the boot seed, so create the prompt and review evaluator this spec needs.
  test.beforeAll(async ({request}) => {
    await ensureSummarizeFeedbackFixtures(request);
  });

  test.beforeEach(async ({page, consoleGuard}) => {
    consoleGuard.allow("Failed to load resource");
    consoleGuard.allow("[syncdb]");
    consoleGuard.allow("[sync]");
    consoleGuard.allow(/WebSocket/i);
    consoleGuard.allow("Sentry not initialized");
    await clearTodosAs(AI_FEEDBACK_USER);
    await createTodoAs(AI_FEEDBACK_USER, "Ship AI feedback");
    await loginAs(page, AI_FEEDBACK_USER);
    await openSyncTodos(page);
  });

  test("user thumbs down with a comment shows in admin Traces and the Review queue", async ({
    page,
    request,
  }) => {
    const summarizeResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/ai/example-summarize") && response.request().method() === "POST"
    );
    await page.getByTestId("todos-summarize-button").click();
    const summarized = (await (await summarizeResponse).json()) as SummarizeBody;
    const traceId = summarized.data?.traceId ?? summarized.traceId;
    expect(traceId, "summarize returns its trace id").toBeTruthy();

    await page.getByTestId("todos-summary-output").waitFor({state: "visible"});

    await page.getByTestId("todos-summary-feedback-negative").click();
    await page.getByTestId("todos-summary-feedback-comment-input").fill(COMMENT);
    await page.getByTestId("todos-summary-feedback-comment-send").click();
    await page.getByTestId("todos-summary-feedback-comment-sent").waitFor({state: "visible"});

    // Admin view of the same trace, through the API the admin Traces and Review screens read.
    const headers = {authorization: `Bearer ${await getAdminToken(request)}`};

    const traces = await request.get(`${API_URL}/ai/observability/traces?thumbs=down`, {headers});
    expect(traces.ok(), await traces.text()).toBe(true);
    const traceList = ((await traces.json()) as {data: TraceRow[]}).data;
    expect(traceList.map(rowId)).toContain(traceId);

    const detail = await request.get(`${API_URL}/ai/observability/traces/${traceId}`, {headers});
    expect(detail.ok(), await detail.text()).toBe(true);
    const detailBody = ((await detail.json()) as {data: {scores?: Array<Record<string, unknown>>}})
      .data;
    expect(detailBody.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          comment: COMMENT,
          name: "thumbs_up",
          source: "user-feedback",
          value: false,
        }),
      ])
    );

    const review = await request.get(`${API_URL}/ai/observability/review?status=pending`, {
      headers,
    });
    expect(review.ok(), await review.text()).toBe(true);
    const items = ((await review.json()) as {data: ReviewRow[]}).data;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({reason: "feedback", status: "pending", traceId}),
      ])
    );
  });

  test("Keep and Dismiss record accepted and dismissed signals on the trace", async ({
    page,
    request,
  }) => {
    const summarizeResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/ai/example-summarize") && response.request().method() === "POST"
    );
    await page.getByTestId("todos-summarize-button").click();
    const summarized = (await (await summarizeResponse).json()) as SummarizeBody;
    const traceId = summarized.data?.traceId ?? summarized.traceId;
    await page.getByTestId("todos-summary-output").waitFor({state: "visible"});

    await page.getByTestId("todos-summary-keep").click();
    await page.getByTestId("todos-summary-dismiss").click();
    await page.getByTestId("todos-summary-output").waitFor({state: "hidden"});

    const headers = {authorization: `Bearer ${await getAdminToken(request)}`};
    await expect
      .poll(async () => {
        const detail = await request.get(`${API_URL}/ai/observability/traces/${traceId}`, {
          headers,
        });
        const scores =
          ((await detail.json()) as {data?: {scores?: Array<{name?: string; source?: string}>}})
            .data?.scores ?? [];
        return scores
          .filter((score) => score.source === "user-signal")
          .map((score) => score.name)
          .sort();
      })
      .toEqual(["accepted", "dismissed"]);
  });
});
