import {beforeEach, describe, it, mock} from "bun:test";
import {createApiClient} from "@terreno/syncdb/api";
import {ApiClientProvider} from "@terreno/syncdb/react";
import {assert} from "chai";
import React from "react";
import TestRenderer, {act, type ReactTestInstance} from "react-test-renderer";
import {getAiSessionId} from "@/lib/aiSession";
import type {Todo} from "@/store/syncDbSdk";

import {TodoSummaryCard} from "./TodoSummaryCard";

// The clipboard is injected through the card's `copyText` dependency (no process-global
// mock.module, which check:test-isolation forbids in shared suites).
const setStringAsync = mock(async (_value: string): Promise<void> => {});

interface RecordedRequest {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface FakeResponse {
  body: unknown;
  status: number;
}

const requests: RecordedRequest[] = [];
const SUMMARY_RESPONSE: FakeResponse = {
  body: {data: {output: "Two todos remain.", traceId: "trace-abc"}},
  status: 200,
};
let nextResponse: FakeResponse = SUMMARY_RESPONSE;
let nextFeedbackResponse: FakeResponse = {body: {data: {traceId: "trace-abc"}}, status: 200};

// Answers every request through the real request client, recording what the card sent.
const fakeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  requests.push({
    body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    method: init?.method ?? "GET",
    url: input,
  });
  // Feedback calls answer separately so a test can fail them without touching the summary.
  const isFeedback = input.includes("/feedback");
  const response = isFeedback ? nextFeedbackResponse : nextResponse;
  return new Response(JSON.stringify(response.body), {
    headers: {"Content-Type": "application/json"},
    status: response.status,
  });
};

const makeTodo = (title: string, completed = false): Todo => ({
  _id: `todo-${title}`,
  completed,
  created: "2026-10-01T00:00:00.000Z",
  ownerId: "user-1",
  title,
  updated: "2026-10-01T00:00:00.000Z",
});

const hasText = (root: ReactTestInstance, text: string): boolean => {
  return root.findAll((node) => node.children.includes(text)).length > 0;
};

const renderCard = async ({
  apiKey = "",
  todos,
}: {
  apiKey?: string;
  todos?: Todo[];
}): Promise<ReactTestInstance> => {
  const client = createApiClient({baseUrl: "http://localhost:4000", fetchImpl: fakeFetch});
  const dependencies = todos
    ? {
        copyText: setStringAsync,
        useApiKey: (): string => apiKey,
        useTodoList: (): {data: Todo[]} => ({data: todos}),
      }
    : {copyText: setStringAsync};
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ApiClientProvider client={client}>
        <TodoSummaryCard dependencies={dependencies} />
      </ApiClientProvider>
    );
  });
  return renderer.root;
};

const pressSummarize = async (root: ReactTestInstance): Promise<void> => {
  await act(async () => {
    await root.findByProps({testID: "todos-summarize-button"}).props.onClick();
  });
};

// The first node carrying `prop` for a testID: the outermost wrapper that owns the handler.
const byTestId = (root: ReactTestInstance, testID: string): ReactTestInstance | undefined => {
  return root.findAll((node) => node.props.testID === testID)[0];
};

const hasTestId = (root: ReactTestInstance, testID: string): boolean => {
  return byTestId(root, testID) !== undefined;
};

const feedbackRequests = (): RecordedRequest[] => {
  return requests.filter((request) => request.url.includes("/feedback"));
};

const pressTestId = async (root: ReactTestInstance, testID: string): Promise<void> => {
  const node = root.findAll(
    (n) => n.props.testID === testID && (n.props.onClick || n.props.onPress)
  )[0];
  if (!node) {
    throw new Error(`No pressable with testID ${testID}`);
  }
  await act(async () => {
    await (node.props.onClick ?? node.props.onPress)();
  });
};

const typeComment = async (root: ReactTestInstance, text: string): Promise<void> => {
  const input = root.findAll(
    (n) =>
      n.props.testID === "todos-summary-feedback-comment-input" &&
      (n.props.onChangeText || n.props.onChange)
  )[0];
  if (!input) {
    throw new Error("No comment input");
  }
  await act(async () => {
    (input.props.onChangeText ?? input.props.onChange)(text);
  });
};

