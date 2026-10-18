# Implementation Plan: Pluggable communications layer (@terreno/comms)

**Status:** Approved — Phase 1 gap-fill implemented
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1018
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-08-09
**Approved:** 2026-08-20
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** none (inbound-webhooks is needed only by adapter delivery-callback phases)
**RTK deprecation flag:** None — backend-only package
**Shipped:** Phases 2–3 and most of Phase 1 in #1037; SendGrid adapter in #1050 (separate IP)
**Remaining:** none — Phase 1 gap-fill landed on this branch
**Research:** [comms-abstraction-research.md](comms-abstraction-research.md)

## Goal

Terreno backends cannot send email, SMS, or push notifications: there is no mail
integration at all, `expo-server-sdk` sits unused in `@terreno/api`, and the RTK client's
`resetPassword` call has no backend to talk to. This IP creates `@terreno/comms`, a new
workspace package that defines **provider interfaces** for the four outbound channels
(mail, SMS, push, OTP verification), a **`CommsApp`** TerrenoPlugin that registers
configured providers and exposes send services to routes and other plugins, **push-token
registration** routes and model, a **delivery log**, and **console adapters** so every
channel works in development with zero external accounts.

Concrete providers (Twilio, SendGrid, Expo push) are separate IPs — one per adapter — so
consumer apps install only the SDKs they use.

## Non-Goals

- Any concrete provider SDK integration (see `comms-adapter-*` IPs). The SendGrid adapter
  already lives at `@terreno/comms/adapters/sendgrid` under that IP; this IP does not own it.
- In-app notification center, inbox UI, or user notification preferences
  (`notification-center` item).
- Password reset / email verification flows (`password-reset-and-email-verification` item
  — a consumer of this layer).
- Inbound webhook HTTP handling (`inbound-webhooks` item); this IP ships
  `recordDeliveryEvent` / `recordOptOut` for adapters to call once those webhooks land.
- Broadcast/bulk campaign tooling.
- Admin retry UI and rich explorer filters ([comms-admin-dashboard](comms-admin-dashboard.md)).

## Decisions

| Question | Decision |
|----------|----------|
| New package or `@terreno/api` module? | New package `@terreno/comms`, mirroring `@terreno/feature-flags` — keeps provider SDKs out of the core dependency tree |
| How do provider SDKs stay optional? | Adapters live in subpath exports (`@terreno/comms/adapters/<name>`) with their SDKs as `peerDependencies` marked optional; core package has zero provider SDKs |
| Precedent to follow | `secretProviders.ts` (env + GCP behind one interface) and the OpenFeature provider in `@terreno/feature-flags` |
| Templates | Minimal: `{subject, text, html}` render helper with variable interpolation; no template builder |
| Where do send calls log? | `CommsMessage` Mongoose model, mirroring the `AIRequest.logRequest` pattern — logging failures never break the send |
| Dev experience | `ConsoleMailProvider` / `ConsoleSmsProvider` / `ConsolePushProvider` / `ConsoleVerificationProvider` print to logger and record to `CommsMessage`; default when no provider configured in non-production |
| Consumer lifecycle hooks | `CommsApp` options expose `beforeSend` / `onSend` / `onError` / `onRetry` / `onOptOut` / `onDeliveryEvent`. Hooks are awaited but wrapped: a throwing hook is logged (`logger.error`) and never breaks the send. `beforeSend` may mutate or cancel |
| Error taxonomy | Every `SendResult` failure carries `errorCode` (provider-native code as a string) and `errorClass` (`"permanent"` \| `"transient"` \| `"config"`). Adapters own the mapping; the facade uses `errorClass` to decide its single inline retry (transient only) and the admin dashboard uses it to gate manual retries |
| Payload retention | `retainPayloadDays` option (default 30) keeps the rendered message on the `CommsMessage` row (post `redactPayload` hook) so the admin dashboard can retry; a TTL-style cleanup clears expired payloads |
| `onRetry` signature (published) | Keep shipped `(context, result: SendResult)`. Put 1-based `attempt` on `CommsHookContext` (2 = the inline retry). Do not change the callback to `(context, attempt)` |
| Provider throws | Facade never rethrows from `sendMail` / `sendSms` / `sendPushToUser` / `startVerification` / `checkVerification`. A throwing provider becomes `errorClass: "transient"`, `errorCode: "provider-throw"`, then follows the same retry rules |
| Push retry | Retry **only tokens** whose first `SendResult` is `errorClass: "transient"` via a second `sendPush`; merge. Do not re-send accepted tokens |
| Push prune | Deactivate when `errorClass === "permanent"` **or** `isPermanentFailure === true` (shipped alias; adapters may set both) |
| Delivery / opt-out intake | `CommsService.recordDeliveryEvent` / `recordOptOut` update the matching log row (by `providerMessageId`) and invoke hooks. Missing rows: `logger.warn`, still fire the hook |
| Payload expiry | `payloadExpiresAt` on the row. Mongo TTL indexes must **not** be used (they would delete the log). `CommsMessage.clearExpiredPayloads()` unsets `payload` only; `logSend` / `appendAttempt` call it best-effort (limit 50) |
| `checkVerification` | Log a verification row; no inline retry; never persist the code |

