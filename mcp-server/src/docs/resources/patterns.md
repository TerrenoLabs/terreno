# Terreno Patterns & Best Practices

Collection CRUD is local-first: the backend syncs a collection with `syncPlugin` and a `sync`
config on `modelRouter`, and the frontend reads and writes it with `@terreno/syncdb/react`
(`useQuery`, `useMutate`). Generated RTK Query hooks from `openApiSdk.ts` are only for routes
that are not synced: auth (`/auth/me`), AI, feature flags, and custom request/response actions.

## Backend Patterns

### Model Definition

A synced model uses a String `_id` (offline clients mint ids), `isDeletedPlugin` (via the app's
default plugins), and `syncPlugin`. Types live in `src/types/models/`. Every field has a
`description`.

```typescript
import {syncPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {TodoDocument, TodoModel} from "../types/models/todoTypes";
import {addDefaultPlugins} from "./modelPlugins";

const todoSchema = new mongoose.Schema<TodoDocument, TodoModel>(
  {
    _id: {
      default: (): string => new mongoose.Types.ObjectId().toHexString(),
      description: "The document id (String so offline sync clients can mint ids)",
      type: String,
    },
    completed: {
      default: false,
      description: "Whether the todo item has been completed",
      type: Boolean,
    },
    ownerId: {
      description: "The user who owns this todo",
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    title: {
      description: "The title of the todo item",
      required: true,
      trim: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

// addDefaultPlugins applies createdUpdatedPlugin, isDeletedPlugin, findExactlyOne, findOneOrNone.
addDefaultPlugins(todoSchema);
// Stamps a per-stream _syncSeq on every write; required by the router's sync config.
todoSchema.plugin(syncPlugin);

export const Todo = mongoose.model<TodoDocument, TodoModel>("Todo", todoSchema);
```

### Route Setup

Use the three-argument `modelRouter` and register it on `TerrenoApp` together with `SyncApp`
and `RealtimeApp`. Sync needs a MongoDB replica set (change streams).

```typescript
import {modelRouter, OwnerQueryFilter, Permissions} from "@terreno/api";
import {Todo} from "../models/todo";
import type {UserDocument} from "../types/models/userTypes";

export const todoRouter = modelRouter("/todos", Todo, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsOwner],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
  },
  preCreate: (body, req) => ({
    ...body,
    ownerId: (req.user as unknown as UserDocument)?._id,
  }),
  queryFields: ["completed", "ownerId"],
  queryFilter: OwnerQueryFilter,
  sort: "-created",
  sync: {scope: {type: "owner"}},
});
```

### Custom Endpoints

Add non-CRUD endpoints as `collectionActions` or `instanceActions` on the same `modelRouter`,
not with `router.post`. They get permissions, validation, and OpenAPI automatically.

```typescript
import {APIError, modelRouter, Permissions, z} from "@terreno/api";

export const todoRouter = modelRouter("/todos", Todo, {
  // ...permissions, sync, and the rest from Route Setup
  collectionActions: {
    bulkComplete: {
      body: z.object({ids: z.array(z.string()).min(1)}).strict(),
      handler: async ({body, user}) => {
        const result = await Todo.updateMany(
          {_id: {$in: body.ids}, ownerId: user?._id},
          {$set: {completed: true}}
        );
        return {matched: result.matchedCount, modified: result.modifiedCount};
      },
      method: "POST",
      permissions: [Permissions.IsAuthenticated],
    },
  },
  instanceActions: {
    markComplete: {
      handler: async ({doc}) => {
        if (doc.completed) {
          throw new APIError({status: 409, title: "Todo is already completed"});
        }
        doc.completed = true;
        await doc.save();
        return doc;
      },
      method: "POST",
      permissions: [Permissions.IsOwner],
    },
  },
});
```

## Frontend Patterns

### Screen with Data Fetching

Synced collections are read from the local store with `useQuery` and written with `useMutate`.
Writes apply immediately and sync through the durable outbox: there is no loading state per
request, no `.unwrap()`, and no refetch after a mutation. Wrap the screen (or the app) in
`SyncDbProvider`, and do not call `mutate` until `syncDb.start()` has resolved.

