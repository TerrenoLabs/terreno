import {describe, it, mock} from "bun:test";
import {assert} from "chai";
import TestRenderer, {act, type ReactTestInstance} from "react-test-renderer";
import type {Todo} from "@/store/syncDbSdk";
import {TodoBrowserList, type TodoBrowserListDependencies} from "./TodoBrowserList";

const todo = (_id: string, title: string, completed: boolean, created: string): Todo => ({
  _id,
  completed,
  created,
  ownerId: "user-1",
  title,
  updated: created,
});

const TODOS: Record<string, Todo> = {
  "todo-1": todo("todo-1", "Book the venue", false, "2026-10-01T00:00:00Z"),
  "todo-2": todo("todo-2", "Pay the bill", true, "2026-10-02T00:00:00Z"),
  "todo-3": todo("todo-3", "Order lunch", false, "2026-10-02T00:00:00Z"),
  "todo-4": todo("todo-4", "Draft the agenda", false, ""),
};

const buildDependencies = ({
  ids,
  selectedId,
  select,
}: {
  ids: string[];
  selectedId?: string;
  select: (id: string) => void;
}): TodoBrowserListDependencies => ({
  // Sorts with the list's own comparator, as the sync store would.
  useEntityIds: (_collection, {sort}) =>
    ids
      .map((id) => TODOS[id])
      .filter((entry): entry is Todo => entry !== undefined)
      .sort(sort)
      .map((entry) => entry._id),
  useListDetail: () => ({select, selectedId}),
  useTodo: (id: string) => ({data: TODOS[id]}),
});

const render = async (dependencies: TodoBrowserListDependencies): Promise<ReactTestInstance> => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<TodoBrowserList dependencies={dependencies} />);
  });
  assert.isDefined(renderer);
  return (renderer as TestRenderer.ReactTestRenderer).root;
};

// Host nodes only: findAllByProps also matches the composite component that passes the prop.
const byTestId = (root: ReactTestInstance, testID: string): ReactTestInstance[] => {
  return root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
};

const hasText = (root: ReactTestInstance, text: string): boolean => {
  return root.findAll((node) => node.children.includes(text)).length > 0;
};

describe("TodoBrowserList", () => {
  it("shows an empty state when there are no todos", async () => {
    const root = await render(buildDependencies({ids: [], select: mock(() => {})}));

    assert.lengthOf(byTestId(root, "todo-browser-empty"), 1);
    assert.lengthOf(byTestId(root, "todo-browser-list"), 0);
  });

  it("lists each todo with its status and marks the open one selected", async () => {
    const root = await render(
      buildDependencies({ids: ["todo-1", "todo-2"], select: mock(() => {}), selectedId: "todo-2"})
    );

    assert.isTrue(hasText(root, "Book the venue"));
    assert.isTrue(hasText(root, "To do"));
    assert.isTrue(hasText(root, "Completed"));
    const [open] = byTestId(root, "todo-browser-item-todo-2");
    const [closed] = byTestId(root, "todo-browser-item-todo-1");
    assert.deepEqual(open?.props.accessibilityState, {selected: true});
    assert.deepEqual(closed?.props.accessibilityState, {selected: false});
  });

  it("opens a todo through the layout when its row is pressed", async () => {
    const select = mock((_id: string) => {});
    const root = await render(buildDependencies({ids: ["todo-1"], select}));

    const [row] = byTestId(root, "todo-browser-item-todo-1");
    await act(async () => {
      row?.props.onClick();
    });

    assert.deepEqual(select.mock.calls, [["todo-1"]]);
  });

  it("orders todos newest first, undated first, ties by id", async () => {
    const root = await render(
      buildDependencies({ids: ["todo-1", "todo-3", "todo-2", "todo-4"], select: mock(() => {})})
    );

    const order = root
      .findAll(
        (node) =>
          typeof node.type === "string" &&
          typeof node.props.testID === "string" &&
          node.props.testID.startsWith("todo-browser-item-")
      )
      .map((node) => node.props.testID);

    assert.deepEqual(order, [
      "todo-browser-item-todo-4",
      "todo-browser-item-todo-2",
      "todo-browser-item-todo-3",
      "todo-browser-item-todo-1",
    ]);
  });
});
