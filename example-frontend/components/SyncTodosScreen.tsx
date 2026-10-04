import {FlashList, type ListRenderItemInfo} from "@shopify/flash-list";
import {generateMutationId} from "@terreno/syncdb";
import {useEntityIds, useSyncStatus} from "@terreno/syncdb/react";
import {
  Box,
  Button,
  Card,
  CheckBox,
  Heading,
  IconButton,
  SyncStatusBanner,
  Text,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {memo, useCallback, useMemo, useState} from "react";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {NotificationCenterBell} from "@/components/NotificationCenter";
import {useSyncConflictsController} from "@/components/SyncConflictsController";
import {SyncDevPanel} from "@/components/SyncDevPanel";
import {TodoSummaryCard} from "@/components/TodoSummaryCard";
import {useSyncDbReady} from "@/hooks/useSyncDbReady";
import {logout, useAppDispatch} from "@/store/index";
import {
  type CreateTodoBody,
  type Todo,
  useCreateTodo,
  useDeleteTodo,
  useTodo,
  useUpdateTodo,
} from "@/store/syncDbSdk";

/**
 * Virtualized row: either a section heading or a todo id.
 */
type TodoListRow =
  | {type: "section"; key: string; title: string; count: number}
  | {type: "todo"; id: string};

const sortByCreatedDesc = (a: Todo, b: Todo): number => {
  // Optimistic creates stamp `created` locally (see handleCreate), so newest-first holds
  // before the server ever acks. The MAX_SAFE_INTEGER fallback keeps any row that somehow
  // lacks a timestamp at the top rather than silently last; `_id` breaks the remaining
  // ties so the order is total — without it, rows sharing a millisecond (or the fallback)
  // shuffle between renders, which in a virtualized list can bounce a row off-screen.
  const aMillis = a.created ? DateTime.fromISO(a.created).toMillis() : Number.MAX_SAFE_INTEGER;
  const bMillis = b.created ? DateTime.fromISO(b.created).toMillis() : Number.MAX_SAFE_INTEGER;
  if (aMillis !== bMillis) {
    return bMillis - aMillis;
  }
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
};

const isIncomplete = (todo: Todo): boolean => !todo.completed;
const isCompleted = (todo: Todo): boolean => Boolean(todo.completed);

/** Extra list padding so the last row sits above the Expo Router tab bar (Playwright's
 * 720px Desktop Chrome viewport otherwise leaves the first todo under `/ai`). */
const TAB_BAR_OVERLAP_PADDING = 96;

/**
 * One row. Subscribes to ONLY its own entity via useEntity, so a change to one
 * todo re-renders just that row — never the whole list. Memoized so a container
 * re-render (adds/removes elsewhere, sync activity) skips untouched rows.
 *
 * Title and completed are both mutable so multi-client races can conflict on
 * either field, or both at once.
 */
const SyncTodoItem: React.FC<{
  id: string;
  onToggle: (id: string, completed: boolean) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}> = memo(({id, onToggle, onRename, onDelete}) => {
  const {data} = useTodo(id);
  const completed = Boolean(data?.completed);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [draftTitle, setDraftTitle] = useState<string>("");

  const handleToggle = useCallback((): void => {
    onToggle(id, completed);
  }, [onToggle, id, completed]);

  const handleDelete = useCallback((): void => {
    onDelete(id);
  }, [onDelete, id]);

  const handleStartEdit = useCallback((): void => {
    setDraftTitle(data?.title ?? "");
    setIsEditing(true);
  }, [data?.title]);

  const commitTitle = useCallback(
    (value: string): void => {
      const nextTitle = value.trim();
      setIsEditing(false);
      if (!nextTitle || nextTitle === (data?.title ?? "")) {
        return;
      }
      onRename(id, nextTitle);
    },
    [data?.title, id, onRename]
  );

  const handleBlurEdit = useCallback(
    (value: string): void => {
      commitTitle(value);
    },
    [commitTitle]
  );

  const handleEnterEdit = useCallback((): void => {
    commitTitle(draftTitle);
  }, [commitTitle, draftTitle]);

  if (!data) {
    return null;
  }

  return (
    <Card
      accessibilityLabel={completed ? "completed todo" : "incomplete todo"}
      marginBottom={2}
      testID={`todo-item-${id}`}
    >
      <Box alignItems="center" direction="row" justifyContent="between">
        <Box alignItems="center" direction="row" flex="grow" gap={2}>
          <Box
            accessibilityHint="Toggles whether this todo is completed"
            accessibilityLabel={completed ? "Mark as not done" : "Mark as done"}
            onClick={handleToggle}
            testID={`todo-toggle-${id}`}
          >
            <CheckBox selected={completed} size="md" />
          </Box>
          {isEditing ? (
            <Box flex="grow">
              <TextField
                id={`todo-title-edit-${id}`}
                onBlur={handleBlurEdit}
                onChange={setDraftTitle}
                onEnter={handleEnterEdit}
                testID={`todo-title-input-${id}`}
                value={draftTitle}
              />
            </Box>
          ) : (
            <Box
              accessibilityHint="Opens an input to rename this todo"
              accessibilityLabel="Edit title"
              flex="grow"
              onClick={handleStartEdit}
              testID={`todo-title-${id}`}
            >
              <Text color={completed ? "secondaryLight" : "primary"} underline={completed}>
                {data.title ?? ""}
              </Text>
            </Box>
          )}
        </Box>
        <Box direction="row" gap={1}>
          {!isEditing && (
            <IconButton
              accessibilityLabel="Edit title"
              iconName="pen-to-square"
              onClick={handleStartEdit}
              testID={`todo-edit-${id}`}
              variant="muted"
            />
          )}
          <IconButton
            accessibilityLabel="Delete todo"
            iconName="trash"
            onClick={handleDelete}
            testID={`todo-delete-${id}`}
            variant="destructive"
          />
        </Box>
      </Box>
    </Card>
  );
});

SyncTodoItem.displayName = "SyncTodoItem";

/**
 * The create form owns its own input state so keystrokes re-render only this
 * small component — never the todo list.
 */
const NewTodoForm: React.FC<{disabled: boolean; onCreate: (title: string) => boolean}> = memo(
  ({disabled, onCreate}) => {
    const [newTodoTitle, setNewTodoTitle] = useState<string>("");

    const handleCreate = useCallback((): void => {
      const title = newTodoTitle.trim();
      if (!title) {
        return;
      }
      // Only clear on an accepted create: the screen declines writes until syncdb has
      // started, and clearing regardless would silently discard what the user typed.
      if (onCreate(title)) {
        setNewTodoTitle("");
      }
    }, [newTodoTitle, onCreate]);

    return (
      <Card marginBottom={6} testID={disabled ? "todos-form-loading" : "todos-form-ready"}>
        <Box gap={3}>
          <TextField
            id="todos-title-input"
            onChange={setNewTodoTitle}
            onEnter={handleCreate}
            placeholder="New Todo"
            testID="todos-title-input"
            title="New Todo"
            value={newTodoTitle}
          />
          <Button
            disabled={disabled || !newTodoTitle.trim()}
            fullWidth
            iconName="plus"
            onClick={handleCreate}
            testID="todos-create-button"
            text="Add Todo"
          />
        </Box>
      </Card>
    );
  }
);

NewTodoForm.displayName = "NewTodoForm";

const SectionHeader: React.FC<{title: string; count: number}> = memo(({title, count}) => {
  const sectionSlug = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <Box marginBottom={3} marginTop={2} testID={`todos-${sectionSlug}-section`}>
      <Heading size="lg">
        {title} ({count})
      </Heading>
    </Box>
  );
});

