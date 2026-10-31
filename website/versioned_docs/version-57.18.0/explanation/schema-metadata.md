# Schema metadata (`describeModel`)

Terreno walks each Mongoose schema **once** and builds a `ModelDescription` field graph. OpenAPI, admin config, and MCP tools are **views** of that graph — they do not re-walk `schema.paths` independently.

## Why one descriptor

Before `describeModel`, three surfaces each interpreted Mongoose differently:

- **OpenAPI** — `mongoose-to-swagger` in `getOpenApiSpecForModel`
- **Admin** — OpenAPI property walk plus Mongoose ref patching in `extractFieldMeta`
- **MCP** — `schema.paths` + `SchemaType.instance` switch in `schemaGenerator`

That drifted on refs, enums, nested arrays, and system fields. A single descriptor keeps field facts in one place.

## Core API

```typescript
import {describeModel, describeModelForRouter} from "@terreno/api";

const description = describeModel(Todo);
// description.fields[path].kind, .required, .description, .enum, .ref, .isArray, .item, .system

const routerDescription = describeModelForRouter(Todo, {
  validation: {excludeFromCreate: ["ownerId"]},
  fieldView: {read: "*", write: ["title", "completed"]},
});
// adds writableOnCreate / writableOnUpdate per field
```

## Field kinds

| Kind | Mongoose source | Notes |
|------|-----------------|-------|
| `string` | String | Includes enum strings |
| `number` | Number | |
| `boolean` | Boolean | |
| `date` | Date | ISO date-time in OpenAPI |
| `dateOnly` | DateOnly | Custom Terreno type |
| `objectId` | ObjectId | Carries `ref` model name |
| `embedded` | Subdocument / array of subdocuments | Nested `fields` |
| `mixed` | Mixed | Accepts any value in OpenAPI |
| `map` | Map | `item` follows Map `of` (omitted `of` is `mixed`); OpenAPI `additionalProperties` |

System paths (`_id`, `__v`, `created`, `updated`, `deleted`) are marked with `system: true`.

## Views (not canonical)

| Surface | Function | Notes |
|---------|----------|-------|
| OpenAPI | `modelDescriptionToOpenApiSpec` | Used by `getOpenApiSpecForModel`; populate still merges referenced models |
| Admin `/admin/config` | `modelDescriptionToAdminFields` | Widget choice stays in admin-backend |
| MCP Zod | `fieldDescriptionToZodType` | Create/update tools omit system fields |

Populate paths remain a `getOpenApiSpecForModel` concern; the descriptor records `ref` on the local path only.

## Related

- [API reference — describeModel](../reference/api.md#describemodel)
- [How to create a model](../how-to/create-a-model.md)
- [Admin backend reference](../reference/admin-backend.md)
