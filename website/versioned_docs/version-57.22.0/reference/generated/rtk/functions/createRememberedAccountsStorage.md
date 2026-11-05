> **createRememberedAccountsStorage**(`isWeb?`): [`RememberedAccountsStorage`](../interfaces/RememberedAccountsStorage.md)

The default storage: SecureStore on native (on iOS, never restored to another device from a
backup; on Android, excluded from Auto Backup by the expo-secure-store config plugin),
localStorage on web, resolved on each call so a store created before `window` exists still
finds it. `isWeb` is a parameter so both branches are testable without reloading modules.

## Parameters

### isWeb?

`boolean` = `IsWeb`

## Returns

[`RememberedAccountsStorage`](../interfaces/RememberedAccountsStorage.md)