## Architecture

```
@terreno/comms
  src/
    types.ts            # Provider interfaces + message/result types
    commsApp.ts         # CommsApp TerrenoPlugin
    commsService.ts     # send* + recordDeliveryEvent/recordOptOut
    models/
      commsMessage.ts   # Delivery log
      pushToken.ts      # Device push token registry
    routes/
      pushTokens.ts     # custom upsert/list/deactivate + owner read
      commsExplorer.ts  # Admin-only delivery log explorer
    adapters/
      console.ts        # Dev adapters for all four channels
    templates.ts        # renderTemplate({subject, text, html}, data)
```

### Provider interfaces (types.ts)

```typescript
export type CommsErrorClass = "config" | "permanent" | "transient";
export type CommsChannel = "mail" | "push" | "sms" | "verification";
export type CommsMessageStatus =
  | "bounced"
  | "cancelled"
  | "delivered"
  | "failed"
  | "sent";

export interface SendResult {
  providerMessageId?: string;
  accepted: boolean;
  error?: string;
  errorCode?: string;
  errorClass?: CommsErrorClass;
  isPermanentFailure?: boolean; // alias: treat as errorClass "permanent" when that is unset
  metadata?: Record<string, unknown>;
}

export interface MailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

export interface MailProvider {
  readonly id: string;
  sendMail(message: MailMessage): Promise<SendResult>;
}

export interface SmsProvider {
  readonly id: string;
  sendSms(message: {to: string; body: string}): Promise<SendResult>;
}

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: string | null;
}

export interface PushProvider {
  readonly id: string;
  sendPush(message: PushMessage): Promise<SendResult[]>; // one per token, same order
}

export interface VerificationProvider {
  readonly id: string;
  startVerification(options: {to: string; channel: "sms" | "email"}): Promise<SendResult>;
  checkVerification(options: {to: string; code: string}): Promise<{
    valid: boolean;
    error?: string;
  }>;
}

export interface DeliveryEvent {
  channel: "mail" | "sms" | "push";
  providerMessageId: string;
  status: "delivered" | "bounced" | "failed" | "opened";
  errorCode?: string;
  errorClass?: CommsErrorClass;
  raw?: unknown;
}

export interface CommsHookContext {
  channel: CommsChannel;
  provider: string;
  message?: MailMessage | {to: string; body: string} | PushMessage | {
    to: string;
    channel: "sms" | "email";
  };
  userId?: string;
  isRetry: boolean;
  attempt: number;          // 1 = first provider call, 2 = inline retry
  messageId?: string;       // CommsMessage._id once the log row exists
}

export interface OptOutEvent {
  channel: "mail" | "sms";
  to: string;
  provider: string;
  reason: string;           // e.g. "sms-stop", "unsubscribe", "spam-report"
  raw?: unknown;
}
```

