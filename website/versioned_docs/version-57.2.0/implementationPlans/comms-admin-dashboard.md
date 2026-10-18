# Implementation Plan: Comms admin dashboard (errors, retries, log digging)

**Status:** Draft
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1091
**Priority:** High
**Effort:** Medium batch
**Owner:** unassigned
**Created:** 2026-08-11
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [comms-abstraction](comms-abstraction.md) (Phases 1–2, including the hook + error-taxonomy additions); adapters optional but the dashboard is most useful once [comms-adapter-twilio-sms](comms-adapter-twilio-sms.md) and [comms-adapter-sendgrid](comms-adapter-sendgrid.md) land
**RTK deprecation flag:** Partial — screens use the generated SDK; migrate with syncdb like other admin screens

## Goal

Make the admin panel the single place to **operate** the comms layer: see errors and
failure rates at a glance, filter and dig into individual delivery logs (attempt history,
provider error codes, raw provider metadata), and retry failed sends with one click —
across every channel and provider, without touching Twilio/SendGrid consoles or raw Mongo.

The comms-abstraction IP ships a minimal read-only `GET /comms/messages` explorer. This IP
upgrades that into a real operations dashboard, following the same pattern the AI package
uses (`addAiRequestsExplorerRoutes`) but with mutation (retry) and much richer filtering.

## Non-Goals

- Building the messages themselves (comms-abstraction) or provider integrations (adapter
  IPs).
- Charts beyond simple count cards — themed chart components arrive with
  `charts-and-dashboards`; the stats endpoint is designed so charts can be added then.
- Broadcast/bulk *composition* from admin (sending new messages, campaign tooling).
- User-facing notification history (`notification-center` item).
- Cross-service log aggregation (Sentry/Cloud Logging stay the deep-debug tools; the
  dashboard links out via `providerMessageId`).

## Decisions

| Question | Decision |
|----------|----------|
| Where do the routes live? | `@terreno/comms` (`src/routes/commsDashboard.ts`) — they operate on `CommsMessage`, which the comms package owns. `@terreno/admin-backend` stays model-generic |
| Where does the UI live? | `@terreno/admin-frontend` (`CommsDashboard*` components), rendered inside `AdminShellLayout` like the rest of the admin panel, and wired into example-frontend + admin-spa |
| Retry semantics | Retry creates a **new** `CommsMessage` row linked back via `retriedFromId`; the original row is never mutated except `retriedById`. Sends go through the normal `commsService` facade so hooks, logging, and error taxonomy all apply |
| What is retryable? | `status: "failed" \| "bounced"` **and** `errorClass !== "permanent"` (permanent failures — invalid number, unsubscribed, suppressed address — get a disabled button with the reason) **and** a retained payload exists. `verification` channel is never retryable (codes expire; users restart the flow) |
| Payload retention for retry | `CommsApp` option `retainPayloadDays` (default 30) keeps the rendered message body on the `CommsMessage` row, passed through the `redactPayload` hook before storage; without a retained payload the retry button is disabled with the reason |
| Filtering | Server-side query params, not client-side table filtering — delivery logs get large. Free-text `q` matches `subject`, `error`, and `to` (last-4 for redacted destinations) |
| Bulk retry | `POST /comms/messages/retryMany` takes the same filter object as the list route plus a hard cap (default 100 per call) so an admin can re-drive an outage window without scripting |
| Stats | One aggregation endpoint with day buckets per channel/provider/status; rendered as count cards now, charts later |

## Architecture

```
@terreno/comms
  src/routes/commsDashboard.ts   # list/detail/retry/retryMany/stats (replaces commsExplorer.ts)
  src/commsService.ts            # retryMessage({messageId, req}) added to the facade

@terreno/admin-frontend
  src/comms/CommsDashboardScreen.tsx   # cards + filter bar + DataTable
  src/comms/CommsMessageDetail.tsx     # attempt timeline + raw metadata + retry
  src/comms/CommsStatusBadge.tsx       # status → Badge mapping
  src/comms/useCommsDashboardApi.tsx   # RTK Query hooks (pattern: useAdminApi)
```

### Retry flow

```
Admin clicks Retry
  → POST /comms/messages/:id/retry (IsAdmin)
  → commsService.retryMessage: validates retryability, loads retained payload
  → normal send path (beforeSend/onSend/onError hooks fire with isRetry: true)
  → new CommsMessage row {retriedFromId: original._id}
  → original row gets {retriedById: new._id}
  → response returns the new row; UI navigates to it
```

## Models

No new models. Uses the `CommsMessage` fields added by the comms-abstraction IP
(`errorCode`, `errorClass`, `attempts[]`, `attemptCount`, `lastAttemptAt`,
`retriedFromId`, `retriedById`, `templateId`, retained `payload`).

## APIs

All routes `Permissions.IsAdmin`, built with `createOpenApiBuilder`, in `/openapi.json`.

