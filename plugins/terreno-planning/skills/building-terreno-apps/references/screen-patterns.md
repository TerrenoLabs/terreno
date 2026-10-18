# Screen Patterns — Terreno Apps

## List screen

```tsx
import {Box, Button, Card, Heading, Page, Spinner, Text} from "@terreno/ui";
import {useCallback} from "react";
import {useGetTodosQuery} from "@/store/sdk";

const TodoListScreen: React.FC = () => {
  const {data, isLoading, error, refetch} = useGetTodosQuery({});

  const handleCreate = useCallback((): void => {
    // navigate or open modal
  }, []);

  if (isLoading) {
    return <Page title="Todos"><Spinner /></Page>;
  }
  if (error) {
    return (
      <Page title="Todos">
        <Text color="error">Failed to load</Text>
        <Button text="Retry" onClick={refetch} />
      </Page>
    );
  }

  const items = data?.data ?? [];

  return (
    <Page title="Todos" scroll>
      <Box gap={3} padding={4}>
        <Box direction="row" justifyContent="between" alignItems="center">
          <Heading size="lg">Todos</Heading>
          <Button text="Add" onClick={handleCreate} iconName="plus" />
        </Box>
        {items.length === 0 ? (
          <Text color="secondaryLight">No todos yet</Text>
        ) : (
          items.map((todo) => (
            <Card key={todo.id} padding={3}>
              <Text>{todo.title}</Text>
            </Card>
          ))
        )}
      </Box>
    </Page>
  );
};
```

## Profile screen

Use `TapToEdit` for per-field profile edits. Save each field with `usePatchMeMutation` — do not collect every field behind one Save button.

```tsx
import {Box, Card, Page, TapToEdit} from "@terreno/ui";
import {useCallback, useEffect, useState} from "react";
import {useGetMeQuery, usePatchMeMutation} from "@/store/sdk";

const ProfileScreen: React.FC = () => {
  const {data: profile} = useGetMeQuery();
  const [updateProfile] = usePatchMeMutation();
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
import {Box, Button, Page, TextField} from "@terreno/ui";
import {useCallback, useState} from "react";
import {useRouter} from "expo-router";
import {usePostTodosMutation} from "@/store/sdk";

const CreateTodoScreen: React.FC = () => {
  const router = useRouter();
  const [title, setTitle] = useState<string>("");
  const [titleError, setTitleError] = useState<string | undefined>();
  const [createTodo, {isLoading}] = usePostTodosMutation();

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!title.trim()) {
      setTitleError("Title is required");
      return;
    }
    try {
      await createTodo({title: title.trim(), completed: false}).unwrap();
      router.back();
    } catch (err) {
      console.error("Create failed", err);
    }
  }, [createTodo, router, title]);

  return (
    <Page title="New Todo" scroll>
      <Box gap={4} padding={4}>
        <TextField
          title="Title"
          value={title}
          onChange={setTitle}
          errorText={titleError}
        />
        <Button text="Save" onClick={handleSubmit} loading={isLoading} fullWidth />
      </Box>
    </Page>
  );
};
```

## Detail screen with params

```tsx
import {Page, Spinner, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import {useGetTodosByIdQuery} from "@/store/sdk";

const TodoDetailScreen: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  const {data, isLoading, error} = useGetTodosByIdQuery({id: id ?? ""}, {skip: !id});

  if (isLoading) {
    return <Page title="Todo"><Spinner /></Page>;
  }
  if (error || !data) {
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

// Rendered inside the AdminProvider in app/admin/_layout.tsx; no RTK `api` prop.
const AdminModelScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  return <AdminScreenRouter apiBase="/admin" name={model ?? ""} routeBase="/admin" />;
};
```
