# @terreno/comms

Provider-agnostic transactional communications for Terreno backends. The core package defines
mail, SMS, push, and verification contracts without installing SendGrid, Twilio, or Expo SDKs.

## Install

```bash
bun add @terreno/comms
```

Peer dependency: `mongoose ^8.0.0 || ^9.0.0`.

## Register the plugin

```typescript
import {
  CommsApp,
  ConsoleMailProvider,
  ConsolePushProvider,
  ConsoleSmsProvider,
  ConsoleVerificationProvider,
} from "@terreno/comms";
import {TerrenoApp} from "@terreno/api";

new TerrenoApp({userModel: User})
  .register(
    new CommsApp({
      defaultFrom: "notifications@example.com",
      mail: new ConsoleMailProvider(),
      push: new ConsolePushProvider(),
      sms: new ConsoleSmsProvider(),
      verification: new ConsoleVerificationProvider(),
    })
  )
  .start();
```

Console providers log only non-sensitive metadata such as message lengths and recipient counts.
They never log message content, recipient identifiers, push tokens, or verification codes.

## Send messages

Use the registered service from routes, jobs, or other plugins:

```typescript
import {getCommsService} from "@terreno/comms";

await getCommsService().sendMail({
  subject: "Welcome",
  text: "Thanks for joining.",
  to: "person@example.com",
});

await getCommsService().sendSms({
  body: "Your appointment is tomorrow.",
  to: "+15555550100",
});
```

`sendPushToUser()` resolves active device tokens and deactivates tokens when
`errorClass` is `"permanent"` or `isPermanentFailure` is `true`. Provider throws become
`errorClass: "transient"` with `errorCode: "provider-throw"` and never reject the
`CommsService` promise. Transient failures retry once (`onRetry` with
`context.attempt === 2`); push retries only the failed tokens. `checkVerification()` does
not retry.

`beforeSend` may mutate the message or cancel (`status: "cancelled"`, no provider call).
A throwing `beforeSend` is logged and treated as no-op (send continues). Adapters later
call `recordDeliveryEvent()` / `recordOptOut()` to update the log and fire
`onDeliveryEvent` / `onOptOut`.

### Notification preferences hook

When you register `NotificationsApp`, compose `notificationsBeforeSend` from `@terreno/api`
into `CommsApp({beforeSend})` so outbound mail, SMS, and push respect per-user channel
toggles. Missing `NotificationPreference` rows default to all channels on. The
`verification` channel is never cancelled by this hook.

```typescript
import {notificationsBeforeSend} from "@terreno/api";

new CommsApp({
  beforeSend: async (context) => {
    const pref = await notificationsBeforeSend({
      channel: context.channel,
      userId: context.userId,
    });
    if (pref?.cancel) {
      return {cancel: true};
    }
    return existingBeforeSend?.(context);
  },
});
```

`getNotificationService().notify()` fans out to comms independently. Register this hook and
pass `{userId}` as the second argument to direct `sendMail` / `sendSms` calls so they honor
preferences; `sendPushToUser` already supplies its user id.

```typescript
await getCommsService().sendMail(message, {userId});
await getCommsService().sendSms(message, {userId});
```

Each send stores one `CommsMessage` row with `attempts[]`. Rendered payloads are retained
for `retainPayloadDays` (default 30, `0` disables) after `redactPayload`. Mail payloads
keep `to`, `from`, `subject`, `text`, `html`, `replyTo`, `templateId`, and
`dynamicTemplateData`. SMS payloads keep `to` and `body`. Push payloads omit tokens.
Verification start stores `{channel}` only; verification checks store no payload.
`recordDeliveryEvent` writes `status`, `errorCode`, and `errorClass` onto the matching
row (`opened` does not change status). Missing rows log a warning and still fire the hook.
A failed row save logs a warning and **throws** so webhook claims can release and retry.

## Provider contracts

| Interface | Method |
|---|---|
| `MailProvider` | `sendMail(message)` |
| `SmsProvider` | `sendSms(message)` |
| `PushProvider` | `sendPush(message)` — one `SendResult` per token |
| `VerificationProvider` | `startVerification(options)`, `checkVerification(options)` |

Concrete SendGrid, Twilio, and Expo providers are separate adapter packages/subpath exports. Core
`@terreno/comms` has no concrete provider SDK dependencies.

### SendGrid mail adapter

```bash
bun add @sendgrid/mail
```

