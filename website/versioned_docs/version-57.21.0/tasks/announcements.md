# Task List: Product Update Announcements

**Status:** In progress — tracer bullet implemented  
**IP:** `docs/implementationPlans/announcements.md`  
**Created:** 2026-09-08

**Follow-up tasks (same PR):** [`docs/tasks/announcements-surfaces.md`](announcements-surfaces.md)

Structured task breakdown for automated implementation. Each task should be independently implementable and testable.

## Phase 1: `@terreno/announcements` package + API

- [x] **Task 1.1**: Scaffold `announcements/` workspace package
  - Description: Add `announcements/package.json` (`@terreno/announcements`), `tsconfig.json`, `biome.jsonc`, `src/index.ts`. Register in root `package.json` workspaces and add `announcements:compile` / `announcements:test` scripts.
  - Files: `announcements/package.json`, `announcements/tsconfig.json`, `announcements/src/index.ts`, root `package.json`
  - Depends on: none
  - Acceptance: `bun run announcements:compile` succeeds; package importable from workspace

- [x] **Task 1.2**: `Announcement` Mongoose model
  - Description: Schema with all fields from IP (`title`, `body`, `status`, `version`, `priority`, `requiresAcknowledgement`, `audience`, `publishAt`, `expiresAt`, `platforms`, `primaryAction`, `publishedAt`, `archivedAt`). Indexes, plugins (`createdUpdated`, `isDeleted`, `findExactlyOne`), TypeScript document interface. Pre-save hook: when `status === "published"` and `title` or `body` modified, increment `version`.
  - Files: `announcements/src/models/announcement.ts`, `announcements/src/types.ts`
  - Depends on: 1.1
  - Acceptance: Model validates enums, version bump hook covered by unit test

- [x] **Task 1.3**: `AnnouncementAcknowledgement` and `AnnouncementImpression` models
  - Description: Schemas per IP. Compound unique index on ack `(userId, announcementId, version)`. Impression index on `(announcementId, viewedAt)`.
  - Files: `announcements/src/models/announcementAcknowledgement.ts`, `announcements/src/models/announcementImpression.ts`
  - Depends on: 1.1
  - Acceptance: Models importable; indexes defined

- [x] **Task 1.4**: `AnnouncementsApp` plugin skeleton
  - Description: Class implementing `TerrenoPlugin`. Constructor accepts `AnnouncementsOptions` (`basePath`, `matchAudience`, `acknowledgementMode`, `permissions`). `register()` mounts router; `adminContribution()` registers admin models and custom editor routes.
  - Files: `announcements/src/announcementsApp.ts`
  - Depends on: 1.2, 1.3
  - Acceptance: Plugin registers with `TerrenoApp` in a smoke test

- [x] **Task 1.5**: Announcement admin CRUD via modelRouter
  - Description: `modelRouter(Announcement)` at `/announcements` with IsAdmin permissions, queryFields (`status`, `priority`, `title`), default sort `-priority,-publishedAt`. OpenAPI via `createOpenApiBuilder`.
  - Files: `announcements/src/announcementsApp.ts`
  - Depends on: 1.4
  - Acceptance: CRUD endpoints work; admin-only enforced

- [x] **Task 1.6**: `POST /announcements/:id/publish` and `POST /announcements/:id/archive`
  - Description: Custom admin routes. Publish: only from `draft` (or re-publish rules documented), set `publishedAt`, honor `publishAt` scheduling. Archive: only from `published`, set `archivedAt`.
  - Files: `announcements/src/announcementsApp.ts`
  - Depends on: 1.5
  - Acceptance: Status transitions validated; 400 on invalid transitions

- [x] **Task 1.7**: `GET /announcements/pending`
  - Description: Filter published, in schedule window, platform match (from `User-Agent` or `?platform=` query), `matchAudience` callback, acknowledgement rules per `acknowledgementMode`. Sort by priority desc, publishedAt desc. Return `{ data: { current, remainingCount } }`.
  - Files: `announcements/src/announcementsApp.ts`, `announcements/src/pending.ts` (pure filter helper for tests)
  - Depends on: 1.4
  - Acceptance: Unit tests for filter matrix; integration test with supertest

