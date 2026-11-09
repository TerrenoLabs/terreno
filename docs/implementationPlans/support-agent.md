# Implementation Plan: Support answering agent (`@terreno/support`)

**Status:** Draft — awaiting approval (Grow ran unattended; every Decisions row marked `assumed` is a recommended default the reviewer can change before Approve)  
**Roadmap:** Area=`ai`, Target=`Future`, Impact=`Feature`  
**Branch:** `cursor/support-agent-grow-fd63`  
**Owner:** unassigned  
**Created:** 2026-09-15  
**Depends on:** [announcements.md](announcements.md) (`@terreno/announcements`, [PR #1284](https://github.com/TerrenoLabs/terreno/pull/1284) — only the announcements adapter task blocks on it), [model-router-mcp.md](model-router-mcp.md) (shipped: `registerMCPTool`, `/mcp`), [model-router-actions.md](model-router-actions.md) (shipped: `collectionActions` / `instanceActions`)  
**Related:** [app-mcp-server.md](app-mcp-server.md) (Draft — MCP prompts/resources; this plan uses tools only until that ships), [ai-agents-and-failover.md](ai-agents-and-failover.md) (Draft — explicitly excludes RAG; this plan owns retrieval), [mcp-boost-parity.md](mcp-boost-parity.md) (hosted dev-time MCP; unchanged)  
**Roadmap issue:** TBD after Approve (`roadmap-item`)

The announcements plan gives consumer apps an admin-authored changelog and exposes it to
Terreno's hosted MCP as keyword search (`terreno_search_update_notes`,
`terreno_ask_update_help`). This plan turns that seam into a **GPT-powered support agent
that runs inside the consumer's backend**: it ingests every announcement, a folder of
markdown knowledge-base docs that AI agents extend as they ship features, and any
consumer-defined source (bug reports and resolutions, Notion, a ticketing system), then
answers support questions with cited sources over MCP and REST.

## Goal

Ship `@terreno/support`, a `TerrenoPlugin` that:

1. **Ingests knowledge** from pluggable `KnowledgeSource` adapters into a Mongo-backed,
   chunked, searchable index. Built in: announcements, markdown docs folder, and a generic
   Mongoose-model adapter.
2. **Answers support questions** with `@terreno/ai`'s `AIService`, grounded only in
   retrieved chunks, returning `answer`, `sources`, `confidence`, and `shouldEscalate`.
3. **Exposes the agent as MCP tools** on the app's existing `/mcp` server
   (`support_ask`, `support_search`, `support_get_document`, `support_list_sources`) and
   as REST `modelRouter` actions, so ChatGPT, Claude, Cursor, an in-app widget, or a
   human-support tool can all call the same agent.
4. **Closes the loop for AI authors**: a `support/kb/` docs convention, a
   `write-support-docs` skill, a `terreno-support check` validator, and a
   "knowledge gaps" report (low-confidence / thumbs-down questions) that tells agents which
   doc to write next.

Destination: in `example-backend`, an authenticated MCP client calls `support_ask`
("How do I archive a todo?") and receives an answer that cites a `support/kb` doc and a
published announcement; an unanswerable question returns `shouldEscalate: true`, is logged,
and appears in `GET /support/questions/gaps`.

## Non-Goals

- Frontend components (`SupportChat` widget, admin "gaps" screen). v1 is MCP + REST;
  admin uses generic model CRUD via `adminContribution`. Frontend is Future Work.
- A published Notion adapter package. v1 ships the `KnowledgeSource` contract plus a how-to
  with a complete Notion example; `@terreno/support-adapter-notion` is Future Work.
- Ticketing / case management. `shouldEscalate` plus an `onEscalate` hook only.
- Multi-tenant knowledge partitioning beyond the `isVisible(user, doc)` hook.
- Replacing hosted `@terreno/mcp` `terreno_ask_update_help` (keyword search of Terreno's
  own notes). Indexing Terreno's docs site with this package is Future Work.
- MCP prompts and resources (`support://` URIs) — blocked on
  [app-mcp-server.md](app-mcp-server.md) Tasks 1.2–1.3; listed as Future Work.
- Streaming answers, voice, or image inputs.
- Reranker models, provider-hosted vector stores, or a required Atlas Vector Search index.
- Mid-conversation tool use by the answering model (the agent retrieves first, then
  generates; it does not call tools).

## Decisions

Source `assumed` = recommended default taken because Grow ran without a human in the loop.
Change the row before Approve if Pick should do something else.

| ID | Question | Decision | Source |
| --- | --- | --- | --- |
| D1 | Where does this live? | New workspace package **`@terreno/support`** (`support/`), plugin class `SupportApp implements TerrenoPlugin`, mirroring `@terreno/feature-flags` / `@terreno/announcements`. Depends on `@terreno/api` and `@terreno/ai`. Does **not** depend on `@terreno/announcements`; the adapter receives the model as an argument. | assumed |
| D2 | How is knowledge pluggable? | One interface, **`KnowledgeSource`** (`id`, `label`, `list()`, optional `watch()`, optional `isVisible(user, doc)`), producing `KnowledgeDocument` records. Built-in adapters: `markdownDocsSource`, `announcementsSource`, `modelSource`. Notion is a how-to example implementing the same interface. Naming follows `@terreno/comms` providers/adapters. | assumed |
| D3 | Where is the index stored? | **MongoDB** via two models: `SupportDocument` (materialized snapshot + `contentHash`) and `SupportChunk` (text, order, optional `embedding: number[]`, denormalized `sourceId` / `audience`). No external vector DB. | assumed |
| D4 | How does retrieval work? | **Hybrid, no infrastructure by default.** Lexical Mongo `$text` search always; when an `embeddingModel` is configured, in-process cosine over embeddings stored on chunks, fused with reciprocal rank fusion. Optional `atlasVectorSearchIndex` switches the vector leg to `$vectorSearch`. `Retriever` is an exported interface so consumers can replace it. | assumed |
| D5 | Which model generates answers and embeddings? | The consumer injects both: `aiService: AIService` (existing `@terreno/ai`) and optional `embeddingModel: EmbeddingModel<string>` (Vercel AI SDK). No provider is hardcoded; `example-backend` wires Google (`@ai-sdk/google`) when its API key is present and falls back to lexical-only otherwise. | assumed |
| D6 | How does the agent answer? | Retrieve → `AIService.generateJsonObject` with a grounded system prompt (constants at the top of `support/src/prompts.ts`) → `{answer, sources[], confidence: "high" \| "medium" \| "low", shouldEscalate}`. The prompt forbids answers not supported by the provided chunks; empty retrieval short-circuits to `shouldEscalate: true` without calling the model. | assumed |
| D7 | Which surfaces? | **MCP tools** on the existing `/mcp` via `registerMCPTool` (`support_ask`, `support_search`, `support_get_document`, `support_list_sources`) and **REST** via `modelRouter("/support/questions", SupportQuestion, {collectionActions: {ask, search, gaps}, instanceActions: {feedback}})` plus admin `modelRouter("/support/documents", SupportDocument, {collectionActions: {reindex}})`. No `app.post`. | assumed |
| D8 | Who may ask? | `IsAuthenticated` by default for `ask` / `search` / `support_*` tools. Public REST help requires both `permissions.ask: [Permissions.IsAny]` and `allowAnonymous: true` on the questions router; an empty permissions array disables an action. Documents, reindex, and gaps are `IsAdmin`. | assumed |
| D9 | How is visibility enforced? | Announcements: `published` only for non-admins, `archived` opt-in, drafts never. Every source may implement `isVisible(user, doc)`; `SupportApp` also accepts a global `isVisible`. Filters run after retrieval and before generation, so hidden chunks never reach the prompt. | assumed |
| D10 | Where do AI-authored docs live? | **`support/kb/**/*.md`** in the consumer backend with frontmatter `title`, `slug`, optional `audience`, `tags`, `related`. Indexed by `markdownDocsSource({dir})` at boot; `watch: true` re-indexes on change in development. | assumed |
| D11 | How do agents keep docs current? | New plugin skill **`write-support-docs`** (installed with `terreno-planning`; generated Claude copy via `bun run skills:sync`), a **`terreno-support check`** CLI that fails on bad frontmatter / empty docs / duplicate slugs, and Roast criteria in this repo's Pick guidance: a user-visible feature PR adds or updates a `support/kb` doc. No hard CI coupling between route changes and docs in v1. | assumed |
| D12 | When does the index refresh? | Incremental by `contentHash`: at boot (non-blocking), on `announcementsSource` post-save hooks, on `markdownDocsSource` file watch (dev), and via admin `POST /support/documents/reindex` (optionally per `sourceId`). Embedding failures log `warn` and leave chunks lexical-only. | assumed |
| D13 | What is logged? | Every `ask` writes a `SupportQuestion` (question, answer, sources, confidence, `shouldEscalate`, `ownerId`, `channel: "mcp" \| "rest"`, `latencyMs`, `feedback`). `ownerId` is the authenticated asker's id when present, enabling standard owner checks. `AIService` already logs the model call to `AIRequest` with `requestType: "support_answer"`. `gaps` groups low-confidence and thumbs-down questions for doc authors. | assumed |
| D14 | Escalation? | `shouldEscalate` in the result plus an optional `onEscalate({question, user, result})` hook consumers wire to `@terreno/comms` or a ticketing API. No ticket model in v1. | assumed |
| D15 | Follow-up questions? | Single-turn by default. Optional `conversationId` threads the last 5 `SupportQuestion` turns owned by the current authenticated user into the prompt as history; anonymous asks are always single-turn. No separate conversation model. | assumed |
| D16 | Frontend in v1? | No. Avoids blocking on UI verification; the MCP surface is the deliverable the request names. `SupportChat` in `@terreno/ui` is Future Work. | assumed |

## Architecture

```
Consumer backend (example-backend)
  new SupportApp({
    aiService,                 // @terreno/ai AIService (required)
    embeddingModel?,           // Vercel AI SDK EmbeddingModel<string> (optional)
    sources: [
      markdownDocsSource({dir: "support/kb", watch: isDev}),
      announcementsSource({model: Announcement, includeArchived: false}),
      modelSource({id: "bug-resolutions", model: BugReport, filter: {status: "resolved"},
                   toDocument: (doc) => ({title: doc.title, body: doc.resolution, ...})}),
      notionSource(...)         // consumer-authored, follows the how-to
    ],
    isVisible?: (user, doc) => boolean,
    onEscalate?: async ({question, user, result}) => void,
    permissions?: {ask: [Permissions.IsAuthenticated]},
    allowAnonymous?: boolean, // requires ask: [Permissions.IsAny]
    retriever?: Retriever,     // replace hybrid default
    atlasVectorSearchIndex?: string,
  })

@terreno/support
  ├─ knowledge/
  │   ├─ types.ts            KnowledgeSource, KnowledgeDocument, Retriever, RetrievedChunk
  │   ├─ chunker.ts          heading-aware markdown chunking (~800 tokens, 100 overlap)
  │   ├─ indexer.ts          SupportIndexer: list sources → hash → upsert docs/chunks → embed
  │   ├─ retrievers/
  │   │   ├─ lexicalRetriever.ts     Mongo $text
  │   │   ├─ vectorRetriever.ts      in-process cosine | $vectorSearch
  │   │   └─ hybridRetriever.ts      RRF fusion + visibility filter
  │   └─ sources/
  │       ├─ markdownDocsSource.ts   support/kb frontmatter docs (+ fs.watch)
  │       ├─ announcementsSource.ts  Announcement model → docs (+ post-save hook)
  │       └─ modelSource.ts          any Mongoose model → docs
  ├─ models/
  │   ├─ supportDocument.ts  snapshot + contentHash + sourceId + status
  │   ├─ supportChunk.ts     text (text index), embedding?, docId, order, audience
  │   └─ supportQuestion.ts  ask log + feedback
  ├─ agent/
  │   ├─ prompts.ts          SUPPORT_SYSTEM_PROMPT, SUPPORT_ANSWER_SCHEMA (constants)
  │   └─ supportAgent.ts     ask() / search() / getDocument()
  ├─ routes.ts               modelRouter definitions (questions + documents)
  ├─ mcpTools.ts             registerMCPTool × 4
  ├─ cli.ts                  `terreno-support check`
  └─ supportApp.ts           TerrenoPlugin wiring + adminContribution

Clients
  ChatGPT / Claude / Cursor / Inspector ──MCP──▶ /mcp  (support_ask …)
  In-app widget / human support tool   ──REST──▶ POST /support/questions/ask
  AI coding agent                      ──skill──▶ support/kb/<slug>.md  ──▶ reindex
```

Mirror existing patterns:

| Concern | Reference |
| --- | --- |
| Plugin package + admin contribution | `feature-flags/src/featureFlagsApp.ts`, `announcements/src/announcementsApp.ts` (PR #1284) |
| Pluggable providers | `comms/src/types.ts` (`MailProvider`, `SmsProvider`), `comms/src/adapters/` |
| Custom MCP tool | `example-backend/src/api/usersTodoStatus.ts` (`registerMCPTool`) |
| MCP integration tests | `api/src/mcp/integration.test.ts`, `api/src/mcp/customTools.test.ts` |
| Grounded JSON generation | `ai/src/service/aiService.ts` `generateJsonObject`, mocked `LanguageModel` in `aiService.test.ts` |
| Prompt governance | `ai-prompt-governance` skill (prompt constants at top of file) |
| Custom endpoints | `docs/explanation/model-router-actions.md` |
| Keyword search over announcements | `announcements/src/help.ts` (`matchesHelpQueries`, `excerptBody`) — reused for excerpts |

## Models

### SupportDocument

| Field | Type | Notes |
| --- | --- | --- |
| `sourceId` | `string` (indexed) | `KnowledgeSource.id` |
| `externalId` | `string` | id within the source (announcement `_id`, file slug, Notion page id). Unique with `sourceId`. |
| `title` | `string` | |
| `body` | `string` | markdown snapshot |
| `url` | `string?` | deep link for citations |
| `tags` | `string[]` | |
| `audience` | `Mixed?` | copied from the source for `isVisible` |
| `contentHash` | `string` | sha256 of `title + body + url`; skip re-chunk when unchanged |
| `status` | `"active" \| "stale"` | `stale` when the source no longer lists it; excluded from retrieval |
| `sourceUpdatedAt` | `Date` | |
| `chunkCount` | `number` | |
| plugins | | `createdUpdated`, `isDeleted`, `findExactlyOne` |

### SupportChunk

| Field | Type | Notes |
| --- | --- | --- |
| `documentId` | `ObjectId` (indexed) | |
| `sourceId` | `string` (indexed) | denormalized for filtering |
| `order` | `number` | |
| `heading` | `string?` | nearest markdown heading |
| `text` | `string` | **text index** (`{text: "text", heading: "text"}`) |
| `embedding` | `number[]?` | absent when no `embeddingModel` |
| `embeddingModelId` | `string?` | re-embed when the configured model changes |
| `audience` | `Mixed?` | denormalized |

### SupportQuestion

| Field | Type | Notes |
| --- | --- | --- |
| `question` | `string` | |
| `answer` | `string?` | |
| `sources` | `[{documentId, title, url, sourceId, chunkIds}]` | |
| `confidence` | `"high" \| "medium" \| "low"` | |
| `shouldEscalate` | `boolean` | |
| `escalatedAt` | `Date?` | set when `onEscalate` ran |
| `ownerId` | `ObjectId?` | authenticated asker; used by owner permissions and conversation-history scoping |
| `conversationId` | `string?` | |
| `channel` | `"mcp" \| "rest"` | |
| `latencyMs` | `number` | |
| `aiRequestId` | `ObjectId?` | link to `AIRequest` |
| `feedback` | `{rating: "up" \| "down", comment?: string, at: Date}?` | |

## APIs

### Public interfaces (`@terreno/support` exports)

```ts
export interface KnowledgeDocument {
  externalId: string;
  title: string;
  body: string;          // markdown
  url?: string;
  tags?: string[];
  audience?: unknown;
  updatedAt: DateTime;   // Luxon
  metadata?: Record<string, unknown>;
}

export interface KnowledgeSource {
  id: string;
  label: string;
  list(): AsyncIterable<KnowledgeDocument> | Promise<KnowledgeDocument[]>;
  watch?(onChange: (change: {externalId?: string}) => void): () => void;
  isVisible?(user: User | undefined, doc: SupportDocumentDocument): boolean;
}

export interface RetrievedChunk {chunk: SupportChunkDocument; document: SupportDocumentDocument; score: number}
export interface Retriever {
  retrieve(params: {query: string; user?: User; limit: number}): Promise<RetrievedChunk[]>;
}

export interface SupportAnswer {
  answer: string;
  sources: Array<{documentId: string; title: string; url?: string; sourceId: string}>;
  confidence: "high" | "medium" | "low";
  shouldEscalate: boolean;
  questionId: string;
}

export const markdownDocsSource: (o: {dir: string; id?: string; watch?: boolean}) => KnowledgeSource;
export const announcementsSource: (o: {model: Model<any>; id?: string; includeArchived?: boolean}) => KnowledgeSource;
export const modelSource: <T>(o: {id: string; label?: string; model: Model<T>; filter?: FilterQuery<T>;
  toDocument: (doc: HydratedDocument<T>) => KnowledgeDocument; isVisible?: KnowledgeSource["isVisible"]}) => KnowledgeSource;
export class SupportIndexer { reindex(o?: {sourceId?: string}): Promise<{indexed: number; unchanged: number; stale: number}> }
export class SupportAgent { ask(...): Promise<SupportAnswer>; search(...): Promise<RetrievedChunk[]>; getDocument(...) }
export class SupportApp implements TerrenoPlugin {}
```

### REST (via `modelRouter`)

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `POST` | `/support/questions/ask` | `permissions.ask` (default `IsAuthenticated`) | body `{question, conversationId?}` → `SupportAnswer`; public use requires `ask: [Permissions.IsAny]` and `allowAnonymous: true` |
| `POST` | `/support/questions/search` | same | body `{query, limit?, sourceIds?}` → `{data: [{title, excerpt, url, sourceId, documentId, score}]}` |
| `GET` | `/support/questions/gaps` | `IsAdmin` | low-confidence + thumbs-down grouped by normalized question, `{count, lastAskedAt, sampleQuestions}` |
| `POST` | `/support/questions/:id/feedback` | owner or admin | body `{rating, comment?}` |
| `GET` | `/support/questions` `/:id` | `IsAdmin` list/read; owner read | standard modelRouter |
| `GET` | `/support/documents` `/:id` | `IsAdmin` | queryFields `sourceId`, `status`, `title` |
| `POST` | `/support/documents/reindex` | `IsAdmin` | body `{sourceId?}` → indexer summary |

All routes carry OpenAPI via the router; example-frontend regenerates its SDK after Phase 2
(`cd example-frontend && bun run sdk`) even though no screen consumes it yet.

### MCP tools (registered on the app `/mcp`)

| Tool | Args (zod) | Returns | Annotation |
| --- | --- | --- | --- |
| `support_ask` | `{question: string, conversationId?: string}` | `SupportAnswer` as text JSON | not read-only (writes a `SupportQuestion`) |
| `support_search` | `{query: string, limit?: number ≤ 20, sourceIds?: string[]}` | ranked excerpts with `documentId` | read-only |
| `support_get_document` | `{documentId: string}` | full markdown + metadata | read-only |
| `support_list_sources` | `{}` | `[{id, label, documentCount, lastIndexedAt}]` | read-only |

Tool handlers receive `user` from the MCP auth layer (JWT bearer or service token) and
apply the same permissions and visibility as REST. Descriptions instruct clients to call
`support_ask` first and `support_get_document` for citations.

### Plugin constructor

See Architecture. Required: `aiService`, `sources` (≥ 1). Everything else optional.

## Notifications

None built in. `onEscalate` is the hook for `@terreno/comms`.

## UI

None in v1 (D16). `adminContribution()` registers `SupportQuestion` and `SupportDocument`
as read-only admin models so admins can browse questions, feedback, and indexed docs
without a custom screen.

## Knowledge-base docs convention (`support/kb`)

```md
---
title: Archive a todo
slug: archive-todo
audience: all            # optional; passed to isVisible
tags: [todos, lifecycle]
related: [restore-todo]
---

Open the todo, choose **Archive** from the overflow menu. Archived todos …
```

- One feature or task per file; H2 sections become chunk boundaries.
- `slug` is the `externalId`; renaming a slug creates a new document and marks the old
  one `stale`.
- `terreno-support check [dir]` exits non-zero on missing `title`/`slug`, duplicate slugs,
  empty bodies, or files that produce zero chunks.
- The `write-support-docs` skill tells agents: when a task adds or changes user-visible
  behavior, add or update the matching `support/kb` doc in the same slice, run
  `terreno-support check`, and mention the doc in the PR. Roast fails a user-visible
  task that lacks it.

## Phases

1. **Knowledge core** — package scaffold, types, models, chunker, `markdownDocsSource`,
   `SupportIndexer`, lexical retriever. Tracer: index `example-backend/support/kb` and
   search it in a Bun test.
2. **Answering + REST** — prompts, `SupportAgent.ask`, `SupportQuestion` logging,
   `modelRouter` actions (`ask`, `search`, `feedback`), permissions.
3. **MCP tools** — four tools through `registerMCPTool`, integration test through the
   `/mcp` transport as an authenticated user.
4. **Sources** — `modelSource` with an example-backend `BugReport` tracer, `announcementsSource`
   (blocked on PR #1284 merge), reindex action + hooks, visibility filtering.
5. **Embeddings** — `embeddingModel` option, vector + hybrid retrievers, RRF, optional
   `$vectorSearch`, example-backend Google wiring.
6. **AI authoring loop** — `terreno-support check` CLI, `write-support-docs` skill,
   `gaps` action, admin contribution, Roast criterion in repo guidance.
7. **Docs consolidation** — explanation page, reference, how-tos (including Notion),
   index links, `docs/reference/environment-variables.md`.

Each task updates its docs in the same slice; Phase 7 only reconciles.

## Feature Flags & Migrations

- No feature flag: the plugin is opt-in by registration.
- New collections only (`supportdocuments`, `supportchunks`, `supportquestions`); no
  migration of existing data. Follow `mongoose-schema-safety` for indexes (text index,
  `{sourceId, externalId}` unique, `{documentId, order}`).
- Changing `embeddingModel` re-embeds chunks whose `embeddingModelId` differs on next
  reindex; no manual migration.

## Activity Log & User Updates

`SupportQuestion` is the activity log. Admin-facing: generic admin list/read. Announce the
package in the release notes and the changelog when it ships (release skill).

## Not Included / Future Work

- `SupportChat` component in `@terreno/ui` + example-frontend screen (RTK SDK hooks for
  `ask`/`feedback`).
- Admin "knowledge gaps" screen with one-click "draft a KB doc" using `AIService`.
- MCP resources (`support://docs/{slug}`) and a `support_answer` prompt once
  [app-mcp-server.md](app-mcp-server.md) ships `registerMCPResource` / `registerMCPPrompt`;
  named mount `/mcp/support`.
- Published adapters: `@terreno/support-adapter-notion`, GitHub Issues, Linear, Zendesk.
- Indexing the Terreno docs site so hosted `@terreno/mcp` can answer with this engine.
- Streaming answers; reranker; scheduled full reindex job.
- Multi-locale documents.

## Files to Create / Modify

```
support/package.json, tsconfig.json, biome.jsonc, README.md
support/src/index.ts, supportApp.ts, routes.ts, mcpTools.ts, cli.ts
support/src/knowledge/{types,chunker,indexer}.ts
support/src/knowledge/retrievers/{lexicalRetriever,vectorRetriever,hybridRetriever}.ts
support/src/knowledge/sources/{markdownDocsSource,announcementsSource,modelSource}.ts
support/src/models/{supportDocument,supportChunk,supportQuestion}.ts
support/src/agent/{prompts,supportAgent}.ts
support/src/tests/**.test.ts, bunSetup.ts
example-backend/src/api/support.ts, example-backend/src/models/bugReport.ts, example-backend/src/server.ts
example-backend/support/kb/*.md
example-frontend/store/openApiSdk.ts (regenerated)
plugins/terreno-planning/skills/write-support-docs/SKILL.md  (+ generated Claude copy via skills:sync)
package.json (workspaces, support:compile / support:test scripts, catalog entries), knip.jsonc if needed
docs/explanation/support-agent.md, docs/reference/support.md,
docs/how-to/add-support-knowledge.md, docs/how-to/plug-in-notion-knowledge.md,
docs/how-to/expose-mcp-tools.md (support tools mention), docs/reference/environment-variables.md,
docs/{explanation,reference,how-to}/README.md, AGENTS.md / CLAUDE.md package list
```

## Task List

[`docs/tasks/support-agent.md`](https://github.com/TerrenoLabs/terreno/blob/master/docs/tasks/support-agent.md)

## Acceptance Criteria

Each criterion names its verification.

- [ ] **AC1** `bun run support:compile` and `bun run support:test` pass; `bun run lint` and
      `bun run check:knip` are clean with the new package. — build + test output.
- [ ] **AC2** Indexing `example-backend/support/kb` creates one `SupportDocument` per file
      and ≥ 1 `SupportChunk` each; a second `reindex()` reports `unchanged` for all and
      writes no new chunks. — Bun test asserting counts and `contentHash` behavior.
- [ ] **AC3** Lexical `search("archive todo")` returns the archive doc first with a non-empty
      excerpt; `search` with a `user` for whom `isVisible` returns false yields none of that
      source's chunks. — Bun test.
- [ ] **AC4** `ask()` with a mocked `LanguageModel` returns `answer`, `sources` (subset of
      retrieved documents), `confidence`, `shouldEscalate`; the system prompt sent to the
      model contains only retrieved chunk text plus the constants in `prompts.ts`. — Bun
      test inspecting the mock's received prompt.
- [ ] **AC5** `ask()` with zero retrieval results returns `shouldEscalate: true`, does not
      call the model, still writes a `SupportQuestion`, and invokes `onEscalate` once. — Bun
      test with spies.
- [ ] **AC6** `POST /support/questions/ask` returns 401 unauthenticated by default and 200
      for an authenticated user; `permissions.ask: [Permissions.IsAny]` with
      `allowAnonymous: true` makes it 200 anonymously, while `permissions.ask: []` returns
      405. `feedback` by a non-owner non-admin is 403. — supertest.
- [ ] **AC7** Over the `/mcp` transport as an authenticated user, `tools/list` includes the
      four `support_*` tools, `support_ask` returns text JSON matching `SupportAnswer`, and
      `support_get_document` for an unknown id returns `isError: true`. — MCP integration
      test following `api/src/mcp/integration.test.ts`.
- [ ] **AC8** `announcementsSource` indexes `published` announcements, skips `draft`,
      includes `archived` only with `includeArchived: true`, and re-indexes an announcement
      within one `post("save")` hook after publish. — Bun test against the
      `@terreno/announcements` model (after PR #1284 merges).
- [ ] **AC9** `modelSource` over `BugReport` (`status: "resolved"`) indexes resolutions and
      excludes open reports; `support_search("crash on login")` surfaces the resolution. —
      example-backend test.
- [ ] **AC10** With a mocked `EmbeddingModel`, chunks store `embedding` and
      `embeddingModelId`; the hybrid retriever ranks a semantically-matching chunk with no
      lexical overlap in the top 3; with no `embeddingModel` the same query still returns
      lexical results and no `embedding` is stored. — Bun tests.
- [ ] **AC11** `terreno-support check example-backend/support/kb` exits 0; a fixture with a
      duplicate slug or missing `title` exits 1 and names the file. — CLI test.
- [ ] **AC12** `GET /support/questions/gaps` groups two `low`-confidence asks of the same
      normalized question into one row with `count: 2`. — supertest.
- [ ] **AC13** Docs exist and are indexed: `docs/explanation/support-agent.md`,
      `docs/reference/support.md`, `docs/how-to/add-support-knowledge.md`,
      `docs/how-to/plug-in-notion-knowledge.md`; the Notion example typechecks against
      `KnowledgeSource`. — docs present and linked from the section READMEs, `docs-audit`
      skill reports no drift for `@terreno/support`, compile test of the how-to snippet.
- [ ] **AC14** `write-support-docs` skill is installed by `bun run skills:sync` into both
      generated plugin copies and appears in the plugin skill list. — git diff shows
      generated copies; skill file lint passes.
