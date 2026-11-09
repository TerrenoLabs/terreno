> **realtimeDocument**(`collection`, `options?`): (`arg`, `api`) => `Promise`\<`void`\>

Factory that returns an `onCacheEntryAdded` callback for real-time
updates on a **single document**.

Subscribes to `document:{collection}:{id}` room on the server. When a sync
event arrives for this document, patches the RTK Query cache in-place.

## Parameters

### collection

`string`

The collection tag (e.g. "todos")

### options?

`RealtimeDocumentOptions`

Optional configuration

## Returns

(`arg`, `api`) => `Promise`\<`void`\>

## Deprecated

Removed in Terreno 58. Use `@terreno/syncdb` (`useEntity`) instead.

## Example

```typescript
const api = generatedApi.enhanceEndpoints({
  endpoints: {
    getTodosIdRead: {
      onCacheEntryAdded: realtimeDocument("todos"),
    },
  },
});
```
