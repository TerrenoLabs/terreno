# Tasks: Support answering agent (`@terreno/support`)

See: [`docs/implementationPlans/support-agent.md`](../implementationPlans/support-agent.md)

**Status:** Draft (Grow). Do not Pick until the IP header is **Approved**.

## Instructions for the implementing agent

- Load `update-docs`, `terreno-backend-api`, `backend-test-env`, `mongoose-schema-safety`,
  and `ai-prompt-governance` (prompt tasks). Load `model-router-actions` for every route.
- TDD: failing Bun test first, then implementation. Mock `LanguageModel` /
  `EmbeddingModel` the way `ai/src/service/aiService.test.ts` does; never call a real
  provider in tests.
- Every task that changes exports or behavior updates the named docs in the same task.
- Run `bun test --only-failures support/` (and `example-backend/` for tracer tasks), then
  `bun run lint` on touched packages. `bun run check:knip` before Brew.
- No `app.get` / `app.post`: routes are `modelRouter` actions. MCP surface is
  `registerMCPTool` only — no prompts/resources (Draft upstream IP).
- Luxon for dates; prompt strings are constants at the top of `support/src/agent/prompts.ts`.

---

### Phase 1: Knowledge core

- [ ] **Task 1.1**: Scaffold `@terreno/support` package
  - Delivers: `support/` workspace package that compiles and runs an empty test; root scripts
    `support:compile` / `support:test`; package listed in `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/00-root.mdc`
  - Files: `support/package.json` (deps `@terreno/api`, `@terreno/ai`, `ai`, `zod`, `luxon`, `gray-matter` or equivalent frontmatter parser via catalog), `support/tsconfig.json`, `support/biome.jsonc`, `support/README.md`, `support/src/index.ts`, `support/src/tests/bunSetup.ts`, root `package.json`, `knip.jsonc` (only if a narrow exception is needed), `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/00-root.mdc`
  - Blocked by: none
  - Docs: `docs/reference/support.md` (create: header + install snippet), `docs/reference/README.md` link
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: `bun run support:compile` and `bun run support:test` succeed; `bun run check:knip` clean; package resolvable from `example-backend` as `workspace:*`

- [ ] **Task 1.2**: Knowledge types + models
  - Delivers: exported `KnowledgeDocument`, `KnowledgeSource`, `Retriever`, `RetrievedChunk`; Mongoose models `SupportDocument`, `SupportChunk` with indexes from the IP (unique `{sourceId, externalId}`, `{documentId, order}`, text index on chunk `text` + `heading`)
  - Files: `support/src/knowledge/types.ts`, `support/src/models/supportDocument.ts`, `support/src/models/supportChunk.ts`, `support/src/modelTypes.ts`, `support/src/tests/models.test.ts`
  - Blocked by: Task 1.1
  - Docs: `docs/reference/support.md` (Models + Interfaces sections)
  - Skills: `mongoose-schema-safety`, `terreno-backend-api`, `update-docs`
  - Acceptance: test inserts two documents with the same `{sourceId, externalId}` and the second fails with a duplicate-key error; `SupportChunk.collection.indexes()` includes a text index

- [ ] **Task 1.3**: Markdown chunker
  - Delivers: `chunkMarkdown({title, body, maxTokens = 800, overlapTokens = 100})` — heading-aware, keeps code fences intact, returns `[{order, heading, text}]`
  - Files: `support/src/knowledge/chunker.ts`, `support/src/knowledge/chunker.test.ts`
  - Blocked by: Task 1.1
  - Docs: `docs/explanation/support-agent.md` (create: Retrieval section, chunking paragraph)
  - Skills: `update-docs`
  - Acceptance: a doc with three H2 sections yields ≥ 3 chunks each carrying its heading; a 5,000-token section splits with overlap and no chunk exceeds `maxTokens`; a fenced code block is never split mid-fence

- [ ] **Task 1.4**: `markdownDocsSource` + `SupportIndexer` (lexical only)
  - Delivers: `markdownDocsSource({dir, id = "docs", watch})` parsing frontmatter (`title`, `slug`, `audience`, `tags`, `related`); `SupportIndexer.reindex({sourceId?})` that upserts `SupportDocument` by hash, replaces chunks only when the hash changed, marks missing docs `stale`, and returns `{indexed, unchanged, stale}`
  - Files: `support/src/knowledge/sources/markdownDocsSource.ts`, `support/src/knowledge/indexer.ts`, `support/src/tests/indexer.test.ts`, `support/src/tests/fixtures/kb/*.md`
  - Blocked by: Task 1.2, Task 1.3
  - Docs: `docs/how-to/add-support-knowledge.md` (create: `support/kb` convention + frontmatter table), `docs/how-to/README.md` link
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: **AC2** — first `reindex()` indexes every fixture; second reports all `unchanged` and chunk count is identical; editing one fixture body re-chunks only that document; deleting a fixture marks it `stale`