```typescript
import {TerrenoApp, WebhooksApp} from "@terreno/api";
import {CommsApp} from "@terreno/comms";
import {SendGridMailProvider} from "@terreno/comms/adapters/sendgrid";

const webhooks = new WebhooksApp();

new TerrenoApp({userModel: User})
  .register(
    new CommsApp({
      defaultFrom: "notifications@example.com",
      mail: new SendGridMailProvider({
        // apiKey defaults to process.env.SENDGRID_API_KEY (required)
        fromEmail: "notifications@example.com",
        fromName: "Terreno",
        // sandboxMode defaults to true when NODE_ENV === "test"
        // webhookVerificationKey defaults to SENDGRID_WEBHOOK_VERIFICATION_KEY
      }),
      webhooks,
      onError: async (_context, result) => {
        console.error("mail failed", result.errorCode, result.errorClass);
      },
    })
  )
  .register(webhooks)
  .start();
```

`SendGridMailProvider` fails fast at construction when `SENDGRID_API_KEY` (or `apiKey`) is
missing. Send-time failures never throw through `sendMail`; they return
`accepted: false` with `errorCode` / `errorClass` (`permanent` | `transient` | `config`).
Transient failures are retried once by `CommsService`. Accepted sends store the SendGrid
`x-message-id` and a `metadata.consoleUrl` Email Activity deep link on the `CommsMessage`
row.

**Sender verification checklist (SendGrid):**

1. Create an API key with Mail Send permission.
2. Verify the from domain (or single sender) in SendGrid.
3. Confirm the from address matches a verified identity.
4. Use sandbox mode in CI/tests so no real mail is delivered.

Pass the same `WebhooksApp` into `CommsApp` **before** registering it. With
`SendGridMailProvider` this mounts `POST {basePath}/webhooks/sendgrid` (default
`/comms/webhooks/sendgrid`). The handler verifies ECDSA (`SENDGRID_WEBHOOK_VERIFICATION_KEY`
or constructor `webhookVerificationKey`), claims each `sg_event_id`, correlates
`sg_message_id` prefixes to stored `x-message-id`, and maps `delivered` / `bounce` /
`dropped` / `open` plus opt-outs (`spamreport`, `unsubscribe`, `group_unsubscribe`).
Missing verification key skips the route and logs an error. Full operator setup is in
the inbound webhooks how-to.

### Twilio SMS adapter

```bash
bun add twilio
```

```typescript
import {TerrenoApp, WebhooksApp} from "@terreno/api";
import {CommsApp} from "@terreno/comms";
import {TwilioSmsProvider} from "@terreno/comms/adapters/twilioSms";

const webhooks = new WebhooksApp();

new TerrenoApp({userModel: User})
  .register(
    new CommsApp({
      sms: new TwilioSmsProvider({
        // accountSid / authToken default to TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
        // Prefer TWILIO_MESSAGING_SERVICE_SID; fall back to TWILIO_FROM_NUMBER
      }),
      webhookPublicUrl: process.env.PUBLIC_API_URL,
      webhooks,
      onError: async (_context, result) => {
        console.error("sms failed", result.errorCode, result.errorClass);
      },
    })
  )
  .register(webhooks)
  .start();
```

Pass the same `WebhooksApp` into `CommsApp` **before** `webhooks` is registered so the
plugin can add routes, then mount it. With `TwilioSmsProvider` this registers
`POST {basePath}/webhooks/twilio/status` and `POST {basePath}/webhooks/twilio/inbound`
(default `basePath` `/comms`). Status callbacks map `delivered` / `undelivered` /
`failed` (including `ErrorCode` `21610` → `permanent`) onto `CommsMessage`. Inbound
`STOP` / `START` call `recordOptOut` with `reason: "sms-stop"` / `"sms-start"`.
`statusCallbackUrl` defaults to the public status URL. Missing auth token or public URL
(`webhookPublicUrl`, `PUBLIC_API_URL`, or `COMMS_WEBHOOK_PUBLIC_URL`) skips those routes
and logs an error. Full operator setup is in the inbound webhooks how-to.

`TwilioSmsProvider` fails fast at construction when account SID or auth token is missing.
Destinations are normalized to E.164 with `libphonenumber-js`; invalid numbers return
`accepted: false` with `errorClass: permanent` and `errorCode: twilio-invalid-destination`
before any Twilio call, so the facade does not retry. Send failures never throw through
`sendSms`; they return `accepted: false` with Twilio `errorCode` / `errorClass`
(`permanent` | `transient` | `config`). Permanent codes (including 21610 STOP) are not
retried. Accepted sends store `providerMessageId` and `metadata.consoleUrl` for the
Twilio SMS log.

The example backend registers this adapter when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
and a sender (`TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`) are set. A sender
without credentials throws at startup. Account credentials without a sender skip SMS so
Verify-only configs can share `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. Unconfigured
environments keep the console SMS provider (or omit SMS in production). `twilio` is an
optional peer — apps that do not send SMS do not install it. Apps that ship
`bun build --compile` (the example Cloud Run image) must inject a Twilio client
(static `import twilio from "twilio"`). The adapters' default
`createRequire("twilio")` is not bundled into that binary.

### Twilio Verify adapter

```bash
bun add twilio
```

```typescript
import {CommsApp} from "@terreno/comms";
import {TwilioVerifyProvider} from "@terreno/comms/adapters/twilioVerify";

