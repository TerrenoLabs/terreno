---
category: Fixed
---

- Mongo filters built from request values reject non-string input with 400 instead of running it as a query operator: AI request explorer `model`, observability review `status`, review batch `promptName`, experiment `datasetId`, trace list filters, push-token `platform`, and `loadDocOr404` ids (404). Sync conflict reloads and tombstone lookups match `_id` with `$eq`.
- Nested-path helpers in `populate`, RBAC field views, and MCP `excludeFields` skip `__proto__`, `constructor`, and `prototype`, so a crafted path can no longer touch `Object.prototype`.
- Removed polynomial-time regexes from bearer-header parsing, trailing-slash trimming (syncdb, ui `ListDetailLayout`, jobs Cloud Tasks runner, admin route paths), prompt references, judge score ranges, AI JSON fence stripping, and the MCP import parser.
- Dataset schema validation stops at the first error (`allErrors` off) to bound work on untrusted input.
- `isTestUser` in `@terreno/ui` matches `nang.io` and `example.com` as the email domain or a subdomain, not as a substring, and always returns a boolean.
- MCP OAuth metadata responses set an explicit JSON content type.
- The example app's AI session id comes from `expo-crypto` `randomUUID` instead of `Math.random`.
