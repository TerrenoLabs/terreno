> **syncConsents**(`definitions`, `options?`): `Promise`\<[`SyncConsentsResult`](../interfaces/SyncConsentsResult.md)\>

Sync consent form definitions to the database.

## Parameters

### definitions

`Record`\<`string`, [`ConsentFormDefinition`](../interfaces/ConsentFormDefinition.md)\>

Map of slug to consent form definition

### options?

[`SyncConsentsOptions`](../interfaces/SyncConsentsOptions.md) = `{}`

Sync options

## Returns

`Promise`\<[`SyncConsentsResult`](../interfaces/SyncConsentsResult.md)\>

Summary of what was created, updated, deactivated, or unchanged

## Example

```typescript
import {syncConsents} from "@terreno/api";

await syncConsents({
  "terms-of-service": {
    title: "Terms of Service",
    type: "terms",
    content: {"en": "# Terms\n...", "es": "# Términos\n..."},
    required: true,
    order: 1,
  },
  "privacy-policy": {
    title: "Privacy Policy",
    type: "privacy",
    content: {"en": "# Privacy\n..."},
    order: 2,
  },
});
```