- [ ] **Task 1.5**: Lexical retriever + `SupportAgent.search`
  - Delivers: `lexicalRetriever` over `$text` with `sourceIds` filter, `status: "active"` filter, and post-filter through `source.isVisible` / global `isVisible`; `SupportAgent.search({query, user, limit, sourceIds})` returning excerpts via `excerptBody`-style helper
  - Files: `support/src/knowledge/retrievers/lexicalRetriever.ts`, `support/src/agent/supportAgent.ts`, `support/src/agent/excerpt.ts`, `support/src/tests/search.test.ts`
  - Blocked by: Task 1.4
  - Docs: `docs/explanation/support-agent.md` (Visibility section)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: **AC3** — `search("archive todo")` ranks the archive fixture first; a source whose `isVisible` returns false for the test user contributes zero results; `stale` documents never appear

---

### Phase 2: Answering + REST

- [ ] **Task 2.1**: Prompts + `SupportAgent.ask` (mocked model)
  - Delivers: `SUPPORT_SYSTEM_PROMPT`, `SUPPORT_ANSWER_SCHEMA` (zod) constants; `ask({question, user, conversationId?, channel})` → retrieve → `aiService.generateJsonObject` → `SupportAnswer`; empty retrieval short-circuits to `shouldEscalate: true` without a model call
  - Files: `support/src/agent/prompts.ts`, `support/src/agent/supportAgent.ts`, `support/src/tests/ask.test.ts`
  - Blocked by: Task 1.5
  - Docs: `docs/explanation/support-agent.md` (Answering + grounding section); prompt governance note in `docs/reference/support.md`
  - Skills: `ai-prompt-governance`, `terreno-backend-api`, `update-docs`
  - Acceptance: **AC4** — mock model receives a system prompt containing each retrieved chunk's text and nothing from non-retrieved fixtures; returned `sources` ⊆ retrieved documents; **AC5** (model part) — zero hits → no `doGenerate` call, `shouldEscalate: true`

- [ ] **Task 2.2**: `SupportQuestion` log, feedback, escalation hook, conversation history
  - Delivers: `SupportQuestion` model; every `ask` writes one row with `ownerId` for an authenticated asker, `channel`, `latencyMs`, `aiRequestId`; `onEscalate` invoked once when `shouldEscalate`; `conversationId` threads only the last 5 turns owned by the current authenticated user into the prompt; anonymous asks are single-turn; `recordFeedback({questionId, user, rating, comment})`
  - Files: `support/src/models/supportQuestion.ts`, `support/src/agent/supportAgent.ts`, `support/src/tests/questionLog.test.ts`
  - Blocked by: Task 2.1
  - Docs: `docs/reference/support.md` (SupportQuestion model, hooks table)
  - Skills: `mongoose-schema-safety`, `terreno-backend-api`, `update-docs`
  - Acceptance: **AC5** (log + hook part) — escalated ask persists a `SupportQuestion` and calls a spy `onEscalate` exactly once; second ask by the same user with the same `conversationId` includes the first Q/A in the mock's prompt, while another user's ask with that id has no history; feedback stores `{rating, comment, at}`

- [ ] **Task 2.3**: `SupportApp` plugin + REST routes
  - Delivers: `SupportApp implements TerrenoPlugin` (constructor per IP; boot-time non-blocking `reindex()`); `modelRouter("/support/questions", SupportQuestion, {collectionActions: {ask, search}, instanceActions: {feedback}, permissions, allowAnonymous})`; public access requires `permissions.ask: [Permissions.IsAny]` with `allowAnonymous: true`; `modelRouter("/support/documents", SupportDocument, {collectionActions: {reindex}})` admin-only; OpenAPI registered
  - Files: `support/src/supportApp.ts`, `support/src/routes.ts`, `support/src/tests/routes.test.ts`, `support/src/index.ts`
  - Blocked by: Task 2.2
  - Docs: `docs/reference/support.md` (REST table, constructor options); `docs/explanation/model-router-actions.md` gets a one-line cross-link example
  - Skills: `model-router-actions`, `terreno-backend-api`, `backend-test-env`, `update-docs`
  - Acceptance: **AC6** — supertest: unauthenticated `ask` 401; authenticated 200 with `SupportAnswer` shape; `permissions.ask: [Permissions.IsAny]` with `allowAnonymous: true` → anonymous 200; `permissions.ask: []` → 405; non-owner `feedback` 403; non-admin `reindex` 403; admin `reindex` returns indexer summary

