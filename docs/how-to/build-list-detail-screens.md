# Build a list/detail screen

Put the list and its detail route in one route group, and make `ListDetailLayout` the group's
layout. On a phone the list pushes the detail. On a tablet or a wide browser the list stays in a
left pane and the detail opens beside it. The URL always names the open item.

```text
app/mail/
  _layout.tsx   ListDetailLayout
  index.tsx     ListDetailIndex
  [id].tsx      the detail screen
```

```tsx
// app/mail/_layout.tsx
import {ListDetailLayout, Text} from "@terreno/ui";
import type React from "react";

import {MailList} from "@/components/MailList";

// A deep link to /mail/3 on a phone still has the list to go back to.
export const unstable_settings = {initialRouteName: "index"};

const MailLayout: React.FC = () => (
  <ListDetailLayout
    detailHref={(id) => `/mail/${id}`}
    emptyDetail={<Text>Select a message</Text>}
    indexHref="/mail"
    list={<MailList />}
    screenOptions={{title: "Inbox"}}
  />
);
export default MailLayout;
```

```tsx
// app/mail/index.tsx
import {ListDetailIndex} from "@terreno/ui";
import type React from "react";

const MailIndex: React.FC = () => <ListDetailIndex />;
export default MailIndex;
```

```tsx
// app/mail/[id].tsx
import {Page, Text} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import type React from "react";

const MailMessage: React.FC = () => {
  const {id} = useLocalSearchParams<{id: string}>();
  return (
    <Page>
      <Text>Message {id}</Text>
    </Page>
  );
};
export default MailMessage;
```

## Select rows from the list

Read the open item and open others with `useListDetail()`. Mark the open row as selected so
screen readers announce it. On web a clickable `Box` row sends this as `aria-current="true"`.

```tsx
import {Box, Text, useListDetail} from "@terreno/ui";
import type React from "react";

export const MailRow: React.FC<{id: string; subject: string}> = ({id, subject}) => {
  const {select, selectedId} = useListDetail();
  const isSelected = id === selectedId;
  return (
    <Box
      accessibilityHint="Opens the message"
      accessibilityLabel={subject}
      accessibilityState={{selected: isSelected}}
      color={isSelected ? "primary" : "base"}
      onClick={() => select(id)}
      padding={3}
      testID={`mail-row-${id}`}
    >
      <Text color={isSelected ? "inverted" : "primary"}>{subject}</Text>
    </Box>
  );
};
```

| Call | Stacked (phone) | Split (tablet, wide web) |
| --- | --- | --- |
| `select(id)`, nothing open | Pushes `detailHref(id)` | Pushes `detailHref(id)` |
| `select(id)`, another item open | Pushes `detailHref(id)` | Replaces the open detail |
| `select(selectedId)` | Pushes again | Does nothing |
| `clear()` | `router.dismissTo(indexHref)`: pops back to the list inside this group | Same |
| `clear()`, nothing open | Does nothing | Does nothing |

Because split mode replaces the open detail, the stack is never deeper than the list plus one
detail, so back returns to the list after a rotation too.

When another screen opens a detail directly, push it with `withAnchor` so the list sits below it
and back lands on the list instead of leaving the group:

```tsx
router.push("/mail/3", {withAnchor: true});
<Link href="/mail/3" withAnchor>Open message</Link>
```

`selectedId` is the `paramName` param (default `id`) of the route directly below `indexHref`
whose segment is `detailRoute` (default `[id]`). An `id` from a parent dynamic segment, such as
`/orgs/[id]/mail`, never counts.

## Keep list state across the breakpoint

The open item survives a rotation or a browser resize. The `list` element does not: it moves
between the index screen and the left pane, so it remounts. Keep filters, search text, and other
list state in the route (`router.setParams`) or a store.

## Nest it inside a sidebar

`ListDetailLayout` measures its own width, so it splits correctly inside `SidebarNavigation` or
an admin rail. Make the group a screen of the sidebar navigator:

```text
app/workspace/
  _layout.tsx         SidebarNavigation with <SidebarNavigation.Screen name="mail" />
  mail/_layout.tsx    ListDetailLayout with indexHref="/workspace/mail"
  mail/index.tsx
  mail/[id].tsx
```

## Choose SplitPage instead

Use `SplitPage` when the list and detail do not have their own routes, such as a picker inside a
modal. `SplitPage` keeps the selection in component state, so it has no URL, deep links, or back
navigation for the open item.

## Reference

Props, defaults, and testIDs: [`ListDetailLayout`](../reference/ui.md#listdetaillayout).
