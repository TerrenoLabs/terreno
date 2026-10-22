---
category: Added
---

- `useTerrenoChat` takes a `tokenSource` option. Each chat request reads its `Authorization: Bearer` token from that source, else the one registered with `setTokenSource`, else the built-in JWT source, and sends no `Authorization` header when there is no token. JWT apps behave as before.
