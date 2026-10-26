# Task List: Announcement Surfaces, Targeting, and Click Tracking

**Status:** Complete — Phase 4 verified; Taste in progress
**IP:** `docs/implementationPlans/announcements-surfaces.md`  
**Parent IP:** `docs/implementationPlans/announcements.md`  
**Created:** 2026-09-15  
**Feature profile:** false

Supporting skills for every task: `mongoose-schema-safety` (schema/model work), `terreno-backend-api`, `terreno-ui`, `terreno-data-fetching`, `update-docs`, `verify-ui-changes` (tasks that touch `@terreno/ui` / example-frontend).

## Phase 1: Backend contracts

- [x] **Task 1.1**: Acknowledgement policy + plugin default
  - Delivers: Per-announcement `acknowledgementPolicy` with consumer `defaultAcknowledgementPolicy`; `acknowledgementMode` and `requiresAcknowledgement` removed from schema/options; public DTO still exposes resolved `requiresAcknowledgement`
  - Files: `announcements/src/models/announcement.ts`, `announcements/src/types.ts`, `announcements/src/pending.ts`, `announcements/src/announcementsApp.ts`, `announcements/src/tests/*.test.ts`, `example-backend/src/server.ts`
  - Docs: `docs/reference/announcements.md` (plugin options + policy table)
  - Blocked by: none
  - Acceptance: Unit tests cover required / dismiss-only / omitted-field+default / leftover boolean `true` → required. Plugin option `acknowledgementMode` no longer compiles. `GET /pending` `current.requiresAcknowledgement` matches resolution. `bun test announcements/src/tests`

- [x] **Task 1.2**: Display mode, audience type, min build filters
  - Delivers: `displayMode`, `audienceType`, `minBuildNumber` on `Announcement`; pending is interrupt-only; feed/help honor min build + audience callback; exported `matchAudienceByType`
  - Files: `announcements/src/models/announcement.ts`, `announcements/src/types.ts`, `announcements/src/pending.ts`, `announcements/src/help.ts`, `announcements/src/announcementsApp.ts`, `announcements/src/index.ts`, `announcements/src/tests/pending.test.ts`, `announcements/src/tests/announcementsApp.test.ts`, `announcements/src/tests/help.test.ts`
  - Docs: `docs/reference/announcements.md` (fields + query `version`)
  - Blocked by: 1.1
  - Acceptance: Pending omits `displayMode: "feed"`. Feed includes feed-only. `minBuildNumber: 10` hidden when `?version=9`, visible when `?version=10` or when `version` omitted. `matchAudienceByType` matrix: all/staff/patient. Schema field `description`s present. Missing new fields on old docs default modal + all.

- [x] **Task 1.3**: CTA click events
  - Delivers: `AnnouncementClickEvent` model, `POST /announcements/:id/click`, admin list/read
  - Files: `announcements/src/models/announcementClickEvent.ts`, `announcements/src/types.ts`, `announcements/src/announcementsApp.ts`, `announcements/src/tests/announcementsApp.test.ts`
  - Docs: `docs/reference/announcements.md` (click route + model)
  - Blocked by: 1.2
  - Acceptance: Authenticated POST `{action:"primaryAction"}` inserts a row with version + optional platform. Repeat clicks insert another row. 400 on missing primaryAction or unknown action. 404 when announcement not visible. Admin GET lists events. Unique index not required.

- [x] **Task 1.4**: Admin config endpoint
  - Delivers: `GET /announcements/config` returns the plugin `defaultAcknowledgementPolicy`
  - Files: `announcements/src/announcementsApp.ts`, `announcements/src/tests/announcementsApp.test.ts`
  - Docs: `docs/reference/announcements.md`
  - Blocked by: 1.1
  - Acceptance: Admin 200 `{ data: { defaultAcknowledgementPolicy } }`. Non-admin 403. Default in response is `"dismiss-only"` when the constructor omits the option.

## Phase 2: Consumer UI

- [x] **Task 2.1**: Banner surface + version query
  - Delivers: `AnnouncementBanner`; navigator blocks only for `modal`; banner overlays children; pending/feed requests send build `version`
  - Files: `ui/src/AnnouncementBanner.tsx`, `ui/src/AnnouncementBanner.test.tsx`, `ui/src/AnnouncementNavigator.tsx`, `ui/src/AnnouncementNavigator.test.tsx`, `ui/src/useAnnouncements.ts`, `ui/src/useAnnouncements.test.ts` (if present), `ui/src/index.tsx`
  - Docs: `docs/how-to/product-announcements.md` (modal vs banner)
  - Blocked by: 1.2
  - Acceptance: Tests: empty queue renders children; modal hides children; banner keeps children and shows `AnnouncementBanner`. Query string includes `platform` and `version` when build number is a finite integer. Public type includes `displayMode`. Feed-only items never appear as `pending.current` (server contract; navigator still ignores unexpected `feed`).

