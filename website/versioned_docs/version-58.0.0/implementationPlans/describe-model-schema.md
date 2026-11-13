# `describeModel()` schema metadata

**Status:** Complete — shipped in #1154  
**Branch:** `cursor/architecture-ips-a7ec`  
**Owner:** —  
**Created:** 2026-08-24  
**Architecture source:** [api.md](../reference/api.md) OpenAPI / model conventions, [create-a-model.md](../how-to/create-a-model.md), [pluggable-database-sqlite.md](pluggable-database-sqlite.md) (adapters need shared path metadata; this is that core, not a second DSL)  
**Task list:** [describe-model-schema.md](../tasks/describe-model-schema.md)  
**Depends on:** none (can parallel unified-mutation-executors)  
**Consumed by:** OpenAPI (`getOpenApiSpecForModel`), admin `extractFieldMeta`, MCP `schemaGenerator`

## Goal

Walk each Mongoose schema **once**. OpenAPI, admin field widgets, and MCP Zod tools consume a `ModelDescription` instead of each re-interpreting `schema.paths` / mongoose-to-swagger / OpenAPI `$ref` hacks.

Evidence: `api/src/populate.ts` `getOpenApiSpecForModel` uses mongoose-to-swagger; `admin-backend/src/adminApp.ts` `extractFieldMeta` (~469) walks OpenAPI properties; `api/src/mcp/schemaGenerator.ts` walks `schema.paths` into Zod. `AdminFieldMeta` (backend) and `AdminFieldConfig` (frontend) duplicate shapes.

## Non-Goals

- Replacing Mongoose as the authoring format (SQLite IP D1).
- Generating TypeScript document types (five-type pattern stays hand-written).
- Unifying admin frontend/backend **component** trees; only the **field descriptor** they share.
- MCP operator-hint copy and OpenAPI prose beyond field facts.
- Widget registry / admin screen router ([admin-improvements.md](admin-improvements.md) owns AdminApp carve-up).

## Decisions

| Question | Decision |
|----------|----------|
| Interface shape | **A — `describeModel(model, {populatePaths?, extraProperties?}) → ModelDescription`.** Surfaces format that graph. Not B (OpenAPI JSON as the canonical model) — OpenAPI drops refs/widget hints MCP and admin need; it is a **view**. |
| Field graph | Paths with `kind`, `required`, `description`, `enum`, `ref`, `isArray`, `item` (nested description or primitive kind), `system` (created/updated/deleted/_id/__v). |
| Write exclusions | `writableOnCreate` / `writableOnUpdate` derived from the same rules MCP `SYSTEM_FIELDS` + router `validation` / field views **when those options are passed in**. `describeModel` on the model alone does not know field views; `describeModelForRouter(model, options)` adds write masks. Two functions, one module. |
| OpenAPI | `getOpenApiSpecForModel` builds swagger **from** `ModelDescription` (or merges m2s output with description for populate — Phase 2 may keep m2s for compatibility then replace). Compatibility: existing OpenAPI snapshots in `example-backend` / api tests must stay equal or have an explicit, reviewed diff. |
| Admin | `extractFieldMeta` maps `ModelDescription` (+ OpenAPI only if still required for nested quirks). Prefer description → `AdminFieldMeta` directly. |
| MCP | `mongooseTypeToZod` maps `FieldDescription`, not raw SchemaType. |
| Compatibility | Public OpenAPI HTTP body stable. Admin `/admin/config` field types stable unless a bugfix is documented. |

## Interface shapes considered

**A (chosen).** Canonical graph in `@terreno/api`, adapters in OpenAPI/admin/MCP.

**B (rejected).** Canonical OpenAPI document. Admin already loses `ref` (see `format === "objectid"` comment in `extractFieldMeta`). MCP would parse OpenAPI into Zod — another shallow wrapper.

## Architecture

```
Mongoose schema.paths
        │
        ▼
describeModel / describeModelForRouter
        │
        ├──► getOpenApiSpecForModel (components, populate)
        ├──► Admin extractFieldMeta /config
        └──► MCP Zod tool schemas
```

Deletion test: deleting `extractFieldMeta`’s OpenAPI walk and MCP’s SchemaType switch **into** `describeModel` concentrates “what is this field?”. Splitting `adminApp.ts` without this only moves the walk.

## Docs in this slice

| Page | Change |
|------|--------|
| `docs/explanation/` new short page `schema-metadata.md` | Why one descriptor; OpenAPI/admin/MCP are views. |
| `docs/reference/api.md` | `describeModel` export, field kinds table. |
| `docs/how-to/create-a-model.md` | Field `description` still required; it feeds the descriptor. |
| Admin reference | Config fields come from `describeModel`, not a second OpenAPI parse. |

## Testing

Seam: `describeModel` snapshots for a fixture model (string, enum, bool, date, ObjectId ref, array of primitives, subdocument array, Mixed).

Surface tests:

- OpenAPI: existing `openApi.test.ts` / example-backend snapshot — update only with reviewed diffs.
- MCP: tool schema tests compare Zod shape to descriptor, not SchemaType.
- Admin: `extractFieldMeta` tests (or new) for ref + enum + required.

No mongoose-schema-safety schema **changes**; this reads schemas.

## Risks

| Risk | Mitigation |
|------|------------|
| OpenAPI snapshot churn | Phase 1: descriptor + tests; Phase 2: OpenAPI switches with snapshot review as its own task. |
| Mixed / virtuals / populate | Populate stays a `getOpenApiSpecForModel` concern using `populatePaths`; descriptor records `ref` on the local path only. |
| Admin widget heuristics | Keep widget choice in admin; descriptor supplies type/enum/ref only. |

## Phases

1. `describeModel` + snapshots; MCP Zod uses it (highest drift vs SchemaType).
2. Admin `extractFieldMeta` uses it.
3. OpenAPI uses it; delete duplicate walks; docs.

## Feature Flags & Migrations

None.

## Not Included / Future Work

- SQLite adapter reading `ModelDescription` for DDL ([pluggable-database-sqlite.md](pluggable-database-sqlite.md) follow-on).
- Generating admin `AdminFieldConfig` types from the same module published to the frontend (shared type package later).

## Files to Create / Modify

- `api/src/schemaMetadata.ts` (new)
- `api/src/schemaMetadata.test.ts`
- `api/src/mcp/schemaGenerator.ts`
- `api/src/populate.ts` (`getOpenApiSpecForModel`)
- `admin-backend/src/adminApp.ts` (`extractFieldMeta`)
- `api/src/index.ts` export
- Docs listed above

## Acceptance Criteria

- [ ] One module describes paths; MCP, admin, and OpenAPI do not walk `schema.paths` independently.
- [ ] Fixture snapshot covers enum, ref, array, subdocument, system fields.
- [ ] OpenAPI compatibility tests pass (or reviewed snapshot update).
- [ ] Admin config still exposes type, required, enum, ref, description.
- [ ] MCP create tool schemas still hide system fields.
- [ ] Docs explain the descriptor; `update-docs` pages listed above.

## Task List

[docs/tasks/describe-model-schema.md](../tasks/describe-model-schema.md)
