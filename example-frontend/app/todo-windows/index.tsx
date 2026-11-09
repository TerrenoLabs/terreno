/**
 * Route for the query windows demo. Owns the `useTodosWindow` hooks and writes;
 * the UI lives in `components/TodoWindowsView.tsx`.
 */
import {useRouter} from "expo-router";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {TodoWindowsView} from "@/components/TodoWindowsView";
import {useSyncDbReady} from "@/hooks/useSyncDbReady";
import {type Todo, useTodosWindow} from "@/store/syncDbSdk";
import {syncDb} from "@/store/syncdb";

const PAGE_SIZE = 5;

const TodoWindowsScreen: React.FC = () => {
  const router = useRouter();
  const isSyncDbReady = useSyncDbReady();
  const [isMissingFieldEnabled, setIsMissingFieldEnabled] = useState(false);
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
  // `title` is not in the todos route's queryFields: running this shows the loud error.
  const missingFieldWindow = useTodosWindow({skip: !isMissingFieldEnabled, where: {title: "Milk"}});

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  const handleRunMissingField = useCallback((): void => {
    setIsMissingFieldEnabled(true);
  }, []);

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
    <TodoWindowsView
      missingField={{
        isEnabled: isMissingFieldEnabled,
        onRun: handleRunMissingField,
        window: missingFieldWindow,
      }}
      onBack={handleBack}
      onToggle={handleToggle}
      openTodos={openTodos}
      recentTodos={recentTodos}
    />
  );
};

export default TodoWindowsScreen;