| Method | Path | Notes |
|---|---|---|
| GET | `/comms/messages` | Paginated list. Filters: `channel`, `provider`, `status`, `errorClass`, `errorCode`, `userId`, `to`, `templateId`, `retriedFromId`, `startDate`, `endDate`, free-text `q`; sort `-created` default |
| GET | `/comms/messages/:id` | Full detail: attempts array, raw provider `metadata`, retained payload (post-redaction), linked retry rows |
| POST | `/comms/messages/:id/retry` | Re-send; 400 with a stable `code` (`comms-retry-not-retryable`, `comms-retry-payload-expired`, `comms-retry-channel-unconfigured`) when not retryable |
| POST | `/comms/messages/retryMany` | Body: same filter object as list + `limit` (cap 100); returns `{retried, skipped: [{id, reason}]}` |
| GET | `/comms/stats` | Aggregation: counts by `channel` × `provider` × `status` with day buckets over `startDate`/`endDate` (default 7d); includes failure rate per provider |

## Notifications

None. (A failure-rate alert notifier is Future Work — see below.)

## UI

All screens live in `@terreno/admin-frontend`, use `@terreno/ui` components only, and
render on the `AdminShellLayout` canvas (`Page` with `color="transparent"`, `padding={0}`).

- **`CommsDashboardScreen`**
  - Summary `Card` row from `/comms/stats`: sent / delivered / failed / bounced for the
    selected range, failure rate per provider, with an error-colored card when the failure
    rate exceeds 5%.
  - Filter bar: `SelectField`s for channel/provider/status/errorClass, `TextField`
    (search icon) for `q`, `DateTimeField` pair for the range. Filters map 1:1 to list
    query params and persist in the URL so views are shareable.
  - `DataTable`: created, channel, provider, to (redacted), subject/preview, status
    (`CommsStatusBadge`), errorCode, attemptCount; row click → detail; inline Retry
    `IconButton` on retryable rows.
  - Loading, error, and empty states per admin-frontend conventions.
- **`CommsMessageDetail`**
  - Header: status badge, channel/provider, recipient, timestamps, linked user
    (`AdminRefField` → User), `retriedFromId`/`retriedById` links.
  - **Attempt timeline**: one row per `attempts[]` entry — timestamp, provider,
    `providerMessageId` (rendered as an external link to the provider console when the
    adapter supplies `consoleUrl` in metadata), errorCode + error message.
  - **Log digging**: collapsible JSON viewer (`Accordion` + `MarkdownView` code block) for
    retained payload and raw provider `metadata` — everything the adapter recorded, post
    redaction.
  - **Retry** `Button` (`withConfirmation`) — disabled with a tooltip reason when not
    retryable.

## Phases

1. **Backend routes:** upgrade the explorer to `commsDashboard.ts` (filters, detail,
   stats), `retryMessage` on the facade, retry + retryMany routes, supertest coverage for
   every filter and every non-retryable reason.
2. **Admin screens:** `CommsDashboardScreen`, `CommsMessageDetail`, badge + hooks; wire
   into example-frontend admin routes and admin-spa nav; regenerate SDK; frontend
   verification with screenshots.
3. **Bulk retry + docs:** `retryMany` UI (filtered "Retry all failed" with count
   confirmation), `docs/reference/comms.md` dashboard section, rulesync.

## Feature Flags & Migrations

None. New routes and screens only; `CommsMessage` fields ship in comms-abstraction.

## Activity Log & User Updates

Every retry is itself a `CommsMessage` row (with `retriedFromId` and the acting admin in
`metadata.retriedByUserId`), so the audit trail is the same surface the dashboard shows.

## Not Included / Future Work

- Failure-rate alerting (Slack/Google Chat notifier when a provider's failure rate spikes)
  — small follow-up once `/comms/stats` exists.
- Charts on the stats endpoint (`charts-and-dashboards`).
- Editing a message before retry ("retry with edits").
- Automatic scheduled retries with backoff — arrives with `job-queues`; this IP is
  explicitly *manual, admin-driven* retry.

## Files to Create / Modify

- `comms/src/routes/commsDashboard.ts` (+ tests) — replaces `commsExplorer.ts`
- `comms/src/commsService.ts` — `retryMessage`
- `admin-frontend/src/comms/*` (+ tests)
- `example-frontend/app/admin/comms/*` — routes; `store/openApiSdk.ts` via `bun run sdk`
- `admin-spa` — nav entry
- `docs/reference/comms.md`, `docs/reference/admin.md`

## Task List

See [docs/tasks/comms-admin-dashboard.md](../tasks/comms-admin-dashboard.md).

## Acceptance Criteria

- [ ] An admin can filter delivery logs by channel, provider, status, error class, error
      code, user, recipient, template, date range, and free text — server-side, paginated.
- [ ] The detail view shows every attempt with timestamp, provider message id, error code
      and message, plus the raw provider metadata and retained payload in a JSON viewer.
- [ ] Retry re-sends through the configured provider, creates a linked `CommsMessage` row,
      fires the normal lifecycle hooks with `isRetry: true`, and records the acting admin.
- [ ] Non-retryable messages (permanent failure, expired payload, unconfigured channel,
      verification channel) show a disabled retry with the specific reason; the route
      returns 400 with the matching stable error `code`.
- [ ] `retryMany` re-drives at most the cap per call and reports skipped ids with reasons.
- [ ] `/comms/stats` counts match the filtered list totals for the same range.
- [ ] All routes are `IsAdmin`; non-admin requests get 403 (supertest coverage).
- [ ] Screens verified in the running example app with screenshots attached to the PR.
