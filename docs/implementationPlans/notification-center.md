# Implementation Plan: In-app notification center

**Status:** Complete — shipped in #1307  
**Branch:** `cursor/notification-center-ip-b11f`  
**Owner:** —  
**Created:** 2026-09-10  
**Approved:** 2026-09-10  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1179 (this feature **closes** that issue; implementation PRs use `Fixes #1179`)  
**Task list:** [notification-center.md](../tasks/notification-center.md)  
**Depends on:** [comms-abstraction](comms-abstraction.md) (shipped)  
**RTK deprecation flag:** Partial — inbox is a syncdb collection; no new RTK CRUD hooks  
**Program:** [B2B platform](b2b-platform-program.md)  

## Goal

Apps can show an in-app inbox next to `@terreno/comms` mail/SMS/push. Registering
`NotificationsApp` on `TerrenoApp` adds owner-scoped `Notification` and
`NotificationPreference` models, a server `notify()` that writes the inbox and fans out
to enabled comms channels, and `@terreno/ui` bell / inbox / preferences surfaces wired
through syncdb in the example app.

## Non-Goals

- Preference **categories** (marketing vs system). v1 is four channel toggles only.
- Client-authored inbox rows (`create: []` on the notification router).
- Owner edits to `title` / `body` / `href` / `kind`.
- Broadcast or fan-out to all users.
- Email digests, admin notification templates, org-scoped inboxes.
- Forced `Linking.openURL` for taps.
- New Socket.io event types or `modelRouter.realtime` (removed in Terreno 58).
- Making `@terreno/ui` depend on `@terreno/syncdb` or `@terreno/comms`.
- `@terreno/api` depending on `@terreno/comms` (comms already depends on api).

## Decisions

| Question | Decision |
|----------|----------|
| Package | **`NotificationsApp` in `@terreno/api`** (ConsentApp pattern). UI in `@terreno/ui`. No new workspace package. Comms stays outbound adapters. |
| Inbox transport | Synced collections, `sync: {scope: {type: "owner"}}`. Live updates via existing `RealtimeApp` `sync:delta`. Hooks: `useQuery` / `useMutate`. |
| Create | Router `create: []`. Only `getNotificationService().notify(...)` (and tests) insert rows. Direct `Model.create` from app code is not the public seam. |
| Owner patch | `preUpdate` keeps `readAt` and `archivedAt` (set or `null`). Dismiss archives via `archivedAt` so the row stays in syncdb. `deleted` is retention-only. |
| Preferences | One `NotificationPreference` per user: `inapp`, `mail`, `push`, `sms`. Missing row = all **on**. |
| `notify()` | Writes inbox if `inapp` is on; then `sendMail` / `sendSms` / `sendPushToUser` when that channel is on **and** a destination exists. Missing email/phone/tokens skip that channel; inbox write still succeeds. Direct `sendMail` still works; prefs apply only if the app registers `notificationsBeforeSend`. |
| Comms hook | `@terreno/api` exports a duck-typed `notificationsBeforeSend({channel, userId})` (no import of comms types). Apps pass it as `CommsApp({beforeSend})`. Compose if the app already has a hook. |
| Tap | Optional `href` on the row. UI calls `onOpen(notification)`. Example-frontend routes internal paths; does not call `Linking.openURL` by default. |
| Retention | `NotificationsApp({retainDays?: number})` default **`0`** (keep). `retainDays > 0` tombstones (`deleted`) rows older than that; no Mongo TTL index (hard delete breaks syncdb). |
| Mark all read | `POST /notifications/mark-all-read` (authenticated, owner filter) sets `readAt` on unread rows; change streams update clients. |
| UI split | Presentational components receive data and callbacks. Example-frontend supplies them with syncdb hooks; the demo uses fixtures. |
| Admin | No dedicated admin explorer in this IP. Consumer may add the models to `AdminApp` later. |
| Kind | Optional `kind` string on `notify()` / the document for icons; **not** used for preferences. |

## Architecture

```
notify({userId, title, body, href?, kind?})
  → load NotificationPreference (defaults all on)
  → if inapp: Notification.create({ownerId: userId, ...})  // syncPlugin stamps _syncSeq
  → if mail  && email:  getCommsService().sendMail(...)     // optional; skip if no comms
  → if sms   && phone:  getCommsService().sendSms(...)
  → if push:            getCommsService().sendPushToUser(...)

RealtimeApp change stream → sync:delta → useQuery("notifications")

CommsApp({beforeSend: notificationsBeforeSend})
  → cancel send when prefs.<channel> === false
```

`@terreno/api` must not import `@terreno/comms`. Fan-out uses an optional
`getComms?: () => {sendMail; sendSms; sendPushToUser}` passed into `NotificationsApp`.
example-backend passes `getCommsService`.

### Models

**Notification** (`ownerId`, `title`, `body`, `href?`, `kind?`, `readAt?`)

- Plugins: `createdUpdatedPlugin`, `isDeletedPlugin`, `syncPlugin`, `findExactlyOne` / `findOneOrNone`.
- Index: `{ownerId: 1, created: -1}`.
- Every field has `description`.

**NotificationPreference** (`ownerId` unique, `inapp`, `mail`, `push`, `sms` default true)

