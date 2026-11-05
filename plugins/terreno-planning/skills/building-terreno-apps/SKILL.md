---
name: building-terreno-apps
description: >-
  Complete guide for building Terreno full-stack Expo apps with @terreno/ui,
  Expo Router, and @terreno/rtk. Covers layout, forms, navigation, theming,
  screen patterns, and when to use Expo Go vs custom builds.
---
# Building Terreno Apps

Use this skill when building or refactoring screens in a Terreno Expo app (`example-frontend`, `admin-spa`, or a consumer app using `@terreno/ui` + `@terreno/rtk`).

**Related skills:** `debug-with-mcp` (standard runtime debug and drive),
`debug-syncdb-with-mcp` (SyncDB depth), `terreno-ui` (component selection),
`terreno-data-fetching` (API hooks), `verify-ui-changes` (mandatory UI verification),
`generate-sdk` (after backend changes), `building-admin-interfaces` (admin shell, custom screens, sidebar).

## Documentation

1. Read `docs/tutorials/`, `docs/explanation/`, and app-structure how-to pages before changing screens or navigation.
2. Implement against that design.
3. Update those pages in the same slice with `update-docs`.
4. Ship without matching docs is a failed slice.

## References

Consult these resources as needed:

```
references/
  route-structure.md     Expo Router conventions adapted for Terreno apps
  screen-patterns.md     List, detail, form, and admin screen templates
  navigation.md          Stacks, tabs, modals, and auth-gated routing
```

Admin CRUD, sidebar, custom screens, and `apiBase`/`routeBase`: use skill
`building-admin-interfaces` and `docs/how-to/build-admin-screens.md`.

## Running the App

**CRITICAL: Always try Expo Go first before creating custom builds.**

1. Start with `bun run frontend:web` (or `bun run start` in the app package) and test in Expo Go or the web dev server.
2. For full-stack features, start the backend: `bun run backend:dev` with MongoDB and auth env vars (see `AGENTS.md`).
3. Only create custom builds (`npx expo run:ios/android`, `eas build`) when you need local Expo modules, Apple targets, third-party native modules not in Expo Go, or native config that cannot be expressed in `app.json`.

## Provider Stack

Every Terreno app root layout should wrap children in this order (outer → inner):

```tsx
import {Provider} from "react-redux";
import {PersistGate} from "redux-persist/integration/react";
import {TerrenoProvider} from "@terreno/ui";
// Import from your app's store bootstrap module (see example-frontend/store/index.ts)
import store, {persistor} from "../store/index.ts";

const RootLayout: React.FC = () => {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <TerrenoProvider>
          <Stack />
        </TerrenoProvider>
      </PersistGate>
    </Provider>
  );
};
```

See `example-frontend/app/_layout.tsx` for the full pattern including auth routing, sockets, and feature flags.

## Code Style

- Use **functional components** with `React.FC` and explicit return types.
- Import hooks directly: `import {useEffect, useCallback} from "react"` — not `React.useEffect`.
- Wrap event handlers in `useCallback`. Add a comment above every `useEffect`.
- Use **Luxon** for all date/time operations — never `Date` or dayjs.
- Use **camelCase** directories (e.g. `components/todoList/`).
- Use **kebab-case** for route file names when the Expo skill convention applies (e.g. `comment-card.tsx`).
- **No barrel imports** — import concrete module files, not directory `index` re-exports. Cross-package `@terreno/*` roots are allowed.
- Never co-locate components, types, or utilities in the `app/` directory.

## Layout — Use @terreno/ui, Not Raw Primitives

| Instead of | Use |
|------------|-----|
| `View` | `Box` |
| React Native `Text` | `Text` or `Heading` from `@terreno/ui` |
| `ScrollView` as page wrapper | `Page` with `scroll={true}` |
| `StyleSheet.create` | Theme props (`padding`, `gap`, `color`) or inline styles |
| `SafeAreaView` | `Page` handles safe areas; or `contentInsetAdjustmentBehavior` on lists |
| Inline hex colors | Theme surface/text colors via props (`color="primary"`) |

### Page layout

```tsx
import {Box, Button, Heading, Page, Text} from "@terreno/ui";

const TodosScreen: React.FC = () => {
  return (
    <Page title="Todos" scroll loading={isLoading}>
      <Box gap={3} padding={4}>
        <Heading size="lg">My Todos</Heading>
        <Text color="secondaryLight">Track your tasks</Text>
        <Button text="Add Todo" onClick={handleAdd} variant="primary" />
      </Box>
    </Page>
  );
};
```

### Box layout

