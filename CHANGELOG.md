# Changelog

All notable changes to this project are documented in this file.

All `@terreno/*` packages (`api`, `test`, `ui`, `rtk`, `admin-backend`,
`admin-frontend`, `admin-spa`, `ai`, `announcements`, `api-health`, `comms`,
`feature-flags`, `jobs`, `mcp`, `syncdb`) and the unscoped `create-terreno-app` CLI are versioned in lockstep
and published at the same version.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Unreleased changes live in [`changelog/unreleased/`](changelog/unreleased/) as one
file per feature. `bun run changelog:assemble <version>` folds those files into a
dated section below when cutting a release.

Upgrade notes for consumer action live in [`mcp-server/src/docs/upgrades/`](mcp-server/src/docs/upgrades/). Fetch a range with the MCP tool `terreno_get_upgrade_guide`. Format: [`mcp-server/src/docs/upgrades/README.md`](mcp-server/src/docs/upgrades/README.md). The [`58.0.0` stub](mcp-server/src/docs/upgrades/58.0.0.md) is for the next major (not yet a changelog section).

## [Unreleased]

Unreleased changes live in [`changelog/unreleased/`](changelog/unreleased/). Add one Markdown file per feature (see that directory's README) instead of editing this section.

## [57.10.1] - 2026-10-04

Upgrade note: [`mcp-server/src/docs/upgrades/57.10.1.md`](mcp-server/src/docs/upgrades/57.10.1.md).

### Breaking

- Security: `GET /files/*gcsKey` (`addFileRoutes`, `AiApp` with `gcsBucket`) now requires authentication and returns a signed URL only for the caller's own upload. Before, anyone could get a signed URL for any stored key, and keys are guessable (`uploads/<userId>/<ms>-<name>`). Another user's file, including for an admin, returns 404 like a missing file, so keys cannot be probed. Send the user's session token with the request; an unauthenticated request now returns 401.

### Added

- Agent UI Asks: the chat agent can pause a turn and ask the user a typed question, then continue with the exact answer. Turn it on with `asks: true` (or `{kinds, approvals, maxFileSizeBytes}`) on `AiApp` or `addGptRoutes`. Asks are off by default: with `asks` unset, tools, the system prompt, SSE events, and endpoints are unchanged. See `docs/how-to/agent-ui-asks.md`, `docs/reference/agent-ui-asks.md`, and `docs/explanation/agent-ui-asks.md`.
- New package `@terreno/blocks`: the shared Zod contracts for asks (input and answer schemas, `validateAskInput`, `validateAskResponse`, stable error codes, `ASK_LIMITS`), simple cards (`toSimpleCard`, `resolveButtonAnswer`), the compact surface, the headless endpoint bodies, and JSON Schema documents plus fixtures (`@terreno/blocks/schemas/*`, `@terreno/blocks/fixtures/*`) for native clients such as a Swift watch app.
- Five ask kinds, each a client-side `ask_<kind>` tool: `choice` (select one, or select many with an optional Other text answer), `confirm`, `markdown` (edit a draft), `form` (a few typed fields, one submit), and `files` (upload images or documents the model reads in the same turn, as data URLs or `fileId`s from `POST /files/upload`).
- Server-enforced approval: with asks on, a host tool marked `needsApproval: true` runs only after the user approves a server-made `confirm` ask. `asks.approvals` sets that ask's text per tool name. With asks off, such a tool never runs.
- `/gpt/prompt` accepts `askResponse` and `surface: "full" | "compact"`, and streams `{ask}` and `{askResolved}` events plus `pendingAsk` on `{done}`. `GptHistory` stores the pending ask. With `chat` options that turn asks on, `addGptHistoryRoutes` (and `AiApp`) adds `GET /gpt/histories/pendingAsks` and `POST /gpt/histories/:id/turn`, which run a turn to completion and return JSON for clients that do not read server-sent events.
- `@terreno/ui`: `GPTChat` shows asks as an `AskCard` in the transcript (`GPTChatMessage.ask`, `onAskSubmit`, `askErrors`, `resolveAskFiles`). New `AskCard` and `SimpleAskCard` components. `Button` has a new `wrapText` prop that wraps a long label onto centered lines instead of overflowing its container.
- The example app's AI screen answers asks end to end, and the example backend runs a scripted keyless demo agent (`terreno-demo-agent`) when no model is configured, so asks can be tried without an API key.
- Agent UI blocks: a chat reply can be one YAML document of headings, metrics, charts, tables, and actions. Turn it on with `uiBlocks` on `addGptRoutes`. The model is told its whole reply is that document. After the text, the route checks it and sends `{blocks}` before `{done}`. `repair: true` runs one repair call. See `docs/how-to/agent-ui-blocks.md`, `docs/reference/blocks.md`, and `docs/explanation/agent-ui-blocks.md`.
- `@terreno/blocks` adds `parseBlocks`, `validateBlocks`, `blocksJsonSchema`, and `terreno-blocks validate`. Charts and tables read inline rows or a `ref` dataset. `AIService.generateBlocks` returns one validated document at temperature 0.
- `@terreno/ai` stores chart rows on `AIDataset` via `registerAiDataset`. `GET /gpt/datasets/:id` is owner-only and can bucket, downsample, or paginate them. `POST /gpt/actions` runs a named host callback after an owner check and a payload check.
- `@terreno/ui` `BlocksView` paints a document. `GPTChat` `uiBlocks` renders assistant messages through that view, including a spinner while the reply is still streaming.
- The example backend registers `exportDataset` and a `todoStats` tool that stores open and completed todo counts. The example AI tab loads `ref` charts and posts callbacks.
- `html` blocks are opt-in (`uiBlocks.html` on the server, `allowHtml` on `GPTChat` or `BlocksView`). The server strips scripts, event handlers, forms, frames, and links, then stores the cleaned document. The client draws it in a sandboxed frame only after the reply finishes.
- `callout`, `image`, and `details` render as a banner, an image, and an accordion. An `https` image loads only when its host is in `uiBlocks.imageHosts`.
- A reply that omits an actions block `id` gets one before it is stored. A block document written in the same step as a tool call is kept when the turn would otherwise have no text. The chat receives the document after that fill, repair, and HTML sanitizing, so an invalid draft is not shown. `{replace: "text"}` is sent only when text was already streamed and then changed. A validation banner names the field path once the reply has finished.
- Example-backend registers `accessControl: access` on `ObservabilityApp` and seeds optional `aiObservabilityViewer` and `aiObservabilityOperator` RBAC roles that demonstrate read-only and full observability access without auto-assigning them to users.
- `@terreno/ai` ships local prompt versions, nested traces, evaluators, datasets, experiments, and a review queue through `ObservabilityApp`, with the admin screens in `@terreno/admin-frontend`. Prompts, datasets, and experiments have one writer. Traces and scores fan out to every registered sink (local Mongo, Langfuse, or OTLP). Six RBAC resources cover read-only, reviewer, and operator access. See `docs/how-to/observe-llm-calls.md`.
- `@terreno/ai/harness` runs phased tasks on Mongo that survive a process crash. Each checkpoint and its trace span commit in one transaction. Tasks can wait for a person, retry, abort from the bottom up, and stay pinned to the definition version they started with. `defineTask`, `defineAgent`, and `defineTool` describe the work; approvals have their own permissions and an admin inbox. See `docs/how-to/build-a-durable-workflow.md`.

### Fixed

- `GET` and `DELETE /files/*gcsKey` find uploads by their full key. Express 5 passes the wildcard as path segments, so a key with slashes, such as the `uploads/<userId>/<ms>-<name>` key every upload gets, returned 404.

## [57.9.0] - 2026-10-03

Upgrade note: [`mcp-server/src/docs/upgrades/57.9.0.md`](mcp-server/src/docs/upgrades/57.9.0.md).

### Added

- `@terreno/ui` can compose operations dashboards with scorecards, comparison sparklines, multi-series line and area charts, donut center labels, previous-period bar overlays, chart-card headers, and spanning dashboard items.
- File uploads can be turned off with the `file-uploads` feature flag. `POST /files/upload`, document storage uploads, and chat attachments return 403 when the flag is off. The example app hides the upload controls. A missing flag leaves uploads enabled.
- `/gpt/prompt` rejects client-only attachment URLs (`blob:`, `file:`, `content:`, `ph:`) with `400` before streaming. With `fileStorageService` configured, `data:` attachments are uploaded and history stores the storage `url` plus `gcsKey`; later turns send the model signed URLs.
- `/gpt/prompt` saves the turn before streaming, sends a first `{historyId, started: true, streamId}` event, and persists partial reply text about every second with `status: "streaming"`. The finished reply is saved with `status: "complete"`; a failed one keeps its partial text with `status: "error"`.
- New `GET /gpt/histories/:id/stream` re-attaches to an in-flight reply after a reload or remount (`offset` skips text the client already shows). The example app reopens the last chat after a reload and resumes its live reply.
- `store-assets` agent skill for Expo apps. It keeps a simulator/emulator dev client in sync with the native fingerprint (downloading a matching EAS build or starting one), captures App Store and Google Play screenshots on store-sized devices with Maestro flows that log in through the `@terreno/ui` LoginScreen, and renders the Play feature graphic and 512×512 icon from a repo's `storeAssets.config.json`. Install with `npx skills add TerrenoLabs/terreno --skill store-assets` or from the `terreno` Claude plugin.

### Changed

- `GPTChat` history rows move rename and delete into a three-dot overflow menu. Rename uses an outlined pencil in the dark secondary color; titles truncate before the menu trigger at any sidebar width.
- `GPTChat` shows "Scroll to bottom" only when content sits below the viewport, never in an empty chat.
- The `GPTChat` composer grows with long text up to 200px, then scrolls. `TextField` / `TextArea` accept `maxHeight` to cap `grow`.
- Generated images in `GPTChat` offer copy-image and (web) download. Copying an image-only reply copies the image instead of text.
- `FilePickerButton` opens an anchored dropdown instead of a modal. On web, **Document** now opens the file picker, and both options return `data:` URLs instead of `blob:` URLs.

### Fixed

- Web toasts now render above open modals and remain correctly centered in statically exported apps instead of inheriting a zero-width server-rendered viewport.

## [57.8.0] - 2026-10-02

Upgrade note: [`mcp-server/src/docs/upgrades/57.8.0.md`](mcp-server/src/docs/upgrades/57.8.0.md).

### Added

- `@terreno/announcements` imports a versioned release pack (`pack.yaml` plus one Markdown file per announcement) through idempotent `POST /announcements/import-release`. Imports default to drafts; pass `publish: true` to publish on import. Re-importing the same product, release version, channel, and slug updates the existing row, and a matching soft-deleted row is restored. Admin auth or `ANNOUNCEMENTS_UPLOAD_TOKEN` can call the route. Request bodies for the import and for impression and click events are strict Zod schemas.
- `SplitPage` accepts opt-in web layout props. `desktopChildrenMinWidth` keeps one or two desktop children at least that many pixels wide and scrolls horizontally when the row is tighter. `narrowViewportChildLabels`, `narrowViewportSelectionActive`, `narrowViewportSelectionKey`, and `narrowViewportListButtonLabel` replace the dotted narrow swiper with a labeled pager. `narrowBelowWidth` uses the narrow layout at or below that pixel width; omit it to keep `isNarrowViewport()`. Native `SplitPage` ignores these props. `IconButton` accepts `backgroundOpacity` to tint only the button background.

### Changed

- CircleCI `publish-release` compiles every lockstep package once and publishes them in parallel instead of recompiling and retesting each package in turn. Tagged commits already passed CI on master. Releases drop from 25+ minutes to about 4.
- `deploy-demo` runs alongside `publish-release` instead of after it.
- `scripts/ci/netlify-deploy.sh` passes `--no-build`, so Netlify deploys no longer rerun the root `netlify.toml` docs build (about 3.5 minutes per demo and frontend deploy).

### Deprecated

- `isMobileDevice` is deprecated. Call `isNarrowViewport` instead. The old function stays exported and returns the same result until it is removed.

### Fixed

- `DropdownPanel` now anchors to its trigger rather than to the row around it. The measured wrapper stretched to fill its container, so the panel opened at the start of that row — visible whenever the trigger is not at the start edge, such as a right-aligned button or a right-to-left layout, where the panel appeared on the opposite side of the screen.
- `/gpt/prompt` sends each generated image once. Image-output models no longer duplicate the SSE `image` event and saved content part, and image-only responses save empty text instead of the `(image)` placeholder. `GptHistory` prompt `text` is now required only when the prompt has no `content` parts.

## [57.7.0] - 2026-09-28

Upgrade note: [`mcp-server/src/docs/upgrades/57.7.0.md`](mcp-server/src/docs/upgrades/57.7.0.md).

### Changed

- CircleCI is now the only continuous deployer for the Netlify demo, example frontend, and docs sites and for GCP terraform, Cloud Run backend/tasks, and MCP. The GitHub Actions deploy workflows are disabled for rollback only, and CircleCI deploy jobs fail instead of skipping when `terreno-netlify` or `terreno-gcp` is missing a value. CircleCI deploys record GitHub Deployments (same environment names as before, plus `docs` and `mcp-production`) when the `terreno-github-deployments` context holds `GITHUB_DEPLOYMENTS_TOKEN`.
- `@terreno/ui`'s `Filter` is now `DropdownPanel`, reflecting that it is a general compositional dropdown (trigger + anchored panel + optional Apply/Clear/Cancel footer), not a filter-only control. `Filter` and `FilterProps` stay exported as deprecated aliases until Terreno 58; the `FilterSelectMenu` / `FilterBoolean` / `FilterAccordion` / `FilterChangesBadge` controls keep their names.
- `DropdownPanel` no longer runs off screen. The panel right-aligns to its trigger when a left-aligned panel would cross the right viewport edge, clamps to an 8px screen margin, flips above the trigger when there is no usable room below, and scrolls its body (footer pinned) when the content is taller than the space available. `align` and `maxPanelHeight` override the automatic behavior, and `computeDropdownPanelLayout` is exported for callers that position their own panels.
- `DropdownPanel` renders through the `TerrenoProvider` portal host on native, so the panel is no longer clipped inside scroll views or cards. Without a host it falls back to the previous inline overlay.
- `DropdownPanel` triggers are now styleable: `triggerVariant` (any `Button` variant), `applyButtonVariant`, `triggerSize` on labeled triggers, `fullWidth`, and `renderTrigger` for a fully custom trigger.
- `bun run prepush` now runs the local mirror of every CI job the branch triggers, using the CircleCI path-filter mapping. That covers package `test:coverage` plus the new-file LCOV gate, `ui` types, example-backend and example-frontend tests, every `repo-policies` step, rulesync drift, and the typedoc API reference. It runs every step even after a failure and prints a summary. Use `--dry-run` to see the plan and `--all` to run everything.
- New `bun run check:test-isolation` blocks new `mock.module` calls in shared Bun test suites (see `docs/explanation/test-isolation.md`).
- The lifecycle plugin now makes one commit per task after Roast `PASS` with no bookkeeping commits, keeps pushes out of Pick and Roast, has Pick list edge cases before coding, has Roast run the CI-equivalent package gate, and has Taste merge `master` only when the PR conflicts, a failure traces to base drift, or the branch is merge-ready.
- Taste invoked directly by a human now repeats bounded reactions (at most 3 fix pushes and 3 hours of waiting) until `PASS`, `BLOCKED`, or `FAIL` instead of returning `PENDING`, and a directly invoked Brew starts Taste as its next stage.

## [57.6.1] - 2026-09-25

### Fixed

- `modelRouter` array subroutes now return a structured `400` error when the requested field is not an array, after preserving consumer update authorization hooks, instead of throwing an iterable `TypeError`.

## [57.6.0] - 2026-09-24

Upgrade note: [`mcp-server/src/docs/upgrades/57.6.0.md`](mcp-server/src/docs/upgrades/57.6.0.md).

### Added

- `sendToSlack` accepts `mentionUserIds` (Slack member IDs) so incoming webhooks can @-mention people. Names and emails in the message text do not notify anyone. New helpers: `formatSlackUserMention`, `normalizeSlackUserId`, and `lookupSlackUserIdByEmail` (optional `SLACK_BOT_TOKEN` with `users:read.email` to resolve an id from email and store it on the staff/user record).
- Add full SyncDB support to `terreno-mcp-local`: inspect debugger and local-store
  state, capture/compare/merge snapshots, mutate or directly edit local entities,
  flush the outbox, reconcile/resync, resolve conflicts, retry failures, and
  exercise offline transitions. State-changing operations require
  `TERRENO_MCP_EVAL=1`; returned state redacts sensitive fields.
- Add `@terreno/cli` (`terreno`) for docs search, codegen (syncdb, RTK SDK, models, routes, screens, forms, admin), bootstrap, unified backend/browser/Metro/app logs, Redux/RTK state inspection, opt-in CDP evaluation/navigation, Bun 1.4 WebView automation and screenshot proof, read-only database tools, OpenAPI `api list|call|request`, and `generate rest-cli` to scaffold an app CLI from a backend spec.

### Changed

- Terreno moved to the `TerrenoLabs` GitHub organization. The repository is now `TerrenoLabs/terreno`, the roadmap board is `github.com/orgs/TerrenoLabs/projects/1`, and package `repository` URLs, docs links, and plugin/skill install commands (`/plugin marketplace add TerrenoLabs/terreno`, `npx skills add TerrenoLabs/terreno`) point at the new location. Old `FlourishHealth/terreno` URLs redirect.
- Every tsconfig builds on TypeScript 6 without `ignoreDeprecations`. Node packages (`@terreno/api`, `ai`, `admin-backend`, `announcements`, `api-health`, `comms`, `feature-flags`, `jobs`, `test`, and the `admin-spa` server plugin) now compile with `module: nodenext` to ES2023 CommonJS instead of ES5. Their dynamic `import()` stays a real ESM import, so `loadMigrations` can load migration files by `file://` URL from compiled `dist/`. Frontend libraries (`ui`, `admin-frontend`, `rtk`, `syncdb`) emit ES2022 with bundler resolution and ship declaration maps. `@terreno/test` no longer publishes its compiled Bun tests. `create-terreno-app` scaffolds drop `ignoreDeprecations` and `moduleResolution: node`, and the generated backend moves to TypeScript 6. See `docs/explanation/typescript-configuration.md`.

### Fixed

- Framework Mongoose models added in 57.3 and 57.4 now use `Terreno*` model names
  without changing their MongoDB collections, preventing collisions with consumer
  models such as `Notification`, `Membership`, and `Job`. Admin UI keys and
  `admin<ModelName>` RBAC resources keep the pre-namespace names. JWT recovery
  routes can be disabled with `authOptions.passwordReset`, `emailVerification`,
  and `legacyResetPasswordRoute`.

## [57.4.0] - 2026-09-22

Upgrade note: [`mcp-server/src/docs/upgrades/57.4.0.md`](mcp-server/src/docs/upgrades/57.4.0.md).

### Added

- CircleCI Playwright now shards `admin-home`, `admin-form`, `admin-table-search-filter`, `admin-table-bulk-actions`, `admin-custom-screens`, and `admin-comms-back` alongside `admin`.
- CircleCI now runs `admin-backend-ci` and `admin-frontend-ci` (lint, compile, 95% coverage) when those packages change. Use `bun run admin-frontend:test` and `bun run admin-backend:test` from the repo root.
- `@terreno/admin-frontend` now ships `adminRequest`, a native `fetch` helper (timeout, JSON/`FormData`, credentials) for admin RPC that is leaving RTK `injectEndpoints`.
- Example admin Todos now allow admin delete, and Playwright covers Todo create → edit → delete on embedded `/admin` and SPA `/console`.
- Built-in admin String-`_id` model CRUD can now run windowed local-first through
  `@terreno/syncdb`: REST supplies membership, TinyBase supplies live rows,
  create/update/delete use the durable outbox, bulk patch stays server-side, and
  `ConflictSheet` resolves admin-loaded records. The embedded example and
  standalone admin SPA demonstrate Bearer and same-origin cookie hosts.
- `GET /admin/config` model meta includes `adminBroadcast` (always) and `syncCollection` when the app sync registry has `adminBroadcast: true`. `AdminProvider` accepts optional `syncDb`. `AdminModelTable` then uses REST membership + a live TinyBase overlay with a visible Refresh control; hosts that pass only `api` keep the RTK list. Refresh treats RTK `refetch` error envelopes as failures, drops in-flight Refresh when list params change, and toasts rejected `hydrateWindow` calls. Fetch-RPC mutations invalidate mounted comms, scripts, and configuration queries just like their RTK counterparts.
- `BetterAuthConfig.disableRateLimit` turns off Better Auth's built-in limiter on a throwaway in-process seed instance. Preview container seeds that create several users no longer 429 on the fourth signup when `NODE_ENV=production`.
- `@terreno/ui` now ships owned-SVG `LineChart`, `BarChart`, `AreaChart`, and `DonutChart`
  plus an eager `DashboardGrid` for wrapping caller `Card`s. Charts use `react-native-svg`
  and private d3 helpers — not `victory-native`. Each chart sizes itself to its container
  and clips to it, so a chart never widens the card it sits in, and `height` covers the whole
  chart including its tick and tooltip rows. `bun run ui:charts:compare` diffs actually
  rendered gallery PNGs against `demo/rendered-snapshots/` (not JSON snapshots).
  Conditional `DashboardGrid` children no longer reserve blank cells, and an open chart
  tooltip now updates or closes when live data changes.
- `create-terreno-app` — unscoped npm CLI (`bunx create-terreno-app` /
  `npm create terreno-app`) that scaffolds a deployable full-stack Terreno app.
  Published in lockstep with `@terreno/*`; generated scaffolds pin
  `^<create-terreno-app version>` on Terreno dependencies.
- **@terreno/ui `DataTable`**: optional server-side search and column filters emit
  modelRouter-shaped query params via `onQueryChange` and `buildDataTableListQuery`
  (web per-column `Filter` popovers; native Filters sheet).
- **@terreno/admin-frontend `AdminModelTable`**: adopts DataTable filter/search UI;
  list search still uses `q`; choice filters support multi-value `$in`. Admin list
  URLs use `qs` bracket serialization so nested filters work with any RTK base query.
- **@terreno/admin-backend**: `parseAdminListFilters` accepts choice `{$in: string[]}`
  and escaped-literal text `{$regex, $options: "i"}` while rejecting extra operators.
  Optional choice filters auto-enable an **Empty** option (`__empty__` wire sentinel → Mongo
  `null`) when the Mongoose field is not required; explicit `allowEmpty` overrides.
  Empty and Empty-plus-value filters remain normalized when combined with toolbar search.
- **@terreno/api**: OpenAPI query validation accepts choice scalars, `{$in: [...]}`, and
  the empty sentinel alongside enum values. Nested query operators reject extra keys and
  executable regex patterns; `queryFilter` can remove consumed wire keys with `undefined`.
- **@terreno/ui `buildDataTableListQuery`**: single concrete choice values emit scalar
  equality (validator-friendly); empty-only and empty+concrete use `$in` with `__empty__`.
- **@terreno/ui `Filter`**: new `iconOnly` and `triggerSize` props render a compact
  icon trigger for dense chrome; DataTable column headers use it.
- **@terreno/ui `DataTable`**: single-column filter popovers no longer duplicate the
  popover's own Clear with a per-field **Clear filter**; the boolean per-field clear
  now appears only where one surface hosts several filters.
- **@terreno/ui `DataTable`**: date range filters use date inputs, so entering a
  calendar date filters immediately and either bound works on its own. Previously the
  datetime input emitted nothing until an hour and minute were also entered. The **to**
  bound now closes the chosen UTC day instead of landing on midnight, so rows recorded
  later that day stay in range.
- Opt-in append-only `AuditEvent` log. Register `AuditApp` and set `audit: true` (or
  `{redact: ["ssn"]}`) on `modelRouter` so successful HTTP CRUD and array mutations
  persist redacted changed-field diffs. Default redaction includes compound keys such as
  `tokenHash`. AdminApp writes the same collection when the plugin is registered and omits
  each model's `hiddenFields` / `excludeFields`; RBAC uses
  `persistRbacAuditToAuditEvent`. List/read is admin-only at `GET /audit-events` and
  `/admin/audit-events`; create/update/delete over HTTP return 405. Persist is
  fire-and-forget; a non-24-hex `actorId` (including 12-character strings mongoose would
  accept) is dropped from the event instead of dropping the event. Update/delete snapshots
  run only when `audit` is on, and a throwing `toJSON` does not fail the mutation. Set `GCP_TASKS_AUDIT_QUEUE` and `AUDIT_TASKS_URL` to enqueue Cloud Tasks
  instead of writing Mongo on the request. Default retention is forever; `retentionDays`
  adds a Mongo TTL index on `created`. See `docs/how-to/audit-log.md`.
- # GCP durable-jobs worker infrastructure

  Infra Manager now owns the example Cloud Tasks queue `terreno-example-jobs-v2`, the
  private `terreno-backend-example-tasks` Cloud Run service, the
  `terreno-backend-runtime` API identity (sole queue enqueuer / jobs-invoker
  `actAs`), and the `terreno-jobs-invoker` OIDC callback identity. CD deploys
  matching PR tags for the API and tasks services. The example API still uses
  `MongoJobRunner` until a follow-up selects `JOBS_RUNNER=gcp-cloud-tasks`. The
  example image compiles `@terreno/jobs` before `@terreno/admin-backend`.
- `GPTChat` accepts an optional `mascot` React node from the consumer. Terreno does not
  ship a default character. The node renders on an empty chat and hides once messages
  exist. The empty state (mascot plus suggested prompts) stays centered in the chat
  panel inside a scrollable message area, and the composer row centers the
  attachment, tools, and Send controls vertically against the input. The example
  consumer bundles four plant-robot mascots and chooses one on each AI screen mount.
- Unattended agents can claim one unstarted GitHub issue labeled
  `status:ready-for-dev`, Pick ⇄ Roast a posted plan, and Brew a draft PR via the
  `implement-ready-for-dev` skill. Pickup skips open linked PRs via GraphQL (not
  `linked:<number>`) and aborts if an untrusted author edits the issue body after
  the label. Dashboard paste lives in that skill's `references/cursor-automation.md`.
  Interactive `/work-github-issues` still requires chat confirmation.
- `@terreno/jobs` adds durable background work for Terreno backends: MongoDB-persisted jobs
  with retries, dead-lettering, cron schedules (IANA timezones), admin list/detail/retry/requeue/cancel,
  and pluggable runners (`MongoJobRunner`, GCP Cloud Tasks, Vercel Queues, custom). Workers start
  only via explicit `startWorker()` — register `JobsApp` on `TerrenoApp`, define handlers, enqueue
  with `getJobsService()`, and choose in-process or standalone worker processes. Admin UI widgets
  ship in `@terreno/admin-frontend`. See `docs/how-to/background-jobs.md` and
  `docs/reference/jobs.md`.
- MongoDB migrations tooling: `terreno-migrate` (`check` / `generate` / `status` / `up` / `down`), `TerrenoApp` `migrations.runOnStart`, admin **Migrations** page, and `example-backend/migrations/`. Admin HTTP is `modelRouter` collection actions `GET /admin/migrations/status` and `POST /admin/migrations/run` (`{data: ...}`), documented in `/openapi.json` under the `adminMigrations` tag. Production wet apply requires `ALLOW_MIGRATIONS=true`. History lives in `terreno_migrations` and is not wiped by seed `--reset`.
- The in-app notification center adds `NotificationsApp` in `@terreno/api` with
  owner-scoped `Notification` and `NotificationPreference`
    models, `getNotificationService().notify()`, `notificationsBeforeSend`, mark-all-read, and
    optional `retainDays` tombstone sweep. `@terreno/ui` provides presentational
  `NotificationBell`, `NotificationInbox`, and `NotificationPreferences` components.
  The example app demonstrates syncdb collections, a todos-header bell that toggles a
  right-side drawer, a full active and archived history page, notification preferences,
  seeded notification examples, todo activity notifications, and a development notify
  route. Inbox list, mark-read, and dismiss (archive via `archivedAt`) use syncdb only;
  `POST /notifications/dev-notify` remains the development send path. `terreno-syncdb-codegen` now accepts hyphenated collection names such as
  `notification-preferences`. Consumers can replace the bell icon and unread bubble with
  `NotificationBell` render props while retaining its layout and accessibility behavior.
- Optional organization management: `OrgsApp` adds `Organization` / `Membership`, org context, isolation filters, and membership-scoped `org-admin` plus operator RBAC. Existing single-tenant apps stay unchanged. Admin hosts get an operator directory, org switcher, settings, and members screens. Newly bootstrapped apps enable an org by default.
- `terreno-pick-roast-loop` drives an approved plan through all actionable Pick/Roast
  cycles without stopping on ordinary engineering failures. It accumulates task, attempt,
  verification, artifact, docs, and risk evidence into one final report. When a genuine
  human decision is required, it first explains the overall plan state, completed work,
  decisive evidence, options and impact, and its recommendation, then asks one exact
  question. The loop excludes Grow, Brew, Taste, and product-CI monitoring. Cursor,
  Codex, Claude Code, and `npx skills` expose the loop.
- `@terreno/announcements` ships `AnnouncementsApp` for admin-managed modal, banner, and feed product updates. Targeting covers staff, patients, and all users, plus custom `audience` segments. Acknowledgements, impressions, frequency caps, minimum-build gates, and CTA click tracking are first-class. Admin screens include a guided overview with aggregate and per-row analytics. Frontend surfaces are `AnnouncementNavigator`, `AnnouncementBanner`, and `AnnouncementScreen` in `@terreno/ui`. See `docs/how-to/product-announcements.md`.
- CircleCI `publish-release` and the GitHub `publish-on-tag.yml` fallback now publish `@terreno/announcements` in lockstep with the other `@terreno/*` packages.
- `SyncConfig.adminBroadcast` (default `false`) is stored on collection registration. When `true`, change-stream `sync:delta` emission also targets `{collection}|admin`. Admin clients join that stream with `sync:subscribe {mode: "window"}` (`createSyncDb({windowCollections})`) and skip `GET /sync/snapshot` paging for those collections. Window subscribe requires admin panel and model-list access. `hydrateWindow` renders REST rows immediately, then refreshes canonical seq/deleted metadata for every requested id through `GET /sync/entities` (unknown ids ignored). AdminApp list/read permissions and `queryFilter` apply to hydrate and live deltas. `{collection}|admin` deltas apply only to ids already in the local window; Refresh is REST + `hydrateWindow`.
- Admin-window sync writes use an explicit `mutationMode: "adminWindow"` marker on `POST /sync/mutate`, `POST /sync/mutate/batch`, `sync:mutate`, and `sync:mutateBatch`. `createSyncDb({windowCollections})` tags matching outbox rows automatically. The server validates the marker together with `adminBroadcast`, admin-window access, and a registered AdminApp write scope, then runs the shared sync executor with AdminApp pre/post hooks (not product `modelRouter` hooks), applying the same permission, stripping, User admin-flag/role gates, and audit semantics as REST. Product clients without the marker keep existing product sync permissions and hooks.
- `@terreno/syncdb` exports `bridgeBetterAuthReactClient`, which adapts a Better Auth
  **react** client to the session-subscription surface `betterAuthAdapter` watches. Without
  it the adapter cannot see the client's nanostore session atom and falls back to polling
  `getSession()`. The example app and the admin SPA both use it.
- `TextField` with `type="password"` now renders a show/hide eye control so users can check what
  they typed. The value starts masked, a disabled field cannot be revealed, and
  `showVisibilityToggle={false}` removes the control. The toggle is reachable in tests at
  `{testID}.visibility-toggle` (override with `testIDs.visibilityToggle`). `Field`, `LoginScreen`,
  and `SignUpScreen` password fields inherit it.
- Dependency updates go through the daily `update-dependencies` skill: one trusted,
  same-repository rolling PR with a landed/failed ledger, a test that imports each
  bumped package, and a freeze on Expo fingerprint changes until a release.

### Changed

- `AdminProvider` accepts host-injected `credentials` and `getAuthHeaders` for native `adminRequest`. The admin SPA uses cookie `same-origin` credentials; the example app sends a Bearer token.
- Admin RPC hooks dual-run: hosts that inject `credentials` / `getAuthHeaders` on `AdminProvider` use native `adminRequest`; hosts that pass only `api` keep RTK `injectEndpoints`.
- Admin panel HTTP script runs enqueue durable job `admin/script` when `JobsApp` is registered.
  The Scripts UI still polls `BackgroundTask`. If runner enqueue throws, the HTTP handler
  marks that `BackgroundTask` failed and returns 500. CLI script runs stay in-process. See
  `docs/how-to/background-jobs.md`.
- CircleCI starts fewer concurrent jobs: repository policies share one `repo-policies` check, Playwright runs five shards instead of one container per spec, and path filters no longer start example-backend / new-file-coverage for unrelated UI, RTK, or e2e-spec-only changes. `repo-policies` uses Node 22.14 for Knip. Require `repo-policies`; treat `e2e-*` shard names as path-filtered (config-only PRs post `e2e-auth`).
- CircleCI uses smaller Docker classes for Playwright e2e shards, skips empty
  Netlify/GCP contexts before `bun install`, and turns off Docker Layer Caching.
- The `terreno-planning` plugin now includes reusable Terreno backend/API, UI, data,
  schema, SDK, admin, prompt-governance, documentation, upgrade, deployment, and UI
  verification skills alongside the lifecycle. It also ships `pre-commit` and
  `ui-verifier` agents. The redundant `commit` and `create-pr` skills are removed in
  favor of Brew. Conflicting or unused Expo skills (`native-data-fetching`,
  `building-native-ui`, `expo-ui`, App Clip, brownfield, Observe, Tailwind setup,
  EAS update insights, and Expo module authoring) are no longer distributed. Taste's
  pre-push gate runs lint, typecheck, and affected tests for every supported host.
  Rulesync now also generates native stop hooks for Cursor, Claude Code, GitHub Copilot,
  and Devin that run repository lint and typecheck, emit each host's blocking JSON
  protocol, and avoid repeated checks on structured Stop-hook retries. Plugin
  `terreno-planning` is `2.8.0`.
- CircleCI Playwright shards now run only when a changed file can reach them. `e2e-prepare` resolves the affected shards with `bun run check:e2e-affected` (import graph with barrel, lazy-registry, and lockfile resolution) and each shard halts before `bun install` when it is unaffected. The gate fails open on anything it cannot resolve. See [circleci.md](../../docs/how-to/circleci.md#e2e-affected-gate).
- The deployed example backend selects `JOBS_RUNNER=gcp-cloud-tasks`, verifies Cloud
  Tasks OIDC on `POST /jobs/execute`, and points each PR preview at its matching
  tasks-service tag. GitHub Actions and CircleCI both deploy that tag, and production
  deploys overwrite env vars so preview `MONGO_DB_NAME` / `PR_NUMBER` cannot stick.
  The API
  process starts the schedule ticker; the tasks service does not. The compiled Cloud Run binary enqueues through the Cloud Tasks REST
  API (`google-auth-library`) because `@google-cloud/tasks` cannot load its JSON
  config from a `bun build --compile` image. Enqueued HTTP tasks set
  `dispatchDeadline` to protobuf `{seconds: 1800}` (REST JSON `"1800s"`) so Cloud
  Tasks does not retry a still-running 30-minute handler at the 10-minute HTTP
  default. The REST client encodes that Duration; the optional `@google-cloud/tasks`
  peer receives the protobuf object. Queue and worker service resources live in Infra
  Manager.
- Grow now ends with a standalone approval brief instead of a 15-line index. It opens
  with a paragraph on where the repository is and where the change takes it, adds
  background on current state when a reviewer needs it, then lays out the idea and the
  plan (tasks, tracer, verification, out of scope, risks). The Decisions table follows
  the plan and now pairs every settled human decision with the question that prompted
  it, so a reviewer can see what was asked as well as what was chosen; it is still
  omitted when grilling settled none. A reviewer should be able to approve from the
  brief alone, without opening the IP, the ticket, or the interview history.
- `implement-ready-for-dev` now Grow-shapes the claimed issue without a chat pause
  (assume answers unless a genuine human gate), then Pick ⇄ Roast, Brew, and Taste
  to a mergeable PR. Dashboard paste is in that skill's `references/cursor-automation.md`.
  There is no separate `autobot-ready-for-dev` skill.
- `new-file-coverage` no longer reruns a package's full test suite when that package's CI already produced LCOV. The 90% new-file gate runs against the package report instead. Remaining reruns use colocated tests, compile `@terreno/*` dist deps only when imported, and coverage-script unit tests run in a separate `coverage-scripts` job.
- Planning Brew titles are `[ticket] Short feature title`. The ticket uses the attached
  Linear id (`[FH-1632]`) or GitHub issue (`[#412]`); the rest names the feature only.
  Titles must not use `feat:` / `docs:` prefixes or lifecycle labels such as
  `IP Approved` and `Task list`.

  PR bodies now preserve the IP's initial justification and a brief overview of its
  intended outcomes. Verification always includes reproducible testing instructions;
  Brew updates that section as testing changes while keeping the rationale and overview
  stable.
- Planning stages and outer loops now close every wait-for-human or done chat with the
  current PR's GitHub Deployment demo URLs as the last visible section when those URLs
  exist. Plugin `terreno-planning` is `2.11.0`.
- Removed the `terreno_bootstrap_app` MCP tool. The only supported scaffold path
  is `bunx create-terreno-app` / `npm create terreno-app`. MCP still offers
  `terreno_bootstrap_ai_rules` for editor rules after the CLI runs.
- Roast no longer asks two unconstrained subagents to each rediscover the repository
  (full-branch diff plus skill catalog). Pick, Roast, and Brew pass a task-scoped
  briefing (`plugins/terreno-planning/references/subagent-briefing.md`): this task's
  criteria, file list, and patch. Roast may spawn at most one UI/runtime verifier when
  this task lists UI files, and must not spawn a conventions reviewer. Installable
  lifecycle skills copy only the plugin references they link.
- Taste records failed tests from the last product-CI run and re-verifies those exact
  local commands before any GitHub push. `prepush` does not substitute for that
  re-verify. Example-frontend now exposes `test:ci` so root `bun run test` includes it.
  Cursor Cloud test mapping lives in `docs/how-to/run-tests-locally.md`. Plugin
  `terreno-planning` is `2.12.0`.
- Taste now runs a repository root's `prepush` package script, when present, in its fresh
  no-context subagent before pushing. Repositories own the exact local gate; when the
  script is absent, Taste retains its affected-package lint, typecheck, and test fallback.
  Terreno's root `prepush` gate runs workspace lint, TypeScript compilation, and full
  Knip/dependency-cruiser static analysis. Plugin `terreno-planning` is `2.10.0`.
- The component demo and documentation site now use distinct Terreno Garden app
  icons. The demo home screen also shows a Terreno Garden banner that flows inline
  with the component grid, filling the first two card slots.

### Deprecated

- `@terreno/admin-frontend`'s `useAdminApi` RTK `injectEndpoints` path and required
  `api` prop are deprecated. Terreno 57 retains them for ObjectId/API-only
  compatibility; Terreno 58 removes them. New admin RPC uses the host-bound fetch
  client, and eligible String-`_id` model CRUD uses windowed syncdb.

### Removed

- The UI component demo no longer includes announcement or in-app notification
  stories. Exercise those surfaces in `example-frontend` instead.

### Fixed

- The `cloud_run_service` Terraform module no longer ignores `template.revision`.
  Ignoring it pinned the live revision name in state, so any structural change
  failed with Cloud Run 409 `Revision named '<name>' with different configuration
  already exists`. The Cloud Tasks queue now also waits on the IAM module so the
  first apply cannot 403 on `cloudtasks.queues.create`.
- `compile-workspace-deps` uses `tsconfig.server.json` when present so
  `@terreno/admin-spa` emits `src/dist` for example-backend coverage.
- Compiled example-backend images (`bun build --compile`) no longer point admin migrations at `$bunfs`. The Docker image copies `migrations/` to `/app/migrations` and sets `MIGRATIONS_DIR`. A missing directory returns 404 `Migration directory not found` instead of a generic 500.
- `test:coverage` and new-file coverage no longer fail when Bun 1.4.2+ exits 1 for bunfig `coverageThreshold` after every test passed. Isolated LCOV merges still enforce the 95% / 90% gates.
- Terraform preview CI now prints Infra Manager `errorCode` / `errorLogs` when
  `previews create` fails, and `terraform-admin` gains `roles/logging.logWriter`
  so Cloud Build can write regional logs.
- Admin Migrations re-enables Dry run / Apply when task polling fails. `terreno-migrate generate` keeps safe index operations as comments in fail-closed stubs that also include unsafe ops.
- `terreno-pick-roast-loop` resumes only Pick or Roast. A stored `next: brew` finishes
  the loop without launching Brew, Taste, or Grow.
- example-backend listens on `PORT` before connecting to MongoDB and attaching
  the Terreno Express app. If that boot later throws, the process closes the
  holder and exits so Cloud Run does not keep a 503 listener. GitHub Actions
  preview deploys overwrite Cloud Run revision secrets, smoke-test the same
  `JOBS_*` env as the revision, rebuild traffic from Ready revisions (omitting
  failed tags), deploy `--no-traffic` without `--tag`, then tag the new revision.
- RBAC permission resolution now keys the in-memory grant cache by user id and
  sorted role names, so promoting a user (for example e2e `setUserAdmin`) takes
  effect on the next `/auth/me` instead of serving a 30s stale set.
- Conflict resolution with **Keep mine** now preserves the admin-window mutation marker
  when cloning a durable outbox row, so its retry retains AdminApp authorization,
  protected-field stripping, hooks, and audit handling.
- `Tooltip` no longer disappears the instant it opens on web. The portal layer that
  renders overlays (tooltips, modals, toasts) declared `pointerEvents: "box-none"` in an
  inline style, which react-native-web drops, so every mounted portal covered the app with
  a full-screen overlay that swallowed hover and press events. The portal layer now uses a
  registered `StyleSheet` style, and `Tooltip` stays off screen until its trigger has been
  measured instead of flashing in the top-left corner.
- `TextField` on React Native Web no longer enters an update-depth loop when
  browser autocorrect alternates controlled values. Web autocorrect/spellcheck is
  disabled, the input handler stays stable, and rapid synthetic A→B→A reversals
  are suppressed without blocking normal typing or delayed backspace/retype.

## [57.3.0] - 2026-09-02

Upgrade note: [`mcp-server/src/docs/upgrades/57.3.0.md`](mcp-server/src/docs/upgrades/57.3.0.md).

### Added

- The lifecycle stages now ship as a Claude Code plugin. Add the marketplace with
  `/plugin marketplace add TerrenoLabs/terreno`, install with
  `/plugin install terreno@terreno-plugins`, then invoke `/terreno:1-grow`. The marketplace
  name is `terreno-plugins` so it does not collide with the plugin name `terreno` (Claude
  Code's installer breaks when those names match). Claude Code takes a
  plugin skill's command from the frontmatter `name`, so its shortened stage names
  (`1-grow` … `5-taste`) ship as a generated copy at `plugins/terreno-claude/`
  (`bun run skills:sync`). Cursor and `npx skills` are unchanged: plugin
  `terreno-planning`, stages `terreno-1-grow` … `terreno-5-taste`.
- The lifecycle stages now ship as a Codex plugin. Add the marketplace with
  `codex plugin marketplace add TerrenoLabs/terreno`, install with
  `codex plugin install terreno-planning --source terreno-plugins`, then invoke
  `$terreno-1-grow`. Codex uses the canonical `plugins/terreno-planning/` tree
  (`.codex-plugin/plugin.json`) and the repo marketplace at
  `.agents/plugins/marketplace.json`. Stage names match Cursor and `npx skills`.
- `TwilioSmsProvider` at `@terreno/comms/adapters/twilioSms` (optional peer `twilio`). Sends
  prefer a messaging service SID over a from-number, require valid E.164 destinations, classify
  Twilio error codes, and store a console deep link on accepted sends. The example backend
  registers the adapter when Twilio env vars are complete.
- `TwilioVerifyProvider` at `@terreno/comms/adapters/twilioVerify` (optional peer `twilio`).
  Starts and checks SMS/email OTP via a Verify service SID, classifies Twilio errors, redacts
  destinations, never stores codes, and marks verification rows non-retryable. The example
  backend registers the adapter when `TWILIO_VERIFY_SERVICE_SID` is set with account
  credentials.
- Admin comms dashboard: filter and inspect delivery logs, retry failed sends (including bulk retry
  with a cap), and view per-provider failure rates. Created and attempt timestamps print in the
  operator locale. List, stats, and bulk retry share a trailing 7-day window when dates are omitted.
  Editing a filter while that window is implicit keeps both date bounds. Push
  `beforeSend` cancel returns `loggedMessageId`. Retry returns the log row created by that send. Routes live on `@terreno/comms`; screens ship in
  `@terreno/admin-frontend` as the `comms` custom screen.
- `describeModel()` and `describeModelForRouter()` in `@terreno/api` walk Mongoose schemas once and expose a canonical `ModelDescription` field graph. OpenAPI (`getOpenApiSpecForModel`), admin `/admin/config` field metadata, and MCP Zod tool schemas now format that graph instead of independently walking `schema.paths` or mongoose-to-swagger. Map fields take their value kind from Mongoose `of` / `getEmbeddedSchemaType()` (not a date fallback).

  Exports include `modelDescriptionToOpenApiSpec`, `modelDescriptionToAdminFields`, and `fieldDescriptionToZodType`. See `docs/explanation/schema-metadata.md`.
- `ExpoPushProvider` at `@terreno/comms/adapters/expoPush` (optional peer
  `expo-server-sdk`). `sendPush` returns one `SendResult` per token, chunks Expo
  payloads, classifies ticket/receipt errors, and polls receipts. `DeviceNotRegistered`
  deactivates `PushToken` rows via `CommsService.deactivatePushToken`. `MessageTooBig` is
  `errorClass: config` and does not deactivate the token. `expo-server-sdk`
  moved off `@terreno/api`. The example app requests notification permission, registers the device token after
  login, and exposes a profile-screen test send (`POST /comms/dev/testPush`) in
  non-production.
- Added `create-github-issue` and `work-github-issues` skills plus a lifecycle
  work-item GitHub form so agents can file pick-ready issues, confirm a plan,
  post it as the Roast contract, then implement with Pick ⇄ Roast.
- Opt-in HTTP rate limiting on `TerrenoApp` via `rateLimit: {}` (memory default; `redis` or `mongo` for shared buckets). Login and related auth routes use 20 requests / 15 minutes; other framework HTTP uses 600 / 15 minutes. Credential-exchange JWT routes ignore a stale access token. Trailing slashes and Express `req.path` drive the auth/api bucket. `trustProxy` defaults off (set `1` on Cloud Run). Omitted `rateLimit` is a no-op until Terreno 58. 429 is `APIError` `code: "rate-limit-exceeded"`. See `docs/how-to/rate-limiting.md`.
- Inbound webhooks on `WebhooksApp`: raw-body capture, HMAC/Stripe/Twilio/SendGrid
  verifiers (SendGrid ECDSA uses the same 300s timestamp window as Stripe), memory or
  Mongo `webhookReceipts` idempotency. `CommsApp` mounts Twilio status/inbound and
  SendGrid Event Webhook routes when passed the same plugin. `recordDeliveryEvent`
  rethrows a failed `CommsMessage` save so webhook claims release. See
  `docs/how-to/inbound-webhooks.md`.
- `terreno_search_docs` and `terreno_get_component_docs` accept an optional
  `version` so agents can search retained docs snapshots for the consumer's
  `@terreno/*` lockstep version. Snapshot component pages match both hyphenated
  camelCase filenames and concatenated generator slugs.
- Pull requests now fail when a newly added workspace `.ts` or `.tsx` implementation
  file is below 90% function coverage or 90% line coverage. Run
  `bun run check:new-file-coverage --base=origin/master --threshold=90` locally.
  The gate reuses each package's `bun test` file arguments so Playwright `*.spec.ts`
  files are not collected. Glob arguments are expanded before spawn so packages such
  as `example-frontend` still collect `*.test.ts` files. Globs that match no files
  are omitted.
- JWT and Better Auth password reset plus email verification: `POST /auth/forgotPassword` (always 202), `POST /auth/resetPassword`, `POST /auth/sendVerification`, and `POST /auth/verifyEmail`. Opt in with `emailVerificationPlugin`, `tokenEpoch`, `authOptions.publicAppUrl` / `sendMail`, and `@terreno/comms` `renderAuthMail`. Better Auth uses the same `publicAppUrl` and `sendMail`. `LoginScreen` accepts `onForgotPassword`. See `docs/how-to/password-reset.md`.
- The `terreno-planning` Cursor plugin (`2.3.0`) adds two outer-loop skills beside the
  five stages: `terreno-planning-loop` walks the approved task list (default Grow once,
  then Pick once — Pick owns the pick-roast inner loop; pass `phases=` to restrict to
  `grow`, `pick`, `roast`, `brew`, and/or `taste`), and `terreno-taste-sweep` finds the
  author's open non-draft PRs that are conflicting or failing and reinvokes Taste until
  each is mergeable or blocked.
- `Popover` in `@terreno/ui` for previewing a document with loading, loaded, and error
  states, an open action, and optional thumbs up/down feedback.
- CI now fails production TypeScript that uses `function` declarations, `Date`/`Date.now()`, `throw new Error`, `console.log`, Mongoose `findOne`, or unsuppressed `as any`. Run `bun run check:source-rules`.
- Upgrade notes format, 0.21.0–0.30.0 backfill, `terreno_get_upgrade_guide` coverage headers, versioning policy, `upgrading-terreno` skill, and changelog links to `mcp-server/src/docs/upgrades/`.

### Changed

- Brew and Taste now discover and observe product CI on every configured host, including
  CircleCI and Buildkite, not only GitHub check runs. Waits use provider-native hooks such
  as `gh pr checks --watch`, `circleci run watch`, and `bk build watch` where available,
  with bounded polling only as fallback. Plugin `terreno-planning` is `2.4.0`.
- Brew and Taste now sleep until async review bots such as Bugbot and CodeQL finish on
  the current head, then continue so they can react in the same invocation. Ordinary
  product CI still uses Taste `PENDING` and the outer loop. Plugin `terreno-planning` is
  `2.2.0`.
- PR GitHub Actions spend fewer minutes on docs, Playwright, Expo fingerprints,
  Maestro, and the example-backend Docker check. Docs previews build only the
  current version (unminified, no local search index) and reuse generated
  TypeDoc/component MDX when the source hashes match. Docusaurus Faster
  (Rspack) is on for PR and `master`; production still builds every versioned
  tree.

  CI pins Bun `1.4.0` instead of `latest`. Playwright e2e compiles the workspace
  once per run and shares `dist/` with the spec shards. Example-backend CI
  compiles `@terreno/*` deps in one process and watches `api/**`. The backend
  Docker check rebuilds only when the image recipe changes; CD still builds
  preview images from source.

  Backend startup now defers sync index creation until after MongoDB connects.
  This prevents import-time Mongoose buffering timeouts from blocking Cloud Run
  containers before they begin listening. The example backend also avoids the
  OpenTelemetry Mongoose patch that deadlocked index creation in Bun-compiled
  binaries, keeps startup logging on Cloud Run's captured stdout instead of a
  blocking network transport, and lets Better Auth-only realtime run without a
  legacy JWT secret.
- Architectural PR review and Maestro web E2E now run on CircleCI. Matching GitHub
  workflows are retained with `on: []` for rollback. Cursor Approval Agent, Bugbot,
  and Security Agent stay on GitHub (Cursor GitHub App automations, not repo
  workflows).
- CircleCI path filters start Netlify and GCP production and PR preview jobs.
  Those jobs skip (exit 0) until `terreno-netlify` and `terreno-gcp` are filled.
  GitHub Actions remains the live deployer in that window. After CircleCI
  secrets exist and a deploy succeeds, set the GHA deploy workflows back to
  `on: []` so terraform is not applied twice. Fork PRs skip CircleCI previews.
  Preview cleanup on PR close uses GitHub `preview-cleanup.yml`.
- CircleCI provides Netlify and GCP deploy jobs, semver-tag npm releases, and
  manual preview cleanup, preview deploy, EAS development build, and
  single-package publish operations. Automatic production deploy path triggers
  stay paused until the Netlify contexts and GCP OIDC bootstrap pass manual
  verification. Matching GitHub CI/CD workflows are retained with `on: []` for
  rollback. CircleCI uses OIDC for GCP; no service-account JSON key is required.
- `modelRouter` registers collections in one in-memory catalog keyed by route path. MCP, realtime, and sync read shared `ModelRouterOptions` from that catalog; `replaceCollectionOptions` updates every surface at once. Registry `clear*` helpers clear the whole catalog in tests.
- `@terreno/api` RBAC routes now narrow path parameters at runtime instead of
  relying on implicit `any`. `@terreno/ui` Hyperlink props (`linkify`, styles,
  `injectViewProps`) and the Google Maps `window.google` global use concrete
  types instead of `any`.
- Root lint now rejects explicit `any` suppressions without a `noExplicitAny:` rationale.
- `improve-rulesync` now keeps user-facing guidance in `docs/` and agent-facing
  guidance in `.ai/` or rules, with cross-links instead of duplicated architecture.
- Heavy optional `@terreno/ui` screens (`GPTChat`, `MarkdownEditor`, `ConsentFormScreen`, `AIRequestExplorer`, and the other named exports from `lazyBoundaries/heavyOptionalExports`) load through lazy boundaries so a root `@terreno/ui` import stays smaller. Named exports are unchanged.
- MCP create, update, and delete tools run through the same `executeCreate` /
  `executeUpdate` / `executeDelete` pipeline as REST and Sync. Permission denials
  and hook failures use `APIError` titles in the MCP error envelope. User-role
  stripping happens after hooks in the executor (MCP uses the registry model
  name). `loadDocOr404` maps invalid document `_id` values to 404, not populate
  `CastError`s.
- Pick and Roast now run as an automated inner loop: implement one unblocked task, roast
  it, then pick the next until the approved list is done. Roast never invokes Pick; Pick
  owns continuation. Exactly one driver continues after each Roast. Later tasks rediscover
  docs and skills. Brew starts only after every in-scope task has Roast `PASS`. Plugin
  `terreno-planning` is `2.3.0`.
- Planning plugin skills (five stages plus planning-loop and taste-sweep) are model-invocable. The lifecycle checker requires those skills omit `disable-model-invocation`.
- Aligned README, docs landing, docs site tagline, agent context, MCP overview, and npm package descriptions on the canonical "Django/Rails for TypeScript — with universal app support" positioning.
- CircleCI is enabled again for package CI, repo policies, and Playwright e2e
  (`.circleci/config.yml` setup + path-filtering). Config-only PRs run a small
  smoke slice; mixed PRs skip that slice so path-filtered jobs are not doubled.
  E2E shards share one compile + `expo export`. `rulesync-check` runs only when
  rule sources change. CircleCI deploy jobs are available through manual
  parameters while automatic production path triggers remain paused. Matching
  GitHub deploy workflows are retained with `on: []`. See `docs/how-to/circleci.md`.
- Taste waits in-process for product CI with a GitHub CLI or CircleCI CLI watch loop.
  Before any push it always pulls latest `master`, then runs `bun lint` (and affected
  tests) in a fresh subagent with no parent conversation, then pushes and watches CI.
  Plugin `terreno-planning` is `2.5.0`.

### Deprecated

- `modelRouter` `realtime` and `@terreno/rtk` cache-patching helpers (`realtimeList`,
  `realtimeDocument`, `setRealtimeSocket`, `getRealtimeSocket`) are deprecated and will
  be removed in Terreno **58**. Migrate collection live updates to `sync` +
  `@terreno/syncdb`. `RealtimeApp` remains required for sync sockets. See
  [migrate-rtk-to-syncdb.md](docs/how-to/migrate-rtk-to-syncdb.md) and
  [remove-legacy-realtime.md](docs/tasks/remove-legacy-realtime.md).

### Fixed

- Admin custom screens now show a clickable back arrow by default. The shared
  `AdminScreenPage` routes back to admin home reliably on web instead of depending on
  browser history, and `Page` supports an explicit `onBack` handler.
- Better Auth lazy User create no longer sets `oauthProvider: null` on email/password sign-up, so `strict: "throw"` User schemas without that field get `req.user` on the first authenticated request instead of 401.
- CircleCI Playwright chaos e2e no longer force-restarts the sync client after
  flaps. `goOnline` waiting for the Offline banner to hide is the reconnect
  signal; `client.stop()` hung for 30s on the production static export.
- CircleCI automatic Netlify and GCP production path triggers are paused until
  their contexts and OIDC bootstrap pass manual verification. Netlify jobs now
  validate credentials before expensive builds, docs builds avoid minification to
  fit the available executor memory, and the Terraform configuration is formatted.
- CircleCI no longer deploys the production demo from prerelease tags, Zoom
  release notify reports failure when publish fails, Maestro keeps Xvfb alive as
  a background step, and CircleCI OIDC can require the `terreno-gcp` context UUID
  before GCP impersonation.
- Taste can query CircleCI with `CIRCLECI_TOKEN` on the GitHub App project slug. The
  new-file coverage job compiles the same workspace packages as example-backend CI.
  The example profile form no longer resets the name field when `/auth/me` is refetched.
- Example backend Cloud Run images include `expo-server-sdk` in the compiled
  binary by injecting an `Expo` client into `ExpoPushProvider`. Preview deploys
  no longer crash at boot with a missing optional peer.
- GitHub `cd.yml` GCP preview jobs (`terraform-preview`,
  `backend-deploy-preview`) and `preview-cleanup.yml` skip fork pull requests.
  OIDC `id-token` is granted only on jobs that authenticate to GCP, not the
  whole workflow. Fork PRs keep `repository: TerrenoLabs/terreno` on the
  token, so WIF would otherwise accept them.
- Sync mutation date equality now parses date-only ISO strings as UTC and rejects invalid input instead of throwing. The unused datetime NumberPicker stores UTC ISO so Luxon can round-trip the picker value.
- The `maestro-e2e` CI job now exports the example-frontend web bundle before starting the
  example backend. That executor shares its memory with the mongo service container, and
  bundling alongside a running backend got the export OOM-killed (`SIGKILL`) even though the
  same export succeeds in `e2e-prepare`.
- `bun run check:new-file-coverage` now expands the glob arguments it reads from a package's
  `test` script before spawning `bun`, so packages without a `src/` directory (such as
  `example-frontend`) no longer fail with "filters did not match any test files". Expo Router
  route-structural entry files under `app/` (`index`, `_layout`, `+not-found`, and dynamic
  segments) are exempt from the gate; the router mounts them by file path and the screens they
  render are covered in their owning package.
- JWT password reset now updates Better Auth credentials and sessions when both stacks are mounted, Better Auth password reset updates the JWT password and `tokenEpoch`, mailbox changes invalidate unused reset tokens even without `emailVerified`, authenticated verification resend returns 501 without a `publicAppUrl`, and Better Auth recovery hooks refuse to send relative links.
- Select dropdown chevrons stay inside the field border in narrow selects on web. The `am`/`pm`
  and timezone pickers in `DateTimeField` no longer render their chevrons far to the right of
  their boxes.
- Example backend Cloud Run images include `twilio` in the compiled binary by injecting
  a Twilio client into the SMS and Verify adapters. Invalid SMS destinations return a
  permanent `SendResult` instead of throwing, so the facade does not retry them. Partial
  Twilio env in the example backend throws `APIError` at boot.

## [57.2.0] - 2026-08-24

Upgrade note: [`mcp-server/src/docs/upgrades/57.2.0.md`](mcp-server/src/docs/upgrades/57.2.0.md).

### Breaking

- Lifecycle stage handoff YAML is now compact `v: 2` (`v`, `stage`, `status`, `next`,
  `action`; omit empty keys). Outer loops that parse `schema_version` / `recommended_next_stage`
  must switch keys. Chat and PRs keep the YAML in a Details toggle. Grow lists every grilled
  decision in an unbounded table after the 15-line index, or omits that table when there were
  none, and stays on a question until the answer is executable.

### Added

- Admin RBAC is now first-class: `admin:access` is the only permission that opens the admin
  page. Per-model access is `read` / `write` / `writeOwned` (with `isOwned` helpers and custom
  `authorize` callbacks). The shell hides models, custom screens, scripts, and Platform tools
  the caller cannot use; row update/delete follow per-record capabilities; roles use a
  one-select access level; denied forms are read-only.

### Changed

- Upgraded the toolchain to Bun 1.4. The GitHub Actions jobs that pinned an exact
  Bun version now use `1.4.0`, `@types/bun` and `bun-types` move to `^1.4.0`, and
  apps scaffolded by `@terreno/mcp` get `@types/bun@^1.4.0`. Contributors should
  run Bun 1.4 or newer locally. EAS build profiles keep their existing Bun pin:
  `eas.json` is an Expo fingerprint input, so bumping it would change the native
  runtime version and force a rebuild for a toolchain-only change.

## [57.1.0] - 2026-08-23

Upgrade note: [`mcp-server/src/docs/upgrades/57.1.0.md`](mcp-server/src/docs/upgrades/57.1.0.md).

### Added

- Admin configuration can now live beside `modelRouter` registrations or in plugin
  `adminContribution()` metadata. `@terreno/admin-frontend` adds a provider-backed widget registry,
  screen router, filter drawer, bulk actions, autocomplete references, and first-party Feature Flags,
  Consent, Documents, and AI admin integrations.
- `terreno_bootstrap_app` scaffolds Better Auth + `@terreno/syncdb` (replica-set MongoDB,
  `SyncApp`/`RealtimeApp`, `SyncDbProvider`) instead of JWT `generateAuthSlice`
- CircleCI dual-run for package CI, repo policies, and Playwright e2e (`.circleci/`;
  deploys still on GitHub Actions). See `docs/how-to/circleci.md`.
- `@terreno/comms` Phase 1 gap-fill: `beforeSend` mutate/cancel, `recordDeliveryEvent` /
  `recordOptOut`, attempt history on `CommsMessage`, payload retention
  (`retainPayloadDays`, `redactPayload`), and channel-wide transient retry (SMS,
  verification start, per-token push). `onRetry` stays `(context, result)` with
  `context.attempt`. Push prune honors `errorClass: "permanent"` as well as
  `isPermanentFailure`.
- `createCollectionHooks` in `@terreno/syncdb/react` and optional per-mutation
  `maxAttempts` on syncdb writes.
- Model Context Protocol support in `modelRouter` via an `mcp` option: opted-in
  models expose their CRUD operations as MCP tools at `POST /mcp`, reusing the
  same permissions, query filters, population, and lifecycle hooks as REST
  ([#358](https://github.com/TerrenoLabs/terreno/pull/358)). `getMCPTools(user)`
  in `@terreno/ai` returns those tools as Vercel AI SDK objects for in-process
  chat. MCP list filters accept Mongo comparison operators (`$in`, `$gte`, `$ne`,
  and friends) and top-level `$and` / `$or` on `queryFields`; operators that can
  execute code (`$where`, `$expr`, `$function`) are rejected. `@terreno/rtk`
  adds `useMCPTools()` and `useTerrenoChat()`. MCP HTTP/stdio servers use the
  TypeScript SDK v2 (`2026-07-28`) with a how-to guide and structured tool-call
  logs. Lifecycle hooks and REST `responseHandler` receive a stub Express-shaped
  request from `createMCPRequest` (authenticated user, tool args as `body`, empty
  `headers`/`query`/`params`, `isMCPRequest: true`) rather than forwarded HTTP
  headers. `registerMCPTool` adds custom tools alongside modelRouter CRUD. The
  example backend exposes `users_todo_statuses` (admin-only: every user and their
  todo completed flags).
- Example app profiles list every assigned role and link superadmins to role editing. The admin
  script runner includes a guarded `resetDatabase` action, and seed data includes
  `superadmin@example.com`. The admin roles page supports creating and editing roles by selecting
  from the server's available permissions. Admin script execution requires `admin:runScripts` when
  RBAC is configured, and live production resets require `ALLOW_ADMIN_DB_RESET=true`.
- `SendGridMailProvider` at `@terreno/comms/adapters/sendgrid` (optional peer
  `@sendgrid/mail`) with sandbox mode, `errorCode`/`errorClass` taxonomy, Email Activity
  deep links, and one transient retry via `CommsService` hooks (`onError` / `onRetry` /
  `onSend`).
- `terreno-syncdb-codegen` CLI in `@terreno/syncdb` generates typed collection hooks
  (`store/syncDbSdk.ts`) from OpenAPI `x-terreno-sync` list operations. The CLI is a
  bin of `@terreno/syncdb`, not a separate `@terreno/syncdb-codegen` package.
- `@terreno/syncdb` documentation: reference (`docs/reference/syncdb.md`), migration guide
  (`docs/how-to/migrate-rtk-to-syncdb.md`), and local-first explainer
  (`docs/explanation/local-first-data.md`)

### Changed

- User admin forms now load existing RBAC roles into an **Add role** dropdown. Assigned roles
  remain visible and can be removed without entering raw array values. Blank optional enum
  fields no longer block otherwise valid saves, and role-update responses include the new roles.
- The admin sidebar groups Scripts, Roles, Version, Audit Log, Feature Flags, and Configuration
  under a consistently spaced **Platform** section at the bottom. Empty navigation sections are
  hidden, and Audit Log / Feature Flags no longer appear twice under Models.
- The Terreno planning plugin 2.0 is a fresh-invocation loop-engineering lifecycle:
  Grow → Pick → Roast → Brew → Taste. Every bounded stage discovers repository skills,
  reads/writes a shared evidence-oriented result/state contract, and exits. Brew no longer
  executes Taste; Taste reacts once to current CI/mergeability/review state while the outer
  loop owns waiting and reinvocation. Terreno package commands and domain rules remain in
  repo-local skills. Grow retains interactive grilling and a 15-line approval summary; Pick
  retains vertical-slice TDD and independent implementation/test-quality review; Roast is
  the authoritative verifier. The former Grind behavior remains an outer-loop feature
  profile, and static validation enforces names, transitions, portability, and loop bounds.
  Deprecated repo-local routers (`ip`, `implement`, `submit`, `autobot`, `check-watcher`)
  are removed. Quiet package tests (`test:agent`) run with `AGENT=1`. Brew, Taste, and
  repository PR skills now enforce an attention-budgeted GitHub format: only `Why`, `What
  changed`, and `Verification` remain visible; optional detail is expandable; comments are
  reserved for blocked decisions or non-obvious review resolutions.
- Unreleased notes are one file per feature in `changelog/unreleased/` instead of a shared
  `CHANGELOG.md` `## [Unreleased]` section. `docs/implementationPlans/PLAN_INDEX.md` is
  removed for the same reason — status lives on each IP's `**Status:**` header. Parallel
  PRs no longer conflict on those shared files.
- GitHub Actions package CI (API, AI, UI, RTK, comms, syncdb, examples, E2E, Maestro, admin SPA) now runs on `pull_request` with path filters, and on `push` only to `master`. This stops the first push of a new branch from ignoring path filters and running unrelated jobs (the 13 Playwright shards were the main cost). Docs-only and rules-only PRs skip package CI, Rulesync, CD, and frontend/demo deploy workflows. Example Frontend Deploy PR path filters match the frontend build gate (backend-only PRs skip the workflow; mixed PRs still retarget preview `BASE_URL`).
- CircleCI pipelines are disabled (`.circleci/config.yml` no-op). GitHub Actions
  remains the CI of record. Restore with `.circleci/config.setup.yml`. See
  `docs/how-to/circleci.md`.
- Lifecycle stages now follow a documentation contract: read architecture docs before
  acting, update them in the same slice, and fail user-visible or architectural work that
  ships without matching docs. All agent skills are installable with
  `npx skills add TerrenoLabs/terreno`. The committed `skills/` tree is generated from
  `.rulesync/skills/`, the planning plugin stages, and `<package>/.ai/skills/` overlays via
  `bun run skills:sync`.
- Role assignment **preview** no longer writes `RbacAudit` denied-assign rows. Denied
  mutation audits are recorded only for the escalation `403` (`Cannot grant permissions
  you do not hold`); other failures are not stored as denials, and a failed audit write
  does not replace that original `403`.
- When a `PermissionSource` refresh fails with `staleOnFailure: "deny"` (the default),
  last-cached `deny` grants stay in force so IdP/ABAC restrictions do not lift. Additive
  `roles` / `permissions` from that source are still omitted.
- RBAC `createView: "deny"` and unknown field-view names fail closed instead of granting a
  full mask. Nested field omits clone documents; write masks honor dotted paths. Bulk create
  and array mutations apply the same write mask as single-document writes.
- AdminApp model CRUD requires resource actions in addition to `admin:access`. Self-service
  still cannot write User `admin`/`roles`. Without RBAC, admin CRUD may set `admin`.
  With RBAC, `roles` go through `RoleManager.assign`. Changing `admin` requires
  `rbac:assignRoles` plus an actor who already holds the legacy admin flag;
  `rbac:manageRoles` is not a substitute. Unchanged echoed `admin`
  values are allowed. If `assign` fails after an admin User update or bulk-patch,
  non-role fields are restored so the request does not keep a partial write.
  Role update requires the actor to hold the union of current and incoming
  permissions, and delete requires holding the role's current permissions, so
  `manageRoles` cannot empty or remove grants the actor lacks.
  assign/unassign require the actor to already hold the
  target user's current permissions. The seeded `auditor` role no longer receives
  `admin:access` via read-only expansion. Admin CRUD for a resource missing
  from statements fails closed for list/read, search, and writes. Framework statements now
  include `featureFlag`, `consentForm`, and `consentResponse` so superadmin `*`
  can list those admin models; example-backend adds `adminAuditLog` list/read.
  `POST /admin/background-tasks`
  requires `admin:runScripts`; version-config GET/PUT require `configuration:read` /
  `configuration:update`.
- MCP and SyncDB registries use resolved RBAC options (TerrenoApp-injected and the
  documented `access` + `accessControl` path, including pathless `modelRouter`)
  instead of the pre-build legacy permission arrays. Create/update also apply
  `validateAccessWritePayload` (field views / `createView: "deny"`).
  User `roles` on modelRouter writes (HTTP, sync, and MCP) are dropped when
  `accessControl` is set.
  Example-backend `backfillAdmins` is dry-run unless `RBAC_BACKFILL_ADMINS=true`.
- `runActionPermissions` combines legacy `action.permissions` with RBAC instead of replacing
  them. Actions without `access` inherit the router's `access.resource` and the mapped CRUD
  verb (`instance` POST → `update`, `collection` POST → `create`). Example todo
  `bulkComplete` / `markComplete` set `access: {resource: "todo", action: "update"}`
  so they cannot bypass `todo:update`. Empty action permissions and inherited CRUD actions
  mapped to `null` remain disabled. Assignment previews use uncached permission resolution
  on both the current and proposed sets, honor source `staleOnFailure` without writing
  caches, and reject role permissions the actor does not already hold. The admin role
  editor keeps Create/Save in the
  modal footer and scrolls the permission grid so a larger statement vocabulary cannot
  hide the save control. Create/list responses always apply the **read** field
  mask. Per-router `access.scope`
  extra PermissionSets are evaluated on HTTP and realtime reads. Sync and realtime
  serializers accept change-stream BSON post-images (no Mongoose `toObject`) so
  `sync:delta` is not dropped after RBAC wraps `defaultResponseHandler`. Invalid permission sets
  use a stable `APIError.title`.
- Self-service signup and `PATCH /auth/me` strip `organizationIds` alongside `admin` and `roles`,
  preventing callers from assigning themselves tenant membership. Administrative organization
  membership changes must use a privileged server-side path.
- Ordinary RBAC-enabled User modelRouter, sync, and MCP writes strip `admin`, `roles`, and
  `organizationIds`. AdminApp strips `organizationIds` the same way, and marks legacy
  `admin` writes only after `assignRoles` and an existing-admin check succeed.
- `RoleManager` writes `RbacAudit` (with `permissionDelta`) on create, update, remove, assign,
  and unassign. Denied escalation attempts are stored with `denied: true`. HTTP `rbacRouter`
  no longer writes a second audit row. Apps can pass `auditSink` (one function or an array)
  to fan records into a consuming-app log; set `persistAudit: false` to skip the built-in
  collection (at least one sink is then required).
- `RbacRole.seedDefaults` accepts `extraRoles` and shares `upsertSeededRole` with
  `RoleManager.seedDefaults`. `previewRoleChange` reports a real `affectedUserCount`.
- Importing `@terreno/api` no longer registers `RbacRole` / `RbacAudit` on the default
  mongoose connection. Use `createAccess({connection})` or `createRbacRoleModel` /
  `createRbacAuditModel`. The `RbacRoleModel` / `RbacAuditModel` singletons are removed;
  the `RbacRoleModel` type remains.
- The RBAC implementation plan is Complete (phases 1–6 shipped).

### Deprecated

- **`@terreno/rtk` for data synchronization** — deprecated as of **56.0.0**. Still published
  through the current major line; will not ship in the next major. Migrate collection CRUD to
  [`@terreno/syncdb`](docs/reference/syncdb.md) using
  [migrate-rtk-to-syncdb.md](docs/how-to/migrate-rtk-to-syncdb.md). Continue using `@terreno/rtk`
  for the OpenAPI SDK, Better Auth Redux, feature flags, and sockets.

### Fixed

- Admin lists no longer inherit public `queryFilter` scoping, and `adminFilter` Mongo operators
  are not rejected as client filters.
- Admin mutations and responses consistently scrub excluded fields, including populated refs.
- Plugin admin contributions forward `populatePaths`.
- Document Storage clients use the contributed `/documents` API path.
- Admin search applies the same `queryFilter`/`adminFilter` as list CRUD.
- AI Request Explorer multi-type filters use `$in` instead of dropping the filter.
- Admin list search (`q`) is a case-insensitive partial match across `searchFields`.
- The filter drawer can clear all filters and disables Apply when the draft is unchanged.
- Admin config `name` is unique when the same Mongoose model is mounted at more than one
  `routePath`, and list search/bulk-patch metadata is looked up by path.
- Document download failures log a status code only — not storage paths or provider payloads.
- The admin Roles screen scrolls its role cards and the "Available permissions" list instead
  of clipping them, and keeps the heading and "Add role" button pinned above the scroll area.
- `@terreno/ui` no longer triggers the react-native-web warning `"shadow*" style props are
  deprecated. Use "boxShadow".` — `Filter`, `WebDropdownMenu` (select fields, timezone picker,
  address field), and `DraggableList` now use `boxShadow`, and the new `createBoxShadow` /
  `applyColorOpacity` helpers build the shadow value from a color plus opacity.
- Patched `react-native-modalize` and `react-native-actions-sheet` to use `boxShadow` on
  iOS/web and `elevation` only on Android, so the two APIs do not stack. The modalize
  stylesheet ran at import time, so the deprecation warning appeared on every web page that
  imported `@terreno/ui`.
- Android centered dropdowns (`WebDropdownMenu` `presentation="centered"`) keep `elevation` and
  omit `boxShadow`, so the two APIs do not stack.
- Push hooks and retries are per-token; provider results are zipped to token strings
  after `beforeSend`. Mail payloads retain `replyTo` and `dynamicTemplateData`.
  `DeliveryEvent.errorClass` is persisted on the log row. `defaultFrom` is reapplied
  after `beforeSend`. Payload cleanup is best-effort and cannot fail `logSend` /
  `appendAttempt`. Hook exception text is logged only; `metadata.hookErrors` stores
  `hook-threw`, not `String(error)`.
- Conflict `requeue` copies per-mutation `maxAttempts` onto the cloned outbox
  row so `retries: false` stays fail-fast after keepMine.
- Expo native fingerprints for the demo and example frontend now exclude `package.json`
  scripts. Development and test command changes no longer trigger unnecessary native build
  acknowledgements or rebuilds.
- MCP create/update apply REST `validation.excludeFromCreate` /
  `excludeFromUpdate` and MCP `excludeFields` as a write denylist on persist and
  hook request bodies, including nested/dot paths and literal dotted keys
  (`"metadata.nested.token"`). Invalid ObjectIds return a structured not-found
  instead of crashing on `CastError`; mixed-case 24-hex ids still work. List
  returns a structured error when `queryFilter` throws. A throwing
  `responseHandler` / `mcpResponseHandler` becomes a structured tool error instead
  of a protocol crash. List filters ignore queryFields that sit under an
  `excludeFields` parent path, matching tool schema generation. Lifecycle hooks
  that throw `APIError` return `error.title` to the MCP client, matching
  `queryFilter` handling.
- `@terreno/ui` no longer triggers the React Native Web warning
  `props.pointerEvents is deprecated. Use style.pointerEvents`. Every component that set
  `pointerEvents` as a prop (`DateTimeField`, `Filter`, `SidebarNavigation`, `ToastNotifications`,
  `WebDropdownMenu`) now sets it in `style`.
- The `react-native-portalize` dependency, which set the deprecated prop on every screen through
  `TerrenoProvider`, is replaced by an internal portal host. `Host` and `Portal` are now exported
  from `@terreno/ui` with the same API.
- `seedDefaults` no longer overwrites customized unsealed roles on restart; sealed defaults still refresh from code.
  API tests clear `RbacRole` / `RbacAudit` in `setupDb` so leftover unsealed names cannot leak across cases.
- Admin `/bulk-patch` authorizes each target document, so scoped `update` cannot patch out-of-scope ids.
- Admin User CRUD can set the `admin` flag when RBAC is off. With RBAC, changing `admin` requires `rbac:assignRoles`; echoed unchanged `admin` values on create/update do not.
- Permission resolver caches evict expired and overflow entries so distinct identities cannot grow unbounded.
- Clearing a role description in the admin UI sends `null` so PATCH removes the field.
- Admin User create rolls back the new row if `RoleManager.assign` fails after insert.
- `assign` / `unassign` refuse to change a user whose current permissions the actor does not hold.
- MCP model tools pick up TerrenoApp-injected `accessControl` (permissions, query filters, write masks) instead of keeping the pre-build legacy checks.
- Example todos Sync Lab panel starts collapsed so the first list row stays
  above the tab bar on short web viewports.
- `terreno-syncdb-codegen` rejects non-identifier collection/type names and
  JSON-escapes generated strings so a remote OpenAPI document cannot inject
  TypeScript.
- `@terreno/syncdb` no longer misses server changes that land between its startup snapshot
  and the socket joining a stream's room: each `sync:subscribed` confirmation now pages the
  streams it names from their cursor, instead of leaving the client stale until the next
  periodic reconcile

## [57.0.0] - 2026-08-20

Upgrade note: [`mcp-server/src/docs/upgrades/57.0.0.md`](mcp-server/src/docs/upgrades/57.0.0.md).

First stable release of the Expo SDK 57 line, cut from `master` after
[`#1065`](https://github.com/TerrenoLabs/terreno/pull/1065). Publishes to the npm
`latest` dist-tag. Apps on `0.x` should stay pinned until they upgrade Expo.

### Added

- `Filter` and its composable select, boolean, accordion, and change-badge controls in
  `@terreno/ui` for desktop web filtering flows
  ([#972](https://github.com/TerrenoLabs/terreno/pull/972))

### Changed

- Terreno's version major now tracks Expo SDK 57 (`57.x.y`). `npm install @terreno/ui`
  resolves to this line; pin `0.x` if the app has not upgraded Expo yet
  ([#1065](https://github.com/TerrenoLabs/terreno/pull/1065))
- Frontend peer/catalog stack moves to Expo SDK 57 / React Native 0.86.2
  (`expo ~57.0.14`, matching React Native DevTools and Hermes V1 fixes from
  `expo@57.0.9+`). React stays at `19.2.3`. Consuming apps should run
  `npx expo install expo@latest --fix` then rebuild native binaries
  ([#1065](https://github.com/TerrenoLabs/terreno/pull/1065))
- `@terreno/syncdb` bumps `tinybase` to `^9.5.1` for Expo SDK 57 /
  `expo-sqlite` type compatibility   ([#1065](https://github.com/TerrenoLabs/terreno/pull/1065))

## [57.0.0-beta.1] - 2026-08-20

Upgrade note: [`mcp-server/src/docs/upgrades/57.0.0-beta.1.md`](mcp-server/src/docs/upgrades/57.0.0-beta.1.md).

First beta of the Expo SDK 57 line, cut from `master` after merging
[`#1065`](https://github.com/TerrenoLabs/terreno/pull/1065). Publishes under the npm
`beta` dist-tag; `npm install @terreno/ui` still resolves to the stable `0.x` line.

### Added

- `Filter` and its composable select, boolean, accordion, and change-badge controls in
  `@terreno/ui` for desktop web filtering flows
  ([#972](https://github.com/TerrenoLabs/terreno/pull/972))

### Changed

- Terreno's version major now tracks Expo SDK 57 (`57.x.y`). The stable `0.x` packages are
  unaffected; this beta does not move `latest`
  ([#1065](https://github.com/TerrenoLabs/terreno/pull/1065))
- Frontend peer/catalog stack moves to Expo SDK 57 / React Native 0.86.2
  (`expo ~57.0.14`, matching React Native DevTools and Hermes V1 fixes from
  `expo@57.0.9+`). React stays at `19.2.3`. Consuming apps should run
  `npx expo install expo@latest --fix` then rebuild native binaries
  ([#1065](https://github.com/TerrenoLabs/terreno/pull/1065))
- `@terreno/syncdb` bumps `tinybase` to `^9.5.1` for Expo SDK 57 /
  `expo-sqlite` type compatibility ([#1065](https://github.com/TerrenoLabs/terreno/pull/1065))

## [56.0.0-beta.2] - 2026-08-17

Upgrade note: [`mcp-server/src/docs/upgrades/56.0.0-beta.2.md`](mcp-server/src/docs/upgrades/56.0.0-beta.2.md).

Second beta of the Expo SDK 56 line, cut from `master` after merging
[`#976`](https://github.com/TerrenoLabs/terreno/pull/976). Publishes under the npm
`beta` dist-tag; `npm install @terreno/ui` still resolves to the stable `0.x` line.

### Added

- Expo SDK 56 target for frontend packages: `expo ~56.0.12`, `react-native 0.85.3`,
  `react 19.2.3`, TypeScript 6
  ([#976](https://github.com/TerrenoLabs/terreno/pull/976))
- `@terreno/syncdb` local-first data layer (TinyBase MergeableStore, durable outbox,
  websocket delta sync, encrypted web persistence) plus `SyncApp` / sync protocol support
  in `@terreno/api`
  ([#976](https://github.com/TerrenoLabs/terreno/pull/976))
- `SyncStatusBanner` and `ConflictSheet` in `@terreno/ui` for sync UX
  ([#976](https://github.com/TerrenoLabs/terreno/pull/976))
- `@terreno/comms` with pluggable mail, SMS, push, and verification contracts, console
  development providers, delivery logging, owner-scoped push-token routes, an admin delivery
  explorer, and generated RTK Query hooks
  ([#1037](https://github.com/TerrenoLabs/terreno/pull/1037))

### Changed

- Terreno's version major now tracks the Expo SDK major it targets (`56.x.y` for Expo 56).
  The stable `0.x` packages are unaffected; this beta does not move `latest`
  ([#976](https://github.com/TerrenoLabs/terreno/pull/976))
- Frontend peer/catalog stack moves to Expo 56 / React Native 0.85 / React 19.2 /
  TypeScript 6 — consuming apps must upgrade Expo before installing this beta
  ([#976](https://github.com/TerrenoLabs/terreno/pull/976))
- `excludeArchivedPlugin` now filters `findOne` the same way as `find`, matching
  `isDeletedPlugin`
- Sync/REST CRUD executors preserve kebab-case error `code` values
  (`create-not-allowed`, `update-not-allowed`, `delete-not-allowed`,
  `invalid-request-body`) and status-specific error names on hook-rejection paths
- Publish workflow pins `@terreno/ui` to the release version for prerelease
  `admin-frontend` / `admin-spa` publishes (same as `ui` / `rtk`)
- Catalog `@shopify/react-native-skia` bumped to `2.6.5` (drops the postinstall that
  could hang `bun install --frozen-lockfile`); removed unused payment/native deps from
  `example-frontend`
- The `terreno-5-dialin` plugin skill now owns merge conflicts that appear after the
  Pour handoff: it checks PR mergeability each cycle, resolves conflicts by merging the
  base branch without rewriting pushed history, re-runs checks and frontend
  verification, and treats a conflicted PR as broken rather than mergeable
  ([#1039](https://github.com/TerrenoLabs/terreno/pull/1039))

### Fixed

- `generateTokens` in `@terreno/api` now logs and falls back to its default expiration when
  `TOKEN_EXPIRES_IN` or `REFRESH_TOKEN_EXPIRES_IN` is not a valid duration, instead of throwing
  from `jwt.sign`
- Sync seq claims under Mongoose 9: `claimSyncSeqs` passes `updatePipeline: true` for
  its aggregation-pipeline `findOneAndUpdate` (required after the master mongoose 9 merge)
- `RealtimeApp` accepts injectable `SocketServer` / `startChangeStreamWatcher` so setup
  tests no longer use process-wide `mock.module` (which broke socketAuth + sync integration)
- Mongoose 9 `insertMany` probe in `syncFrontier.test.ts` no longer calls removed `next()`
- Sync save error middleware: `throw` instead of `next(error)` under Mongoose 9/Kareem 3,
  and release pending seq claims on any failed claimed save (not only VersionError)
- Drop orphaned `ui` consent-history PDF test left after the move to `admin-frontend`

## [0.31.0] - 2026-08-11

Upgrade note: [`mcp-server/src/docs/upgrades/0.31.0.md`](mcp-server/src/docs/upgrades/0.31.0.md).

### Added

- `EditableCard` in `@terreno/ui`: a summary card with an optional icon, badge,
  description, helper text, edit button, and attention state
  ([#981](https://github.com/TerrenoLabs/terreno/pull/981))
- MIT `LICENSE` file in every published package, plus contribution guide, changelog,
  and GitHub issue/PR templates ([#985](https://github.com/TerrenoLabs/terreno/pull/985))
- Public roadmap generated from `docs/` into GitHub, with `roadmap:generate` /
  `roadmap:check` scripts and roadmap discussion setup
  ([#986](https://github.com/TerrenoLabs/terreno/pull/986), [#991](https://github.com/TerrenoLabs/terreno/pull/991))
- `check:upgrade-docs` release gate that fails a tagged publish when a release
  documents breaking, changed, deprecated, or removed behavior without an
  `mcp-server/src/docs/upgrades/<version>.md` note ([#987](https://github.com/TerrenoLabs/terreno/pull/987))
- Deployment foundation for GCP, deploy guides, and agentic SDLC plugin phase 1
  ([#988](https://github.com/TerrenoLabs/terreno/pull/988))
- Reference documentation for `@terreno/ai`, `@terreno/admin-spa`, and `@terreno/test`,
  plus full READMEs for `admin-backend`, `admin-frontend`, `ai`, and `api-health`
  ([#995](https://github.com/TerrenoLabs/terreno/pull/995))

### Changed

- Mongoose 9 support: the workspace runs on Mongoose 9.7.4 and every published
  package widens its `mongoose` peer dependency to `^8.0.0 || ^9.0.0`, so Mongoose 8
  consumers keep working ([#984](https://github.com/TerrenoLabs/terreno/pull/984))
- All published packages are MIT licensed; they were previously Apache-2.0
  ([#985](https://github.com/TerrenoLabs/terreno/pull/985))
- `modelRouter` accepts a wider Mongoose model generic, so models carrying custom
  query helpers, methods, or virtuals no longer need a cast ([#984](https://github.com/TerrenoLabs/terreno/pull/984))
- `findOneOrNoneFor` takes `ModelQuery<T>` instead of Mongoose's `FilterQuery<T>`
  ([#984](https://github.com/TerrenoLabs/terreno/pull/984))
- `@terreno/admin-backend` reads array field metadata through Mongoose's public
  `getEmbeddedSchemaType()` (falling back to the Mongoose 8 `caster`) and only emits
  `itemEnum` when the embedded enum is an array ([#984](https://github.com/TerrenoLabs/terreno/pull/984))
- Local development requires Node >= 20.19.0 ([#984](https://github.com/TerrenoLabs/terreno/pull/984))
- Positioning copy blocks and an honest framework comparison table
  ([#993](https://github.com/TerrenoLabs/terreno/pull/993))
- Implementation plans and program docs for the infrastructure MCP server, the B2B
  platform program, the IP + roadmap flow, and the RTK-to-syncdb migration strategy,
  with merged plans linked to their roadmap tracking issues
  ([#990](https://github.com/TerrenoLabs/terreno/pull/990), [#996](https://github.com/TerrenoLabs/terreno/pull/996), [#998](https://github.com/TerrenoLabs/terreno/pull/998), [#999](https://github.com/TerrenoLabs/terreno/pull/999), [#1028](https://github.com/TerrenoLabs/terreno/pull/1028))
- Test coverage, rule alignment, and explicit-any remediation across `api`, `ui`, and `rtk`
  ([#946](https://github.com/TerrenoLabs/terreno/pull/946), [#977](https://github.com/TerrenoLabs/terreno/pull/977), [#978](https://github.com/TerrenoLabs/terreno/pull/978), [#979](https://github.com/TerrenoLabs/terreno/pull/979), [#980](https://github.com/TerrenoLabs/terreno/pull/980), [#982](https://github.com/TerrenoLabs/terreno/pull/982), [#983](https://github.com/TerrenoLabs/terreno/pull/983), [#1000](https://github.com/TerrenoLabs/terreno/pull/1000), [#1001](https://github.com/TerrenoLabs/terreno/pull/1001), [#1002](https://github.com/TerrenoLabs/terreno/pull/1002))

### Fixed

- CI queues `terreno-example` EAS native builds only for new fingerprints
  ([#965](https://github.com/TerrenoLabs/terreno/pull/965))
- Keep the Dial In PR loop active through slow or pending CI, and only return
  broken checks when no autonomous action can advance them or user direction is
  required ([#1027](https://github.com/TerrenoLabs/terreno/pull/1027))
- Dial In preserves existing PR descriptions instead of overwriting them
  ([#1030](https://github.com/TerrenoLabs/terreno/pull/1030))

## [0.30.0] - 2026-08-03

Upgrade note: [`mcp-server/src/docs/upgrades/0.30.0.md`](mcp-server/src/docs/upgrades/0.30.0.md) (consolidated 0.21.0 → 0.30.0).

### Added

- `ThumbsUpDownFeedback` UI component ([#948](https://github.com/TerrenoLabs/terreno/pull/948))

### Fixed

- Pass `APIError` context through `modelRouter` without re-wrapping errors raised
  inside hooks or Mongoose middleware ([#967](https://github.com/TerrenoLabs/terreno/pull/967))
- `modelRouter` no longer drops `status`, `title`, `detail`, `code`, and `meta`
  when re-throwing an `APIError` from create/update/delete handlers, populate,
  `queryFilter`, list serialization, or array-operation paths
- Mongoose validation and cast errors from `modelRouter` writes surface per-field
  messages via `meta.fields` again instead of generic wrapper titles
- `queryFilter` wrapper details use readable message extraction instead of
  `String(error)`
- Framework-thrown errors follow the 0.28.0 contract: stable `title`, per-occurrence
  text in `detail`, kebab-case `code`, and status subclasses where applicable
- `apiUnauthorizedMiddleware` only matches plain `Error("Unauthorized")`, so a
  `ForbiddenError` titled `"Unauthorized"` stays 403

### Changed

- Add `errorDetail(error)` helper for nested `APIError` detail in framework wrappers
- Test coverage, rule alignment, and explicit-any remediation commits ([#959](https://github.com/TerrenoLabs/terreno/pull/959), [#963](https://github.com/TerrenoLabs/terreno/pull/963), [#968](https://github.com/TerrenoLabs/terreno/pull/968), [#969](https://github.com/TerrenoLabs/terreno/pull/969))

## [0.29.0] - 2026-07-31

### Added

- Typed and draw/type signature capture fields in `@terreno/ui` ([#958](https://github.com/TerrenoLabs/terreno/pull/958))
- Short-attention-span skill for action-first AI output ([#956](https://github.com/TerrenoLabs/terreno/pull/956))

## [0.28.0] - 2026-07-30

### Added

- Open source launch program: 15 implementation plans, task lists, and the
  `build-terreno-app` dogfooding skill ([#942](https://github.com/TerrenoLabs/terreno/pull/942))

### Changed

- Redesign `APIError` to use standard `Error` fields for Sentry grouping ([#949](https://github.com/TerrenoLabs/terreno/pull/949))
- Rename `SelectField` `searchable` prop to `disableSearch` ([#954](https://github.com/TerrenoLabs/terreno/pull/954))

### Fixed

- Queue only missing platform dev builds on EAS PR slow path ([#955](https://github.com/TerrenoLabs/terreno/pull/955))

## [0.27.0] - 2026-07-29

### Added

- Terreno-native agent skills (`building-terreno-apps`, `terreno-data-fetching`,
  `terreno-backend-api`, `terreno-ui`) ([#941](https://github.com/TerrenoLabs/terreno/pull/941))
- Explicit-any audit script for tracking `any` usage across the monorepo ([#927](https://github.com/TerrenoLabs/terreno/pull/927))
- RBAC permissions API design doc ([#887](https://github.com/TerrenoLabs/terreno/pull/887))

### Changed

- Document custom icon registration in `@terreno/ui` ([#910](https://github.com/TerrenoLabs/terreno/pull/910))
- Change example-backend seed admin user to `admin@example.com` (password
  unchanged) ([#935](https://github.com/TerrenoLabs/terreno/pull/935))
- Require frontend app login, feature exercise, and PR evidence in agent
  workflows ([#915](https://github.com/TerrenoLabs/terreno/pull/915))

### Fixed

- Fix `Modal` Confirm button on native Android tablets ([#952](https://github.com/TerrenoLabs/terreno/pull/952))
- Guard `@terreno/rtk` web tests against `IsWeb` platform mock leakage ([#934](https://github.com/TerrenoLabs/terreno/pull/934))

## [0.26.0] - 2026-07-15

### Added

- `IconButton` gains an `active` interaction state via `state?: "default" | "active"`
  ([#885](https://github.com/TerrenoLabs/terreno/pull/885))

### Changed

- Remove internal barrel imports; ban new internal barrel `index.ts` files via
  Biome lint and `check:no-barrel-imports` ([#907](https://github.com/TerrenoLabs/terreno/pull/907))
- Order Terreno planning skills by workflow step (`terreno-1-blend` through
  `terreno-5-dialin`) ([#900](https://github.com/TerrenoLabs/terreno/pull/900))

### Fixed

- Fix `Table`/`DataTable` preview cards on the demo home page rendering as a
  floating overlay ([#911](https://github.com/TerrenoLabs/terreno/pull/911))
- Fix demo, docs, and example-frontend production Netlify deploys silently
  no-opping on push to `master` ([#903](https://github.com/TerrenoLabs/terreno/pull/903))
- Fix duplicate `if` keys in example-app E2E and Admin SPA integration workflows
  ([#901](https://github.com/TerrenoLabs/terreno/pull/901))
- Stabilize AI and admin frontend test suites ([#902](https://github.com/TerrenoLabs/terreno/pull/902))

## [0.25.0] - 2026-07-12

### Added

- `@terreno/api`: HTTP client layer — `createAuthenticatedClient`,
  `normalizeApiError`, and `withApiErrorHandling` ([#870](https://github.com/TerrenoLabs/terreno/pull/870))
- `SelectField` / `WebDropdownMenu`: type-to-filter searchable dropdown
  ([#615](https://github.com/TerrenoLabs/terreno/pull/615))
- Demo AI palette generator (`/palette`) with WCAG contrast checks ([#863](https://github.com/TerrenoLabs/terreno/pull/863))

### Changed

- Add repo subagents and upgrade rulesync to v9 ([#892](https://github.com/TerrenoLabs/terreno/pull/892))
- Include run evidence (screenshots/videos) in PRs via submit and pour skills
  ([#871](https://github.com/TerrenoLabs/terreno/pull/871))

### Fixed

- `@terreno/api`: return `401` (not `500`) for auth failures in `bun build --compile`
  binaries ([#894](https://github.com/TerrenoLabs/terreno/pull/894))
- Website: prune docs versions correctly so `versions.json` stays valid ([#866](https://github.com/TerrenoLabs/terreno/pull/866))

## [0.24.0] - 2026-07-03

### Added

- `AiSuggestionBox`: `hidden` suggestion status, condensed collapsed states, race-safe
  expansion, and refreshed sparkles/thumbs visuals ([#865](https://github.com/TerrenoLabs/terreno/pull/865))

### Changed

- Test coverage and explicit-any remediation commits ([#852](https://github.com/TerrenoLabs/terreno/pull/852), [#851](https://github.com/TerrenoLabs/terreno/pull/851), [#861](https://github.com/TerrenoLabs/terreno/pull/861), [#862](https://github.com/TerrenoLabs/terreno/pull/862))

## [0.23.1] - 2026-07-02

### Added

- Architectural PR review workflow ([#844](https://github.com/TerrenoLabs/terreno/pull/844))

### Changed

- Document Cursor Cloud dev-environment setup for example-backend MongoDB ([#845](https://github.com/TerrenoLabs/terreno/pull/845))
- Demo Appium CI non-blocking unless a mobile build feature changes ([#846](https://github.com/TerrenoLabs/terreno/pull/846))
- Consolidate shared dependencies into Bun catalog ([#848](https://github.com/TerrenoLabs/terreno/pull/848))
- Align dev API port with docs; clear required on warning ([#842](https://github.com/TerrenoLabs/terreno/pull/842))

### Fixed

- Correct example-backend consent enum snapshot ordering ([#628](https://github.com/TerrenoLabs/terreno/pull/628))
- Fix lint regression and iOS Appium smoke timeout ([#843](https://github.com/TerrenoLabs/terreno/pull/843))
- Fix E2E todos web server startup in CI ([#811](https://github.com/TerrenoLabs/terreno/pull/811))
- Resolve UI and demo formatting CI failures ([#789](https://github.com/TerrenoLabs/terreno/pull/789))
- Stop Expo fingerprint churn forcing a native build on every PR ([#849](https://github.com/TerrenoLabs/terreno/pull/849))
- `Button`: use transparent background for ghost variant ([#858](https://github.com/TerrenoLabs/terreno/pull/858))

## [0.23.0] - 2026-06-26

### Added

- `@terreno/ui` compound components expose predictable dot-suffixed test IDs ([#832](https://github.com/TerrenoLabs/terreno/pull/832), [#840](https://github.com/TerrenoLabs/terreno/pull/840))
- Admin Script Runner CLI (`runScriptCli`, declared `args` on scripts) ([#828](https://github.com/TerrenoLabs/terreno/pull/828))
- Consent response list/read populate `userId`; `ConsentResponseViewer` user section
  ([#833](https://github.com/TerrenoLabs/terreno/pull/833))

### Changed

- Document `GCP_SA_*` service account secrets in cloud agent instructions ([#829](https://github.com/TerrenoLabs/terreno/pull/829))
- Add example-backend Script Runner CI workflow and CLI docs ([#828](https://github.com/TerrenoLabs/terreno/pull/828))

### Fixed

- Equalize `MarkdownEditor` edit and preview pane heights ([#831](https://github.com/TerrenoLabs/terreno/pull/831))

## [0.22.2] - 2026-06-24

### Fixed

- `@terreno/api`: declare `@terreno/test` as a runtime dependency so
  `@terreno/api/testing` resolves under isolated installs ([#827](https://github.com/TerrenoLabs/terreno/pull/827))

### Changed

- Publish `@terreno/feature-flags` for the first time since `0.21.0`; all packages
  move to `0.22.2` to stay in lockstep

## [0.22.1] - 2026-06-24

### Fixed

- `@terreno/test`: pin `qs` to `^6.14.1` instead of a missing `catalog:` entry so
  the publish workflow succeeds ([#824](https://github.com/TerrenoLabs/terreno/pull/824))

### Changed

- Publish `@terreno/test`, `@terreno/ai`, `@terreno/admin-backend`, and
  `@terreno/feature-flags` for the first time at `0.22.1`; all packages move to
  `0.22.1` to stay in lockstep

## [0.22.0] - 2026-06-24

### Added

- New `@terreno/test` package: shared Bun test helpers and in-memory MongoDB fixtures
  ([#822](https://github.com/TerrenoLabs/terreno/pull/822), [#823](https://github.com/TerrenoLabs/terreno/pull/823))
- `Button`: `ghost` variant and `sm` size; fix `outline` button height ([#816](https://github.com/TerrenoLabs/terreno/pull/816))
- `OpenApiMiddlewareBuilder.withOperationId()` for custom OpenAPI `operationId` ([#815](https://github.com/TerrenoLabs/terreno/pull/815))

### Changed

- Add SyncDB local-first data layer plan and tasks ([#739](https://github.com/TerrenoLabs/terreno/pull/739))

## [0.21.0] - 2026-06-22

Upgrade note: [`mcp-server/src/docs/upgrades/0.21.0.md`](mcp-server/src/docs/upgrades/0.21.0.md).

### Changed

- **Breaking:** `setupServer` removed — use `TerrenoApp` instead ([#795](https://github.com/TerrenoLabs/terreno/pull/795))
- **Breaking:** JSON object responses include `requestId` in the body ([#793](https://github.com/TerrenoLabs/terreno/pull/793))

### Added

- Admin UI v2 backend: `schemaVersion: 2` config, bulk-patch, background tasks ([#782](https://github.com/TerrenoLabs/terreno/pull/782))
- Traceable API logging: `createScopedLogger`, `createFeatureFlaggedLogger` ([#799](https://github.com/TerrenoLabs/terreno/pull/799))
- `Card` redesign: `container` and `display` variants ([#375](https://github.com/TerrenoLabs/terreno/pull/375))
- MCP documentation search: `terreno_search_docs`, `terreno_get_component_docs` ([#796](https://github.com/TerrenoLabs/terreno/pull/796))
- `@terreno/rtk` exports `devStore` utilities ([#782](https://github.com/TerrenoLabs/terreno/pull/782))

### Fixed

- Unblock Dependabot by upgrading `@terreno/ai` multer dependency ([#803](https://github.com/TerrenoLabs/terreno/pull/803))
- Fix CI: install workspace deps before Trigger EAS Workflow dispatch ([#805](https://github.com/TerrenoLabs/terreno/pull/805))

## [0.20.2] - 2026-06-17

### Changed

- Normalize `Badge` height to 20px; add Badge vs SelectBadge demo ([#751](https://github.com/TerrenoLabs/terreno/pull/751))

## [0.20.1] - 2026-06-16

### Added

- `@terreno/ui`: support registering custom icons ([#771](https://github.com/TerrenoLabs/terreno/pull/771))
- Expo skills for AI agents ([#777](https://github.com/TerrenoLabs/terreno/pull/777))
- Admin UI v2 IP with Django-style `home.slots` ([#775](https://github.com/TerrenoLabs/terreno/pull/775))
- `@terreno/ai`: export `./parseAiJson` subpath ([#783](https://github.com/TerrenoLabs/terreno/pull/783))

### Changed

- Normalize skill descriptions to single-line UI summaries ([#772](https://github.com/TerrenoLabs/terreno/pull/772))

### Fixed

- Restore demo CI ordering checks ([#770](https://github.com/TerrenoLabs/terreno/pull/770))
- Fix Appium dev-client smoke tests on Android and iOS ([#773](https://github.com/TerrenoLabs/terreno/pull/773))

## [0.16.0] - 2026-06-02

Historical `@terreno/api` release notes preserved from the former
`api/CHANGELOG.md` (packages now version in lockstep from 0.20.0 onward).

### Added

- **`modelRouter` actions** — `instanceActions` and `collectionActions` on
  `ModelRouterOptions` for named operations at `/resource/:id/action` and
  `/resource/action`
- **`loadDocOr404`** — shared document loader used by permission middleware and
  instance actions (soft-delete-aware 404 metadata preserved)

### Changed

- Permission middleware doc loading delegates to `loadDocOr404` (behavior-preserving)

### Dependencies

- Added `@asteasolutions/zod-to-openapi` ^8.5.0
- Added **`zod` ^4.3.6 as a peer dependency** for backends defining action Zod
  schemas

### Migration

- Regenerate frontend SDKs after adding actions; `operationId` values follow
  `{tag}_{actionName}` (e.g. `todos_markComplete`)

## [0.20.0] - 2026-06-14

Upgrade note: [`mcp-server/src/docs/upgrades/0.20.0.md`](mcp-server/src/docs/upgrades/0.20.0.md).

### Changed

- **Breaking:** `@terreno/api` `ConfigurationApp`: `POST {basePath}/list-secrets` is
  now read-only validation/status — it no longer resolves or returns secret values;
  `PATCH {basePath}` strips `secret: true` fields ([#768](https://github.com/TerrenoLabs/terreno/pull/768))
- **`configurationPlugin` no longer adds the `_singleton` unique index by default**
  — opt in via `enforceSingletonIndex: true`
- **`configurationPlugin` singleton semantics are soft-delete aware**
- **`configurationPlugin.updateConfig` applies updates via `findOneAndUpdate({$set})`
  with dotted paths** instead of `Object.assign` + `doc.save()`
- Prefix `terreno-planning` Cursor plugin skills with `terreno-` ([#764](https://github.com/TerrenoLabs/terreno/pull/764))
- Submit skill: merge-first PR body updates ([#765](https://github.com/TerrenoLabs/terreno/pull/765))

### Added

- `@terreno/api` configuration and secret upgrades: `CompositeSecretProvider`,
  `CachingSecretProvider`, pluggable `permissions`, `preUpdate`/`postUpdate` hooks,
  optional `version` on secret resolution ([#768](https://github.com/TerrenoLabs/terreno/pull/768))
- OpenFeature migration for feature flags: `MongoFeatureFlagProvider`,
  `GET …/flagConfiguration`, `useTerrenoFeatureFlags` hook ([#761](https://github.com/TerrenoLabs/terreno/pull/761))
- `SecretProvider.getSecret(secretName, version?)` and `flattenToDotPaths` export

### Deprecated

- Legacy `GET …/evaluate` feature-flag endpoint (sends `Deprecation`/`Sunset` headers)
  ([#761](https://github.com/TerrenoLabs/terreno/pull/761))

[57.0.0]: https://github.com/TerrenoLabs/terreno/releases/tag/57.0.0
[57.0.0-beta.1]: https://github.com/TerrenoLabs/terreno/releases/tag/57.0.0-beta.1
[56.0.0-beta.2]: https://github.com/TerrenoLabs/terreno/releases/tag/56.0.0-beta.2
[0.30.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.30.0
[0.29.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.29.0
[0.28.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.28.0
[0.27.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.27.0
[0.26.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.26.0
[0.25.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.25.0
[0.24.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.24.0
[0.23.1]: https://github.com/TerrenoLabs/terreno/releases/tag/0.23.1
[0.23.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.23.0
[0.22.2]: https://github.com/TerrenoLabs/terreno/releases/tag/0.22.2
[0.22.1]: https://github.com/TerrenoLabs/terreno/releases/tag/0.22.1
[0.22.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.22.0
[0.21.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.21.0
[0.20.2]: https://github.com/TerrenoLabs/terreno/releases/tag/0.20.2
[0.20.1]: https://github.com/TerrenoLabs/terreno/releases/tag/0.20.1
[0.20.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.20.0
[0.16.0]: https://github.com/TerrenoLabs/terreno/releases/tag/0.16.0