- [ ] **Task 2.4**: Example-backend tracer (kb docs + wiring + SDK)
  - Delivers: `example-backend/support/kb/` with ≥ 3 docs about todos (create, complete, archive); `SupportApp` registered in `server.ts` with `markdownDocsSource`; `AIService` from existing `example-backend/src/api/ai.ts` provider; example-frontend SDK regenerated
  - Files: `example-backend/support/kb/*.md`, `example-backend/src/api/support.ts`, `example-backend/src/server.ts`, `example-backend/src/api/support.test.ts`, `example-backend/package.json`, `example-frontend/store/openApiSdk.ts` (generated only)
  - Blocked by: Task 2.3
  - Docs: `example-backend/README.md` (Support section); `docs/how-to/add-support-knowledge.md` (worked example)
  - Skills: `terreno-backend-api`, `generate-sdk`, `update-docs`
  - Acceptance: example-backend test boots the app, waits for reindex, and `POST /support/questions/search {query: "archive"}` returns the archive doc; `bun run sdk` diff contains `usePostSupportQuestionsAskMutation` (or the generated equivalent) and nothing hand-edited

---

### Phase 3: MCP tools

- [ ] **Task 3.1**: `support_ask` + `support_search` tools
  - Delivers: `registerSupportMCPTools({agent, permissions})` called by `SupportApp.register`; zod schemas per IP; handlers reuse `SupportAgent` with `channel: "mcp"`; permission denial returns `isError: true`
  - Files: `support/src/mcpTools.ts`, `support/src/tests/mcpTools.test.ts`, `support/src/supportApp.ts`
  - Blocked by: Task 2.3
  - Docs: `docs/how-to/expose-mcp-tools.md` (Support tools subsection); `docs/reference/support.md` (MCP tools table)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: **AC7** (part) — MCP integration test (pattern: `api/src/mcp/integration.test.ts`) as authenticated user: `tools/list` contains `support_ask`, `support_search`; `support_ask` returns text JSON parseable into `SupportAnswer` and a `SupportQuestion` row with `channel: "mcp"`; unauthenticated call is rejected per MCP auth

- [ ] **Task 3.2**: `support_get_document` + `support_list_sources`
  - Delivers: full markdown + metadata for a visible document; sources summary `{id, label, documentCount, lastIndexedAt}`
  - Files: `support/src/mcpTools.ts`, `support/src/agent/supportAgent.ts` (`getDocument`, `listSources`), `support/src/tests/mcpTools.test.ts`
  - Blocked by: Task 3.1
  - Docs: `docs/reference/support.md` (tools table complete)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: **AC7** (rest) — unknown `documentId` → `isError: true`; hidden document (visibility false) → `isError: true` with no content leak; `support_list_sources` counts match `SupportDocument` `active` rows per source

---

### Phase 4: Sources

- [ ] **Task 4.1**: `modelSource` + example-backend `BugReport` tracer
  - Delivers: `modelSource({id, model, filter, toDocument, isVisible})`; example-backend `BugReport` model (`title`, `description`, `resolution`, `status`) with seed data and `modelSource` over resolved reports
  - Files: `support/src/knowledge/sources/modelSource.ts`, `support/src/tests/modelSource.test.ts`, `example-backend/src/models/bugReport.ts`, `example-backend/src/modelInterfaces.ts`, `example-backend/src/api/support.ts`, `example-backend/src/scripts/seed-test-data.ts`, `example-backend/src/api/support.test.ts`
  - Blocked by: Task 1.5
  - Docs: `docs/how-to/add-support-knowledge.md` (Model source section: bug reports and resolutions)
  - Skills: `mongoose-schema-safety`, `terreno-backend-api`, `update-docs`
  - Acceptance: **AC9** — resolved reports indexed, open excluded; `search("crash on login")` returns the resolution excerpt

