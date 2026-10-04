import {describe, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import TestRenderer, {act, type ReactTestInstance} from "react-test-renderer";
import {TodoSummaryCard} from "./TodoSummaryCard";

let todos: Array<{completed: boolean; id: string; text: string}> = [];
let summarizeError: unknown;

const summarizeExampleTextMock = mock((_body: {apiKey?: string; text: string}) => ({
  unwrap: async (): Promise<{output: string}> => {
    if (summarizeError) {
      throw summarizeError;
    }
    return {output: "Two todos remain."};
  },
}));

const dependencies = {
  useApiKey: (): string => "",
  useSummarize: () =>
    [summarizeExampleTextMock, {isLoading: false}] as [
      typeof summarizeExampleTextMock,
      {isLoading: boolean},
    ],
  useTodoList: () => ({data: todos}),
};

const hasText = (root: ReactTestInstance, text: string): boolean => {
  return root.findAll((node) => node.children.includes(text)).length > 0;
};

describe("TodoSummaryCard", () => {
  it("uses the app hooks by default", async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TodoSummaryCard />);
    });

    assert.isDefined(renderer);
    assert.isTrue(hasText(renderer.root, "Add a todo to summarize."));
  });

  it("disables summarize when there are no todos", async () => {
    todos = [];
    summarizeError = undefined;
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TodoSummaryCard dependencies={dependencies} />);
    });
    assert.isDefined(renderer);
    const root = renderer.root;

    assert.isTrue(hasText(root, "Add a todo to summarize."));
    const button = root.findByProps({testID: "todos-summarize-button"});
    assert.isTrue(button.props.accessibilityState?.disabled ?? button.props.disabled);
  });

  it("renders the unwrapped summary response", async () => {
    todos = [{completed: false, id: "todo-1", text: "Ship observability"}];
    summarizeError = undefined;
    summarizeExampleTextMock.mockClear();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TodoSummaryCard dependencies={dependencies} />);
    });
    assert.isDefined(renderer);
    const root = renderer.root;

    await act(async () => {
      await root.findByProps({testID: "todos-summarize-button"}).props.onClick();
      await Promise.resolve();
    });

    assert.equal(summarizeExampleTextMock.mock.calls.length, 1);
    assert.isTrue(hasText(root, "Two todos remain."));
  });

  it("shows the API error title", async () => {
    todos = [{completed: false, id: "todo-1", text: "Ship observability"}];
    summarizeError = {data: {title: "Provide an AI API key."}};
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TodoSummaryCard dependencies={dependencies} />);
    });
    assert.isDefined(renderer);
    const root = renderer.root;

    await act(async () => {
      await root.findByProps({testID: "todos-summarize-button"}).props.onClick();
      await Promise.resolve();
    });

    assert.isTrue(hasText(root, "Provide an AI API key."));
  });
});
