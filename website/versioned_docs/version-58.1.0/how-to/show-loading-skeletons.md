# Show loading skeletons

Show placeholders in the shape of your content while it loads, instead of a spinner. Every
container in `@terreno/ui` takes the same `loading` props. See
[Loading states and skeletons](../reference/ui.md#loading-states-and-skeletons) for every prop
and default.

## Skeleton a Box

Pass `loading` and a `loadingComponent` built from skeleton primitives:

```tsx
import {Box, SkeletonList} from "@terreno/ui";

<Box loading={isLoading} loadingComponent={<SkeletonList rows={3} />} padding={4}>
  {todos.map((todo) => <TodoRow key={todo.id} todo={todo} />)}
</Box>
```

Without `loadingComponent`, the Box shows three lines of `SkeletonText`.

## Choose an animation

Set `loadingAnimation` on the container: `"pulse"` (default), `"shimmer"`, or `"none"`. Every
skeleton inside picks it up and animates in sync.

```tsx
<Card loading={isLoading} loadingAnimation="shimmer">
  <ProfileSummary user={user} />
</Card>
```

Animations turn off on their own when the OS reduce-motion setting is on.

## Skeleton cards, charts, and pages

- `Card`, `EditableCard`: `loading` replaces the content. A display `Card` defaults to a
  `SkeletonCard`, with media when it has `imageUri`.
- `ChartCard`, `Scorecard`: `loading` keeps the title and replaces the body or value.
- Charts, `Page`, `SplitPage`: `loading` still shows a spinner. Pass `loadingComponent` to show a
  skeleton instead.

```tsx
<Page loading={isLoading} loadingComponent={<SkeletonCard showMedia />} title="Profile">
  <ProfileScreen />
</Page>
```

## Add loading to your own component

Wrap it once with `withLoading`:

```tsx
import {SkeletonList, withLoading} from "@terreno/ui";

const UserRowWithLoading = withLoading(UserRow, {loadingComponent: <SkeletonList rows={1} />});

<UserRowWithLoading loading={isLoading} user={user} testID="user-row" />
```

While loading it renders a busy `Box` with test id `user-row-loading`. Use it only for a component
that has no `loading` prop of its own.

## Test it

Skeletons are hidden from screen readers, so React Native Testing Library needs
`includeHiddenElements` to find them:

```tsx
expect(getByTestId("list-skeleton", {includeHiddenElements: true})).toBeTruthy();
expect(getByTestId("todos").props["aria-busy"]).toBe(true);
```

In Playwright, `getByTestId` finds them as usual.
