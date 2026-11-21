# Pluggable file storage, an upload field, and three more email adapters

Terreno ships file handling and email, but both assume one vendor. Files go to Google Cloud Storage from two places that share no code, and email goes out through SendGrid or to the console. An adopter on AWS, Cloudflare, Fly, a laptop, or an EU mail provider has to write that plumbing before a first avatar upload or a first password-reset email works. This plan adds one storage contract with four adapters (memory, local disk, GCS, S3-compatible), moves the two existing GCS users onto it, adds a small upload primitive (signed upload routes, a client hook and a UI field), and adds SMTP, Resend and SES mail adapters behind the mail seam that already exists. It comes from findings 6.2 and 6.3 of the 2026-11-12 codebase audit, which ranks these as the cheapest "table stakes" gaps for getting an app off the ground outside GCP. The rest of the audit's missing-features list (6.5–6.10 and the "Also absent" items) has no task list here: it is ranked under Expansions as a backlog, and whether that is acceptable is the one question this plan brings to the owner (Q8).

This file holds the plan and the task list. It follows the dated `docs/plans/` convention the two most recent plans use (`2026-11-01-sqlite-mongoose-driver.md`, `2026-11-02-admin-spa-ssr.md`), not the older `docs/implementationPlans/` + `docs/tasks/` pair.

## The idea

**Storage.** A `StorageAdapter` interface lives in `@terreno/api` (`api/src/storage/`):

```typescript
export interface StorageObject {
  contentType?: string;
  key: string;
  size: number;
  /** ISO 8601. */
  updated?: string;
}

export interface StorageAdapter {
  readonly id: string;
  createReadStream(args: {key: string}): Readable;
  delete(args: {key: string}): Promise<void>;
  get(args: {key: string}): Promise<Buffer>;
  getSignedUrl(args: {
    action: "read" | "write";
    contentType?: string;
    expiresInSeconds: number;
    key: string;
  }): Promise<string>;
  head(args: {key: string}): Promise<StorageObject | null>;
  list(args: {delimiter?: string; prefix?: string}): Promise<{
    objects: StorageObject[];
    prefixes: string[];
  }>;
  /** A stable, unsigned locator for the object. Not necessarily fetchable. */
  objectUrl(args: {key: string}): string;
  put(args: {
    body: Buffer;
    contentType?: string;
    key: string;
    metadata?: Record<string, string>;
  }): Promise<void>;
}
```

Adapters: `MemoryStorageAdapter` (tests), `LocalDiskStorageAdapter` (dev and single-host deploys, with a `LocalStorageApp` plugin that serves HMAC-signed read and write URLs), `GcsStorageAdapter`, and `S3StorageAdapter` (AWS S3, Cloudflare R2, MinIO through `endpoint`). Vendor SDKs are optional peers loaded lazily, the way `comms/src/adapters/sendgrid.ts:46` loads `@sendgrid/mail`. `FileStorageService` in `@terreno/ai` and `DocumentStorageApp` in `@terreno/admin-backend` take an `adapter` option and keep their current GCS constructors, so nothing breaks for existing apps.

**Upload primitive.** `createUploadsRouter({adapter})` returns a `modelRouter` for a new `StoredFile` model, mounted at `/uploads`. The browser or device never sends file bytes through the API's JSON pipeline: `POST /uploads/start` returns a signed write URL, the client `PUT`s the bytes to storage, `POST /uploads/:id/complete` confirms the object arrived, and `GET /uploads/:id/downloadUrl` returns a short-lived read URL to the owner. `useFileUpload` in `@terreno/syncdb/react` runs those three steps, and `FileUploadField` in `@terreno/ui` renders pick, progress, done and error states on top of the existing `FilePickerButton`.

**Email.** `SmtpMailProvider`, `ResendMailProvider` and `SesMailProvider` implement the existing `MailProvider` interface (`comms/src/types.ts:73`) and classify failures into the existing `config` / `transient` / `permanent` classes, so retries, logging and hooks in `CommsService` work unchanged. SMTP makes local mail visible in Mailpit.

Rejected: a new `@terreno/storage` package. `@terreno/ai` and `@terreno/admin-backend` already depend on `@terreno/api`, and a new published package costs a CircleCI filter block, a coverage gate and another job in the 2,060-line publish workflow (Q1). Rejected: proxying upload bytes through the API with `multer`, as the two existing routes do. It holds every file in API memory and puts a 10 MB ceiling on what an app can accept (Q2).

## The plan

The plan has two independent tracks. Track A (T1–T12) is storage and uploads. Track B (T13–T16) is email. Both tracks start at once. They meet twice, only because of shared files: T5 waits for T16 (`knip.jsonc`, `bun.lock`) and T12 waits for T16 (`example-backend/src/server.ts`).

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: storage adapter contract, memory adapter, conformance cases | none | api/src/storage | Unit: every conformance case passes on the memory adapter |
| T2 | Local disk adapter with signed read and write URLs | T1 | api/src/storage | Unit + supertest: conformance cases, signed PUT then GET, tampered or expired URL refused |
| T3 | GCS adapter | T1 | api/src/storage | Unit: conformance cases against the GCS mock |
| T4 | S3-compatible adapter | T1 | api/src/storage | Unit: conformance cases against an in-memory S3 client double |
| T5 | Publish the storage API from `@terreno/api` with docs | T2, T3, T4, T16 | api entry, package.json, docs | api smoke imports the adapters from the built package |
| T6 | `FileStorageService` accepts any storage adapter | T5 | ai | Existing ai file suites pass; new suite on the memory adapter |
| T7 | `DocumentStorageApp` accepts any storage adapter | T5 | admin-backend | Existing documents suite passes; new suite on the memory adapter |
| T8 | Uploads router: start and complete a signed upload | T5 | api/src/storage | Supertest: start, PUT to the signed URL, complete |
| T9 | Uploads router: owner download URL and delete cleanup | T8 | api/src/storage | Supertest: owner gets a URL, other user 403, delete removes the object |
| T10 | `useFileUpload` hook | none | syncdb | Hook test: three calls in order, no auth header on the storage PUT |
| T11 | `FileUploadField` component | none | ui, demo | Component test: idle, uploading, done, too-large and failed states |
| T12 | Example app: upload a file end to end | T9, T10, T11, T16 | example-backend, example-frontend, docs | Playwright: a user uploads a file and opens it |
| T13 | SMTP mail adapter | none | comms/src/adapters | Unit: send, error classes, missing sender |
| T14 | Resend mail adapter | none | comms/src/adapters | Unit: send, error classes, missing sender |
| T15 | SES mail adapter | none | comms/src/adapters | Unit: send, error classes, missing sender |
| T16 | Publish the mail adapters, pick one from env in the example, docs | T13, T14, T15 | comms package.json, example-backend, docs | comms smoke sends through the SMTP adapter from the built package |

Tracer: `StorageAdapter` as an exported contract, proven by a runner-agnostic list of conformance cases that every adapter (first-party or third-party) must pass.
E2E: 1 spec (browser) and 2 smoke additions (http).
Regression: 5 provisional cases. `STORAGE-new-1` (a real S3-compatible bucket) → `docs/regression/storage.md`; `COMMS-new-1` to `COMMS-new-3` (real Resend, SES and SMTP delivery) → `docs/regression/comms.md`; `NATIVE-new-1` (upload from a phone) → `docs/regression/ui-native.md`. Each checks a real third-party service or a device that CI cannot reach.
User guide: 1 new page, `docs/user-guide/documents/upload-a-file.md`.
Design: None — no canvas; the one new component reuses `FilePickerButton` and existing field styling.
Out of scope: invitations (own plan), image transforms, virus scanning, resumable uploads, a `fileField` Mongoose helper, mail delivery webhooks for the new providers, merging `FileAttachment` into `StoredFile`, and the rest of the audit's missing-features backlog (see Expansions).
Open risks: uploads that are started and never completed leave `pending` rows and, sometimes, objects behind until X20 adds a sweep; the S3, SES and SMTP adapters are unit-tested against doubles, so a wrong guess about a vendor SDK shape surfaces only in the manual regression cases; browser uploads straight to a bucket need CORS configured on that bucket, which the how-to must spell out; `LocalStorageApp` only works when mounted with `addMiddleware`, and an app that registers it as a plugin by mistake would have JSON uploads parsed and logged, so T2 makes `register` unavailable on it and the how-to shows the one correct line.
Elephant: direct-to-storage uploads skip the API, so nothing checks that the bytes match the declared MIME type or scans them. For an app that stores PHI or shows uploads to other users, the declared type is attacker-controlled until a later plan adds content sniffing and a scan hook (X14).

## Audit findings re-verified

