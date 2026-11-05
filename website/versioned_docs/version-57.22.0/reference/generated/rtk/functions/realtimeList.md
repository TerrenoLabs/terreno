> **realtimeList**(`collection`, `options?`): (`arg`, `api`) => `Promise`\<`void`\>

Factory that returns an `onCacheEntryAdded` callback for real-time
updates on a **list of documents**, optionally filtered by query.

If the query argument contains filter fields (after stripping pagination params),
subscribes to `query:{queryId}` so the server only sends matching events.
Otherwise subscribes to `model:{collection}` for all events.

Handles:
- **create** → prepends new document to the list
- **update** → patches existing document in-place, or adds it if newly matching
- **delete** → removes document from the list

## Parameters

### collection

`string`

The collection tag (e.g. "todos")

### options?

`RealtimeListOptions`

Optional configuration

## Returns

(`arg`, `api`) => `Promise`\<`void`\>

## Deprecated

Removed in Terreno 58. Use `@terreno/syncdb` (`useQuery` / `useEntityIds`) instead.

## Example

```typescript
const api = generatedApi.enhanceEndpoints({
  endpoints: {
    getTodosList: {
      onCacheEntryAdded: realtimeList("todos"),
    },
  },
});
```
