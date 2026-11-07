> **resolveBetterAuthAppUser**(`__namedParameters`): `Promise`\<[`ResolvedBetterAuthAppUser`](../interfaces/ResolvedBetterAuthAppUser.md)\>

Finds the application user for a Better Auth session user, creating it on first contact,
and reports whether the account is disabled. Every Better Auth entry point (REST session
middleware, socket handshake) goes through this so they accept and refuse the same users.

## Parameters

### \_\_namedParameters

[`ResolveBetterAuthAppUserOptions`](../interfaces/ResolveBetterAuthAppUserOptions.md)

## Returns

`Promise`\<[`ResolvedBetterAuthAppUser`](../interfaces/ResolvedBetterAuthAppUser.md)\>