SectionHeader.displayName = "SectionHeader";

/**
 * Local-first Todos screen backed by @terreno/syncdb. Reads come from the local store,
 * writes apply optimistically and sync through the durable outbox.
 *
 * Performance: a single FlashList virtualizes rows so Sync Lab volumes stay scrollable
 * on native. The list container still only re-renders when id membership/order changes
 * (`useEntityIds`); each row subscribes to its own entity via generated `useTodo`.
 */
const SyncTodosScreen: React.FC = () => {
  const isSyncDbReady = useSyncDbReady();
  const [createTodo] = useCreateTodo();
  const [patchTodo] = useUpdateTodo();
  const [deleteTodo] = useDeleteTodo();
  const syncStatus = useSyncStatus();
  // The app mounts exactly one ConflictSheet (owned by SyncHealthToast in _layout.tsx);
  // the banner's conflict badge requests it rather than rendering a second copy.
  const {openConflicts} = useSyncConflictsController();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const listBottomPadding = insets.bottom + TAB_BAR_OVERLAP_PADDING;

  const incompleteIds = useEntityIds<Todo>("todos", {
    filter: isIncomplete,
    sort: sortByCreatedDesc,
  });
  const completedIds = useEntityIds<Todo>("todos", {
    filter: isCompleted,
    sort: sortByCreatedDesc,
  });
  const totalCount = incompleteIds.length + completedIds.length;

  const listData = useMemo((): TodoListRow[] => {
    if (totalCount === 0) {
      return [];
    }
    const rows: TodoListRow[] = [
      {count: incompleteIds.length, key: "incomplete", title: "To Do", type: "section"},
      ...incompleteIds.map((id): TodoListRow => ({id, type: "todo"})),
    ];
    if (completedIds.length > 0) {
      rows.push({
        count: completedIds.length,
        key: "completed",
        title: "Completed",
        type: "section",
      });
      for (const id of completedIds) {
        rows.push({id, type: "todo"});
      }
    }
    return rows;
  }, [completedIds, incompleteIds, totalCount]);

  const handleCreate = useCallback(
    (title: string): boolean => {
      if (!isSyncDbReady) {
        return false;
      }
      // Mint the entity id client-side and embed it in the data so the optimistic
      // local row is renderable/addressable before the server ever sees the document.
      // `created` is stamped locally too (the server overwrites it on save) so the row
      // sorts newest-first immediately instead of tying with every other unacked create.
      const id = generateMutationId();
      const data: CreateTodoBody & {_id: string; created: string} = {
        _id: id,
        completed: false,
        created: DateTime.now().toISO(),
        title,
      };
      createTodo({data, id});
      return true;
    },
    [createTodo, isSyncDbReady]
  );

  const handleToggleTodo = useCallback(
    (id: string, completed: boolean): void => {
      if (!isSyncDbReady) {
        return;
      }
      patchTodo({data: {completed: !completed}, id});
    },
    [isSyncDbReady, patchTodo]
  );

  const handleRenameTodo = useCallback(
    (id: string, title: string): void => {
      if (!isSyncDbReady) {
        return;
      }
      patchTodo({data: {title}, id});
    },
    [isSyncDbReady, patchTodo]
  );

  const handleDeleteTodo = useCallback(
    (id: string): void => {
      if (!isSyncDbReady) {
        return;
      }
      deleteTodo({id});
    },
    [isSyncDbReady, deleteTodo]
  );

  const openConflictSheet = useCallback((): void => {
    openConflicts("todos");
  }, [openConflicts]);

  // Replay is paused until this user re-authenticates, and the session we hold is no
  // longer usable — clearing it sends the root layout's redirect effect to /login, and a
  // successful sign-in resumes the queued mutations for the same user.
  const handleAuthRequired = useCallback((): void => {
    dispatch(logout());
  }, [dispatch]);

  const keyExtractor = useCallback((item: TodoListRow): string => {
    if (item.type === "section") {
      return `section:${item.key}`;
    }
    return item.id;
  }, []);

  const getItemType = useCallback((item: TodoListRow): string => item.type, []);

  const renderItem = useCallback(
    ({item}: ListRenderItemInfo<TodoListRow>): React.ReactElement | null => {
      if (item.type === "section") {
        return <SectionHeader count={item.count} title={item.title} />;
      }
      return (
        <SyncTodoItem
          id={item.id}
          onDelete={handleDeleteTodo}
          onRename={handleRenameTodo}
          onToggle={handleToggleTodo}
        />
      );
    },
    [handleDeleteTodo, handleRenameTodo, handleToggleTodo]
  );

  // Reads alongside the `todos-count` number, which stays bare so load tests can parse it.
  const countSummary = useMemo((): string => {
    const noun = totalCount === 1 ? "todo" : "todos";
    return `${noun} · ${incompleteIds.length} remaining · ${completedIds.length} completed`;
  }, [completedIds.length, incompleteIds.length, totalCount]);

  const listHeader = useMemo(
    (): React.ReactElement => (
      <Box>
        <SyncDevPanel />
        <Box alignItems="center" direction="row" justifyContent="between" marginBottom={6}>
          <Box flex="grow">
            <Heading size="xl">My Todos</Heading>
            <Text color="secondaryLight" size="sm">
              Local-first via @terreno/syncdb
            </Text>
          </Box>
          <NotificationCenterBell />
        </Box>
        <Box alignItems="center" direction="row" gap={1} marginBottom={6} wrap>
          <Text color="secondaryLight" size="sm" testID="todos-count">
            {totalCount}
          </Text>
          <Text color="secondaryLight" size="sm" testID="todos-count-summary">
            {countSummary}
          </Text>
        </Box>
        <NewTodoForm disabled={!isSyncDbReady} onCreate={handleCreate} />
        <TodoSummaryCard />
      </Box>
    ),
    [countSummary, handleCreate, isSyncDbReady, totalCount]
  );

  const listEmpty = useMemo(
    (): React.ReactElement => (
      <Text color="secondaryLight" testID="todos-empty-state">
        No todos yet. Add one above!
      </Text>
    ),
    []
  );

  return (
    <Box
      alignSelf="center"
      flex="grow"
      maxWidth={800}
      padding={4}
      style={{flex: 1}}
      testID="todos-screen"
      width="100%"
    >
      <SyncStatusBanner
        conflictCount={syncStatus.conflictCount}
        draining={syncStatus.draining}
        failedCount={syncStatus.failedCount}
        isOnline={syncStatus.isOnline}
        onAuthRequired={handleAuthRequired}
        onOpenConflicts={openConflictSheet}
        paused={syncStatus.paused}
        queuedCount={syncStatus.queuedCount}
        sentThisDrain={syncStatus.sentThisDrain}
        totalThisDrain={syncStatus.totalThisDrain}
      />
      <FlashList
        contentContainerStyle={{paddingBottom: listBottomPadding}}
        contentInsetAdjustmentBehavior="automatic"
        data={listData}
        getItemType={getItemType}
        keyboardShouldPersistTaps="handled"
        keyExtractor={keyExtractor}
        ListEmptyComponent={listEmpty}
        ListHeaderComponent={listHeader}
        renderItem={renderItem}
        style={{flex: 1}}
      />
    </Box>
  );
};

export default SyncTodosScreen;
