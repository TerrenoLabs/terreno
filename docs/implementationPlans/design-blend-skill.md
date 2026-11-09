# Implementation Plan: design-blend Skill

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1083  
**Status:** Complete

## Goal

Create a new `design-blend` skill that converts a Claude design file into a Terreno implementation blueprint and execution steps, with these hard constraints:

1. REST-first APIs via `modelRouter` CRUD by default.
2. Model actions only when REST is a poor fit (command, aggregation, or performance path).
3. Maximum reuse of existing `@terreno/ui` components.
4. New UI components only when the design cannot be expressed with existing Terreno primitives/components.
5. Two-stage flow in the skill: (a) plan with task list, then (b) implementation using a subagent with per-task plan comparison.

## Scope

- Add canonical skill definition at `.rulesync/skills/design-blend/SKILL.md`.
- Preserve planning artifacts:
  - `docs/implementationPlans/design-blend-skill.md` (this file)
  - `docs/tasks/design-blend-skill.md` (bot task list)
- Sync generated mirrors for all configured `rulesync` targets.

## Required Outputs Enforced by the Skill (Contract)

The `design-blend` skill must require the following explicit outputs whenever it is used.

### 1) Models Output (Required)

For every entity inferred from the design, output a model spec with:

- `modelName`
- `fields` (name, type, required, default, description)
- `relations` (`ref`, cardinality)
- `indexes`
- `plugins`
- `ownership/multitenancy` notes (`ownerId`, tenant key, soft delete)

Required format in skill output:

1. A "Model Inventory" table.
2. A per-model schema checklist.
3. A "No model needed" rationale when a design section is purely presentational.

### 2) modelRouter REST Output (Required)

For each model, output a modelRouter plan with:

- Route base path (for example `/orders`)
- CRUD endpoints:
  - `POST /resource`
  - `GET /resource`
  - `GET /resource/:id`
  - `PATCH /resource/:id`
  - `DELETE /resource/:id` (or explicit disable rationale)
- `permissions` per method
- `queryFields`
- `queryFilter` (ownership/tenant filter when relevant)
- `sort`
- `populatePaths` where needed

Required format in skill output:

1. "REST Endpoint Matrix" (method/path/permission/purpose).
2. "modelRouter Options Block" for each model.
3. Explicit statement if any CRUD endpoint is disabled and why.

### 3) Model Actions Output (Conditional, Strictly Gated)

Actions are allowed only if one of these is true:

1. Non-resource command semantics (`publish`, `approve`, `submit`, `duplicate`).
2. Aggregation/read-model endpoint where CRUD cannot express required shape efficiently.
3. Performance-motivated path (batch operation or optimized read route) with measurable benefit.

For each action, require:

- `actionName`
- `method` + `path`
- `whyRestIsInsufficient` (mandatory)
- `requestSchema` + `responseSchema`
- `permissions`
- `performanceNote` (mandatory if performance-motivated)

Required format in skill output:

1. "Action Decision Gate" checklist.
2. "Approved Actions" table.
3. "Rejected Candidate Actions" table (to prove REST-first evaluation happened).

### 4) UI Composition Output (Required)

For each screen/state in the design:

- Map to existing `@terreno/ui` components first (for example `Page`, `Box`, `Card`, `DataTable`, `TextField`, `SelectField`, `Button`, `Modal`, `Spinner`, `Toast`).
- Include loading, empty, error, and success states.
- Note navigation and interaction flow.

Required format in skill output:

1. "Terreno Component Mapping" table by screen section.
2. "State Coverage Matrix" (loading/empty/error/success).
3. "Accessibility/Testability Notes" (testIDs and semantics).

### 5) New UI Components Output (Conditional)

No mandatory net-new UI components are required by this IP itself. New components are conditional and must only be created when a clear gap exists.

If a gap exists, the skill must require:

- `componentName`
- `whyExistingTerrenoComponentsDoNotFit`
- `propsApi`
- `states`
- `reusabilityTargets` (at least one additional use-case)

Required format in skill output:

1. "New Component Candidates" table.
2. "Approved New Components" section with API contract.
3. "Rejected Candidate Components" section with fallback composition.

## Skill Behavior Requirements

The skill must guide users through this order:

1. Parse design file.
2. Produce implementation plan covering models/APIs/actions/UI/new components.
3. Produce structured task list.
4. Wait for confirmation of plan/task list.
5. Execute tasks using a subagent.
6. After each task, publish "Plan vs Actual" comparison with:
   - status (`match`, `partial`, `deviation`)
   - notes
   - corrective action (if needed)

## Phases

### Phase 1: Planning Artifacts

- Finalize this IP with explicit contract sections.
- Produce `docs/tasks/design-blend-skill.md`.

### Phase 2: Skill Authoring

- Implement `.rulesync/skills/design-blend/SKILL.md` with:
  - REST-first gate
  - required output templates
  - subagent execution step
  - per-task plan comparison requirement

### Phase 3: Rulesync + Validation

- Run `bun run rules`.
- Verify synced files are generated for all targets.
- Validate markdown quality and requirement coverage.

## Acceptance Criteria

1. `design-blend` skill exists in `.rulesync/skills/design-blend/SKILL.md`.
2. Skill text explicitly enforces:
   - models output format
   - modelRouter CRUD matrix
   - action gating and schemas
   - Terreno-first UI mapping
   - conditional new component contract
3. Skill requires subagent execution after confirmed plan/task list.
4. Skill requires per-task "Plan vs Actual" comparison.
5. `bun run rules` succeeds and mirrors are generated.

## Deliverables

1. `docs/implementationPlans/design-blend-skill.md`
2. `docs/tasks/design-blend-skill.md`
3. `.rulesync/skills/design-blend/SKILL.md`
4. Synced generated skill files from `rulesync`

## Risks

- Skill may drift into generic advice and skip enforceable output structure.
- Users may bypass REST-first design and overuse actions.
- New component proposals may be accepted too early without proving Terreno composition limits.
- Mirror files may drift if rulesync is skipped.

## Mitigations

- Add strict required-output templates and checklists in the skill.
- Require explicit "why REST is insufficient" text per action.
- Require rejected-component table before approving any net-new component.
- Run `bun run rules` in the same implementation flow and verify generated artifacts.

