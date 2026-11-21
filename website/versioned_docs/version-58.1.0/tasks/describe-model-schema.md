# Tasks: `describeModel()` schema metadata

IP: [describe-model-schema.md](../implementationPlans/describe-model-schema.md)

## Phase 1 — Descriptor + MCP

- [x] **Task 1.1**: `describeModel` / `describeModelForRouter`
  - Delivers: field graph + snapshot tests on a fixture schema
  - Files: `api/src/schemaMetadata.ts`, `api/src/schemaMetadata.test.ts`
  - Blocked by: none
  - Acceptance: snapshots for enum, ref, array, subdocument, system fields
- [x] **Task 1.2**: MCP Zod from descriptor
  - Delivers: `schemaGenerator.ts` maps `FieldDescription`; no SchemaType switch for kinds already in the descriptor
  - Files: `api/src/mcp/schemaGenerator.ts`, `api/src/mcp/schemaGenerator.test.ts`
  - Blocked by: 1.1
  - Acceptance: MCP schema tests pass; create tools still omit system fields

## Phase 2 — Admin

- [x] **Task 2.1**: `extractFieldMeta` from descriptor
  - Delivers: admin config fields built from `describeModel`, not OpenAPI property walk
  - Files: `admin-backend/src/adminApp.ts`, admin-backend tests
  - Blocked by: 1.1
  - Acceptance: ref, enum, required, nested array items still appear on `/admin/config`

## Phase 3 — OpenAPI + docs

- [x] **Task 3.1**: `getOpenApiSpecForModel` from descriptor
  - Delivers: OpenAPI properties derived from `ModelDescription`; populate still applied
  - Files: `api/src/populate.ts`, `api/src/openApi.test.ts` / example-backend openapi snapshot if required
  - Blocked by: 1.1
  - Acceptance: OpenAPI tests pass; any snapshot diff is reviewed in the PR
- [x] **Task 3.2**: Docs + export
  - Files: `docs/explanation/schema-metadata.md`, `docs/reference/api.md`, `docs/how-to/create-a-model.md`, admin reference, `api/src/index.ts`, changelog
  - Blocked by: 1.2, 2.1, 3.1
  - Skills: `update-docs`
  - Acceptance: stranger finds “one descriptor, three views” without reading code