| Finding | Verdict | Evidence |
| --- | --- | --- |
| 6.2 "GCS only, in two unrelated places" | Confirmed | `ai/src/service/fileStorage.ts:28` and `admin-backend/src/documentStorageApp.ts:131` each call `new Storage()`; no shared interface exists |
| 6.2 "no upload field" | Confirmed with a correction | No upload field exists, but `ui/src/FilePickerButton.tsx` already picks files on web and native; the plan builds on it |
| 6.3 "SendGrid only; the adapter seam exists" | Confirmed | `comms/src/adapters/` holds `sendgrid.ts` and `console.ts` for mail; `MailProvider` is at `comms/src/types.ts:73` |
| 6.3 seam is provider-neutral | Corrected | `MailMessage.templateId` and `dynamicTemplateData` are SendGrid dynamic templates. The new adapters refuse a message that sets `templateId` (D-level detail in T13–T15) |
| "Also absent: a Dockerfile for non-GCP deploy targets" | Wrong | `create-terreno-app/src/generate.ts:270` and `:2618` emit a root `Dockerfile`. Only a Compose file is missing (X13) |
| "no OpenTelemetry anywhere" (matrix) | Partly wrong | No framework package has it, but `example-backend/package.json` already depends on OpenTelemetry instrumentation and a Cloud Trace exporter (X12) |
| 6.4 "no way to add a teammate" | Overstated | `POST /orgs/:id/members` (`api/src/orgs/orgsApp.ts:412`) attaches an existing user by email. Missing: inviting someone with no account. Planned in `2026-11-13-invitations.md` |
| 6.8 `$search` and `$autocomplete` are no-ops | Confirmed | `api/src/api.ts:921-927` |

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `api/e2e/smoke.ts` (add one check) | http | From the built `@terreno/api`, a server with `LocalStorageApp` mounted through `addMiddleware` and the uploads router completes start → signed PUT → complete → download URL → GET, and the downloaded bytes equal the uploaded bytes | T9 |
| E2 | `comms/e2e/smoke.ts` (add one check) | http | From the built `@terreno/comms/adapters/smtp`, an admin send goes through `SmtpMailProvider` with an in-memory transport and the comms dashboard records it as sent | T16 |
| E3 | `example-frontend/e2e/uploads.spec.ts` | browser | A signed-in user opens Uploads, chooses a PNG, sees it listed, opens it, and removes it | T12 |

T1–T8, T10, T11 and T13–T15 are proven by unit and supertest suites, which the e2e guide ranks below smoke and e2e and which need no row here.

## Regression cases

Destination: STORAGE → docs/regression/storage.md
Destination: COMMS → docs/regression/comms.md
Destination: NATIVE → docs/regression/ui-native.md

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| STORAGE-new-1 | Upload to a real S3-compatible bucket | Start example-backend with `STORAGE_ADAPTER=s3` and credentials for a real S3 or R2 bucket whose CORS allows `PUT` from `http://localhost:8082`; sign in to the example app as `test@example.com`; open **Profile**, press **My uploads**; choose a PNG under 1 MB; then press the new row | The row appears with the file name, the image opens in a new tab, and the object is in the bucket under `uploads/<user id>/` | web | manual | storage-and-email-adapters |
| COMMS-new-1 | Reset email through Resend | Start example-backend with `MAIL_PROVIDER=resend`, a real `RESEND_API_KEY` and a verified sender; then walk AUTH-001 (`docs/regression/auth.md`) with a seeded account whose address is an inbox you can read | One reset email arrives from the configured sender and its link opens the reset screen; the comms dashboard shows the message as sent with provider `resend` | web | manual | storage-and-email-adapters |
| COMMS-new-2 | Reset email through Amazon SES | As COMMS-new-1 with `MAIL_PROVIDER=ses`, `AWS_REGION` and AWS credentials for an account with a verified sender | As COMMS-new-1, with provider `ses` | web | manual | storage-and-email-adapters |
| COMMS-new-3 | Reset email through a real SMTP relay | As COMMS-new-1 with `MAIL_PROVIDER=smtp` and the `SMTP_*` variables of a real relay that uses STARTTLS and a password | As COMMS-new-1, with provider `smtp` | web | manual | storage-and-email-adapters |
| NATIVE-new-1 | Upload a photo from a phone | With a development build of the example app on an iOS or Android device, pointed at an example-backend that uses the `gcs` or `s3` adapter, sign in as `test@example.com`; open **Profile**, press **My uploads**, press **Choose file**, pick a photo from the photo library; then press the new row | The row appears with the photo's file name and the photo opens | iOS, Android | manual | storage-and-email-adapters |

COMMS-new-1 to COMMS-new-3 reuse AUTH-001's steps and differ only in the provider under test. Sending through SMTP to a local Mailpit is not a regression case: E2 and T13's unit suite cover the adapter's request shape.

## User guide

| ID | Page | Change | Audience | Written in |
| --- | --- | --- | --- | --- |
| G1 | `docs/user-guide/documents/upload-a-file.md` | new | user | T12 |

T1–T11 and T13–T16 change developer-facing APIs only. `docs/user-guide/documents/files.md` (the Documents tab) is unchanged, because T7 changes where its bytes are stored, not what the user sees.

## Design

None — no canvas. `FileUploadField` (T11) composes `FilePickerButton`, `Text`, `Spinner` and `IconButton`. Drag-and-drop is the `ui-polish` plan's dropzone, not this plan.

## Tasks

- [ ] **T1** — Add the storage adapter contract, a memory adapter and conformance cases
  - Depends on: none
  - Files: api/src/storage/types.ts, api/src/storage/memoryAdapter.ts, api/src/storage/memoryAdapter.test.ts, api/src/storage/adapterContract.ts, api/src/storage/keys.ts, api/src/storage/keys.test.ts
  - Criteria: `StorageAdapter`, `StorageObject` and `StorageNotFoundError` exist as in "The idea"; `MemoryStorageAdapter` passes every conformance case; `assertValidStorageKey` rejects unsafe keys. Verified by `bun test api/src/storage/memoryAdapter.test.ts api/src/storage/keys.test.ts`.
  - Seam: exported functions and classes in `api/src/storage/`
  - Interface: `new MemoryStorageAdapter()` implements `StorageAdapter` with `id === "memory"`. `storageAdapterContractCases(): Array<{name: string; run: (adapter: StorageAdapter) => Promise<void>}>` returns checks that throw on failure and import no test runner. `assertValidStorageKey(key: string): void` throws `Error("Invalid storage key")`. `StorageNotFoundError extends Error` with `name === "StorageNotFoundError"`.
  - Cases (each is one conformance case, and is also asserted directly on the memory adapter):
    - `put({key: "a/b.txt", body: Buffer.from("hi"), contentType: "text/plain"})` then `get({key: "a/b.txt"})` → bytes `hi`
    - `head` of that key → `{key: "a/b.txt", size: 2, contentType: "text/plain"}` plus an ISO `updated`; `head` of a missing key → `null`
    - `get` and `createReadStream` of a missing key → reject / emit `StorageNotFoundError`
    - `createReadStream({key: "a/b.txt"})` collected → bytes `hi`
    - `put` twice to one key → second body wins
    - `delete` of an existing key → `head` returns `null`; `delete` of a missing key resolves
    - keys `a/b.txt`, `a/c/d.txt`, `e.txt`: `list({prefix: "a/", delimiter: "/"})` → objects `[a/b.txt]`, prefixes `["a/c/"]`; `list({})` → all three objects, no prefixes
    - `put({key: "a/empty/", body: Buffer.alloc(0)})` (a folder marker) → `list({prefix: "a/", delimiter: "/"})` includes prefix `a/empty/` and no object with that key
    - `getSignedUrl({key: "a/b.txt", action: "read", expiresInSeconds: 60})` → a non-empty string; `objectUrl({key: "a/b.txt"})` → a non-empty string containing `a/b.txt`
    - `assertValidStorageKey`: `""`, `"/abs"`, `"a/../b"`, `"a\\b"`, a key with a NUL byte, and a 1,025-character key throw; `"uploads/u1/f1"` and `"a/empty/"` do not
  - Blast radius: none
  - Docs: none in this task; T5 writes the reference page once the adapters exist
  - Test skills: terreno-backend-tests