- Same plugins. Synced owner scope so the preferences screen is local-first.
- Client **may** create/update this collection (upsert defaults). Unique `ownerId`.

### APIs

| Method | Path | Permissions | Notes |
|---|---|---|---|
| — | `GET/PATCH/DELETE /notifications/:id` + list | list/read: authenticated + owner filter; update: owner; delete: owner; **create: []** | `modelRouter` + `sync: {scope: {type: "owner"}}` |
| POST | `/notifications/mark-all-read` | IsAuthenticated | Sets `readAt` now on owner's unread, non-deleted rows |
| — | preference CRUD | owner + sync owner | Create allowed (lazy defaults) |
| service | `notify(input)` | server only | Public TypeScript seam |

`preUpdate` on notifications: drop every key except `readAt`. Invalid `readAt` (non-date / non-null) → 400.

### UI

| Component | Role |
|---|---|
| `NotificationBell` | Icon button + unread badge; opens inbox sheet/dropdown |
| `NotificationInbox` | List unread/read; mark read/unread; dismiss; tap → `onOpen` |
| `NotificationPreferences` | Four `BooleanField` toggles |

Props take data + callbacks (`items`, `unreadCount`, `onMarkRead`, `onDismiss`, `onOpen`, `preferences`, `onChangePreference`). No syncdb import in `@terreno/ui`.

### Example app

- Register `NotificationsApp` + pass `getCommsService`.
- `CommsApp({beforeSend: notificationsBeforeSend})` composed with any existing hook.
- Authenticated demo `POST` (pattern: `commsDev`) to call `notify()` for the current user.
- `example-frontend`: add collections to syncdb; bell on the todos screen header; settings preferences route; `onOpen` uses Expo Router when `href` is an in-app path.

## Notifications

This IP **is** the notification system. No extra product pings required to ship it.

## Phases

1. **Backend tracer:** models, `notify()` inbox write, owner read/update/delete, sync, tests.
2. **Prefs + comms:** preference document, `notificationsBeforeSend`, optional comms fan-out, mark-all-read, `retainDays`.
3. **UI + demo:** presentational components, stories, tests.
4. **Example + docs:** example-backend/frontend, Diátaxis pages, rules, changelog.

## Feature Flags & Migrations

None. New collections only. `retainDays` default 0 so existing (empty) data is never tombstoned.

## Activity Log & User Updates

Inbox rows are the user-visible audit. Comms sends still log `CommsMessage`. Do not duplicate comms explorer here.

## Not Included / Future Work

- Category matrix and marketing defaults.
- Broadcast / topics / org inbox (`org-management-ui`).
- Digest email job (`job-queues`).
- Admin templates and a notification explorer (`comms-admin-dashboard` stays delivery logs).
- Client create for “reminders I wrote myself”.

## Files to Create / Modify

**Create**

- `api/src/notifications/notificationsApp.ts`
- `api/src/notifications/notificationService.ts`
- `api/src/models/notification.ts`, `notificationPreference.ts`
- `api/src/types/notification.ts`, `notificationPreference.ts`
- matching `*.test.ts`
- `ui/src/NotificationBell.tsx`, `NotificationInbox.tsx`, `NotificationPreferences.tsx` + tests
- `docs/how-to/in-app-notifications.md`
- `demo/stories/NotificationCenter.stories.tsx` (or equivalent demoConfig entry)

**Modify**

- `api/src/index.ts` exports
- `example-backend/src/server.ts` (register plugin + beforeSend)
- `example-frontend` sync collections, todos header, settings
- `docs/reference/api.md` (new **In-app notifications** section; do not overload Webhooks & Notifications)
- `docs/reference/ui.md`, `docs/reference/comms.md` (beforeSend composition)
- `docs/how-to/README.md`
- `.rulesync/rules/api/00-api.md` (then `bun run rules`)
- `changelog/unreleased/`

## Task List

See [docs/tasks/notification-center.md](../tasks/notification-center.md).

## Acceptance Criteria

- [ ] `notify()` inserts an owner-scoped row when `inapp` is on; no row when the user turned in-app off.
- [ ] Sync create of `notifications` is rejected; mark read and dismiss work; `sync:delta` delivers new rows.
- [ ] `notificationsBeforeSend` cancels mail/SMS/push when that toggle is off.
- [ ] `notify()` still writes inbox if comms is unregistered or a channel destination is missing.
- [ ] `retainDays: 0` keeps rows; `retainDays > 0` tombstones old rows without a Mongo TTL index.
- [ ] Bell shows unread count; inbox mark/dismiss/open; preferences persist via syncdb in example-frontend.
- [ ] Docs: how-to + api reference + ui props; comms beforeSend note; issue 1179 closable.

## Risks

| Risk | Mitigation |
|---|---|
| `create: []` blocks `notify()` if someone uses the HTTP/sync mutate path only | `notify()` uses the Mongoose model (syncPlugin still stamps `_syncSeq`) |
| api ↔ comms cycle | Optional `getComms` callback; duck-typed beforeSend |
| Hard-delete TTL breaks snapshot catch-up | Tombstone via `isDeletedPlugin` only |
| PHI in `body` | Owner scope + optional `retainDays`; no admin list in v1 |
