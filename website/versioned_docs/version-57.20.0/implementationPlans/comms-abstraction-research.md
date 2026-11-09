# Research: comms-abstraction (finish pass)

**Date:** 2026-08-20
**Scope:** Reconcile the Draft IP with shipped `@terreno/comms` and name remaining roast work.

## Shipped (do not re-plan)

- Package scaffold, console adapters, `CommsApp`, `getCommsService()`, `PushToken` + routes,
  `GET /comms/messages`, example-backend registration, CI/publish, reference docs, rules.
- PRs: #1037 (foundation), #1050 (SendGrid adapter — owned by `comms-adapter-sendgrid`).
- `SendResult.errorCode` / `errorClass` exist; `CommsMessage` stores them.
- Mail-only inline retry on `errorClass: "transient"`.
- Partial hooks: `onSend`, `onError`, `onRetry`, `onDeliveryEvent` (the last is never invoked).
- Recipients redacted at rest (`redactRecipients`, default true).
- Push pruning uses `isPermanentFailure`, not `errorClass`.

## Gaps vs original IP (remaining)

| Contract | IP | Code today |
|---|---|---|
| `beforeSend` mutate/cancel | specified | missing |
| `onOptOut` / `OptOutEvent` | specified | missing |
| `recordDeliveryEvent` / `recordOptOut` | implied (adapters feed events) | missing; `onDeliveryEvent` dead |
| `CommsHookContext` | message, userId, isRetry, messageId | `{channel, provider, isRetry?}` |
| `onRetry` | `(context, attempt)` | `(context, result)` — **keep shipped signature** |
| Inline retry | all send paths | mail only; SMS/push/verification rethrow |
| `attempts[]`, payload, retry links | dashboard-ready fields | missing |
| `status: cancelled` | specified | not in enum |
| Push prune | permanent failure | `isPermanentFailure` only |

## Options considered (finish pass)

Remaining work keeps the original IP as the contract. Shrink-to-code was rejected: the
admin-dashboard IP depends on attempt history, payload retention, and `beforeSend`. A
follow-up IP was rejected: the fields were already in this plan.

Non-breaking choices for a published package:

- Keep `onRetry(context, result)`; put `attempt` on `CommsHookContext`.
- Keep `isPermanentFailure` as an adapter alias; facade also prunes on `errorClass: "permanent"`.
- Unify provider throws to `SendResult` (no rethrow) so retry can run on every channel.

## References

- `comms/src/types.ts`, `commsService.ts`, `models/commsMessage.ts`
- [comms-admin-dashboard.md](comms-admin-dashboard.md)
- [comms-adapter-sendgrid.md](comms-adapter-sendgrid.md)
- Roadmap: https://github.com/TerrenoLabs/terreno/issues/1018