- [ ] **T2** — Add a local disk storage adapter with signed read and write URLs
  - Depends on: T1
  - Files: api/src/storage/localDiskAdapter.ts, api/src/storage/localDiskAdapter.test.ts, api/src/storage/localStorageApp.ts, api/src/storage/localStorageApp.test.ts
  - Criteria: files persist under a root directory; signed URLs work through a `TerrenoPlugin`; a URL that is expired, altered, or used for the wrong action is refused. Verified by `bun test api/src/storage/localDiskAdapter.test.ts api/src/storage/localStorageApp.test.ts`.
  - Seam: exported class, and the HTTP routes `LocalStorageApp.mount` adds (supertest against a built `TerrenoApp`)
  - Interface: `new LocalDiskStorageAdapter({rootDir: string, publicBaseUrl: string, signingSecret: string, basePath?: string, overwrite?: boolean})` with `id === "local"`; `basePath` defaults to `/storage/local`; `overwrite` defaults to `true` and applies only to signed `PUT` requests. Constructor throws `Error("LocalDiskStorageAdapter requires signingSecret")` when the secret is empty. `getSignedUrl` returns `${publicBaseUrl}${basePath}/<key>?action=<read|write>&expires=<epoch seconds>&sig=<hex>` where `sig` is HMAC-SHA256 of `action`, `key`, `expires` and `contentType ?? ""` joined by newlines. `new LocalStorageApp({adapter, maxFileSize?: number})` (default 10 MB) serves `GET` and `PUT` at `basePath/*key` with no session auth: the signature is the credential. It is not a `TerrenoPlugin`. An app mounts it with `terrenoApp.addMiddleware(localStorageApp.mount)`, where `mount` is `(app: express.Application) => void`: `addMiddleware` functions run after CORS and before the JSON and urlencoded body parsers and the request logger (`api/src/terrenoApp.ts:416-434`, `:483`), so uploaded bytes are never parsed, never logged, and signed URLs never reach the request log. The route reads the raw request stream only.
  - Cases:
    - every `storageAdapterContractCases()` entry passes against a temp `rootDir`
    - a second adapter instance on the same `rootDir` reads what the first wrote, with its content type
    - `PUT` to a `write` URL with body `hello` and the signed `Content-Type` → 200; `GET` on a `read` URL for that key → 200, body `hello`, the same `Content-Type`, `Cache-Control: private, no-store`
    - `GET` with a `write` URL, or `PUT` with a `read` URL → 403 `{title: "Invalid storage URL"}`
    - `sig` changed by one character, `key` changed, or `expires` in the past (clock frozen with `freezeTime`) → 403
    - `PUT` with a `Content-Type` different from the signed one → 403
    - `PUT` body one byte over `maxFileSize` → 413, and `head` of the key is `null`
    - mounted with `addMiddleware` on a `TerrenoApp` with request logging on: `PUT` of `{"a":1}` with signed `Content-Type: application/json`, then `GET` → the identical 7 bytes; the same for the malformed body `{"a":` (stored byte for byte, no 400) and for `a=1` with `application/x-www-form-urlencoded`
    - during those requests no log line contains the body text, the `sig` value, or the storage path (assert on a captured logger transport)
    - `GET` responses carry `X-Content-Type-Options: nosniff`; `Content-Disposition` is `inline` for `image/png`, `image/jpeg`, `image/gif`, `image/webp` and `application/pdf`, and `attachment` for every other type, including `text/html` and `image/svg+xml`
    - a `write` URL for a key that already holds an object, when the adapter was built with `overwrite: false` → 409 `{title: "Object already exists"}`
    - `GET` on a valid `read` URL for a missing key → 404
    - `key` of `..%2F..%2Fetc%2Fpasswd` → 400 or 403 and nothing is read outside `rootDir`
  - Blast radius: none
  - Docs: none in this task; T5
  - Test skills: terreno-backend-tests

- [ ] **T3** — Add a Google Cloud Storage adapter
  - Depends on: T1
  - Files: api/src/storage/gcsAdapter.ts, api/src/storage/gcsAdapter.test.ts
  - Criteria: the adapter passes every conformance case against the shared GCS mock (`registerGcsMock`) and produces the same object URL `FileStorageService` stores today. Verified by `bun test api/src/storage/gcsAdapter.test.ts`.
  - Seam: exported class
  - Interface: `new GcsStorageAdapter({bucketName: string, storage?: GcsLikeStorage, storageOptions?: Record<string, unknown>, loadModule?: () => {Storage: new (options?: Record<string, unknown>) => GcsLikeStorage}})` with `id === "gcs"`. `loadModule` defaults to a lazy `createRequire` of `@google-cloud/storage`. `GcsLikeStorage` is the structural subset `{bucket(name): {file(key), getFiles(query)}}` the adapter uses. With no `storage`, it loads `@google-cloud/storage` lazily with `createRequire` and throws `Error("GcsStorageAdapter requires optional peer dependency @google-cloud/storage. Install it with: bun add @google-cloud/storage")` when it is absent.
  - Cases:
    - every `storageAdapterContractCases()` entry passes with `storage` set to the `{bucket}` object returned by `registerGcsMock()` from `@terreno/test` (`test/src/mocks/gcs.ts:117`)
    - `objectUrl({key: "uploads/u1/1-a.png"})` with bucket `b` → `https://storage.googleapis.com/b/uploads/u1/1-a.png`
    - `getSignedUrl({action: "read", expiresInSeconds: 3600, key})` calls the file's `getSignedUrl` with `{action: "read", version: "v4"}` and an `expires` 3600 s ahead (clock frozen); `action: "write"` with `contentType: "image/png"` passes `{action: "write", contentType: "image/png", version: "v4"}`
    - `delete` passes `{ignoreNotFound: true}`
    - `list` when the bucket answers 404 with reason `notFound` → rejects `StorageNotFoundError`
    - `get` when the file answers 404 → rejects `StorageNotFoundError`
    - no `storage` and a `loadModule` that throws → the install-hint error above. (`registerGcsMock()` installs `mock.module("@google-cloud/storage")` for the whole test process, so the missing-module case is proven through the injected loader, not by a real unresolved import)
  - Blast radius: none
  - Docs: none in this task; T5
  - Test skills: terreno-backend-tests

- [ ] **T4** — Add an S3-compatible storage adapter
  - Depends on: T1
  - Files: api/src/storage/s3Adapter.ts, api/src/storage/s3Adapter.test.ts
  - Criteria: the adapter passes every conformance case against an in-memory client double and builds its default client for AWS S3, R2 and MinIO from options. Verified by `bun test api/src/storage/s3Adapter.test.ts`.
  - Seam: exported class
  - Interface: `new S3StorageAdapter({bucket: string, region?: string, endpoint?: string, forcePathStyle?: boolean, credentials?: {accessKeyId: string; secretAccessKey: string}, client?: S3LikeClient})` with `id === "s3"`. `S3LikeClient` is `{putObject, getObject, headObject, deleteObject, listObjects, presign}`, each taking one object argument, defined in the adapter file. With no `client`, it loads `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` lazily and throws `Error("S3StorageAdapter requires optional peer dependencies @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner. Install them with: bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner")` when either is absent.
  - Cases:
    - every `storageAdapterContractCases()` entry passes with an in-memory `client` double written in the test file
    - `list` follows continuation: a double that returns 2 keys and a continuation token, then 1 key → 3 objects
    - `objectUrl({key: "k"})` → `s3://<bucket>/k`
    - `getSignedUrl({action: "write", contentType: "image/png", expiresInSeconds: 900, key: "k"})` calls `presign` with exactly `{action: "write", contentType: "image/png", expiresInSeconds: 900, key: "k"}`
    - `headObject` rejecting with `name: "NotFound"` or `$metadata.httpStatusCode: 404` → `head` returns `null`; `getObject` rejecting with `name: "NoSuchKey"` → `StorageNotFoundError`
    - `deleteObject` rejecting with `NoSuchKey` → `delete` resolves
    - no `client` and the SDK cannot be resolved → the install-hint error above
  - Blast radius: none
  - Docs: none in this task; T5
  - Test skills: terreno-backend-tests

