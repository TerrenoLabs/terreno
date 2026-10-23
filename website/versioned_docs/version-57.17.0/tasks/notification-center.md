# Tasks: In-app notification center

IP: [notification-center.md](../implementationPlans/notification-center.md)  
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1179

**Feature profile:** false (full IP)

## Phase 1 — Tracer (inbox write + sync)

- [x] **Task 1.1**: Notification model + `NotificationsApp` + `notify()` inbox write
  - Delivers: `new NotificationsApp()` registers owner-scoped `/notifications` with `create: []`, `sync: {scope: {type: "owner"}}`, `isDeletedPlugin` + `syncPlugin`; `getNotificationService().notify({userId, title, body, href?, kind?})` inserts a row and change-stream/sync can see it; HTTP/sync create is 403/nack
  - Files: `api/src/models/notification.ts`, `api/src/types/notification.ts`, `api/src/notifications/notificationsApp.ts`, `api/src/notifications/notificationService.ts`, `api/src/notifications/notificationsApp.test.ts`, `api/src/index.ts`
  - Blocked by: none
  - Skills: `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`, `update-docs`
  - Docs: stub **In-app notifications** in `docs/reference/api.md` (do not mix with Slack/Zoom notifiers)
  - Acceptance: bun + supertest — `notify` creates one owner row; unauthenticated list 401; other user cannot read; POST `/notifications` 403 or disabled; every schema field has `description`

- [x] **Task 1.2**: Owner mark-read and dismiss
  - Delivers: `preUpdate` allows only `readAt` (ISO/date or `null`); `delete` soft-deletes; other fields in PATCH are stripped/rejected; unread query is `readAt` unset/null
  - Files: `api/src/notifications/notificationsApp.ts`, tests in `notificationsApp.test.ts`
  - Blocked by: 1.1
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: one sentence on patch/delete in the api.md stub
  - Acceptance: bun tests — PATCH `{readAt}` persists; PATCH `{title: "x"}` does not change title; DELETE hides from list; second user 403

## Phase 2 — Preferences, comms fan-out, retention

- [x] **Task 2.1**: Preference model + defaults + `notificationsBeforeSend`
  - Delivers: `NotificationPreference` unique `ownerId`, four booleans default true; missing row treated as all on; export duck-typed `notificationsBeforeSend({channel, userId})` that cancels when that boolean is false (`verification` channel never cancelled by this hook)
  - Files: `api/src/models/notificationPreference.ts`, `api/src/types/notificationPreference.ts`, preference router on `NotificationsApp`, tests
  - Blocked by: 1.1
  - Skills: `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`
  - Docs: prefs table in api.md stub
  - Acceptance: bun tests — no row → beforeSend does not cancel; `mail: false` → `{cancel: true}` for `channel: "mail"`; inapp false → `notify` does **not** insert a Notification

- [x] **Task 2.2**: Optional comms fan-out from `notify()`
  - Delivers: `NotificationsApp({getComms})`; after inbox write, call `sendMail` / `sendSms` / `sendPushToUser` when that pref is on and destination exists (email from User, phone if present on user, push via comms); missing `getComms` or missing destination skips that channel without failing `notify`; do not import `@terreno/comms` from `@terreno/api`
  - Files: `api/src/notifications/notificationService.ts`, tests with a fake `getComms`
  - Blocked by: 2.1
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: fan-out order in api.md
  - Acceptance: bun tests — fake mail called when pref on + email present; mail not called when pref off; `notify` resolves when `getComms` throws after inbox write (log `logger.error`, still return the notification id)

- [x] **Task 2.3**: Mark-all-read + `retainDays`
  - Delivers: `POST /notifications/mark-all-read` sets `readAt` on the caller's unread rows; `retainDays` default `0` (no sweep); `retainDays > 0` tombstones (`deleted`) rows with `created` older than N days (best-effort on `notify` and/or a small `sweepExpired()`); **no** Mongo TTL index
  - Files: `notificationsApp.ts`, `notificationService.ts`, tests
  - Blocked by: 1.2
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: `retainDays` default 0 in api.md
  - Acceptance: bun tests — mark-all-read only affects caller; retainDays 0 leaves old rows; retainDays 1 tombstones a row dated 2 days ago via Luxon; collection indexes do not include a TTL expireAfterSeconds on Notification