- [x] **Task 1.8**: `GET /announcements/feed`
  - Description: Paginated list of published announcements (same visibility filters as pending except acknowledgement). Support `limit` + `page` or cursor.
  - Files: `announcements/src/announcementsApp.ts`
  - Depends on: 1.7
  - Acceptance: Returns only visible announcements; pagination works

- [x] **Task 1.9**: `POST /announcements/:id/acknowledge` and `POST /announcements/:id/impression`
  - Description: Ack: create acknowledgement for current announcement version (idempotent). Impression: create impression row with optional platform in body.
  - Files: `announcements/src/announcementsApp.ts`
  - Depends on: 1.4
  - Acceptance: Duplicate ack same version returns 200 without duplicate row; impression creates row

- [x] **Task 1.10**: Acknowledgement + impression admin read routes
  - Description: modelRouter read-only list/read for admin on both models with populatePaths for `announcementId` and `userId`.
  - Files: `announcements/src/announcementsApp.ts`
  - Depends on: 1.3
  - Acceptance: Admin can list acks and impressions

- [x] **Task 1.11**: Package tests
  - Description: `announcements/src/tests/` — pending logic, version bump, publish/archive, acknowledge idempotency, matchAudience callback, acknowledgementMode matrix.
  - Files: `announcements/src/tests/*.test.ts`, `announcements/src/tests/bunSetup.ts`
  - Depends on: 1.7, 1.9
  - Acceptance: `bun run announcements:test` passes

## Phase 2: Markdown embeds (`@terreno/ui`)

- [x] **Task 2.1**: YouTube + Loom embed detection utilities
  - Description: Pure functions: `isYouTubeUrl`, `isLoomUrl`, `toYouTubeEmbedUrl`, `toLoomEmbedUrl`. Handle youtu.be, youtube.com/watch, /embed/, Loom share URLs.
  - Files: `ui/src/markdownEmbeds.ts`, `ui/src/markdownEmbeds.test.ts`
  - Depends on: none
  - Acceptance: Unit tests cover common URL shapes

- [x] **Task 2.2**: Integrate embeds into `MarkdownView`
  - Description: Custom `rules` / link renderer in `react-native-markdown-display`: matching URLs render embed component (web: iframe in Box; native: WebView with sensible aspect ratio). Non-matching links unchanged.
  - Files: `ui/src/MarkdownView.tsx`, optional `ui/src/MarkdownEmbed.tsx`
  - Depends on: 2.1
  - Acceptance: Render test or snapshot for YouTube + Loom markdown strings on web

## Phase 3: Consumer UI (`@terreno/ui` + `@terreno/rtk`)

- [x] **Task 3.1**: `useAnnouncements` hook
  - Description: RTK endpoint injection for `GET /announcements/pending` and `GET /announcements/feed`. Returns `{ pending, feed, isLoading, error, refetch }`. Pattern from `useConsentForms`.
  - Files: `ui/src/useAnnouncements.ts`
  - Depends on: Phase 1
  - Acceptance: Hook fetches and caches; tags for invalidation

- [x] **Task 3.2**: `useAcknowledgeAnnouncement` hook
  - Description: Mutations for acknowledge + impression. Invalidates pending on success.
  - Files: `ui/src/useAcknowledgeAnnouncement.ts`
  - Depends on: Phase 1
  - Acceptance: Mutation works; cache invalidated

- [x] **Task 3.3**: `AnnouncementScreen` component
  - Description: Renders single announcement: title, MarkdownView body, primaryAction Button (opens URL), acknowledge vs dismiss per ack requirement. Calls impression on mount. Props: `announcement`, `onAcknowledge`, `onDismiss`, `isSubmitting`, `requiresAcknowledgement`.
  - Files: `ui/src/AnnouncementScreen.tsx`, `ui/src/AnnouncementScreen.test.tsx`
  - Depends on: 2.2, 3.2
  - Acceptance: Ack button gated correctly; primary action navigates