const summarizeFirst = async (): Promise<ReactTestInstance> => {
  const root = await renderCard({todos: [makeTodo("Ship observability")]});
  await pressSummarize(root);
  return root;
};

describe("TodoSummaryCard", () => {
  beforeEach(() => {
    requests.splice(0);
    nextResponse = SUMMARY_RESPONSE;
    nextFeedbackResponse = {body: {data: {traceId: "trace-abc"}}, status: 200};
    setStringAsync.mockClear();
  });

  it("uses the app hooks by default", async () => {
    const root = await renderCard({});

    assert.isTrue(hasText(root, "Add a todo to summarize."));
  });

  it("disables summarize when there are no todos", async () => {
    const root = await renderCard({todos: []});

    assert.isTrue(hasText(root, "Add a todo to summarize."));
    const button = root.findByProps({testID: "todos-summarize-button"});
    assert.isTrue(button.props.accessibilityState?.disabled ?? button.props.disabled);
  });

  it("posts the todos with the AI session and key headers and renders the summary", async () => {
    const root = await renderCard({
      apiKey: "gemini-key",
      todos: [makeTodo("Ship observability"), makeTodo("Write docs", true)],
    });

    await pressSummarize(root);

    assert.lengthOf(requests, 1);
    const [request] = requests;
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "http://localhost:4000/ai/example-summarize");
    assert.deepEqual(request?.body, {
      text: "My todo list:\n- [open] Ship observability\n- [done] Write docs",
    });
    assert.equal(request?.headers["x-ai-session-id"], getAiSessionId());
    assert.equal(request?.headers["x-ai-api-key"], "gemini-key");
    assert.isTrue(hasText(root, "Two todos remain."));
  });

  it("omits the key header when no key is saved", async () => {
    const root = await renderCard({todos: [makeTodo("Ship observability")]});

    await pressSummarize(root);

    assert.notProperty(requests[0]?.headers ?? {}, "x-ai-api-key");
  });

  it("shows the API error title", async () => {
    nextResponse = {body: {title: "Provide an AI API key."}, status: 400};
    const root = await renderCard({todos: [makeTodo("Ship observability")]});

    await pressSummarize(root);

    assert.isTrue(hasText(root, "Provide an AI API key."));
    assert.isFalse(hasText(root, "Two todos remain."));
  });

  describe("feedback", () => {
    it("shows thumbs, Keep, Dismiss, and Copy only once a summary is shown", async () => {
      const root = await renderCard({todos: [makeTodo("Ship observability")]});
      const ids = [
        "todos-summary-feedback-positive",
        "todos-summary-feedback-negative",
        "todos-summary-keep",
        "todos-summary-dismiss",
        "todos-summary-copy",
      ];
      for (const id of ids) {
        assert.isFalse(hasTestId(root, id), `${id} before a summary`);
      }

      await pressSummarize(root);

      for (const id of ids) {
        assert.isTrue(hasTestId(root, id), `${id} after a summary`);
      }
    });

    it("sends thumbs down for the summary's trace id, then the comment with it", async () => {
      const root = await summarizeFirst();

      await pressTestId(root, "todos-summary-feedback-negative");

      assert.lengthOf(feedbackRequests(), 1);
      assert.equal(feedbackRequests()[0]?.method, "POST");
      assert.equal(
        feedbackRequests()[0]?.url,
        "http://localhost:4000/ai/observability/traces/trace-abc/feedback"
      );
      assert.deepEqual(feedbackRequests()[0]?.body, {thumbs: "down"});

      await typeComment(root, "Missed a todo");
      await pressTestId(root, "todos-summary-feedback-comment-send");

      assert.lengthOf(feedbackRequests(), 2);
      assert.deepEqual(feedbackRequests()[1]?.body, {comment: "Missed a todo", thumbs: "down"});
      assert.isTrue(hasTestId(root, "todos-summary-feedback-comment-sent"));
    });

    it("sends thumbs up", async () => {
      const root = await summarizeFirst();

      await pressTestId(root, "todos-summary-feedback-positive");

      assert.deepEqual(feedbackRequests()[0]?.body, {thumbs: "up"});
    });

    it("sends thumbs null when the selected thumb is pressed again", async () => {
      const root = await summarizeFirst();

      await pressTestId(root, "todos-summary-feedback-negative");
      await pressTestId(root, "todos-summary-feedback-negative");

      assert.lengthOf(feedbackRequests(), 2);
      assert.deepEqual(feedbackRequests()[1]?.body, {thumbs: null});
    });

    it("Keep sends the accepted signal and shows as pressed", async () => {
      const root = await summarizeFirst();
      const pressedProps = (): string => {
        const node = byTestId(root, "todos-summary-keep");
        return JSON.stringify({
          accessibilityState: node?.props.accessibilityState,
          disabled: node?.props.disabled,
          iconName: node?.props.iconName,
          variant: node?.props.variant,
        });
      };
      const before = pressedProps();

      await pressTestId(root, "todos-summary-keep");

      assert.lengthOf(feedbackRequests(), 1);
      assert.deepEqual(feedbackRequests()[0]?.body, {signal: "accepted"});
      assert.notEqual(pressedProps(), before);
    });

    it("Dismiss sends the dismissed signal and hides the summary", async () => {
      const root = await summarizeFirst();
      assert.isTrue(hasTestId(root, "todos-summary-output"));

      await pressTestId(root, "todos-summary-dismiss");

      assert.deepEqual(feedbackRequests()[0]?.body, {signal: "dismissed"});
      assert.isFalse(hasTestId(root, "todos-summary-output"));
      assert.isFalse(hasText(root, "Two todos remain."));
    });

    it("Copy puts the summary on the clipboard, then sends the copied signal", async () => {
      const root = await summarizeFirst();

      await pressTestId(root, "todos-summary-copy");

      assert.lengthOf(setStringAsync.mock.calls, 1);
      assert.equal(setStringAsync.mock.calls[0]?.[0], "Two todos remain.");
      assert.deepEqual(feedbackRequests()[0]?.body, {signal: "copied"});
      assert.isTrue(hasText(root, "Two todos remain."));
    });

    it("keeps the summary and shows no error text when feedback fails with 404", async () => {
      const root = await summarizeFirst();
      nextFeedbackResponse = {body: {title: "Trace not found"}, status: 404};

      await pressTestId(root, "todos-summary-feedback-negative");
      await pressTestId(root, "todos-summary-keep");

      assert.isAtLeast(feedbackRequests().length, 2);
      assert.isTrue(hasText(root, "Two todos remain."));
      assert.isTrue(hasTestId(root, "todos-summary-output"));
      assert.isFalse(hasTestId(root, "todos-summary-error"));
      assert.isFalse(hasText(root, "Trace not found"));
    });

    it("keeps the summary when the copy signal fails", async () => {
      const root = await summarizeFirst();
      nextFeedbackResponse = {body: {title: "Trace not found"}, status: 404};

      await pressTestId(root, "todos-summary-copy");

      assert.isTrue(hasTestId(root, "todos-summary-output"));
      assert.isFalse(hasTestId(root, "todos-summary-error"));
    });

    it("clears the thumbs and uses the new trace id after summarizing again", async () => {
      const root = await summarizeFirst();
      await pressTestId(root, "todos-summary-feedback-negative");
      const selected = (): unknown =>
        byTestId(root, "todos-summary-feedback-negative")?.props.accessibilityState?.checked;
      assert.isTrue(selected());

      nextResponse = {
        body: {data: {output: "One todo remains.", traceId: "trace-def"}},
        status: 200,
      };
      await pressSummarize(root);

      assert.isFalse(selected());
      assert.isTrue(hasText(root, "One todo remains."));
      await pressTestId(root, "todos-summary-keep");
      const last = feedbackRequests().at(-1);
      assert.equal(last?.url, "http://localhost:4000/ai/observability/traces/trace-def/feedback");
      assert.deepEqual(last?.body, {signal: "accepted"});
    });

    it("sends no feedback when the summary has no trace id", async () => {
      nextResponse = {body: {data: {output: "Two todos remain."}}, status: 200};
      const root = await summarizeFirst();

      await pressTestId(root, "todos-summary-keep");

      assert.lengthOf(feedbackRequests(), 0);
      assert.isTrue(hasText(root, "Two todos remain."));
    });
  });
});
