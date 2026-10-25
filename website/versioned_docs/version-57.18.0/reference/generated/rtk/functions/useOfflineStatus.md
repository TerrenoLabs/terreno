> **useOfflineStatus**(): [`OfflineStatus`](../interfaces/OfflineStatus.md)

Hook for consuming offline state, sync status, and conflict notifications.

Usage:
```typescript
const {isOnline, queueLength, isSyncing, undismissedConflicts, dismissConflict} = useOfflineStatus();

if (!isOnline) {
  return <Banner text={`Offline. ${queueLength} changes pending.`} />;
}
```

## Returns

[`OfflineStatus`](../interfaces/OfflineStatus.md)
