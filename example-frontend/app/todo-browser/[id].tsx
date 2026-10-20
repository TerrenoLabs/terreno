/**
 * One todo in the todo browser, read from the route's `[id]` param.
 */
import {Box, Button, Heading, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback} from "react";
import {useSyncDbReady} from "@/hooks/useSyncDbReady";
import {useTodo, useUpdateTodo} from "@/store/syncDbSdk";

const TodoBrowserDetail: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const {data} = useTodo(id);
  const [patchTodo] = useUpdateTodo();
  const isSyncDbReady = useSyncDbReady();
  const completed = Boolean(data?.completed);

  const handleToggle = useCallback((): void => {
    if (!isSyncDbReady || !id) {
      return;
    }
    patchTodo({data: {completed: !completed}, id});
  }, [completed, id, isSyncDbReady, patchTodo]);

  if (!data) {
    return (
      <Box alignItems="center" flex="grow" justifyContent="center" padding={6}>
        <Text testID="todo-browser-detail-missing">This todo does not exist.</Text>
      </Box>
    );
  }

  const created = data.created
    ? DateTime.fromISO(data.created).toFormat("LLL d, yyyy, h:mm a")
    : "";

  return (
    <Box color="base" flex="grow" gap={3} padding={6} testID={`todo-browser-detail-${id}`}>
      <Heading size="lg">{data.title}</Heading>
      <Text testID="todo-browser-detail-status">{completed ? "Completed" : "To do"}</Text>
      {created ? (
        <Text color="secondaryLight" size="sm">
          Created {created}
        </Text>
      ) : null}
      <Box alignItems="start">
        <Button
          disabled={!isSyncDbReady}
          iconName={completed ? "rotate-left" : "check"}
          onClick={handleToggle}
          testID="todo-browser-detail-toggle"
          text={completed ? "Mark to do" : "Mark complete"}
          variant="secondary"
        />
      </Box>
    </Box>
  );
};

export default TodoBrowserDetail;