- [ ] **T5** — Export the storage adapters from `@terreno/api` and document them
  - Depends on: T2, T3, T4, T16 (T16 only because both edit `knip.jsonc` and `bun.lock`)
  - Files: api/src/index.ts, api/src/tests.ts, api/package.json, knip.jsonc, bun.lock, api/e2e/smoke.ts, docs/reference/storage.md, docs/reference/api.md, docs/reference/README.md, changelog/unreleased/storage-adapters.md
  - Criteria: a consumer imports the contract, the four adapters and `LocalStorageApp` from `@terreno/api`, and `storageAdapterContractCases` from `@terreno/api/testing`; the three vendor SDKs are optional peers; `bun run check:knip` reports zero findings; the reference page documents every option and the "write your own adapter" steps. Verified by `bun run --cwd api smoke`, `bun run check:knip`, and `bun run check:no-barrel-imports`.
  - Seam: the built package entry (`@terreno/api`, `@terreno/api/testing`)
  - Interface: named exports `StorageAdapter`, `StorageObject`, `StorageNotFoundError`, `MemoryStorageAdapter`, `LocalDiskStorageAdapter`, `LocalStorageApp`, `GcsStorageAdapter`, `S3StorageAdapter`, `assertValidStorageKey` from `@terreno/api`; `storageAdapterContractCases` from `@terreno/api/testing`. `api/package.json` lists `@google-cloud/storage`, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` under `peerDependencies` and marks each `optional` in `peerDependenciesMeta`.
  - Cases:
    - `api/e2e/smoke.ts` imports `LocalDiskStorageAdapter` from the built `@terreno/api`, writes `smoke` to a temp directory and reads `smoke` back, printing one `✅` line
    - `storageAdapterContractCases` imported from `@terreno/api/testing` in the smoke has length ≥ 9
    - importing `@terreno/api` in the smoke process with none of the three SDKs resolvable does not throw (the api workspace does not install them)
  - Blast radius: every `@terreno/api` consumer loads the new exports → the api smoke case above proves the import stays free of vendor SDKs
  - Docs: new `docs/reference/storage.md` (contract, each adapter's options, signed URL lifetimes, bucket CORS for browser uploads, key rules, how to write and prove a custom adapter with `storageAdapterContractCases`); link it from `docs/reference/api.md` and the reference index; `Added` changelog fragment
  - Test skills: terreno-backend-tests

- [ ] **T6** — Let `FileStorageService` use any storage adapter
  - Depends on: T5
  - Files: ai/src/service/fileStorage.ts, ai/src/service/fileStorage.test.ts, ai/src/service/fileStorageAdapter.test.ts, docs/reference/ai.md
  - Criteria: `new FileStorageService({adapter})` works with any adapter; `new FileStorageService({bucketName, storageOptions})` behaves exactly as before; the existing ai file suites pass with no change to their assertions. Verified by `bun test ai/src/service ai/src/routes/files.test.ts ai/src/routes/gptFiles.test.ts`.
  - Seam: exported class `FileStorageService`
  - Interface: constructor accepts `{adapter: StorageAdapter}` or `{bucketName: string, storageOptions?: StorageOptions}`; the second form builds a `GcsStorageAdapter` around its own `new Storage(storageOptions)`. `upload`, `download`, `getSignedUrl` and `delete` keep their signatures and the `gcsKey` field name.
  - Cases (new suite, `MemoryStorageAdapter`):
    - `upload({buffer: Buffer.from("x"), filename: "My File!.png", mimeType: "image/png", userId})` → result `gcsKey` matches `uploads/<userId>/<digits>-My_File_.png`, `size` 1, `url` equals `adapter.objectUrl({key: gcsKey})`, and a `FileAttachment` row exists with the same values
    - `download(gcsKey)` → bytes `x`
    - `getSignedUrl(gcsKey)` → the adapter is asked for `{action: "read", expiresInSeconds: 3600, key: gcsKey}`
    - `delete(gcsKey)` → `adapter.head` returns `null` and the `FileAttachment` row has `deleted: true`
    - constructor with neither `adapter` nor `bucketName` → throws `Error("FileStorageService requires adapter or bucketName")`
    - legacy form: `url` is `https://storage.googleapis.com/<bucket>/<gcsKey>` (existing assertion, unchanged)
  - Blast radius: `ai/src/routes/files.ts`, `ai/src/service/askFiles.ts`, `ai/src/service/chatTurn.ts`, `example-backend/src/api/{ai,settings,photoLibrary}.ts` and `example-backend/src/scripts/generatePhotoLibrary.ts` call the service → their existing suites must pass unchanged (run `bun run --cwd ai test:ci` and `bun run --cwd example-backend test:ci`)
  - Docs: `docs/reference/ai.md` file storage section gains the `adapter` option and a link to `storage.md`
  - Test skills: terreno-backend-tests

