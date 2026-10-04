/**
 * Query windows demo: two server-filtered views over the same todos.
 *
 * Each `useWindowQuery` is its own server list request (`GET /todos?…`) with its own
 * membership, but rows are stored once per id in the local `todos` table. A todo that
 * matches both windows is one row: completing it updates the store once, and the
 * "Open" window drops it while the "Recent" window keeps it. The third card filters on
 * a field missing from the route's `queryFields` to show the loud error path.
 */
import type {UseWindowQueryResult} from "@terreno/syncdb/react";
import {Box, Button, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useRouter} from "expo-router";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {useSyncDbReady} from "@/hooks/useSyncDbReady";
import {type Todo, useTodosWindow} from "@/store/syncDbSdk";
import {syncDb} from "@/store/syncdb";

const PAGE_SIZE = 5;

interface TodoWindowCardProps {
  title: string;
  description: string;
  testID: string;
  window: UseWindowQueryResult<Todo>;
  sharedIds: Set<string>;
  onToggle: (todo: Todo) => void;
}

const TodoWindowCard: React.FC<TodoWindowCardProps> = ({
  title,
  description,
  testID,
  window,
  sharedIds,
  onToggle,
}) => {
  const {data, error, fetchNextPage, hasMore, isFetching, isLoading, refetch, total} = window;

  const handleLoadMore = useCallback(async (): Promise<void> => {
    await fetchNextPage().catch((loadError: unknown) => {
      console.warn("Load more failed", loadError);
    });
  }, [fetchNextPage]);

  const handleRefetch = useCallback(async (): Promise<void> => {
    await refetch().catch((refetchError: unknown) => {
      console.warn("Refetch failed", refetchError);
    });
  }, [refetch]);

  return (
    <Card flex="grow" gap={3} minWidth={280} padding={4} testID={testID}>
      <Box alignItems="center" direction="row" justifyContent="between">
        <Heading size="md">{title}</Heading>
        {isFetching ? <Spinner size="sm" /> : null}
      </Box>
      <Text color="secondaryLight" size="sm">
        {description}
      </Text>
      <Text size="sm" testID={`${testID}-count`}>
        {`Showing ${data.length}${total === undefined ? "" : ` of ${total}`}`}
      </Text>
      {error ? (
        <Text color="error" size="sm">
          {error}
        </Text>
      ) : null}
      {isLoading ? <Spinner /> : null}
      {!isLoading && data.length === 0 ? (
        <Text color="secondaryLight">No matching todos.</Text>
      ) : null}
      <Box gap={2}>
        {data.map((todo) => (
          <Box
            alignItems="center"
            direction="row"
            gap={2}
            justifyContent="between"
            key={todo._id}
            testID={`${testID}-row-${todo._id}`}
          >
            <Box flex="grow">
              <Text underline={todo.completed}>{todo.title}</Text>
              <Text color="secondaryLight" size="sm">
                {DateTime.fromISO(todo.created).toRelative() ?? ""}
                {sharedIds.has(todo._id) ? " · shared row" : ""}
              </Text>
            </Box>
            <Button
              onClick={(): void => onToggle(todo)}
              testID={`${testID}-toggle-${todo._id}`}
              text={todo.completed ? "Reopen" : "Done"}
              variant="secondary"
            />
          </Box>
        ))}
      </Box>
      <Box direction="row" gap={2}>
        <Button
          disabled={!hasMore || isFetching}
          onClick={handleLoadMore}
          testID={`${testID}-load-more`}
          text="Load more"
          variant="outline"
        />
        <Button
          disabled={isFetching}
          iconName="rotate"
          onClick={handleRefetch}
          testID={`${testID}-refetch`}
          text="Refetch"
          variant="muted"
        />
      </Box>
    </Card>
  );
};