Verification start attempts store `metadata.verificationChannel`. Recipients stay
redacted. Verification codes are never persisted.

### CommsApp (TerrenoPlugin)

```typescript
export interface CommsOptions {
  mail?: MailProvider;
  sms?: SmsProvider;
  push?: PushProvider;
  verification?: VerificationProvider;
  defaultFrom?: string;
  logMessages?: boolean;                      // default true
  retainPayloadDays?: number;                 // default 30; 0 stores no payload
  redactRecipients?: boolean;                 // default true — `to` at rest
  redactPayload?: (context: CommsHookContext, payload: unknown) => unknown;

  beforeSend?: (context: CommsHookContext) =>
    Promise<{cancel?: boolean; message?: CommsHookContext["message"]} | void>;
  onSend?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  onError?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  onRetry?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  onOptOut?: (event: OptOutEvent) => Promise<void>;
  onDeliveryEvent?: (event: DeliveryEvent) => Promise<void>;
}

new TerrenoApp({userModel: User})
  .register(new CommsApp({mail: new ConsoleMailProvider(), push: new ExpoPushProvider()}))
  .start();
```

`CommsApp.register()` mounts the push-token routes and admin explorer;
`getCommsService()` (module-level accessor) gives routes and other plugins `sendMail` /
`sendSms` / `sendPushToUser` / `startVerification` / `checkVerification` /
`recordDeliveryEvent` / `recordOptOut`. `sendPushToUser(userId, message)` resolves the
user's active `PushToken`s and prunes tokens the provider reports permanently dead.

Unconfigured channel behavior: in production, throw `APIError({status: 501, title:
"Comms channel not configured"})`; in development, fall back to the console adapter with a
`logger.warn`.

### Hook order and semantics

For every send (including the inline retry) the facade runs:

1. `beforeSend` — once, **before the first** provider call. May replace the message
   (`{message}`) or cancel (`{cancel: true}` → `CommsMessage` with `status: "cancelled"`,
   no provider call). Quiet hours, preferences, and suppression lists use this hook.
2. Provider `send*` → on `errorClass: "transient"` (or a wrapped provider throw),
   `onRetry(context, failedResult)` fires with `context.attempt === 2` and `isRetry: true`,
   then the facade retries once.
3. `onSend` (accepted) or `onError` (final failure) — `onError` receives the full
   `SendResult`.
4. Later, adapters call `recordDeliveryEvent` / `recordOptOut`, which fire
   `onDeliveryEvent` / `onOptOut`.

`checkVerification` skips `beforeSend` and inline retry. It still logs and fires
`onSend` / `onError`.

Hooks are observation and shaping points, not error channels: exceptions thrown inside a
hook are caught, logged with `logger.error`, and recorded in `CommsMessage.metadata.hookErrors`
— they never change the send outcome. A throwing `beforeSend` is treated as “no mutation,
do not cancel.”

### Attempt logging

One `CommsMessage` row per send invocation (not per retry):

1. After attempt 1, `logSend` creates the row (`attempts[0]`, `attemptCount: 1`).
2. After the inline retry, `appendAttempt` pushes `attempts[1]` and updates top-level
   `status`, `error`, `errorCode`, `errorClass`, `providerMessageId`, `attemptCount`,
   `lastAttemptAt`.
3. Cancelled sends create a row with `status: "cancelled"`, empty `attempts`, no provider.

`logSend` and `appendAttempt` never throw.

### Payload stored per channel

After `redactPayload` (identity if unset), when `retainPayloadDays > 0`:

| Channel | `payload` |
|---|---|
| mail | `{to, from, subject, text, html, replyTo, templateId, dynamicTemplateData}` |
| sms | `{to, body}` |
| push | `{title, body, data, badge, sound}` (tokens omitted) |
| verification start | `{channel}` only |
| verification check | none |
| cancelled | the mutated-or-original message, same shape as the channel |

`payloadExpiresAt = now + retainPayloadDays`. Expired payload is treated as absent for
retry even before cleanup runs.

## Models

All fields carry `description`; both models use `createdUpdatedPlugin` + `isDeletedPlugin`
and live per the five-type pattern (`CommsMessageDocument`, etc.).

**PushToken** — `userId` (ref User, required, indexed), `token` (string, required, unique),
`platform` ("ios" | "android" | "web"), `deviceId` (string, optional), `active` (boolean,
default true), `lastSeenAt` (date). Shipped.

**CommsMessage** — `channel` ("mail" | "sms" | "push" | "verification"), `provider`
(string), `to` (string, redacted-at-rest for sms/mail per option), `subject` (string,
optional), `userId` (ref User, optional), `status` ("sent" | "failed" | "delivered" |
"bounced" | "cancelled"), `providerMessageId` (string, indexed), `error` (string,
optional), `errorCode` (string, indexed), `errorClass` ("permanent" | "transient" |
"config"), `templateId` (string, optional), `attempts` (array of `{at, provider,
providerMessageId, errorCode, errorClass, error}` — one entry per facade attempt including
the inline retry), `attemptCount` (number), `lastAttemptAt` (date), `retriedFromId` /
`retriedById` (ref CommsMessage — written later by admin-dashboard retries; schema exists
now), `payload` (Mixed, retained per `retainPayloadDays` after `redactPayload`, cleared on
expiry), `payloadExpiresAt` (date), `metadata` (Mixed). Statics: `logSend()`,
`appendAttempt()`, `clearExpiredPayloads()`.

These fields exist so the [comms-admin-dashboard](comms-admin-dashboard.md) IP can filter
on error codes/classes, show per-attempt history, and re-send from the retained payload
without any further schema changes.

## APIs

| Method | Path | Permissions | Notes |
|---|---|---|---|
| POST | `/comms/pushTokens` | IsAuthenticated | Upsert by `token`; sets `userId`, `platform`, `lastSeenAt` |
| GET | `/comms/pushTokens` | IsOwner via queryFilter | List own device tokens |
| DELETE | `/comms/pushTokens/:id` | IsOwner | Deactivate on logout/uninstall |
| GET | `/comms/messages` | IsAdmin | Paginated delivery log explorer; filters: `channel`, `status`, `userId`, date range |

Push token registration, owner-scoped list, and deactivation use dedicated handlers because
`modelRouter` create cannot provide idempotent upsert semantics and `OwnerQueryFilter` targets a
persisted `ownerId` while `PushToken` persists `userId`. Owner read remains on `modelRouter`.
The explorer uses `createOpenApiBuilder`, modeled on `addAiRequestsExplorerRoutes`, and is
deliberately minimal here — the [comms-admin-dashboard](comms-admin-dashboard.md) IP upgrades it
with error-code/class filtering, free-text search, a detail route, stats, and retry endpoints.

No HTTP routes for `recordDeliveryEvent` / `recordOptOut` in this IP.

## Notifications

None beyond the feature itself.

## UI

None in this IP. example-frontend gains a settings row that registers the Expo push token
(client helper already exists in `store/utils.ts`) once the Expo adapter lands.

## Phases

1. **Package + contracts:** `@terreno/comms` package scaffold, `types.ts`, console
   adapters, `CommsMessage` + logging, `commsService`, unit tests.
   **Shipped** including dashboard-ready fields, hooks, payload retention, and
   channel-wide transient retry.
2. **CommsApp + routes:** plugin registration, `PushToken` model + routes, admin explorer,
   OpenAPI, supertest coverage. **Shipped.**
