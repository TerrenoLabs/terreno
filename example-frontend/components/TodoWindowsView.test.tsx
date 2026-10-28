import {describe, it, mock} from "bun:test";
import type {UseWindowQueryResult} from "@terreno/syncdb/react";
import {assert} from "chai";
import React from "react";
import {act, create, type ReactTestInstance, type ReactTestRenderer} from "react-test-renderer";
import type {Todo} from "@/store/syncDbSdk";
import {TodoWindowsView, type TodoWindowsViewProps} from "./TodoWindowsView";

const todo = (id: string, overrides: Partial<Todo> = {}): Todo => ({
  _id: id,
  completed: false,
  created: "2026-10-04T00:00:00.000Z",
  ownerId: "u1",
  title: `Todo ${id}`,
  updated: "2026-10-04T00:00:00.000Z",
  ...overrides,
});

const windowResult = (
  rows: Todo[],
  overrides: Partial<UseWindowQueryResult<Todo>> = {}
): UseWindowQueryResult<Todo> => ({
  data: rows,
  fetchNextPage: mock(async (): Promise<void> => {}),
  hasMore: false,
  ids: rows.map((row) => row._id),
  isError: false,
  isFetching: false,
  isLoading: false,
  refetch: mock(async (): Promise<void> => {}),
  total: rows.length,
  ...overrides,
});

const render = (props: Partial<TodoWindowsViewProps> = {}): ReactTestRenderer => {
  const full: TodoWindowsViewProps = {
    missingField: {isEnabled: false, onRun: mock((): void => {}), window: windowResult([])},
    onBack: mock((): void => {}),
    onToggle: mock((_todo: Todo): void => {}),
    openTodos: windowResult([todo("a"), todo("b")]),
    recentTodos: windowResult([todo("b"), todo("c", {completed: true})]),
    ...props,
  };
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<TodoWindowsView {...full} />);
  });
  if (!renderer) {
    throw new Error("render failed");
  }
  return renderer;
};

const byTestId = (renderer: ReactTestRenderer, testID: string): ReactTestInstance[] =>
  renderer.root.findAll((node) => node.props.testID === testID && typeof node.type === "string");

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");

/** Works with either the preload Button (onPress) or a sibling suite's host mock (onClick). */
const press = (node: ReactTestInstance): void => {
  const handler = (node.props.onPress ?? node.props.onClick) as (() => unknown) | undefined;
  assert.isDefined(handler, `no press handler on ${String(node.props.testID)}`);
  act(() => {
    handler?.();
  });
};

describe("TodoWindowsView", () => {
  it("shows each window's own rows and counts shared rows once", () => {
    const renderer = render();
    assert.equal(
      textOf(byTestId(renderer, "todo-windows-stats-text")[0]),
      "Open: 2 · Recent: 2 · Shared: 1 · Rows stored for both: 3"
    );
    assert.lengthOf(byTestId(renderer, "todo-windows-open-row-a"), 1);
    assert.lengthOf(byTestId(renderer, "todo-windows-open-row-c"), 0);
    assert.lengthOf(byTestId(renderer, "todo-windows-recent-row-c"), 1);
    assert.equal(textOf(byTestId(renderer, "todo-windows-open-count")[0]), "Showing 2 of 2");
  });

  it("toggles a row and pages or refetches its window", () => {
    const onToggle = mock((_todo: Todo): void => {});
    const openTodos = windowResult([todo("a")], {hasMore: true, total: 9});
    const renderer = render({onToggle, openTodos});
    press(byTestId(renderer, "todo-windows-open-toggle-a")[0]);
    assert.equal(onToggle.mock.calls[0]?.[0]._id, "a");
    press(byTestId(renderer, "todo-windows-open-load-more")[0]);
    press(byTestId(renderer, "todo-windows-open-refetch")[0]);
    assert.equal((openTodos.fetchNextPage as ReturnType<typeof mock>).mock.calls.length, 1);
    assert.equal((openTodos.refetch as ReturnType<typeof mock>).mock.calls.length, 1);
    assert.equal(textOf(byTestId(renderer, "todo-windows-open-count")[0]), "Showing 1 of 9");
  });

  it("reports failed page loads and refetches without throwing", async () => {
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]): void => {
      warnings.push(args[0]);
    };
    try {
      const openTodos = windowResult([todo("a")], {
        fetchNextPage: async (): Promise<void> => {
          throw new Error("page failed");
        },
        hasMore: true,
        refetch: async (): Promise<void> => {
          throw new Error("refetch failed");
        },
      });
      const renderer = render({openTodos});
      press(byTestId(renderer, "todo-windows-open-load-more")[0]);
      press(byTestId(renderer, "todo-windows-open-refetch")[0]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(warnings, ["Load more failed", "Refetch failed"]);
    } finally {
      console.warn = warn;
    }
  });

  it("shows loading, fetching, empty, and error states", () => {
    const renderer = render({
      openTodos: windowResult([], {error: "boom", isLoading: true, total: undefined}),
      recentTodos: windowResult([], {isFetching: true}),
    });
    assert.equal(textOf(byTestId(renderer, "todo-windows-open-count")[0]), "Showing 0");
    assert.lengthOf(byTestId(renderer, "todo-windows-recent-fetching"), 1);
    const texts = renderer.root
      .findAll((node) => typeof node.type === "string")
      .map((node) => textOf(node));
    assert.include(texts, "boom");
    assert.include(texts, "Loading…");
    assert.include(texts, "No matching todos.");
  });

  it("runs the missing-queryFields demo and shows its error code", () => {
    const onRun = mock((): void => {});
    const onBack = mock((): void => {});
    const renderer = render({
      missingField: {
        isEnabled: true,
        onRun,
        window: windowResult([], {
          error: 'Add "title" to queryFields',
          errorCode: "query-param-not-allowed",
          isError: true,
        }),
      },
      onBack,
    });
    press(byTestId(renderer, "todo-windows-back")[0]);
    assert.equal(onBack.mock.calls.length, 1);
    const errorBox = byTestId(renderer, "todo-windows-missing-field-error")[0];
    assert.include(textOf(errorBox), "query-param-not-allowed");
    assert.include(textOf(errorBox), 'Add "title" to queryFields');
  });

  it("lets the demo run when enabled is false", () => {
    const onRun = mock((): void => {});
    const renderer = render({
      missingField: {isEnabled: false, onRun, window: windowResult([])},
    });
    press(byTestId(renderer, "todo-windows-missing-field-run")[0]);
    assert.equal(onRun.mock.calls.length, 1);
    assert.lengthOf(byTestId(renderer, "todo-windows-missing-field-error"), 0);
  });
});
