# Implementation Plan: Comms adapter — Expo push notifications

**Status:** Complete — shipped in #1204
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1019
**Priority:** High
**Effort:** Small batch
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [comms-abstraction](comms-abstraction.md)
**RTK deprecation flag:** None — backend adapter; client token registration already exists

## Goal

Implement `PushProvider` on Expo's push service so `sendPushToUser` delivers real
notifications to iOS/Android devices. `expo-server-sdk` is already a dependency of
`@terreno/api` (currently unused — it moves to this adapter's peer deps); the client-side
token fetch (`getExpoPushTokenAsync`) already exists in `example-frontend/store/utils.ts`.

## Non-Goals

- Direct FCM/APNs integration (future adapter if demand appears).
- Notification center / inbox UI.
- Rich notification content (images, actions) beyond title/body/data/badge/sound.

## Decisions

| Question | Decision |
|----------|----------|
| SDK | `expo-server-sdk` as optional peer of `@terreno/comms` (subpath `adapters/expoPush`); removed from `@terreno/api` deps |
| Receipts | Poll receipts after send (Expo's required pattern); surface as `DeliveryEvent`s to `onDeliveryEvent` |
| Dead tokens | `DeviceNotRegistered` receipt → `SendResult.accepted: false` with permanent-failure marker so core pruning deactivates the `PushToken` |
| Chunking | Use the SDK's `chunkPushNotifications`; one `SendResult` per token preserved through chunks |

## Architecture

```typescript
// @terreno/comms/adapters/expoPush
export class ExpoPushProvider implements PushProvider {
  readonly id = "expo";
  constructor(options?: {accessToken?: string; receiptPollDelayMs?: number});
  sendPush(message: PushMessage): Promise<SendResult[]>;
}
```

Send flow: validate tokens with `Expo.isExpoPushToken` → chunk → send → collect tickets →
schedule one receipt poll (default 15 min, configurable; inline timer until `job-queues`
lands) → map receipt errors to `DeliveryEvent`s and permanent-failure results.

## Models

None new — uses `PushToken` and `CommsMessage` from the abstraction.

## APIs

None new.

## Notifications

This is the notification plumbing itself.

## UI

example-frontend: register the push token on login via `POST /comms/pushTokens` (guarded by
`expo-device` physical-device check once the native baseline lands) and a profile-screen
test-send row in dev builds.

## Phases

Single phase.

## Feature Flags & Migrations

None.

## Activity Log & User Updates

Sends and receipt failures logged to `CommsMessage`.

## Not Included / Future Work

- Queue-backed receipt polling (moves to `job-queues` when available).
- Web push (Expo tokens cover native only; web is a future adapter).

## Files to Create / Modify

- `comms/src/adapters/expoPush.ts` + tests (mock `Expo` client)
- `comms/package.json` — optional peer `expo-server-sdk`
- `api/package.json` — remove unused `expo-server-sdk`
- `example-frontend/app/(tabs)/profile.tsx`, `store/utils.ts` — token registration wiring
- `docs/reference/comms.md` — adapter section

## Task List

See [docs/tasks/comms-adapter-expo-push.md](../tasks/comms-adapter-expo-push.md).

## Acceptance Criteria

- [x] With a mocked Expo client, `sendPush` returns one `SendResult` per token across chunk
      boundaries.
- [x] A `DeviceNotRegistered` receipt deactivates the corresponding `PushToken` via core
      pruning.
- [x] Invalid tokens are rejected before hitting the SDK and logged as failed
      `CommsMessage` rows.
- [x] `@terreno/api` no longer lists `expo-server-sdk`; apps not using the adapter install
      nothing new.
- [x] example-frontend registers its token after login on a physical device build.