- [ ] **Task 4.2**: `announcementsSource`
  - Delivers: adapter over the `Announcement` model: `published` for everyone, `archived` with `includeArchived`, drafts never; `post("save")` hook triggers `reindex({sourceId})` for that document; `isVisible` delegates to an optional `matchAudience` passed in
  - Files: `support/src/knowledge/sources/announcementsSource.ts`, `support/src/tests/announcementsSource.test.ts` (dev-dependency on `@terreno/announcements` for the test model only), `example-backend/src/api/support.ts`
  - Blocked by: Task 1.5, **merge of [PR #1284](https://github.com/TerrenoLabs/terreno/pull/1284)**
  - Docs: `docs/how-to/add-support-knowledge.md` (Announcements section); `docs/reference/announcements.md` (link to support integration)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: **AC8** — status matrix test; publishing an announcement results in a new `SupportDocument` after the save hook resolves, without a manual `reindex()`

- [ ] **Task 4.3**: Reindex lifecycle hardening
  - Delivers: `watch: true` on `markdownDocsSource` re-indexes a changed file (debounced); boot reindex never blocks `TerrenoApp.start()`; indexer errors from one source do not abort others and are logged with `logger.warn`
  - Files: `support/src/knowledge/indexer.ts`, `support/src/knowledge/sources/markdownDocsSource.ts`, `support/src/tests/indexerLifecycle.test.ts`
  - Blocked by: Task 2.3, Task 4.1
  - Docs: `docs/explanation/support-agent.md` (Indexing lifecycle section)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: a source whose `list()` throws leaves other sources indexed and the summary reports it; file change under `watch` produces a new `contentHash` within the debounce window in a test using a temp dir

---

### Phase 5: Embeddings + hybrid retrieval

- [ ] **Task 5.1**: `embeddingModel` option + chunk embeddings
  - Delivers: indexer calls `embedMany` in batches when `embeddingModel` is set; stores `embedding` + `embeddingModelId`; re-embeds only when the model id differs or the chunk is new; embedding failure logs `warn` and leaves chunks lexical-only
  - Files: `support/src/knowledge/indexer.ts`, `support/src/knowledge/embeddings.ts`, `support/src/tests/embeddings.test.ts`
  - Blocked by: Task 1.4
  - Docs: `docs/reference/support.md` (options: `embeddingModel`); `docs/reference/environment-variables.md` (example-backend key used for embeddings)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: **AC10** (storage part) — mocked `EmbeddingModel` yields embeddings on every chunk; switching `modelId` re-embeds all; no `embeddingModel` → no `embedding` field

- [ ] **Task 5.2**: Vector + hybrid retrievers with RRF
  - Delivers: `vectorRetriever` (in-process cosine; `$vectorSearch` when `atlasVectorSearchIndex` set), `hybridRetriever` fusing lexical + vector by reciprocal rank fusion; `SupportApp` picks hybrid when embeddings exist, lexical otherwise; `retriever` option overrides
  - Files: `support/src/knowledge/retrievers/vectorRetriever.ts`, `support/src/knowledge/retrievers/hybridRetriever.ts`, `support/src/supportApp.ts`, `support/src/tests/hybridRetriever.test.ts`
  - Blocked by: Task 5.1, Task 1.5
  - Docs: `docs/explanation/support-agent.md` (Retrieval: lexical vs hybrid vs Atlas); `docs/reference/support.md` (`atlasVectorSearchIndex`, `retriever`)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: **AC10** (ranking part) — with deterministic mock embeddings a chunk with zero lexical overlap but nearest vector lands in top 3; custom `retriever` is called instead of the default; `$vectorSearch` path is unit-tested by asserting the aggregation pipeline shape (no Atlas in tests)

- [ ] **Task 5.3**: Example-backend embedding wiring
  - Delivers: `example-backend` passes `google.textEmbedding(...)` when the Google key is present (reuse provider loading in `example-backend/src/api/ai.ts`), otherwise omits `embeddingModel`; README documents both modes
  - Files: `example-backend/src/api/support.ts`, `example-backend/src/api/ai.ts`, `example-backend/README.md`
  - Blocked by: Task 5.2, Task 2.4
  - Docs: `docs/reference/environment-variables.md`; `example-backend/README.md`
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: example-backend test with env unset boots lexical-only and `search` still works; a unit test asserts the embedding model is constructed only when the key is set

---

### Phase 6: AI authoring loop

- [ ] **Task 6.1**: `terreno-support check` CLI
  - Delivers: bin `terreno-support` with `check [dir]` validating frontmatter (`title`, `slug`), duplicate slugs, empty bodies, zero-chunk files; JSON and human output; non-zero exit on failure
  - Files: `support/src/cli.ts`, `support/src/knowledge/validateKb.ts`, `support/src/tests/cli.test.ts`, `support/package.json` (`bin`), example-backend `package.json` script `support:check`
  - Blocked by: Task 1.4
  - Docs: `docs/how-to/add-support-knowledge.md` (Validate section); `docs/reference/support.md` (CLI)
  - Skills: `update-docs`
  - Acceptance: **AC11** — fixtures for pass and each failure class; failing output names the file and rule

- [ ] **Task 6.2**: `write-support-docs` skill
  - Delivers: plugin skill instructing agents to add/update `support/kb/<slug>.md` for user-visible changes, run `terreno-support check`, mention the doc in the PR; Roast criterion text; generated Claude copy via `bun run skills:sync`
  - Files: `plugins/terreno-planning/skills/write-support-docs/SKILL.md`, generated `plugins/terreno-claude/skills/write-support-docs/SKILL.md`, `skills/` output, `plugins/README.md` skill list, `.rulesync/rules` or Pick guidance reference (`plugins/terreno-planning/skills/terreno-2-pick/SKILL.md` supporting-skills mention)
  - Blocked by: Task 6.1
  - Docs: `docs/reference/lifecycle-plugin.md` (skill table row); `docs/how-to/install-agent-skills.md` if it enumerates skills
  - Skills: `update-agent-docs`, `update-docs`
  - Acceptance: **AC14** — `bun run skills:sync` produces the generated copies with no manual edits; `bun run check:lifecycle-skills` passes; skill has a reliable trigger line and completion criteria per `update-agent-docs`

- [ ] **Task 6.3**: Knowledge gaps + admin contribution
  - Delivers: `GET /support/questions/gaps` collection action grouping `low` confidence and `down` feedback by normalized question (`{normalizedQuestion, count, lastAskedAt, sampleQuestions, sampleQuestionIds}`); `adminContribution()` registering `SupportQuestion` and `SupportDocument` read-only
  - Files: `support/src/routes.ts`, `support/src/agent/gaps.ts`, `support/src/supportApp.ts`, `support/src/tests/gaps.test.ts`
  - Blocked by: Task 2.3
  - Docs: `docs/how-to/add-support-knowledge.md` (Close the loop: gaps → new doc); `docs/reference/support.md` (gaps action, admin models)
  - Skills: `model-router-actions`, `building-admin-interfaces`, `update-docs`
  - Acceptance: **AC12** — two `low` asks with case/punctuation variants collapse into one row with `count: 2`; non-admin 403; admin app lists both models

---

### Phase 7: Docs consolidation

- [ ] **Task 7.1**: Explanation, reference, how-to reconciliation + Notion how-to
  - Delivers: complete `docs/explanation/support-agent.md` (why RAG in-process, source contract, visibility, authoring loop, relation to announcements help API and hosted MCP), complete `docs/reference/support.md`, `docs/how-to/plug-in-notion-knowledge.md` with a full `KnowledgeSource` implementation using `@notionhq/client` that typechecks in a docs compile test, index links in all three READMEs, root `README.md` package table
  - Files: the four docs pages, `docs/{explanation,reference,how-to}/README.md`, `README.md`, `support/src/tests/docsSnippets.test.ts` (compiles the Notion snippet against exported types with a stubbed client)
  - Blocked by: Task 3.2, Task 4.2, Task 5.2, Task 6.3
  - Docs: all of the above
  - Skills: `update-docs`, `docs-audit`
  - Acceptance: **AC13** — pages exist and are linked; `docs-audit` reports no drift for `@terreno/support`; Notion snippet compiles; no page documents prompts/resources as shipped

---

## Frontier after Approve

Unblocked: **Task 1.1**.  
After 1.1: 1.2, 1.3 in parallel.  
1.4 after 1.2 + 1.3; 1.5 after 1.4.  
Phase 2 is linear (2.1 → 2.2 → 2.3 → 2.4).  
3.1 after 2.3; 3.2 after 3.1.  
4.1 and 5.1 can start after 1.5 / 1.4 in parallel with Phase 2.  
4.2 additionally waits for PR #1284 to merge — if it has not merged when the frontier reaches it, skip it and continue; Brew notes the gap.  
6.1 after 1.4; 6.2 after 6.1; 6.3 after 2.3.  
7.1 last.
