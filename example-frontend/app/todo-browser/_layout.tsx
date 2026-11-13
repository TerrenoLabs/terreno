/**
 * Todo browser: a ListDetailLayout over the synced todos. Phones push each todo; tablets and
 * wide browsers keep the list on the left and open the todo beside it.
 */
import {Box, ListDetailLayout, Text} from "@terreno/ui";
import type React from "react";
import {TodoBrowserList} from "@/components/TodoBrowserList";

// A deep link to a todo on a phone still has the list to go back to.
export const unstable_settings = {initialRouteName: "index"};

const TodoBrowserLayout: React.FC = () => (
  <ListDetailLayout
    detailHref={(id) => `/todo-browser/${id}`}
    emptyDetail={
      <Box alignItems="center" color="baseAlternate" flex="grow" justifyContent="center">
        <Text color="secondaryLight">Select a todo to see its details.</Text>
      </Box>
    }
    indexHref="/todo-browser"
    list={<TodoBrowserList />}
    screenOptions={{title: "Browse todos"}}
  />
);

export default TodoBrowserLayout;
