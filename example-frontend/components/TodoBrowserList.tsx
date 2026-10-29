import {useEntityIds} from "@terreno/syncdb/react";
import {Box, FlatList, type ListDetailState, Text, useListDetail} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {memo, useCallback} from "react";
import {type Todo, useTodo} from "@/store/syncDbSdk";

/** Newest first; `_id` breaks ties so the order is stable between renders. */
const sortByCreatedDesc = (a: Todo, b: Todo): number => {
  const aMillis = a.created ? DateTime.fromISO(a.created).toMillis() : Number.MAX_SAFE_INTEGER;
  const bMillis = b.created ? DateTime.fromISO(b.created).toMillis() : Number.MAX_SAFE_INTEGER;
  if (aMillis !== bMillis) {
    return bMillis - aMillis;
  }
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
};

/** The hooks the list reads; tests pass fakes instead of a router and a sync client. */
export interface TodoBrowserListDependencies {
  useListDetail: () => Pick<ListDetailState, "select" | "selectedId">;
  useTodo: (id: string) => {data?: Pick<Todo, "completed" | "title">};
  useEntityIds: (collection: "todos", options: {sort: (a: Todo, b: Todo) => number}) => string[];
}

const defaultDependencies: TodoBrowserListDependencies = {
  useEntityIds,
  useListDetail,
  useTodo,
};

/** One row. Subscribes only to its own todo, so an edit re-renders just this row. */
const TodoBrowserRow: React.FC<{
  id: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  useRowTodo: TodoBrowserListDependencies["useTodo"];
}> = memo(({id, isSelected, onSelect, useRowTodo}) => {
  const {data} = useRowTodo(id);
  const title = data?.title ?? "";

  const handleSelect = useCallback((): void => {
    onSelect(id);
  }, [id, onSelect]);

  return (
    <Box
      accessibilityHint="Opens the todo"
      accessibilityLabel={title}
      accessibilityState={{selected: isSelected}}
      border="default"
      color={isSelected ? "secondaryExtraLight" : "base"}
      onClick={handleSelect}
      paddingX={4}
      paddingY={3}
      testID={`todo-browser-item-${id}`}
    >
      <Text bold={!data?.completed}>{title}</Text>
      <Text color="secondaryLight" size="sm">
        {data?.completed ? "Completed" : "To do"}
      </Text>
    </Box>
  );
});

/**
 * The todo list for the todo browser. Reads and changes the open todo through the surrounding
 * ListDetailLayout: stacked on a phone, the left pane on a tablet.
 */
export const TodoBrowserList: React.FC<{dependencies?: TodoBrowserListDependencies}> = ({
  dependencies = defaultDependencies,
}) => {
  const {select, selectedId} = dependencies.useListDetail();
  const ids = dependencies.useEntityIds("todos", {sort: sortByCreatedDesc});
  const useRowTodo = dependencies.useTodo;

  const renderItem = useCallback(
    ({item}: {item: string}): React.ReactElement => (
      <TodoBrowserRow
        id={item}
        isSelected={item === selectedId}
        onSelect={select}
        useRowTodo={useRowTodo}
      />
    ),
    [select, selectedId, useRowTodo]
  );

  if (ids.length === 0) {
    return (
      <Box alignItems="center" color="base" flex="grow" justifyContent="center" padding={6}>
        <Text color="secondaryLight" testID="todo-browser-empty">
          No todos yet. Add one on the Todos tab.
        </Text>
      </Box>
    );
  }

  return (
    <Box color="base" flex="grow" testID="todo-browser-list">
      <FlatList
        data={ids}
        extraData={selectedId}
        keyExtractor={(id) => id}
        renderItem={renderItem}
      />
    </Box>
  );
};
