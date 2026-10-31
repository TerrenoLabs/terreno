---
category: Fixed
---

OpenAPI specs and model metadata from `@terreno/api` no longer mark a field as required when
its Mongoose `required` is a function. Such a field is only required on some documents, so
generated SDKs now type it as optional (for example `ConsentResponse.provisionalNote` and
`GptHistory.text`). Saving still enforces the condition.
