> **setRealtimeSocket**(`socket`): `void`

Provide the Socket.io client instance used by `realtimeDocument` and `realtimeList`.

Call this once after your socket connects (e.g. inside `useSocketConnection`'s `onConnect`
callback, or in a `useEffect` that watches the socket ref).

## Parameters

### socket

`Socket`\<`DefaultEventsMap`, `DefaultEventsMap`\> \| `null`

## Returns

`void`

## Deprecated

Removed in Terreno 58. Use `@terreno/syncdb` for collection sync.
`useSocketConnection` remains for feature flags and other sockets.

## Example

```typescript
const { socket } = useSocketConnection({ ... });

useEffect(() => {
  setRealtimeSocket(socket);
  return () => setRealtimeSocket(null);
}, [socket]);
```
