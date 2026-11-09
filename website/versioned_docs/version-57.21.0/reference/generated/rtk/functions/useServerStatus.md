> **useServerStatus**(`options?`): [`OfflineStatus`](../interfaces/OfflineStatus.md)

Polls the API server health endpoint to determine actual server reachability.
Dispatches setOnlineStatus(true/false) into the offline slice so the rest
of the offline middleware (queue, optimistic updates, replay) reacts.

Use this instead of useOfflineStatus when you want real server-connectivity
detection rather than just browser navigator.onLine.

## Parameters

### options?

[`ServerStatusOptions`](../interfaces/ServerStatusOptions.md) = `{}`

## Returns

[`OfflineStatus`](../interfaces/OfflineStatus.md)

## Example

```typescript
const {isOnline, queueLength, isSyncing, isLocalOnly} = useServerStatus({
  skip: !userId,
});
```