```typescript
import {generateMutationId} from "@terreno/syncdb";
import {SyncDbProvider, useMutate, useQuery} from "@terreno/syncdb/react";
import {Box, Button, Card, CheckBox, Heading, IconButton, Text, TextField} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useState} from "react";
import {useSyncDbReady} from "@/hooks/useSyncDbReady";
import {syncDb} from "@/store/syncdb";

interface Todo {
  _id: string;
  completed?: boolean;
  created: string;
  ownerId: string;
  title: string;
}

const TodoList: React.FC = () => {
  const isSyncDbReady = useSyncDbReady();
  const [newTitle, setNewTitle] = useState<string>("");
  const todos = useQuery<Todo>("todos", {sort: "-created"});
  const {create, update, remove} = useMutate("todos");

  const handleCreate = useCallback((): void => {
    const title = newTitle.trim();
    if (!title || !isSyncDbReady) {
      return;
    }
    // Mint the id locally so the optimistic row is addressable before the server acks it.
    const id = generateMutationId();
    create({data: {_id: id, completed: false, created: DateTime.now().toISO(), title}, id});
    setNewTitle("");
  }, [create, isSyncDbReady, newTitle]);

  const handleToggle = useCallback(
    (todo: Todo): void => {
      update({data: {completed: !todo.completed}, id: todo._id});
    },
    [update]
  );

  const handleDelete = useCallback(
    (id: string): void => {
      remove({id});
    },
    [remove]
  );

  return (
    <Box gap={3} padding={4} testID="todos-screen">
      <Heading size="lg">Todos</Heading>
      <Card>
        <Box gap={3}>
          <TextField
            onChange={setNewTitle}
            onEnter={handleCreate}
            placeholder="New todo"
            testID="todos-title-input"
            title="New Todo"
            value={newTitle}
          />
          <Button
            disabled={!isSyncDbReady || !newTitle.trim()}
            iconName="plus"
            onClick={handleCreate}
            testID="todos-create-button"
            text="Add Todo"
          />
        </Box>
      </Card>
      {todos.length === 0 ? <Text testID="todos-empty-state">No todos yet</Text> : null}
      {todos.map((todo) => (
        <Card key={todo._id} testID={`todo-item-${todo._id}`}>
          <Box alignItems="center" direction="row" gap={2}>
            <Box onClick={() => handleToggle(todo)} testID={`todo-toggle-${todo._id}`}>
              <CheckBox selected={Boolean(todo.completed)} size="md" />
            </Box>
            <Box flex="grow">
              <Text>{todo.title}</Text>
            </Box>
            <IconButton
              accessibilityLabel="Delete todo"
              iconName="trash"
              onClick={() => handleDelete(todo._id)}
              testID={`todo-delete-${todo._id}`}
              variant="destructive"
            />
          </Box>
        </Card>
      ))}
    </Box>
  );
};

const TodosScreen: React.FC = () => (
  <SyncDbProvider client={syncDb}>
    <TodoList />
  </SyncDbProvider>
);

export default TodosScreen;
```

For large lists, render `useEntityIds` in the list and `useEntity` in each row, so a change to
one row re-renders only that row. Running `terreno-syncdb-codegen` generates typed hooks such as
`useTodo`, `useCreateTodo`, and `useUpdateTodo` in `store/syncDbSdk.ts`, which wrap the same
calls.

### Form with Validation

A form that calls a non-synced route uses the generated RTK Query mutation and `.unwrap()`.
Here it updates the signed-in user's profile through `PATCH /auth/me`.

```typescript
import {Box, Button, EmailField, TextField} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";
import {usePatchMeMutation} from "@/store/sdk";

interface FormErrors {
  name?: string;
  email?: string;
}

const ProfileForm: React.FC = () => {
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [updateProfile, {isLoading}] = usePatchMeMutation();

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!name.trim()) {
      newErrors.name = "Name is required";
    }

    if (!email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Invalid email format";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, email]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!validate()) {
      return;
    }

    try {
      await updateProfile({email, name}).unwrap();
    } catch (error: unknown) {
      const fields = (error as {data?: {fields?: FormErrors}}).data?.fields;
      if (fields) {
        setErrors(fields);
      }
    }
  }, [name, email, validate, updateProfile]);

  return (
    <Box gap={3} padding={4}>
      <TextField
        errorText={errors.name}
        onChange={setName}
        testID="profile-name-input"
        title="Name"
        value={name}
      />
      <EmailField
        errorText={errors.email}
        onChange={setEmail}
        testID="profile-email-input"
        title="Email"
        value={email}
      />
      <Button
        fullWidth
        loading={isLoading}
        onClick={handleSubmit}
        testID="profile-save-button"
        text="Save"
      />
    </Box>
  );
};
```

## Error Handling

### Backend

```typescript
import { APIError } from "@terreno/api";

// Validation error with field-specific messages
throw new APIError({
  status: 400,
  title: "Validation Error",
  detail: "Please fix the following errors",
  code: "VALIDATION_ERROR",
  fields: {
    email: "Email already exists",
    password: "Password must be at least 8 characters",
  },
});

// Not found
throw new APIError({
  status: 404,
  title: "Not Found",
  detail: "The requested resource was not found",
});

// Permission denied
throw new APIError({
  status: 403,
  title: "Forbidden",
  detail: "You do not have permission to perform this action",
});
```

### Frontend

A synced write does not return the server's answer to the caller. A rejected or conflicting
mutation shows up in `useSyncStatus()` and `useConflicts()`; render the conflict UI from those
hooks. Errors from
non-synced RTK Query routes arrive on `.unwrap()`:

```typescript
try {
  await someApiCall().unwrap();
} catch (error: unknown) {
  const data = (error as {data?: {detail?: string; fields?: Record<string, string>}}).data;
  // Handle field-specific errors
  if (data?.fields) {
    setErrors(data.fields);
    return;
  }

  // Handle general errors
  toast.error(data?.detail ?? "An error occurred");
}
```

## Code Style Checklist

- [ ] Use ES module syntax
- [ ] Use const arrow functions
- [ ] Use Luxon for dates
- [ ] Use interfaces over types
- [ ] No enums (use maps)
- [ ] Named exports preferred
- [ ] RORO pattern for complex functions
- [ ] Early returns for error conditions
- [ ] No nested if statements (prefer early return)
- [ ] Multiline syntax with braces for conditionals
- [ ] `console.log` only for debugging
- [ ] Wrap callbacks with useCallback
- [ ] Provide explicit return types
