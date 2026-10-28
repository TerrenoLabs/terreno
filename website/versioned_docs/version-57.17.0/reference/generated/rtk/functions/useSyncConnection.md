> **useSyncConnection**(`__namedParameters`): `void`

Hook that connects WebSocket sync events to RTK Query's cache.

For **create** events: invalidates cache tags to trigger refetch of list queries.
For **update** events: patches entities in-place in cached queries, falling back to tag invalidation.
For **delete** events: removes entities from cached list queries, falling back to tag invalidation.

Automatically subscribes to model rooms for each tagType when the socket connects,
so models using `roomStrategy: "model"` will work without additional setup.

## Parameters

### \_\_namedParameters

`UseSyncConnectionOptions`

## Returns

`void`

## Example

```typescript
const { socket } = useSocketConnection({ ... });

useSyncConnection({
  socket,
  api: terrenoApi,
  tagTypes: ['todos', 'users'],
});
```