new TerrenoApp({userModel: User})
  .register(
    new CommsApp({
      verification: new TwilioVerifyProvider({
        // accountSid / authToken default to TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
        // verifyServiceSid defaults to TWILIO_VERIFY_SERVICE_SID
      }),
    })
  )
  .start();
```

`TwilioVerifyProvider` fails fast at construction when account SID, auth token, or
`TWILIO_VERIFY_SERVICE_SID` is missing. `startVerification` supports `sms` and `email`.
`checkVerification` returns `valid: true` only for Verify status `approved`; `pending`,
`expired`, and max-attempt states return `valid: false` with those reasons. Start failures
are classified (`config` / `transient` / `permanent`) and never throw through the facade.
Verification `CommsMessage` rows redact the destination, never store the OTP, and are not
retryable from admin. Accepted starts store `metadata.consoleUrl` for the Verify service.

The example backend registers this adapter when `TWILIO_VERIFY_SERVICE_SID` is set together
with `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`. A verify service SID without those
credentials throws at startup. Unconfigured environments keep the console verification
provider (or omit verification in production). Verify's email channel needs a Twilio Verify
email integration; that setup is not automated.

### Expo push adapter

```bash
bun add expo-server-sdk
```

```typescript
import {CommsApp, getCommsService} from "@terreno/comms";
import {ExpoPushProvider} from "@terreno/comms/adapters/expoPush";

new TerrenoApp({userModel: User})
  .register(
    new CommsApp({
      push: new ExpoPushProvider({
        // accessToken defaults to process.env.EXPO_ACCESS_TOKEN (optional)
        onDeadToken: async (token) => {
          await getCommsService().deactivatePushToken(token);
        },
        onDeliveryEvent: async (event) => {
          await getCommsService().recordDeliveryEvent(event);
        },
      }),
    })
  )
  .start();
```

`ExpoPushProvider` validates tokens with `Expo.isExpoPushToken`, chunks with
`chunkPushNotifications`, and returns one `SendResult` per input token. Invalid tokens
never hit the Expo API (`errorCode: expo-invalid-token`, `errorClass: permanent`).
Ticket `DeviceNotRegistered` is a permanent failure so `sendPushToUser` deactivates the
`PushToken`. `MessageTooBig` is `errorClass: config`: the send fails and is not retried,
but the token stays active. Successful tickets schedule one receipt poll (default 15
minutes, `receiptPollDelayMs`) that emits `DeliveryEvent`s; a later `DeviceNotRegistered`
receipt calls `onDeadToken`. `EXPO_ACCESS_TOKEN` is optional (higher Expo rate limits).

Apps that ship `bun build --compile` (the example Cloud Run image) must inject
an `Expo` client (static `import {Expo} from "expo-server-sdk"`). The adapter's
default `createRequire("expo-server-sdk")` is not bundled into that binary.

example-frontend requests notification permission, then `getExpoPushTokenAsync`, then
`POST /comms/pushTokens` after login. Denied permission and web skip registration (empty
token). Physical-device gating via `expo-device` is deferred until the native baseline
lands. The profile **Send test push** card is `__DEV__` only, so production web exports
(CircleCI Playwright) do not render it.

## Configuration

```typescript
interface CommsAppOptions {
  basePath?: string; // default: "/comms"
  beforeSend?: (context: CommsHookContext) =>
    Promise<{cancel?: boolean; message?: CommsHookMessage} | undefined>;
  defaultFrom?: string;
  logMessages?: boolean; // default: true
  mail?: MailProvider;
  onDeliveryEvent?: (event: DeliveryEvent) => Promise<void>;
  onError?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  onOptOut?: (event: OptOutEvent) => Promise<void>;
  onRetry?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  onSend?: (context: CommsHookContext, result: SendResult) => Promise<void>;
  push?: PushProvider;
  redactPayload?: (context: CommsHookContext, payload: unknown) => unknown;
  redactRecipients?: boolean; // default: true
  retainPayloadDays?: number; // default: 30; 0 stores no payload
  sms?: SmsProvider;
  verification?: VerificationProvider;
}
```

When a channel is unconfigured:

- non-production environments use the matching console provider and emit a warning;
- production throws a `501` `APIError` titled `Comms channel not configured`.

Delivery attempts are stored in `CommsMessage`. Recipient values are stored as `[redacted]` unless
`redactRecipients` is explicitly `false`. Rendered payloads are retained for `retainPayloadDays`
(default 30) after `redactPayload`; expired payloads are unset without deleting the log row.
Mail payloads keep `to`, `from`, `subject`, `text`, `html`, `replyTo`, `templateId`, and
`dynamicTemplateData`. SMS payloads keep `to` and `body`. Verification start keeps `{channel}`
only; verification checks store no payload. `recordDeliveryEvent` writes `status`, `errorCode`,
and `errorClass` onto the matching row (`opened` does not change status). Missing rows warn;
save failures throw after a warning so inbound webhook claims can retry.

`beforeSend` may replace the message or cancel the send (`status: "cancelled"`). `onSend` and
`onError` fire after every channel outcome. `onRetry` fires once before the inline retry when
`errorClass` is `"transient"` (`context.attempt === 2`; shipped signature is `(context, result)`).
Throwing hooks are logged and never change the send outcome. Exception text stays in logs;
`metadata.hookErrors` records only `hook-threw` per hook name. Adapters should call
`recordDeliveryEvent()` and `recordOptOut()` rather than invoking those hooks directly.

Provider throws become `{accepted: false, errorClass: "transient", errorCode: "provider-throw"}`.
Permanent and config failures are not retried. Push retries re-send only the tokens whose first
result was transient; tokens are deactivated when `errorClass` is `"permanent"` or
`isPermanentFailure` is true. Each push token gets its own hook context (`attempt`, `isRetry`,
`messageId`).

## Routes

The default `basePath` is `/comms`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/comms/pushTokens` | Authenticated | Register or refresh a device token |
| `GET` | `/comms/pushTokens` | Authenticated owner | List the current user's tokens |
| `GET` | `/comms/pushTokens/:id` | Owner | Read one token |
| `DELETE` | `/comms/pushTokens/:id` | Owner | Deactivate a token |
| `GET` | `/comms/messages` | Admin | Filtered, paginated delivery log. Query: `channel`, `provider`, `status`, `errorClass`, `errorCode`, `userId`, `to`, `templateId`, `retriedFromId`, `startDate`, `endDate`, free-text `q`, `page`, `limit` |
| `GET` | `/comms/messages/:id` | Admin | Full row: attempts, metadata, retained payload, retry links, `retryable` / `retryDisabledReason` |
| `POST` | `/comms/messages/:id/retry` | Admin | Re-send through the facade. Creates a linked row. 400 codes: `comms-retry-not-retryable`, `comms-retry-payload-expired`, `comms-retry-channel-unconfigured` |
| `POST` | `/comms/messages/retryMany` | Admin | Same filters as list plus `limit` (cap 100). Returns `{retried, skipped: [{id, reason}]}` |
| `GET` | `/comms/stats` | Admin | Counts by channel × provider × status with day buckets. Default range 7d. Includes per-provider failure rate |