- [ ] **T7** — Let `DocumentStorageApp` use any storage adapter
  - Depends on: T5
  - Files: admin-backend/src/documentStorageApp.ts, admin-backend/src/documentStorageApp.test.ts, admin-backend/src/documentStorageAdapter.test.ts, docs/reference/admin-backend.md
  - Criteria: every route of `DocumentStorageApp` works on any adapter; `bucketName` alone still works; the existing suite passes with no change to its assertions. Verified by `bun test admin-backend/src/documentStorageApp.test.ts admin-backend/src/documentStorageAdapter.test.ts`.
  - Seam: the HTTP routes `DocumentStorageApp` mounts (supertest)
  - Interface: `DocumentStorageOptions` gains `adapter?: StorageAdapter`; `bucketName` becomes optional. With no `adapter`, the app keeps today's lazy rule from `admin-backend/src/documentStorageApp.ts:140-150`: on each request it resolves the bucket from `bucketName`, then `GCS_BUCKET`, and answers 503 `{title: "Storage not configured"}` when neither is set; otherwise it uses a `GcsStorageAdapter` for that bucket. The constructor never throws. Routes, request shapes, response shapes and status codes are unchanged.
  - Cases (new suite, `MemoryStorageAdapter`, admin user unless stated):
    - upload `a.txt` (`text/plain`, body `hi`) to the root, then list → `files` holds one entry with `name: "a.txt"`, `size: 2`, `isFolder: false`
    - download that file → 200, body `hi`, `Content-Type: text/plain`
    - create folder `reports`, then list the root → `folders` includes `reports/`
    - delete the file → 200/204 as today, then list → `files` is empty
    - delete folder `reports` holding two files → both objects are gone from the adapter
    - `access: "authenticated"`, non-admin user A uploads `a.txt` → stored under `users/<A id>/`; user B listing sees no files
    - no token → 401
    - `list` when the adapter rejects `StorageNotFoundError` → 200 with empty `files` and `folders` (today's missing-bucket behaviour)
    - no `adapter`, `bucketName: ""` and no `GCS_BUCKET` → construction succeeds and list answers 503 `{title: "Storage not configured"}` (today's behaviour, pinned at `documentStorageApp.test.ts:605-619`; `example-backend/src/server.ts:448` relies on it)
    - no `adapter`, `bucketName: ""`, and `GCS_BUCKET` set after construction → requests use that bucket
    - `adapter` set and `GCS_BUCKET` unset → no 503
  - Blast radius: `admin-frontend/src/useDocumentStorageApi.ts` and `example-frontend/app/(tabs)/documents.tsx` read these routes → response shapes are pinned by the unchanged existing suite; `example-frontend/app/(tabs)/documents.test.tsx` must pass unchanged
  - Docs: `docs/reference/admin-backend.md` document storage section gains the `adapter` option and a link to `storage.md`
  - Test skills: terreno-backend-tests

- [ ] **T8** — Add the uploads router: start and complete a signed upload
  - Depends on: T5
  - Files: api/src/storage/storedFileModel.ts, api/src/types/storedFile.ts, api/src/storage/uploadsRouter.ts, api/src/storage/uploadsRouter.test.ts, api/src/index.ts, docs/reference/storage.md
  - Criteria: a signed-in user can start an upload, send bytes to the returned URL, and complete it; limits and permissions hold. Verified by `bun test api/src/storage/uploadsRouter.test.ts`.
  - Seam: HTTP routes of `createUploadsRouter` (supertest, `MemoryStorageAdapter` and, for the PUT step, `LocalDiskStorageAdapter` + `LocalStorageApp`)
  - Interface: `createUploadsRouter({adapter: StorageAdapter, basePath?: string, allowedMimeTypes?: string[], maxFileSize?: number, keyPrefix?: string, writeUrlSeconds?: number, readUrlSeconds?: number, enabled?: boolean | ((req: express.Request) => boolean | Promise<boolean>)})` returns a `modelRouter` registration for `TerrenoApp.register`. Defaults: `basePath` `/uploads`, `maxFileSize` 10 MB, `writeUrlSeconds` 900, `readUrlSeconds` 3600, `allowedMimeTypes` the list in `ai/src/routes/files.ts:11-20`. `StoredFile` fields: `ownerId`, `filename`, `mimeType`, `size`, `key` (unique), `status` (`pending` | `ready`), `adapterId`, plus `created`, `updated`, `deleted`. Object keys are `<keyPrefix>uploads/<ownerId>/<StoredFile id>`: the file name never appears in a key.
    - `POST /uploads/start` body `{filename: string (1–255), mimeType: string, size: integer ≥ 1}` strict → 200 `{data: {file: {_id, filename, mimeType, size, status: "pending"}, upload: {url, method: "PUT", headers: {"Content-Type": <mimeType>}, expiresAt: <ISO>}}}`, exactly those fields
    - `POST /uploads/:id/complete` (owner) → 200 `{data: {_id, filename, mimeType, size, status: "ready"}}`
    - CRUD: `list` for any signed-in user, filtered to their own files; `read` owner only; `create` and `update` disabled
    - "Owner only" is strict. The router uses its own `IsFileOwner` permission, not `Permissions.IsOwner`, because `Permissions.IsOwner` also passes any admin (`api/src/permissions.ts:102-104`). An admin who is not the owner is refused like any other user
  - Cases:
    - start with `{filename: "a.png", mimeType: "image/png", size: 5}` → 200; `upload.url` is the adapter's signed `write` URL for the new key; `expiresAt` is 900 s ahead (clock frozen)
    - with the local disk adapter: `PUT` 5 bytes to `upload.url`, then complete → `status: "ready"`, `size: 5`
    - complete before any bytes were sent → 409 `{title: "Upload not received"}`
    - the stored object is larger than `maxFileSize` at complete → 400 `{title: "File is too large"}`, the object is deleted, the row stays `pending`
    - the stored object's size differs from the declared size but is within the limit → `size` in the response is the stored size
    - complete twice → second call 200 with the same body
    - start with `mimeType: "application/x-msdownload"` → 400 `{title: "File type application/x-msdownload is not allowed"}`
    - start with `size` one byte over `maxFileSize` → 400 `{title: "File is too large"}`; `size: 0` or an extra body key → 400
    - `enabled: false` or a function returning `false` → start 403 `{title: "File uploads are disabled"}`
    - no token → 401 on start and complete; user B completing user A's file → 403; an admin who is not the owner completing or reading it → 403; unknown id → 404
    - `POST /uploads` and `PATCH /uploads/:id` → 405
    - `GET /uploads` as user A with files owned by A and B → only A's files; as an admin who owns none → an empty list
    - `filename: "../../etc/passwd"` → 200, and the object key contains neither `..` nor `passwd`
  - Blast radius: none; `FileAttachment` and the `/files/*` routes in `@terreno/ai` are untouched
  - Docs: `docs/reference/storage.md` gains an "Uploads router" section with the routes, options and the three-step flow
  - Test skills: terreno-backend-tests, mongoose-schema-safety

- [ ] **T9** — Add owner download URLs and delete cleanup to the uploads router
  - Depends on: T8
  - Files: api/src/storage/uploadsRouter.ts, api/src/storage/uploadsRouter.test.ts, api/e2e/smoke.ts, docs/reference/storage.md, docs/how-to/store-files.md, changelog/unreleased/file-uploads.md
  - Criteria: the owner gets a short-lived read URL for a completed file; deleting a file removes its object; the api smoke walks the whole flow from the built package. Verified by `bun test api/src/storage/uploadsRouter.test.ts` and `bun run --cwd api smoke`.
  - Seam: HTTP routes of `createUploadsRouter`
  - Interface: `GET /uploads/:id/downloadUrl` (owner) → 200 `{data: {url, expiresAt}}`, exactly those fields. `DELETE /uploads/:id` (owner) → the status `modelRouter` delete returns today; the row is soft-deleted and the object is removed from storage.
  - Cases:
    - owner, `ready` file → `url` is the adapter's signed `read` URL; `expiresAt` is 3600 s ahead (clock frozen); `readUrlSeconds: 60` → 60 s ahead
    - `pending` file → 409 `{title: "Upload not complete"}`
    - user B → 403; an admin who is not the owner → 403; no token → 401; unknown id → 404; a deleted file → 404
    - the object was replaced after `complete` (its stored size no longer equals the row's `size`, for example by a second `PUT` to the still-valid write URL) → 409 `{title: "File changed after upload"}` and no URL is returned
    - with the local disk adapter built with `overwrite: false`: a second `PUT` to the same write URL after the first → 409 from storage, and the stored bytes are the first upload's
    - owner deletes a `ready` file → `adapter.head` of its key is `null`, and `GET /uploads` no longer lists it
    - owner deletes a `pending` file with no object → succeeds
    - the adapter's `delete` rejects → the route still succeeds and logs a warning (the row is the source of truth)
    - user B, or an admin who is not the owner, deleting user A's file → 403, and the object is still present
    - E1 (smoke): start → PUT → complete → downloadUrl → GET returns the uploaded bytes
  - Blast radius: none beyond T8's routes
  - Docs: `storage.md` routes table updated; new `docs/how-to/store-files.md` (choose an adapter, mount `LocalStorageApp` with `addMiddleware` and register the uploads router, reference a `StoredFile` id from your own model, bucket CORS, why keys hold no file names); `Added` changelog fragment
  - Test skills: terreno-backend-tests

- [ ] **T10** — Add the `useFileUpload` hook to `@terreno/syncdb/react`
  - Depends on: none
  - Files: syncdb/src/react/useFileUpload.ts, syncdb/src/react/useFileUpload.test.tsx, syncdb/src/react/index.ts, docs/reference/syncdb.md
  - Criteria: one call uploads a picked file through start → PUT → complete and reports progress state and errors. Verified by `bun test syncdb/src/react/useFileUpload.test.tsx`.
  - Seam: the rendered hook, under `ApiClientProvider` with a fake transport
  - Interface: `useFileUpload(options?: {basePath?: string; fetchImpl?: typeof fetch}): {upload: (file: {mimeType: string; name: string; size?: number; uri: string}) => Promise<UploadedFile>; isUploading: boolean; error: Error | undefined}` where `UploadedFile` is `{_id: string; filename: string; mimeType: string; size: number; status: "ready"}`. `basePath` defaults to `/uploads`. Start and complete go through the app's API client (with its auth). The storage `PUT` uses `fetchImpl` (default global `fetch`) with exactly the `method` and `headers` the start response returned.
  - Cases:
    - `upload({uri: "data:text/plain;base64,aGk=", name: "a.txt", mimeType: "text/plain"})` → requests in order: `POST /uploads/start` with `{filename: "a.txt", mimeType: "text/plain", size: 2}`; `PUT <upload.url>` with a 2-byte body and header `Content-Type: text/plain`; `POST /uploads/<id>/complete`. Resolves the complete response's `data`
    - the storage `PUT` request carries no `Authorization` and no `Cookie` header, and `credentials` is `"omit"`
    - `isUploading` is `true` between the call and settlement, `false` after
    - storage `PUT` answers 403 → rejects `Error("Upload failed (403)")`, `error` is set, and complete is not called
    - start answers 400 `{title: "File is too large"}` → rejects with that title and no `PUT` is sent
    - `size` given as 9 by the caller, actual blob 2 bytes → start is sent `size: 2`
    - `basePath: "/files2"` → the three API calls use `/files2`
    - a native-style `uri` of `file:///tmp/a.jpg` with `fetchImpl` returning a 3-byte blob for that URI → start is sent `size: 3` and the `PUT` body is that blob (the hook reads every `uri` through `fetchImpl`, never through `FileReader`)
  - Blast radius: none
  - Docs: `docs/reference/syncdb.md` gains `useFileUpload`
  - Test skills: terreno-frontend-tests

- [ ] **T11** — Add the `FileUploadField` component to `@terreno/ui`
  - Depends on: none
  - Files: ui/src/FileUploadField.tsx, ui/src/FileUploadField.test.tsx, ui/src/index.tsx, demo/stories/FileUploadField.stories.tsx, demo/demoConfig.tsx, docs/reference/ui.md
  - Criteria: the field lets a user pick files, shows each one uploading, done or failed, and lets them remove one; it uses no web-only API (the picker is `FilePickerButton`, which already handles both platforms; the device path is regression case NATIVE-new-1) and has a demo entry so `bun run check:demo-coverage` passes. Verified by `bun test ui/src/FileUploadField.test.tsx` and `bun run check:demo-coverage`.
  - Seam: the rendered component
  - Interface: `FileUploadField` props: `onUpload: (file: SelectedFile) => Promise<FileUploadValue>`, `value: FileUploadValue[]`, `onChange: (files: FileUploadValue[]) => void`, optional `title`, `helperText`, `errorText`, `multiple`, `documentTypes`, `includeImages`, `maxSizeBytes`, `disabled`, `buttonText` (default `"Choose file"`), `testID` (default `"file-upload"`). `FileUploadValue` is `{id: string; name: string; mimeType?: string; size?: number}`. Test IDs: `<testID>-button`, `<testID>-uploading-<index>`, `<testID>-file-<id>`, `<testID>-remove-<id>`, `<testID>-error`.
  - Cases:
    - empty `value` → the button shows `Choose file`; no file rows
    - a file is picked and `onUpload` is pending → a row `<testID>-uploading-0` shows the file name and a spinner; the button is disabled when `multiple` is false
    - `onUpload` resolves `{id: "f1", name: "a.png"}` → `onChange` is called with `[...value, {id: "f1", name: "a.png"}]`; the uploading row is gone
    - `value` holds `{id: "f1", name: "a.png"}` → row `<testID>-file-f1` shows `a.png`; pressing `<testID>-remove-f1` calls `onChange([])`; the remove control has accessibility label `Remove a.png`
    - `onUpload` rejects → `<testID>-error` shows `Could not upload a.png. Try again.`; `onChange` is not called
    - `maxSizeBytes: 1048576` and a picked file with `size: 2097152` → `<testID>-error` shows `a.png is larger than 1 MB.`; `onUpload` is not called
    - `multiple: false` with one file in `value` → picking another replaces it: `onChange([{id: "f2", ...}])`
    - `disabled` → the button is disabled and remove controls are hidden
    - `errorText: "Required"` → shown in `<testID>-error`
  - Blast radius: none; `FilePickerButton` is used, not changed
  - Docs: `docs/reference/ui.md` gains `FileUploadField`; the demo story covers idle, with-files and error
  - Test skills: terreno-frontend-tests, accessibility-testing

- [ ] **T12** — Upload a file end to end in the example app
  - Depends on: T9, T10, T11, T16 (T16 only because both edit `example-backend/src/server.ts`)
  - Files: example-backend/src/storage.ts, example-backend/src/storage.test.ts, example-backend/src/server.ts, example-backend/.env.example, example-frontend/store/apiSdk.ts (regenerated with `bun run sdk`, never hand-edited), example-frontend/app/uploads.tsx, example-frontend/app/uploads.test.tsx, example-frontend/app/(tabs)/profile.tsx, example-frontend/e2e/uploads.spec.ts, .circleci/continue-config.yml, .github/workflows/e2e-ci.yml, docs/user-guide/documents/upload-a-file.md, docs/user-guide/README.md, docs/regression/storage.md, docs/regression/ui-native.md, docs/regression/README.md
  - Criteria: the example backend picks a storage adapter from env and registers the uploads router; a signed-in user can upload, open and remove a file from an Uploads screen. Verified by `bun test example-backend/src/storage.test.ts example-frontend/app/uploads.test.tsx`, `bun run frontend:e2e -- uploads.spec.ts`, and `bun run check:regression-suites`.
  - Seam: `createExampleStorageAdapter(env)` (exported function) and the browser
  - Interface: `createExampleStorageAdapter(env: NodeJS.ProcessEnv): StorageAdapter | undefined`. `STORAGE_ADAPTER` is `local`, `gcs` or `s3`. Unset, it resolves to `gcs` when `GCS_BUCKET` is set, to `local` when `NODE_ENV` is not `production`, and otherwise to no adapter: the function returns `undefined`, logs one warning, and `server.ts` registers neither the uploads router nor `LocalStorageApp`. The deployed example backend runs with `NODE_ENV=production` (`example-backend/Dockerfile:52`), so it keeps booting with no new env and gets uploads on GCS wherever `GCS_BUCKET` is already set. When uploads are off, `GET /uploads` answers 404 and the Uploads screen shows `uploads-unavailable` with `Uploads are not set up on this server.` `local` uses `STORAGE_LOCAL_DIR` (default `.devdata/uploads`) and `STORAGE_SIGNING_SECRET`; `gcs` uses `GCS_BUCKET`; `s3` uses `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The Uploads screen is `/uploads`, linked from Profile as **My uploads**. Test IDs: `uploads-screen`, `uploads-field` (the `FileUploadField` `testID`), `uploads-list`, `uploads-item-<id>`, `uploads-open-<id>`, `uploads-remove-<id>`, `uploads-empty`, `uploads-unavailable`, `profile-uploads-link`.
  - Cases:
    - `createExampleStorageAdapter({})` → `id === "local"`; `({GCS_BUCKET: "b"})` → `id === "gcs"`; `({NODE_ENV: "production"})` → `undefined` and one warning, no throw; `({NODE_ENV: "production", GCS_BUCKET: "b"})` → `id === "gcs"`
    - `({NODE_ENV: "production", STORAGE_ADAPTER: "local"})` with no `STORAGE_SIGNING_SECRET` → throws `Error("STORAGE_SIGNING_SECRET is required for local storage in production")` (an explicit choice fails loudly)
    - the Uploads screen with `GET /uploads` answering 404 → `uploads-unavailable` is visible and the field is hidden (component test in `example-frontend/app/uploads.test.tsx`)
    - `{STORAGE_ADAPTER: "gcs"}` with no `GCS_BUCKET` → throws `Error("GCS_BUCKET is required when STORAGE_ADAPTER=gcs")`; `{STORAGE_ADAPTER: "s3", S3_BUCKET: "b"}` → `id === "s3"`; `{STORAGE_ADAPTER: "nope"}` → throws `Error("Unknown STORAGE_ADAPTER: nope")`
    - E3: after `loginAs(page)`, go to `/uploads` and wait for `uploads-screen`; `uploads-empty` is visible; set a 1×1 PNG on the field's file chooser; `uploads-item-<id>` appears with the file name; pressing `uploads-open-<id>` requests a URL that answers 200 with `Content-Type: image/png`; pressing `uploads-remove-<id>` and confirming removes the row and `uploads-empty` returns
    - E3: choosing a file larger than 10 MB shows the field's too-large message and no row
  - CI: both CI configs list e2e specs by hand (`.circleci/continue-config.yml` per-shard lists, `.github/workflows/e2e-ci.yml` matrix), so add `uploads.spec.ts` to a shard in each and run `bun run check:circleci-parity`. The e2e backend there starts with no storage env and is not production, so it resolves to `local`
  - Blast radius: `example-backend/src/server.ts` registration order → `bun run --cwd example-backend test:ci` (including `openapi.test.ts`) must pass; the new `/uploads` paths appear in `/openapi.json`, so the regenerated `store/apiSdk.ts` is part of this task
  - Docs: user guide page G1 (words on screen: **My uploads**, **Choose file**, **Remove**); regression cases STORAGE-new-1 and NATIVE-new-1; the `STORAGE_*` and `S3_*` variables are documented in `example-backend/.env.example` here and in `docs/reference/environment-variables.md` by T16, which already owns that file
  - Test skills: terreno-frontend-tests, terreno-backend-tests, verify-ui-changes

- [ ] **T13** — Add an SMTP mail adapter
  - Depends on: none
  - Files: comms/src/adapters/smtp.ts, comms/src/adapters/smtp.test.ts
  - Criteria: mail sends through any SMTP server and failures map to the existing error classes. Verified by `bun test comms/src/adapters/smtp.test.ts`.
  - Seam: exported class `SmtpMailProvider` (adapter contract `MailProvider`)
  - Interface: `new SmtpMailProvider({host?: string, port?: number, secure?: boolean, user?: string, password?: string, fromEmail?: string, fromName?: string, transport?: {sendMail: (message: Record<string, unknown>) => Promise<{messageId?: string}>}})` with `id === "smtp"`. Env fallbacks: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`"true"`), `SMTP_USER`, `SMTP_PASSWORD`. With no `transport`, it loads `nodemailer` lazily and throws `Error("SmtpMailProvider requires optional peer dependency nodemailer. Install it with: bun add nodemailer")` when absent. Throws `Error("SmtpMailProvider requires SMTP_HOST or a host constructor option")` with no host and no transport.
  - Cases:
    - `sendMail({to: "a@example.com", subject: "Hi", text: "t", html: "<p>t</p>", replyTo: "r@example.com"})` with `fromEmail: "no-reply@example.com"`, `fromName: "App"` → transport receives `{from: '"App" <no-reply@example.com>', to: "a@example.com", subject: "Hi", text: "t", html: "<p>t</p>", replyTo: "r@example.com"}`; result `{accepted: true, providerMessageId: <messageId>}`
    - `to: ["a@example.com", "b@example.com"]` → transport `to` is that array
    - no `fromEmail` and no `message.from` → `{accepted: false, errorClass: "config", errorCode: "smtp-missing-from"}`; the transport is not called
    - `message.templateId` set → `{accepted: false, errorClass: "permanent", errorCode: "smtp-template-unsupported", isPermanentFailure: true}`
    - transport rejects with `{code: "EAUTH"}` or `{responseCode: 535}` → `errorClass: "config"`, `errorCode: "smtp-auth"`
    - rejects with `{code: "ECONNECTION"}`, `{code: "ETIMEDOUT"}` or `{responseCode: 421}` → `errorClass: "transient"`
    - rejects with `{responseCode: 550}` → `errorClass: "permanent"`, `errorCode: "smtp-550"`, `isPermanentFailure: true`
    - no result ever contains the password, and `sendMail` never throws
  - Blast radius: none
  - Docs: none in this task; T16
  - Test skills: terreno-backend-tests

- [ ] **T14** — Add a Resend mail adapter
  - Depends on: none
  - Files: comms/src/adapters/resend.ts, comms/src/adapters/resend.test.ts
  - Criteria: mail sends through Resend's HTTP API with no extra dependency and failures map to the existing error classes. Verified by `bun test comms/src/adapters/resend.test.ts`.
  - Seam: exported class `ResendMailProvider`
  - Interface: `new ResendMailProvider({apiKey?: string, fromEmail?: string, fromName?: string, fetchImpl?: typeof fetch, baseUrl?: string})` with `id === "resend"`. `apiKey` falls back to `RESEND_API_KEY`; throws `Error("ResendMailProvider requires RESEND_API_KEY or an apiKey constructor option")` with neither. `baseUrl` defaults to `https://api.resend.com`. Sends `POST <baseUrl>/emails` with `Authorization: Bearer <apiKey>` and a JSON body.
  - Cases:
    - `sendMail({to: "a@example.com", subject: "Hi", text: "t", html: "<p>t</p>", replyTo: "r@example.com"})` with `fromEmail: "no-reply@example.com"`, `fromName: "App"`, and fetch answering 200 `{id: "re_1"}` → request body `{from: "App <no-reply@example.com>", to: ["a@example.com"], subject: "Hi", text: "t", html: "<p>t</p>", reply_to: "r@example.com"}`; result `{accepted: true, providerMessageId: "re_1"}`
    - no sender → `errorClass: "config"`, `errorCode: "resend-missing-from"`; fetch is not called
    - `templateId` set → `errorClass: "permanent"`, `errorCode: "resend-template-unsupported"`
    - 401 or 403 → `errorClass: "config"`, `errorCode: "resend-401"` / `"resend-403"`
    - 429 or 500 → `errorClass: "transient"`
    - 422 `{message: "Invalid `to` field"}` → `errorClass: "permanent"`, `error: "Invalid `to` field"`, `isPermanentFailure: true`
    - fetch rejects (network) → `errorClass: "transient"`, `errorCode: "resend-network"`
    - the API key never appears in a result, and `sendMail` never throws
  - Blast radius: none
  - Docs: none in this task; T16
  - Test skills: terreno-backend-tests

- [ ] **T15** — Add an Amazon SES mail adapter
  - Depends on: none
  - Files: comms/src/adapters/ses.ts, comms/src/adapters/ses.test.ts
  - Criteria: mail sends through SES v2 and failures map to the existing error classes. Verified by `bun test comms/src/adapters/ses.test.ts`.
  - Seam: exported class `SesMailProvider`
  - Interface: `new SesMailProvider({region?: string, fromEmail?: string, fromName?: string, configurationSetName?: string, sendEmail?: (input: SesSendEmailInput) => Promise<{MessageId?: string}>})` with `id === "ses"`. `SesSendEmailInput` is `{FromEmailAddress: string; Destination: {ToAddresses: string[]}; ReplyToAddresses?: string[]; ConfigurationSetName?: string; Content: {Simple: {Subject: {Data: string}; Body: {Text?: {Data: string}; Html?: {Data: string}}}}}`. `region` falls back to `AWS_REGION`. With no `sendEmail`, it loads `@aws-sdk/client-sesv2` lazily (credentials from the SDK's default chain) and throws `Error("SesMailProvider requires optional peer dependency @aws-sdk/client-sesv2. Install it with: bun add @aws-sdk/client-sesv2")` when absent.
  - Cases:
    - `sendMail({to: "a@example.com", subject: "Hi", text: "t", html: "<p>t</p>", replyTo: "r@example.com"})` with `fromEmail: "no-reply@example.com"`, `fromName: "App"`, `sendEmail` resolving `{MessageId: "m1"}` → input `{FromEmailAddress: "App <no-reply@example.com>", Destination: {ToAddresses: ["a@example.com"]}, ReplyToAddresses: ["r@example.com"], Content: {Simple: {Subject: {Data: "Hi"}, Body: {Text: {Data: "t"}, Html: {Data: "<p>t</p>"}}}}}`; result `{accepted: true, providerMessageId: "m1"}`
    - `configurationSetName: "cs"` → input has `ConfigurationSetName: "cs"`
    - no sender → `errorClass: "config"`, `errorCode: "ses-missing-from"`
    - `templateId` set → `errorClass: "permanent"`, `errorCode: "ses-template-unsupported"`
    - rejects with `name` of `AccessDeniedException`, `MailFromDomainNotVerifiedException`, `AccountSuspendedException` or `SendingPausedException`, or `$metadata.httpStatusCode: 403` → `errorClass: "config"`, `errorCode: "ses-<name>"`
    - rejects with `TooManyRequestsException`, `ThrottlingException`, or status 429 / ≥ 500 → `errorClass: "transient"`
    - rejects with `MessageRejected` or `BadRequestException` → `errorClass: "permanent"`, `isPermanentFailure: true`
    - `sendMail` never throws
  - Blast radius: none
  - Docs: none in this task; T16
  - Test skills: terreno-backend-tests

- [ ] **T16** — Publish the mail adapters, choose one from env in the example backend, and document them
  - Depends on: T13, T14, T15
  - Files: comms/package.json, knip.jsonc, bun.lock, comms/e2e/smoke.ts, example-backend/src/mailProvider.ts, example-backend/src/mailProvider.test.ts, example-backend/src/server.ts, example-backend/.env.example, docs/reference/comms.md, docs/how-to/send-email.md, docs/reference/environment-variables.md, docs/regression/comms.md, docs/regression/README.md, changelog/unreleased/comms-email-adapters.md
  - Criteria: consumers import each adapter from its own subpath; the example backend picks its mail provider from `MAIL_PROVIDER`; docs cover all four providers and local mail with Mailpit. Verified by `bun run --cwd comms smoke`, `bun test example-backend/src/mailProvider.test.ts`, `bun run check:knip`, and `bun run check:regression-suites`. The new suite is added to the Areas table in `docs/regression/README.md`.
  - Seam: the built package subpaths, and `createExampleMailProvider(env)` (exported function)
  - Interface: `comms/package.json` exports `./adapters/smtp`, `./adapters/resend`, `./adapters/ses` in the shape of the existing `./adapters/sendgrid` entry, and lists `nodemailer` and `@aws-sdk/client-sesv2` as optional peers. `createExampleMailProvider(env: NodeJS.ProcessEnv): MailProvider` reads `MAIL_PROVIDER` (`console` | `sendgrid` | `smtp` | `resend` | `ses`). With `MAIL_PROVIDER` unset it keeps today's rule from `example-backend/src/server.ts:324-332`: SendGrid when its key is set, otherwise console.
  - Cases:
    - `createExampleMailProvider({})` → `id === "console"`; `{SENDGRID_API_KEY: "k"}` → `id === "sendgrid"` (today's behaviour)
    - `{MAIL_PROVIDER: "smtp", SMTP_HOST: "localhost", SMTP_PORT: "1025"}` → `id === "smtp"`; `{MAIL_PROVIDER: "resend", RESEND_API_KEY: "k"}` → `id === "resend"`; `{MAIL_PROVIDER: "ses", AWS_REGION: "us-east-1"}` → `id === "ses"`
    - `{MAIL_PROVIDER: "resend"}` with no key → throws the adapter's missing-key error; `{MAIL_PROVIDER: "pigeon"}` → throws `Error("Unknown MAIL_PROVIDER: pigeon")`
    - E2 (smoke): a `TerrenoApp` built from the compiled packages with `SmtpMailProvider` (imported from `@terreno/comms/adapters/smtp`, in-memory `transport`) accepts an admin send, the transport received one message, and the comms dashboard lists it as `sent` with provider `smtp`
    - importing `@terreno/comms` with `nodemailer` and `@aws-sdk/client-sesv2` not installed does not throw
  - Blast radius: `example-backend/src/server.ts` mail wiring feeds auth recovery mail → `bun run --cwd example-backend test:ci` must pass unchanged
  - Docs: `docs/reference/comms.md` gains one section per adapter (options, env, error codes, the `templateId` limit) and a provider comparison table; new `docs/how-to/send-email.md` (pick a provider, local mail with Mailpit on `localhost:1025`, verified sender domains); `environment-variables.md` gains `MAIL_PROVIDER`, `SMTP_*`, `RESEND_API_KEY`, and the example backend's `STORAGE_ADAPTER`, `STORAGE_LOCAL_DIR`, `STORAGE_SIGNING_SECRET` and `S3_*` (read by T12); regression cases COMMS-new-1 to COMMS-new-3 in a new `docs/regression/comms.md`; `Added` changelog fragment
  - Test skills: terreno-backend-tests

## Assumptions

- Vendor SDKs stay out of the workspace install. Adapters define the structural subset of each client they use and tests inject doubles, the way `comms/src/adapters/sendgrid.ts` and its test do today (`knip.jsonc:221` ignores `@sendgrid/mail`).
- The storage API is exported from the `@terreno/api` package root. Package roots are allowed by the no-barrel rule; internal files import concrete modules.
- `createUploadsRouter` uses `modelRouter` with `collectionActions` and `instanceActions`, per the repository rule for application APIs. `LocalStorageApp` adds plain Express routes ahead of the body parsers because it serves raw bytes to a signed URL with no session, which falls under the same exception as the static SPA and webhook plugins.
- The API's existing CORS configuration covers a browser `PUT` to `LocalStorageApp` on the API origin. E3 proves it for the example app.
- `gcsKey` stays the field name on `FileAttachment` and in the `/files/*` routes even when the adapter is not GCS. Renaming it is a data migration and a breaking API change (X15).
- No change in this plan is breaking, so no upgrade note is needed: both existing constructors keep working, `DocumentStorageApp` keeps resolving `GCS_BUCKET` per request and answering 503 without it, and `DocumentStorageOptions.bucketName` only widens to optional.
- Supporting skills for the build: `terreno-backend-tests`, `terreno-frontend-tests`, `mongoose-schema-safety`, `update-docs`, `generate-sdk`, `verify-ui-changes`, `accessibility-testing`.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q8 (fundamental) | The audit group has ten more missing-feature items (6.5–6.10 and "Also absent"). Is it acceptable that this pass writes task lists for only storage, email and invitations, and ranks the rest as a backlog? | Yes, but this is the owner's call and was not assumed silently | The group is a roadmap of 13 unrelated features totalling roughly 20 weeks; two of them already have plans or issues (billing, search), three depend on other groups' plans, and a plan written now for work months away goes stale | Run distill on the next items in Expansions order: X2 (plugin guide), X3 (starter templates), X5 (test factories) | none here |
| Q1 | Should storage live in `@terreno/api` or a new `@terreno/storage` package? | In `@terreno/api`, under `api/src/storage/` | `ai` and `admin-backend` already depend on `api`; SDKs are optional peers so core stays light; a new package needs CircleCI filters, a coverage gate and a publish job | Files move to `storage/src/`, T5 becomes "create the package and its CI wiring" (about 2 extra days), and consumers import from `@terreno/storage` | T1–T9 (paths only), T5 |
| Q2 | Should uploads go straight to storage through a signed URL, or through the API as multipart? | Signed URL, direct to storage | No file bytes in API memory, no 10 MB ceiling tied to the API host, works the same on S3, R2 and GCS | T8–T10 change shape: `POST /uploads` takes multipart, `useFileUpload` sends `FormData`, `LocalStorageApp` loses its `PUT` route; bucket CORS docs go away | T2, T8, T9, T10 |
| Q3 | Should the new upload model replace `FileAttachment` in `@terreno/ai`? | Not in this plan | It needs a data migration and renames `gcsKey` in a public route; the adapter option already removes the GCS lock-in | Add a migration task and a breaking-change upgrade note; see X15 | T6, T8 |
| Q4 | Should the S3 adapter use the AWS SDK or Bun's built-in S3 client? | AWS SDK v3 as optional peers | Works on Node and Bun; `@terreno/api` has no `Bun.*` calls in `src` today | T4 loses the peers and the lazy load; adopters on Node lose the adapter | T4, T5 |
| Q5 | Should the new mail adapters render `templateId` messages somehow? | No: return a permanent `*-template-unsupported` failure | `templateId` means a SendGrid dynamic template; silently sending an empty body would be worse than failing | Each adapter task gains a template-mapping option | T13–T15 |
| Q6 | Should vendor SDKs be added as dev dependencies so the adapters typecheck against the real types? | No, follow the SendGrid precedent; prove real behaviour with the two regression cases | Keeps install size and the lockfile out of four parallel tasks | Add catalog entries and a type-conformance test per adapter; T4, T13, T15 then share `package.json` and must run in sequence | T3, T4, T13, T15 |
| Q7 | Who may read or delete an uploaded file? | Only its owner. Admins are refused too | Deny by default; in an app that holds PHI an admin minting a read URL for any user's file would be unaudited access | Add a `canRead` option (and `audit: true` on the router when admins are let in) and cases for it | T8, T9 |
| Q9 | Should this plan also add the `fileField()` model helper and wire storage and mail into the scaffold, so a brand-new app gets them without copying from the example? | Not in this plan: X16 and X18 | The scaffold belongs to `one-command-dev`, and `fileField` is small once T9 exists. Until then a new app registers the uploads router and a mail adapter by following two how-tos | Add one task after T9 for `fileField` (about 1 day) and one after T12 and T16 for the scaffold, which then depends on `one-command-dev` | new tasks |

## Expansions (follow up later)

Ranked by adoption impact against effort. X1–X13 are the rest of the audit's missing-features backlog (6.4–6.10 and the "Also absent" line). X14 onward came up while planning this work.

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Invitations and seat management. Planned: [`2026-11-13-invitations.md`](2026-11-13-invitations.md), issue [#1173](https://github.com/TerrenoLabs/terreno/issues/1173) | 6.4. Orgs ship with no way to bring in someone who has no account | M (1–2 weeks) | A real mail adapter (T13–T16 or SendGrid) |
| X2 | Plugin authoring guide, `generate plugin` template and a plugin index page. Slug `plugin-authoring-guide` | 6.7. `TerrenoPlugin` is used by every first-party package but no how-to explains it; cheapest differentiator on the list | S (2–3 days) | `plugin-contract-v2` (owned by `api-foundations`): write the guide against the v2 contract |
| X3 | Starter templates `--template minimal\|saas\|ai-chat`. Slug `starter-templates` | 6.6. One fixed scaffold shape (`create-terreno-app/src/cli.ts` has no `--template`) | M (1 week) | `one-command-dev` (owns the scaffold and the `minimal` template); `saas` needs X1 |
| X4 | App-facing `SchemaForm` and `ResourceList` in `@terreno/ui`, lifted from the admin renderers. Slug `schema-form-resource-list` | 6.5. Metadata-driven forms and tables exist only in `admin-frontend` | L (2 weeks) | `resource-generator` (its generated screens should use these); `ui-polish` for field primitives |
| X5 | Test factories: `defineFactory(Model, …)` in `@terreno/test`, reused by `seedRunner`. Slug `test-factories` | "Also absent". No factory or faker helper in `test/src` or `api/src` | S (3–4 days) | none |
| X6 | Search: implement `$search` with a Mongo text-index default and an Atlas Search option, plus a bound search field. Slug `search`, issue [#1183](https://github.com/TerrenoLabs/terreno/issues/1183) (global search) | 6.8. `api/src/api.ts:921-927` are no-ops | M–L (1–2 weeks) | none |
| X7 | Stripe billing plugin. Already planned: [`docs/implementationPlans/billing-stripe.md`](../implementationPlans/billing-stripe.md), tasks [`docs/tasks/billing-stripe.md`](../tasks/billing-stripe.md), issue [#1025](https://github.com/TerrenoLabs/terreno/issues/1025). Do not re-plan | 6.9 | L (3–4 weeks) | X1 for seat enforcement |
| X8 | i18n baseline: translation provider and extraction for `@terreno/ui` built-in strings and app strings. Slug `i18n-baseline` | 6.10. No i18n library in `ui` or `syncdb` | L (2 weeks) | `ui-polish` (string surfaces it touches) |
| X9 | Outbound webhooks: subscriptions, signed deliveries, retries through `@terreno/jobs`. Slug `outbound-webhooks` | "Also absent". Inbound webhooks exist; no delivery code | M (1 week) | none |
| X10 | RAG primitive for `@terreno/ai`: `embeddingsPlugin`, `$vectorSearch` retrieval, a harness retrieval tool. Slug `ai-rag` | "Also absent" | L (2 weeks) | none |
| X11 | Product analytics hook (PostHog / Segment adapter seam). Slug `analytics-hook` | "Also absent" | S (2–3 days) | none |
| X12 | OpenTelemetry spans around `modelRouter`, jobs and AI calls in the framework packages. Slug `opentelemetry`. Note: `example-backend` already wires OTel itself; the audit's "none anywhere" is wrong | "Also absent" | M (1 week) | none |
| X13 | Compose file in the scaffold for Fly, Render and Railway. Slug `compose-deploy-target`. Note: the scaffold already emits a `Dockerfile` (`generate.ts:270`); only Compose is missing | "Also absent" | S (2–3 days) | `one-command-dev` (owns the scaffold) |
| X14 | Content sniffing and a scan hook on `complete`: check magic bytes against the declared MIME type and call an app-supplied `scan(file)` before `ready` | The plan's Elephant | M | T8 |
| X15 | Replace `FileAttachment` with `StoredFile` in `@terreno/ai` and rename `gcsKey` to `key`, with a migration and an upgrade note | Q3; two file models is the audit's "two unrelated places" in a smaller form | M, breaking | T6, T8 |
| X16 | `fileField()` Mongoose helper that references a `StoredFile` and checks on write that the file is `ready` and owned by the writer | Audit opportunity 4 names it; T9's how-to shows the manual version | S | T9 |
| X17 | Delivery webhooks (bounce, delivered) for Resend and SES, like `comms/src/webhooks/sendgridWebhooks.ts` | New adapters report `sent` but never `delivered` or `bounced` | M | T14, T15 |
| X18 | Wire `@terreno/comms` with SMTP → Mailpit and the uploads router into the scaffold | The scaffold has no comms or storage wiring today | S | `one-command-dev` |
| X20 | Sweep stale `pending` uploads: a job that deletes `StoredFile` rows left `pending` for more than a day and their objects | Abandoned uploads are never cleaned up | S | T8, `@terreno/jobs` |
| X19 | Enterprise SSO ([#1184](https://github.com/TerrenoLabs/terreno/issues/1184)), multi-step wizard ([#1181](https://github.com/TerrenoLabs/terreno/issues/1181)), response caching | Audit "later, lower ratio" list; the first two already have roadmap issues | L each | wizard: `ui-polish` |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |

None. The owner answered no question for this plan; every choice above is a recommendation.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 17 findings: 15 fixed, 2 moved to questions (backlog-only coverage of 6.5–6.10 → Q8 fundamental; `fileField` and scaffold wiring → Q9), 0 rebutted. Blocking: round 1 had 2 (a `DocumentStorageApp` constructor throw that broke today's lazy 503, fixed; a scoping choice recorded as an owner decision, moved to Q8); round 2 had 2 (uploaded JSON bodies reaching the parsers and request log, fixed by mounting `LocalStorageApp` ahead of them; the example backend failing to boot in production with no storage env, fixed). Round 2's fixes were not re-cut (two-round cap). Not checked by cut: the exact `modelRouter` action envelopes T8 and T9 assert, and vendor SDK shapes, which the regression cases cover.
