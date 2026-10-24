# @terreno/comms e2e tests

Run the comms smoke after a compile:

```bash
bun run compile && bun run --cwd comms smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | `CommsService` send, retry, hooks, and logging; each adapter against an injected client; push-token and dashboard routes; and Twilio and SendGrid webhooks, through supertest against in-memory Mongo (`src/**/*.test.ts`) | `bun run comms:test` |
| Smoke | The compiled package sending mail from a real server and recording delivery from a signed webhook | `bun run --cwd comms smoke` |
| E2E | The admin comms dashboard loading and its back navigation, in example-frontend's Playwright suite against example-backend (`admin-comms-back.spec.ts`) | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`comms/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/comms/e2e/smoke.ts)
runs at the `http` layer. It re-runs itself with a `serve` argument to start a child process
that imports the compiled `@terreno/api` and `@terreno/comms` by package name and listens on a
`freePort()` against `smokeMongoUri()`. The child builds a `TerrenoApp` with:

- `UserModel` from `@terreno/api/testing`, with one seeded admin. Signup never grants `admin`,
  and the dashboard needs it.
- `CommsApp` with `SendGridMailProvider` on an in-memory client in place of `@sendgrid/mail`.
  The client returns a SendGrid-style 202 with an `x-message-id`, so no request leaves the
  machine and no SendGrid key is needed.
- `WebhooksApp` with the memory idempotency store. The parent generates an ECDSA P-256 key pair
  and passes the public key as `SENDGRID_WEBHOOK_VERIFICATION_KEY`, so `CommsApp` registers the
  SendGrid Event Webhook route.
- One smoke-only `modelRouter` collection action, `POST /commsSmoke/sendMail`, that calls
  `getCommsService().sendMail()` the way app code does.

The parent waits for `/health` with `spawnUntilReady`, then checks over real HTTP:

1. `POST /auth/login` signs the admin in.
2. `POST /commsSmoke/sendMail` returns an accepted send with a `loggedMessageId` and the
   in-memory client's message id.
3. `GET /comms/messages/:id` shows the row as a `sendgrid` mail message with status `sent`.
4. `POST /comms/webhooks/sendgrid` with a signed `delivered` event returns 200.
5. `GET /comms/messages/:id` shows the same row with status `delivered`.

It prints one `✅` line per check and exits 1 on the first failure, after printing the
server's output. A compiled `recordDeliveryEvent` that stops writing the status fails check 5.
The admin email and message ids carry a per-run id, so the smoke reruns cleanly against a
persistent `TERRENO_TEST_MONGODB_URI`.

**Measured time:** about 6 s against an external replica set (`TERRENO_TEST_MONGODB_URI`) and
17–21 s with the in-memory replica set, excluding the compile. Budget: 30 s.

## Add an e2e test

- **New adapter, hook, or route behavior:** add a unit test next to the code in `comms/src/`.
  The smoke stays one happy path; do not add edge cases to it.
- **The send-to-delivered path changed** (the `SendResult` shape, the message log, or webhook
  intake): update the checks in `comms/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible flow** (for example, a dashboard screen): add a Playwright spec in
  `example-frontend/e2e/`, following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec), with the provider wired into
  example-backend.

See [the `@terreno/comms` reference](../../reference/comms.md) for the plugin API and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