/** Filters on `title`, which the todos route does not list in `queryFields`. */
const MissingQueryFieldCard: React.FC = () => {
  const [isEnabled, setIsEnabled] = useState(false);
  const window = useTodosWindow({skip: !isEnabled, where: {title: "Milk"}});

  const handleRun = useCallback((): void => {
    setIsEnabled(true);
  }, []);

  return (
    <Card gap={3} padding={4} testID="todo-windows-missing-field">
      <Heading size="md">Filter on a field missing from queryFields</Heading>
      <Text color="secondaryLight" size="sm">
        {'where: {title: "Milk"} — the todos route allows completed, created, and ownerId.'}
      </Text>
      <Box direction="row">
        <Button
          disabled={isEnabled}
          onClick={handleRun}
          testID="todo-windows-missing-field-run"
          text="Run query"
          variant="outline"
        />
      </Box>
      {window.errorCode ? (
        <Box gap={1} testID="todo-windows-missing-field-error">
          <Text bold color="error" size="sm">
            {window.errorCode}
          </Text>
          <Text color="error" size="sm">
            {window.error}
          </Text>
        </Box>
      ) : null}
    </Card>
  );
};

const TodoWindowsScreen: React.FC = () => {
  const router = useRouter();
  const isSyncDbReady = useSyncDbReady();
  // Rounded to the hour so revisits reuse one window (and its cached membership).
  const since = useMemo(
    (): string => DateTime.now().minus({days: 1}).startOf("hour").toUTC().toISO() ?? "",
    []
  );

  const openTodos = useTodosWindow({
    pageSize: PAGE_SIZE,
    sort: "-created",
    where: {completed: false},
  });
  const recentTodos = useTodosWindow({
    pageSize: PAGE_SIZE,
    sort: "-created",
    where: {created: {$gte: since}},
  });

  const sharedIds = useMemo((): Set<string> => {
    const recent = new Set(recentTodos.ids);
    return new Set(openTodos.ids.filter((id) => recent.has(id)));
  }, [openTodos.ids, recentTodos.ids]);
  const storedRowCount = new Set([...openTodos.ids, ...recentTodos.ids]).size;

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  const handleToggle = useCallback(
    (todo: Todo): void => {
      if (!isSyncDbReady) {
        return;
      }
      syncDb.mutate({
        collection: "todos",
        data: {completed: !todo.completed},
        id: todo._id,
        operation: "update",
      });
    },
    [isSyncDbReady]
  );

  return (
    <Page navigation={undefined} scroll>
      <Box
        alignSelf="center"
        gap={5}
        maxWidth={1000}
        padding={4}
        testID="todo-windows-screen"
        width="100%"
      >
        <Box alignItems="center" direction="row" gap={3}>
          <Button
            iconName="arrow-left"
            onClick={handleBack}
            testID="todo-windows-back"
            text="Back"
            variant="ghost"
          />
          <Heading size="xl">Query windows</Heading>
        </Box>
        <Text color="secondaryLight">
          Two server-filtered windows over todos. Each keeps its own result list; rows that match
          both are stored once and update once.
        </Text>
        <Card padding={4} testID="todo-windows-stats">
          <Text size="sm" testID="todo-windows-stats-text">
            {`Open: ${openTodos.ids.length} · Recent: ${recentTodos.ids.length} · Shared: ${sharedIds.size} · Rows stored for both: ${storedRowCount}`}
          </Text>
        </Card>
        <Box direction="row" gap={4} wrap>
          <TodoWindowCard
            description='where: {completed: false}, sort: "-created", 5 per page'
            onToggle={handleToggle}
            sharedIds={sharedIds}
            testID="todo-windows-open"
            title="Open todos"
            window={openTodos}
          />
          <TodoWindowCard
            description='where: {created: {$gte: 24h ago}}, sort: "-created", 5 per page'
            onToggle={handleToggle}
            sharedIds={sharedIds}
            testID="todo-windows-recent"
            title="Created in the last day"
            window={recentTodos}
          />
        </Box>
        <MissingQueryFieldCard />
      </Box>
    </Page>
  );
};

export default TodoWindowsScreen;