- [x] **Task 2.2**: Client frequency caps
  - Delivers: Session max, cooldown, skip-first-launch applied to interrupts before show
  - Files: `ui/src/announcementFrequency.ts`, `ui/src/announcementFrequency.test.ts`, `ui/src/AnnouncementNavigator.tsx`, `ui/src/AnnouncementNavigator.test.tsx`
  - Docs: `docs/how-to/product-announcements.md` (frequency props)
  - Blocked by: 2.1
  - Acceptance: With `maxInterruptionsPerSession: 1`, second pending item this session is not shown until remount of a new session helper. `skipFirstLaunch: true` skips on first launch then stores launched flag. `cooldownHours` skips when last interrupt is inside the window. Defaults: max 1 / session, cooldown off, skipFirstLaunch false. Caps do not filter `useAnnouncements` feed.

- [x] **Task 2.3**: Primary-action click tracking
  - Delivers: Modal and banner primary buttons call `POST /announcements/:id/click` then open the URL
  - Files: `ui/src/useAcknowledgeAnnouncement.ts`, `ui/src/AnnouncementScreen.tsx`, `ui/src/AnnouncementScreen.test.tsx`, `ui/src/AnnouncementBanner.tsx`, `ui/src/AnnouncementBanner.test.tsx`
  - Docs: `docs/reference/announcements.md` (consumer hook)
  - Blocked by: 1.3, 2.1
  - Acceptance: Click mutation fires once per press. URL still opens if click POST fails (warn log, do not block navigation). No click POST when `primaryAction` is absent.

## Phase 3: Admin, example, docs

- [x] **Task 3.1**: Admin editor structured targeting
  - Delivers: Selects for displayMode, audienceType, acknowledgementPolicy (from config), number field for minBuildNumber; list columns; audience JSON remains advanced
  - Files: `admin-frontend/src/AnnouncementEditor.tsx`, `admin-frontend/src/AnnouncementEditor.test.tsx`, `admin-frontend/src/AnnouncementList.tsx`
  - Docs: `docs/how-to/product-announcements.md` (admin fields)
  - Blocked by: 1.2, 1.4
  - Acceptance: Create form pre-fills policy from config. Save persists new fields (no `requiresAcknowledgement`). Tests cover create payload shape and edit omitting status (existing editor rule).

- [x] **Task 3.2**: Example app + architecture docs
  - Delivers: Example backend `defaultAcknowledgementPolicy` + `matchAudienceByType` using `user.admin`; seeds one staff modal (required) and one patient banner (dismiss-only); example-frontend navigator frequency documented; parent IP pointer accurate
  - Files: `example-backend/src/server.ts`, `example-backend/src/scripts/seed-announcements.ts` (and any seed caller), `example-frontend` layout using `AnnouncementNavigator`, `docs/reference/announcements.md`, `docs/how-to/product-announcements.md`, `docs/implementationPlans/announcements.md`, `announcements/README.md`
  - Docs: listed files — Diátaxis in place, one minimal wiring example
  - Blocked by: 2.2, 2.3, 3.1
  - Acceptance: Seed idempotent. Docs tables match shipped options (no `acknowledgementMode`). How-to shows Flourish-style staff vs patient. `bun run website:build` if docs pages changed. Frontend verification: log in to example app, confirm modal vs banner per seed, capture artifacts under `/opt/cursor/artifacts/`.

## Phase 4: Admin launch overview

- [x] **Task 4.1**: Overview API
  - Delivers: Admin-only `GET /announcements/overview?page=&limit=` with aggregate per-row metrics (impressions, acknowledgements, clicks across all event versions), status/total summaries, deterministic pagination, OpenAPI response schema, integration tests (metrics, totals, pagination, empty state, 401/403)
  - Files: `announcements/src/overview.ts`, `announcements/src/types.ts`, `announcements/src/announcementsApp.ts`, `announcements/src/index.ts`, `announcements/src/tests/overview.test.ts`
  - Docs: `docs/reference/announcements.md` (overview route + response shape)
  - Blocked by: Phase 3
  - Acceptance: Admin 200 with exact row metrics and totals; non-admin 403; unauth 401; deleted docs excluded; default limit 20 cap 100; `bun test announcements/src/tests/overview.test.ts`

- [x] **Task 4.2**: Admin overview UI
  - Delivers: `@terreno/admin-frontend` overview screen with summary cards and metrics table backed by generated SDK hook for `/announcements/overview`
  - Files: `admin-frontend/src/AnnouncementOverview.tsx`, tests, `admin-frontend/src/index.tsx`
  - Docs: `docs/how-to/product-announcements.md` (admin overview)
  - Blocked by: 4.1
  - Acceptance: Admin can open overview, see totals cards and paginated rows with metrics; frontend verification artifacts captured

- [x] **Task 4.3**: Nav and media wiring
  - Delivers: Grouped Announcements nav with overview + audit models; example-frontend admin route; launch seed with markdown, YouTube, screenshots, and tracked CTA
  - Files: `announcements/src/announcementsApp.ts` (`adminContribution`), `admin-frontend/src/AdminShell.tsx`, `example-frontend/app/admin/announcements/`, `example-backend/src/scripts/seed-announcements.ts`, `website/static/img/announcements/`
  - Docs: `docs/how-to/product-announcements.md`
  - Blocked by: 4.2
  - Acceptance: Overview reachable from the Announcements sidebar group in the example app; related audit pages share that group; seeded staff modal renders markdown with YouTube and screenshot media
