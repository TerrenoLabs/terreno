import {beforeEach, describe, it} from "bun:test";
import {createApiClient} from "@terreno/syncdb/api";
import {ApiClientProvider} from "@terreno/syncdb/react";
import {assert} from "chai";
import React from "react";
import TestRenderer, {act, type ReactTestInstance} from "react-test-renderer";
import {getAiSessionId} from "@/lib/aiSession";
import type {Todo} from "@/store/syncDbSdk";
import {TodoSummaryCard} from "./TodoSummaryCard";

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
let nextResponse: FakeResponse = {body: {output: "Two todos remain."}, status: 200};

// Answers every request through the real request client, recording what the card sent.
const fakeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  requests.push({
    body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    method: init?.method ?? "GET",
    url: input,
  });
  return new Response(JSON.stringify(nextResponse.body), {
    headers: {"Content-Type": "application/json"},
    status: nextResponse.status,
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
    ? {useApiKey: (): string => apiKey, useTodoList: (): {data: Todo[]} => ({data: todos})}
    : undefined;
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

describe("TodoSummaryCard", () => {
  beforeEach(() => {
    requests.splice(0);
    nextResponse = {body: {output: "Two todos remain."}, status: 200};
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
});
