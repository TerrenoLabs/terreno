---
category: Fixed
---

`@terreno/api` answers a malformed JSON request body with 400 `Malformed request body` instead of 500 `Internal server error`. `apiErrorMiddleware` now converts body-parser client errors with the new `bodyParserErrorToAPIError` helper and keeps the parser's status: an oversized body returns 413 `Request body too large`, and an unsupported charset returns 415 `Unsupported request body encoding`. The parser's message is in `detail`. These errors are logged at `warn` and are not sent to Sentry.