- [x] **Task 3.4**: `AnnouncementNavigator` component
  - Description: Mirror `ConsentNavigator`: loading spinner, error retry, auth pass-through on 401/403, single modal from pending.current, refetch after ack/dismiss until queue empty, then render children.
  - Files: `ui/src/AnnouncementNavigator.tsx`, `ui/src/AnnouncementNavigator.test.tsx`
  - Depends on: 3.1, 3.3
  - Acceptance: Tests cover empty queue, single item, multi-item sequence

- [x] **Task 3.5**: Export from `@terreno/ui`
  - Description: Export navigator, screen, hooks from `ui/src/index.tsx` and lazy boundary if needed.
  - Files: `ui/src/index.tsx`
  - Depends on: 3.4
  - Acceptance: `import {AnnouncementNavigator} from "@terreno/ui"` works

## Phase 4: Admin UI (`@terreno/admin-frontend`)

- [x] **Task 4.1**: `AnnouncementList` component
  - Description: DataTable with title, status, priority, version, publishedAt, expiresAt. Create button → editor. Uses admin API hooks.
  - Files: `admin-frontend/src/AnnouncementList.tsx`
  - Depends on: Phase 1
  - Acceptance: Lists announcements; navigation works

- [x] **Task 4.2**: `AnnouncementEditor` component
  - Description: Full editor per IP: MarkdownEditor for body, preview pane, scheduling fields, platforms multi-select, audience JSON field, primaryAction, requiresAcknowledgement, priority. Header actions: Save, Publish, Archive. Uses `useAdminApi`.
  - Files: `admin-frontend/src/AnnouncementEditor.tsx`, `admin-frontend/src/AnnouncementEditor.test.tsx`
  - Depends on: 4.1
  - Acceptance: Create/edit/publish/archive flows work in isolation tests

- [x] **Task 4.3**: Wire adminContribution custom routes
  - Description: In `AnnouncementsApp.adminContribution()`, point list/create/edit to `AnnouncementList` / `AnnouncementEditor` (same pattern as consent custom admin screens).
  - Files: `announcements/src/announcementsApp.ts`, `admin-frontend/src/index.tsx`
  - Depends on: 4.2
  - Acceptance: Admin SPA shows custom screens for announcements model

## Phase 5: Example app + documentation

- [x] **Task 5.1**: Integrate into `example-backend`
  - Description: Register `AnnouncementsApp` with sample `matchAudience` (e.g. pass all or filter on `audience.tier`). Seed one published announcement.
  - Files: `example-backend/src/server.ts`, `example-backend/src/seed.ts` (or dedicated seed helper)
  - Depends on: Phase 1
  - Acceptance: OpenAPI includes announcement routes; seed idempotent

- [x] **Task 5.2**: Integrate into `example-frontend`
  - Description: Wrap authenticated layout with `AnnouncementNavigator`. Add optional “What’s new” screen using feed hook. Regenerate SDK (`bun run sdk`).
  - Files: `example-frontend/app/_layout.tsx`, optional `example-frontend/app/whats-new.tsx`
  - Depends on: Phase 3, 5.1
  - Acceptance: Modal appears for seeded announcement; ack clears queue

- [x] **Task 5.3**: Admin routes in example-frontend
  - Description: Expo Router admin paths for announcement list/editor if not covered by admin-spa default model routing.
  - Files: `example-frontend/app/admin/announcements/` or admin-spa equivalent
  - Depends on: Phase 4, 5.1
  - Acceptance: Admin can create and publish from example app

- [x] **Task 5.4**: Documentation
  - Description: `docs/reference/announcements.md` (API + models), `docs/how-to/product-announcements.md` (consumer wiring, matchAudience, acknowledgementMode). Update package README.
  - Files: `docs/reference/announcements.md`, `docs/how-to/product-announcements.md`, `announcements/README.md`
  - Depends on: Phases 1–4
  - Acceptance: Docs match shipped behavior; linked from relevant explanation pages if applicable

## Tracer bullet (minimum shippable slice)

For first Pick iteration, complete **Tasks 1.1–1.7, 1.9, 1.11, 3.1–3.4, 5.1–5.2** before Phase 4 admin polish if time-boxed — proves `pending → navigator → acknowledge` end-to-end.