```tsx
<Box direction="row" padding={4} gap={2} alignItems="center">
  <Text flex="grow">Content</Text>
  <Button text="Action" onClick={handleAction} />
</Box>
```

Use the spacing scale via props (`padding={4}` → 16px). Prefer `gap` over margin.

## Data on Screens

Never call `fetch` or `axios` in screen components. Use generated RTK Query hooks:

```tsx
import {useGetTodosQuery, usePostTodosMutation} from "@/store/sdk";

const {data, isLoading, error, refetch} = useGetTodosQuery({});
const [createTodo, {isLoading: isCreating}] = usePostTodosMutation();
```

See `terreno-data-fetching` for auth, caching, and error handling.

## Forms

Use `@terreno/ui` form fields with local state and RTK mutations:

```tsx
import {Button, TextField} from "@terreno/ui";

const [title, setTitle] = useState<string>("");
const [titleError, setTitleError] = useState<string | undefined>();

const handleSubmit = useCallback(async (): Promise<void> => {
  if (!title.trim()) {
    setTitleError("Title is required");
    return;
  }
  try {
    await createTodo({title: title.trim(), completed: false}).unwrap();
    setTitle("");
  } catch (err) {
    console.error("Failed to create todo", err);
  }
}, [createTodo, title]);

<TextField
  title="Title"
  value={title}
  onChange={setTitle}
  errorText={titleError}
/>
<Button text="Create" onClick={handleSubmit} loading={isCreating} />
```

## Navigation

- Use Expo Router file-based routing in `app/`.
- Gate routes on auth state in root `_layout.tsx` (redirect to `/login` when logged out).
- Use `Stack` from `expo-router` for stack navigation; set titles via `Stack.Screen options`.
- For admin screens, use `AdminShellLayout` from `@terreno/admin-frontend`.

See `./references/navigation.md` and `./references/route-structure.md`.

## Loading, Error, and Empty States

Every data-driven screen must handle all three:

```tsx
if (isLoading) {
  return <Page title="Todos"><Spinner /></Page>;
}
if (error) {
  return (
    <Page title="Todos">
      <Text color="error">Failed to load todos</Text>
      <Button text="Retry" onClick={refetch} />
    </Page>
  );
}
if (!data?.data?.length) {
  return (
    <Page title="Todos">
      <Text>No todos yet</Text>
      <Button text="Create your first todo" onClick={handleAdd} />
    </Page>
  );
}
```

## Theming

- Wrap the app in `TerrenoProvider` (done in root layout).
- Use theme props on components: `color="primary"`, `border="default"`, `rounding="md"`.
- Access theme programmatically with `useTheme()` when needed.
- Do not hardcode hex colors when a theme token exists.

## Verification

Any UI change **must** follow the `verify-ui-changes` skill before opening or updating a PR. Launch the correct app, log in with seeded credentials, exercise the feature, and attach screenshots/videos to the PR.

## Decision Tree

```
Building or changing a screen?
  |-- Need layout/structure?
  |   \-- Page for full screens, Box for sections, Card for grouped content
  |
  |-- Need data from API?
  |   \-- terreno-data-fetching (RTK Query hooks, never raw fetch)
  |
  |-- Need a form?
  |   \-- @terreno/ui TextField/SelectField/DateTimeField + local state + mutation
  |
  |-- Need navigation?
  |   \-- references/navigation.md (Expo Router + auth gating)
  |
  |-- Need admin CRUD, sidebar, or a custom operator screen?
  |   \-- building-admin-interfaces + AdminShellLayout + AdminScreenRouter
  |
  |-- Backend API doesn't exist yet?
  |   \-- terreno-backend-api (modelRouter on Express, then generate-sdk)
  |
  \-- Done coding?
      \-- verify-ui-changes (mandatory)
```

## Common Mistakes

**Wrong: Raw View/Text**

```tsx
<View style={{padding: 16}}>
  <Text style={{fontSize: 18}}>Hello</Text>
</View>
```

**Right: @terreno/ui with theme props**

```tsx
<Box padding={4}>
  <Heading size="lg">Hello</Heading>
</Box>
```

**Wrong: fetch in a screen**

```tsx
const [todos, setTodos] = useState([]);
useEffect(() => {
  fetch("/todos").then((r) => r.json()).then(setTodos);
}, []);
```

**Right: Generated RTK Query hook**

```tsx
const {data} = useGetTodosQuery({});
```

**Wrong: Editing openApiSdk.ts by hand**

```tsx
// Manually adding a hook to store/openApiSdk.ts
```

**Right: Regenerate SDK after backend changes**

```bash
cd example-frontend && bun run sdk
```
