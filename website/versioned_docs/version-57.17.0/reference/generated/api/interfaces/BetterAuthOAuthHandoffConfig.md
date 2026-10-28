Where the OAuth one-time-token handoff may send a token.

## Properties

### callbackPaths?

> `optional` **callbackPaths?**: `string`[]

Exact paths on those origins that may receive the token, such as `"/auth/return"`.
Defaults to `["/"]`. The redirect must already be written the way the URL parser prints
it (lower-case host, no default port, credentials, backslashes, or dot segments), and its
path must equal one of these exactly (case, trailing slashes and encoded characters all
count). Its query is free, so `?handoff=<nonce>` still works. Each entry must start with one `/` and be in normal form:
no `.` or `..` segments, encoded slashes or backslashes, spaces, query, or fragment.

Keep the list to the page that reads the token. That page must strip the fragment before
anything else runs and must never redirect, on the server or in the browser, because a
browser carries the fragment through a redirect that has none of its own.

***

### webOrigins

> **webOrigins**: `string`[]

Exact `http:` or `https:` origins of the web apps, such as `"https://app.example.com"`.
Scheme, host and port must match the redirect exactly. Patterns, paths, and other schemes
are rejected when Better Auth is created, and so is an empty list.
