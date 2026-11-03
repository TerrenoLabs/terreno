> **createLinkingDisabledPlugin**(): `BetterAuthPlugin`

The plugin `createBetterAuth` adds when linking is off (`accountLinking: {mode: "never"}`, or
`options.account.accountLinking.enabled: false`). Better Auth itself only refuses such a link
when the provider calls back; this refuses `POST {basePath}/link-social` up front with 403
`LINKING_DISABLED`, so a client never sends the user to the provider for nothing.

## Returns

`BetterAuthPlugin`
