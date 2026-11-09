# Task List: Documentation Site, Versioned Docs, and Docs-Maintenance Skills

See: [`docs/implementationPlans/docs-site-and-versioning.md`](../implementationPlans/docs-site-and-versioning.md)

Phases 1–2 and most of 3–4 already shipped on `master` (`website/`, generated
reference, `docs:version` job, `update-docs` / `docs-audit`, weekly audit CI).
This file tracks the remaining frontier.

## Instructions for the implementing agent

- Public MCP tool schemas live in `mcp-server/src/tools.ts`. Search behavior
  lives in `mcp-server/src/search/docIndex.ts`.
- Run `cd mcp-server && bun test src/__tests__/search.test.ts src/search/docVersion.test.ts`.
- Update `docs/reference/mcp-server.md` in the same slice as the tool schema.

## Phase 3: Versioning (remaining)

- [x] **Task 3.1**: MCP `version` parameter on doc search tools
  - Delivers: `terreno_search_docs` and `terreno_get_component_docs` accept
    optional `version`. Unmatched versions fall back to the nearest retained
    snapshot with a note. Omitted `version` searches `next` (current `docs/`).
    Historical searches do not mix other versions. Versioned `.mdx` files are
    indexed.
  - Files: `mcp-server/src/search/docIndex.ts`, `mcp-server/src/search/docVersion.ts`,
    `mcp-server/src/tools.ts`, `docs/reference/mcp-server.md`
  - Blocked by: none
  - Acceptance: `searchDocs({queries: ["token"], version: "0.19.0"})` returns
    only that snapshot; a patch like `0.19.1` falls back to `0.19.0` with a
    note; omitted version does not return `versioned/0.19.0` chunks;
    `getComponentDocsMarkdown` accepts the same `version` and reads the
    snapshot MDX when present.

## Phase 4: Skills (remaining)

- [x] **Task 4.1**: `improve-rulesync` docs-vs-agent split
  - Delivers: `improve-rulesync` states that user-facing guidance belongs in
    `docs/` (the site) and agent-facing guidance belongs in `.ai/` / rules,
    with cross-links rather than duplication.
  - Files: `.rulesync/skills/improve-rulesync/SKILL.md` (then `bun run skills:sync`)
  - Blocked by: Task 3.1
  - Acceptance: the skill names both homes and forbids copying the same
    architecture into both without a cross-link.