An active token cannot be claimed by another user. After its owner deactivates it, another
authenticated user on the same device may register it.

## Admin dashboard

`CommsApp.adminContribution()` registers a custom screen named `comms` with the sidebar label **Comms Dashboard**. `@terreno/admin-frontend` ships `COMMS_ADMIN_WIDGETS` (`CommsDashboardScreen`, `CommsMessageDetail`) and hosts wire:

- example-frontend: `/admin/comms` and `/admin/comms/[id]`
- admin-spa: `/comms` and `/comms/[id]`

Filters persist in the URL. List, stats, and bulk retry use the same match: when no dates are set, both the table and the cards use the trailing 7 days (labeled **Last 7 days**). Editing any filter while those dates are still implicit writes both bounds into the URL so the other bound is not dropped. `beforeSend` cancel on push attaches `loggedMessageId` the same way mail and SMS do. Created and attempt times print in the operator's locale (`DateTime.DATETIME_MED`), not UTC ISO. Inline and detail Retry create a new `CommsMessage` and navigate to it. **Retry matching** confirms the filtered list count (capped at 100) then posts `retryMany`.

Run `bun run backend:seed` from the repository root to populate the example dashboard with 10 current, idempotent delivery logs across mail, SMS, push, and verification. The sample includes delivered, sent, failed, bounced, and cancelled states so stats, provider breakdowns, filters, and retry controls are visible immediately.

## Templates

`renderTemplate()` replaces top-level `{{variable}}` placeholders in `subject`, `text`, and `html`.
Missing or inherited properties render as empty strings.

```typescript
const message = renderTemplate({
  data: {name: "Ada"},
  template: {
    subject: "Welcome, {{name}}",
    text: "Hello {{name}}",
  },
});
```

Auth mail helpers `renderAuthMail()` and `DEFAULT_AUTH_MAIL_TEMPLATES` render reset and
verify links as `${publicAppUrl}/resetPassword?token=...` and
`${publicAppUrl}/verifyEmail?token=...`. Pass `templates` to override subject/text/html
per template id (`resetPassword` | `verifyEmail`). Variables: `resetUrl`, `verifyUrl`,
`publicAppUrl`, `token`.