## Phase 3 — UI

- [x] **Task 3.1**: `NotificationBell` + `NotificationInbox`
  - Delivers: presentational components (no syncdb import); bell shows badge from `unreadCount`; inbox lists items, mark read/unread, dismiss, tap calls `onOpen`; empty and loading states; `testID`s
  - Files: `ui/src/NotificationBell.tsx`, `ui/src/NotificationInbox.tsx`, tests, `ui/src/index.tsx` exports
  - Blocked by: none
  - Skills: `terreno-ui`, `update-docs`, `verify-ui-changes`
  - Docs: stub props in `docs/reference/ui.md`
  - Acceptance: bun `ui` tests with `renderWithTheme`; badge hidden at 0; `onOpen` fired with the item; dismiss/mark callbacks fired

- [x] **Task 3.2**: `NotificationPreferences`
  - Delivers: four `BooleanField`s bound to `{inapp, mail, push, sms}`; `onChange` per channel
  - Files: `ui/src/NotificationPreferences.tsx`, test, export
  - Blocked by: none
  - Skills: `terreno-ui`
  - Docs: prefs props in ui.md
  - Acceptance: bun tests — toggling mail calls `onChange("mail", false)`

- [x] **Task 3.3**: Demo stories
  - Delivers: demoConfig entries with fixture unread/read items and prefs toggles
  - Files: `demo/stories/` + `demo/demoConfig.tsx` (or current demo registration)
  - Blocked by: 3.1, 3.2
  - Skills: `terreno-ui`, `verify-ui-changes`
  - Docs: none (4.1)
  - Acceptance: demo route renders bell + inbox + prefs without a backend

## Phase 4 — Example app + docs

- [x] **Task 4.1**: example-backend register + demo notify
  - Delivers: `NotificationsApp({getComms: getCommsService})`; compose `notificationsBeforeSend` into `CommsApp` `beforeSend`; authenticated demo route (follow `commsDev`) that `notify`s the current user
  - Files: `example-backend/src/server.ts`, `example-backend/src/api/` demo route + test
  - Blocked by: 2.2, 2.3
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: none (4.3)
  - Acceptance: bun tests — registered routes exist; demo notify 401 without auth; 200 with auth creates a row

- [x] **Task 4.2**: example-frontend syncdb + bell + prefs
  - Delivers: collections `notifications` and `notification-preferences`; bell on todos header; settings preferences screen; `onOpen` uses Expo Router for in-app `href`; optional “send test” calling the demo route
  - Files: `example-frontend/store/syncdb.ts` (codegen/list), todos screen, settings route, tests if present
  - Blocked by: 3.1, 3.2, 4.1
  - Skills: `terreno-data-fetching`, `terreno-ui`, `verify-ui-changes`, `generate-sdk` (only if a non-sync demo route needs SDK)
  - Docs: none (4.3)
  - Acceptance: `useQuery` lists notify rows after demo send; mark read persists; prefs toggle survives reload (syncdb); no new RTK CRUD hooks for the collection

- [x] **Task 4.3**: Diátaxis docs + rules + changelog
  - Delivers: `docs/how-to/in-app-notifications.md`; finish `docs/reference/api.md` and `docs/reference/ui.md`; `docs/reference/comms.md` beforeSend composition; `docs/how-to/README.md` link; `.rulesync/rules/api` mention + `bun run rules`; `changelog/unreleased/notification-center.md`
  - Files: those docs + rules
  - Blocked by: 4.2
  - Skills: `update-docs`
  - Docs: (this task)
  - Acceptance: a stranger can register the plugin and wire the bell from the how-to without reading the IP; website/how-to index lists the page
