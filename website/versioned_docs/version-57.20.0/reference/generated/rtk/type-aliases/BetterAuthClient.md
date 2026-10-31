> **BetterAuthClient** = `ReactAuthClient`\<\{ `baseURL`: `string`; `fetchOptions?`: `BetterAuthFetchOptions`; `plugins`: `BetterAuthClientPlugin`[]; \}\>

Type of the Better Auth client returned by createBetterAuthClient without `features`. Its
plugins are typed as a generic list, so plugin namespaces are untyped.
