# Screen Patterns — Terreno Apps

## List screen (synced collection)

Synced collections read from the local store: no loading spinner after bootstrap, and
writes apply immediately.

```tsx
import {generateMutationId} from "@terreno/syncdb";
import {useMutate, useQuery} from "@terreno/syncdb/react";
import {Box, Button, Card, Heading, Page, Text} from "@terreno/ui";
import {useCallback} from "react";

const TodoListScreen: React.FC = () => {
  const todos = useQuery<Todo>("todos", {sort: "-created"});
  const {create} = useMutate("todos");

  const handleCreate = useCallback((): void => {
    create({data: {_id: generateMutationId(), title: "New todo", completed: false}});
  }, [create]);

  return (
    <Page title="Todos" scroll>
      <Box gap={3} padding={4}>
        <Box direction="row" justifyContent="between" alignItems="center">
          <Heading size="lg">Todos</Heading>
          <Button text="Add" onClick={handleCreate} iconName="plus" />
        </Box>
        {todos.length === 0 ? (
          <Text color="secondaryLight">No todos yet</Text>
        ) : (
          todos.map((todo) => (
            <Card key={todo._id} padding={3}>
              <Text>{todo.title}</Text>
            </Card>
          ))
        )}
      </Box>
    </Page>
  );
};
```

Gate the empty state on the stream's bootstrap (see `docs/how-to/use-syncdb-correctly.md`).

## Profile screen

Use `TapToEdit` for per-field profile edits. Save each field with the generated `usePatchAuthMeMutation` — do not collect every field behind one Save button.

```tsx
import {Box, Card, Page, TapToEdit} from "@terreno/ui";
import {useCallback, useEffect, useState} from "react";
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";

const ProfileScreen: React.FC = () => {
  const {data: profile} = useGetAuthMeQuery();
  const [updateProfile] = usePatchAuthMeMutation();
  const [name, setName] = useState<string>("");

  // Seed only this field from the server so saving another TapToEdit does not wipe the draft.
  useEffect(() => {
    if (!profile) {
      return;
    }
    setName(profile.name || "");
  }, [profile?.name]);

  const handleSaveName = useCallback(
    async (value: string): Promise<void> => {
      await updateProfile({name: value}).unwrap();
    },
    [updateProfile]
  );

  return (
    <Page title="Profile" scroll>
      <Box gap={4} padding={4}>
        <Card>
          <TapToEdit
            onSave={handleSaveName}
            setValue={setName}
            title="Name"
            type="text"
            value={name}
          />
        </Card>
      </Box>
    </Page>
  );
};
```

## Form screen

```tsx
import {generateMutationId} from "@terreno/syncdb";
import {useMutate} from "@terreno/syncdb/react";
import {Box, Button, Page, TextField} from "@terreno/ui";
import {useCallback, useState} from "react";
import {useRouter} from "expo-router";

const CreateTodoScreen: React.FC = () => {
  const router = useRouter();
  const [title, setTitle] = useState<string>("");
  const [titleError, setTitleError] = useState<string | undefined>();
  const {create} = useMutate("todos");

  const handleSubmit = useCallback((): void => {
    if (!title.trim()) {
      setTitleError("Title is required");
      return;
    }
    create({data: {_id: generateMutationId(), title: title.trim(), completed: false}});
    router.back();
  }, [create, router, title]);

  return (
    <Page title="New Todo" scroll>
      <Box gap={4} padding={4}>
        <TextField
          title="Title"
          value={title}
          onChange={setTitle}
          errorText={titleError}
        />
        <Button text="Save" onClick={handleSubmit} fullWidth />
      </Box>
    </Page>
  );
};
```

Server rejections arrive later in `useConflicts()` / `useSyncStatus().failedCount`, not
from `create`.

## Detail screen with params

```tsx
import {useEntity} from "@terreno/syncdb/react";
import {Page, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";

const TodoDetailScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const {data, deleted} = useEntity<Todo>("todos", id ?? "");

  if (!data || deleted) {
    return <Page title="Todo"><Text color="error">Not found</Text></Page>;
  }

  return (
    <Page title={data.title} scroll>
      <Text>{data.title}</Text>
    </Page>
  );
};
```

## Admin table screen

Prefer `@terreno/admin-frontend` over hand-rolled tables. Use `AdminScreenRouter` so
custom screens and models share `[model]/index`. Full nav and custom-screen rules:
skill `building-admin-interfaces`.

```tsx
import {AdminScreenRouter} from "@terreno/admin-frontend";
import {useLocalSearchParams} from "expo-router";

// Rendered inside the AdminProvider in app/admin/_layout.tsx.
const AdminModelScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  return <AdminScreenRouter apiBase="/admin" name={model ?? ""} routeBase="/admin" />;
};
```