3. **Integration:** example-backend registers `CommsApp` (console adapters), seed docs,
   `docs/reference/comms.md`, catalog entries, publish wiring in `publish-on-tag.yml`.
   **Shipped.**

## Feature Flags & Migrations

None. New collections only; no existing data touched. Remaining schema fields are additive
on `CommsMessage` (`cancelled` status value, `attempts`, payload fields, retry refs).

## Activity Log & User Updates

Every send attempt is a `CommsMessage` row (that is the audit surface). No user-facing
updates.

## Not Included / Future Work

- Adapter IPs: `comms-adapter-expo-push`, `comms-adapter-twilio-sms`,
  `comms-adapter-twilio-verify`, `comms-adapter-sendgrid` (Phase 1 of SendGrid already
  shipped).
- Admin operations dashboard (rich filtering, log digging, manual retries) —
  [comms-admin-dashboard](comms-admin-dashboard.md); this IP only ships the fields and
  hooks it needs.
- Notification center, user notification preferences (`beforeSend` is the extension
  point they will plug into).
- Queue-backed sending with automatic scheduled retries — arrives with `job-queues`;
  until then sends are inline with one transient-error retry plus manual admin retries.
- Webhook HTTP for delivery callbacks — `inbound-webhooks` plus adapter Phase 2.

## Files to Create / Modify

Remaining roast (gap-fill):

- `comms/src/types.ts`, `commsService.ts`, `models/commsMessage.ts`, `modelTypes.ts`
- Tests for hooks, retry-per-channel, attempts, payload expiry
- `docs/reference/comms.md`, `.rulesync/rules/comms/00-comms.md` (then `bun run rules`)

Already shipped:

- `comms/` package scaffold, console adapters, `CommsApp`, routes, CI/publish
- Root `package.json` scripts, example-backend registration

## Task List

See [docs/tasks/comms-abstraction.md](../tasks/comms-abstraction.md).

## Acceptance Criteria

- [x] A Terreno app with only console adapters can call `sendMail`, `sendSms`,
      `sendPushToUser`, and `startVerification`/`checkVerification` in development, each
      producing a logger line and a `CommsMessage` row.
- [x] `beforeSend` can cancel and mutate; `onSend`/`onError` fire with the final
      `SendResult`; `onRetry` fires on the inline transient retry with
      `context.attempt === 2` — and a hook that throws is logged without changing the send
      outcome (test per hook, including `onOptOut` / `onDeliveryEvent` via the record
      methods).
- [x] Failed sends record `errorCode` and `errorClass` on both the `SendResult` and the
      `CommsMessage` row; only `transient` failures trigger the inline retry; provider
      throws become transient and do not propagate.
- [x] `CommsMessage.attempts` holds one entry per attempt with per-attempt error data;
      `payload` is retained post-redaction and cleared after `retainPayloadDays`.
- [x] `POST /comms/pushTokens` registers a device token for the authenticated user;
      re-posting the same token updates rather than duplicates; other users cannot list or
      delete it.
- [x] `GET /comms/messages` is admin-only, paginated, and filterable by channel and status.
- [x] Production apps with an unconfigured channel get a 501 `APIError`, not a silent no-op.
- [x] `@terreno/comms` core has zero provider SDKs in `dependencies`.
- [x] All routes appear in `/openapi.json` and the generated SDK compiles.
- [x] Push retries re-send only transient-failed tokens; permanent failures deactivate
      tokens via `errorClass` or `isPermanentFailure`.
- [x] `recordDeliveryEvent` updates status by `providerMessageId`; `recordOptOut` fires
      `onOptOut` without sending.

## Named assumptions (finish pass)

1. Original Decisions table stands; remaining work implements the IP rather than shrinking
   it to today’s partial code.
2. Published `onRetry(context, result)` stays; `attempt` is added on context.
3. Roadmap issue #1018 already exists; Blend does not open a second issue. Maintainer can
   move Project status when roast of remaining tasks starts.
