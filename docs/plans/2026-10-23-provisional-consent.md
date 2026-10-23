# Provisional consent signing

Terreno's consent system today lets a user sign only for themselves: `ConsentNavigator` blocks
the app until the user agrees to every pending form, and admins can only read responses. Apps
such as Flourish need staff to record consent ahead of the user, for example after verbal
consent from a guardian at intake, so the form counts as signed for compliance while the user
still sees it and signs it themselves. This plan adds that provisional signature to the
consent API, ships an exported UI component apps can drop into any screen, and makes consent
printouts show the provisional signature.

## The idea

A `ConsentResponse` can now be **provisional**: `agreed: true`, `provisional: true`, signed by
another user (`provisionalSignedBy`), at a time (`agreedAt`), with a required free-text note
(`provisionalNote`). A new RBAC action, `consentResponse:signOnBehalf`, controls who may
create one. A provisional response counts as signed in `getConsentStatuses`, a new server helper
and endpoint. It does **not** clear the form from `/consents/pending`, so the user still
meets the form in the gate, now with a "Signed on your behalf by <name> on <date>" notice.
The user's own answer always wins: agreeing makes the status `signed`, and declining makes it
`declined`. Both records stay for audit. A provisional signature made in error can be voided,
with the void kept on record.

`@terreno/ui` exports `ProvisionalConsentSigner`: given a target `userId`, it lists that user's
forms with status and lets the signer read a form, fill in the note box, and sign it
provisionally. Consent printouts (a new print action, plus the existing PDF downloads)
include a "Provisional signature" block.

Rejected: a separate `ProvisionalConsent` model. A field on `ConsentResponse` keeps one audit
trail per user and reuses the existing admin screens, populate paths, and PDF code.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Provisional sign endpoint + RBAC (tracer) | none | api | `bun test api/src/consentApp.test.ts api/src/rbac` |
| T2 | Provisional notice data on user-facing payloads | T1 | api | `bun test api/src/consentApp.test.ts` |
| T3 | `getConsentStatuses` helper + status endpoint + admin columns + SDK | T2 | api, example-frontend SDK | `bun test api/src/consentStatus.test.ts api/src/consentApp.test.ts` |
| T4 | Void a provisional signature | T3 | api | `bun test api/src/consentApp.test.ts` |
| T5 | Provisional notice in the consent gate | none | ui | `bun test ui/src/ConsentFormScreen.test.tsx` |
| T6 | `ProvisionalConsentSigner` status list + hook | none | ui | `bun test ui/src/ProvisionalConsentSigner.test.tsx` |
| T7 | Sign flow with note box in `ProvisionalConsentSigner` | T6 | ui | same |
| T8 | Print helper + provisional block in PDF template | none | ui | `bun test ui/src/pdfHtmlTemplate.test.ts` |
| T9 | Provisional block in admin-frontend PDF generators | T8 | admin-frontend | `bun test admin-frontend/src` (PDF + isolated) |
| T10 | Print buttons + provisional display in admin and user consent views | T9 | admin-frontend | `bun test admin-frontend/src/Consent*.test.tsx` |
| T11 | Print and void buttons in `ProvisionalConsentSigner` | T7, T8 | ui | `bun test ui/src/ProvisionalConsentSigner.test.tsx` |
| T12 | Example app routes + backend wiring + E2E (admin and RBAC staff) | T4, T5, T11 | example-backend, example-frontend | `bun run frontend:e2e -- provisionalConsent.spec.ts` + screenshots |
| T13 | UI, admin, how-to docs + changelog | T10, T12 | docs, changelog | `bun run check:changelog`, `bun run check:knip`, docs-audit skill |

Tracer: `POST /consent-responses/provisional` → `ConsentResponse{provisional: true}` → form still in `/consents/pending`.
Out of scope: printing blank forms, bulk provisional signing, org or relationship scoping of who can sign for whom (see Expansions).
Open risks: staff with `signOnBehalf` can list any user's consent statuses. You chose RBAC with no relationship check, so these reads and writes are audited (T1, T3) when `AuditApp` is registered.

## Contracts

### Model: `ConsentResponse` (additive, no migration)

| Field | Type | Notes |
| --- | --- | --- |
| `provisional` | `Boolean`, default `false` | `true` only on responses created by `/consent-responses/provisional` |
| `provisionalSignedBy` | `ObjectId` ref `User` | The signer. Required when `provisional` |
| `provisionalNote` | `String` | Required, trimmed, non-empty, max 2000 chars when `provisional` |
| `provisionalSignerIp` / `provisionalSignerUserAgent` | `String` | Signer's request metadata, set when `auditTrail` is on |
| `voidedAt` / `voidedBy` / `voidReason` | `Date` / `ObjectId` ref `User` / `String` | Set only by the void action (T4) |

For provisional responses, `agreed` is always `true` and `agreedAt` is the server time.
`signature`/`signedAt` stay unset. `ipAddress`/`userAgent` stay unset, because those fields mean
the **user's** device. `formVersionSnapshot` is always set. `contentSnapshot` is set when
`auditTrail` is on. Existing documents read as `provisional: false` through the schema default.

### RBAC

`terrenoStatements.consentResponse` becomes `["list", "read", "signOnBehalf"]`, with a
description in `terrenoStatementDescriptions`. The built-in `admin` role definition gets
`consentResponse: ["signOnBehalf"]`. The `admin` role upsert in `roleModel.ts` adds
`consentResponse` to **existing** unsealed admin roles through `mergeMissingResourcePermissions`,
as it already does for observability resources. Without that, existing databases such as
Flourish would not get the permission. `superadmin` already has `*`.

`ConsentAppOptions` gains `accessControl?: AnyTerrenoAccess`. The same rule covers sign, status,
and void:

| `accessControl` passed | Who may act |
| --- | --- |
| yes | Any authenticated user whose roles grant `consentResponse:signOnBehalf` |
| no | `user.admin` only (legacy apps without RBAC); one `logger.warn` at register |

### Status rules (`getConsentStatuses`, T3)

For each active form after `resolveConsentForms(targetUser, forms)`, look only at non-voided
responses for the form's **current version**:

1. If the user has their own (non-provisional) response, the latest one decides: `agreed` →
   `signed`, declined → `declined`.
2. Otherwise, if a provisional response exists → `provisional`. It counts as signed.
3. Otherwise → `pending`.

`isConsented` is `true` for `signed` and `provisional`. Exported from `@terreno/api`:
`getConsentStatuses({userId, resolveConsentForms?}) → Promise<ConsentStatusRow[]>`. App code
uses this as the "considered signed" contract.

### API (modelRouter `collectionActions` / `instanceActions` on `/consent-responses`)

| Method + path | Body / query | Response | Errors |
| --- | --- | --- | --- |
| `POST /consent-responses/provisional` | `{userId, consentFormId, note, locale?}` | `{data: ConsentResponse}` (populated `provisionalSignedBy` name/email) | 400: missing ids, blank note, inactive form, form not in target user's resolved set, `userId` = signer. 404: unknown user or form. 403/405: no permission |
| `GET /consent-responses/status?userId=` | — | `{data: ConsentStatusRow[]}` | 400 missing `userId`; 404 unknown user; 403/405 |
| `POST /consent-responses/:id/void` | `{reason}` | `{data: ConsentResponse}` | 400: blank reason, not provisional, already voided. 403/405 |

`ConsentStatusRow = {form: ConsentFormPublic, status: "pending" | "provisional" | "signed" | "declined", isConsented, respondedAt?, provisional?: {responseId, signedAt, signedBy: {id, name, email}, note}}`.

User-facing changes (T2). The user never sees the note or the signer's request metadata:

- `GET /consents/pending`: only non-provisional responses remove a form, as today, including
  declines. Each form carries `provisionalSignature?: {signedAt, signedByName}` from the latest
  non-voided provisional response for its current version.
- `GET /consents/my`: entries add `provisional`, `provisionalSignedBy: {name} | null`, `voidedAt`.
  No note and no signer IP/UA.
- `GET /consents/audit/:userId` (admin): adds every provisional and void field.

Audit: when `AuditApp` is registered, sign, void, and status reads each call `recordAuditEvent`
(`api/src/audit/record.ts`) with actor, target user, form id, and action. Writes are best-effort,
as everywhere else.

### UI exports (`@terreno/ui`)

```tsx
<ProvisionalConsentSigner
  api={terrenoApi}        // consumer RTK api, same pattern as ConsentNavigator
  baseUrl?: string
  userId="..."            // the user being signed for
  onSigned?={(response) => void}
  onError?={(error) => void}
  variables?: Record<string, string>
/>
```

- `useProvisionalConsent(api, baseUrl)` → `{statuses, isLoading, error, refetch, sign, isSigning, voidSignature}`. It injects `getConsentStatus`, `signConsentProvisionally`, and `voidProvisionalConsent`. Mutations invalidate `ConsentStatus` and `PendingConsents`.
- `printConsentHtml({html})`: native → `expo-print` `printAsync`; web → hidden iframe + `contentWindow.print()`.
- `PdfTemplateData.provisionalSignature?: {signedAt, signedByName, note?, signerIp?, voidedAt?}` rendered by `buildConsentPdfHtml` as a "Provisional signature" section.

testIDs: `provisional-consent-signer`, `provisional-consent-row-{formId}`, `provisional-consent-status-{formId}`, `provisional-consent-open-{formId}`, `provisional-consent-note-input`, `provisional-consent-submit-button`, `provisional-consent-success`, `provisional-consent-print-{formId}`, `provisional-consent-void-{formId}`, `consent-form-provisional-notice`, `consent-history-print-{entryId}`, `consent-response-print-button`.

## Tasks

- [x] **T1** — Add provisional consent signing endpoint
  - Depends on: none
  - Files: api/src/types/consentResponse.ts, api/src/models/consentResponse.ts, api/src/rbac/statements.ts, api/src/rbac/roleModel.ts, api/src/rbac/roleModel.test.ts, api/src/rbac/statements.test.ts, api/src/consentApp.ts, api/src/consentApp.test.ts, docs/explanation/consent-forms.md (new), docs/reference/api.md
  - Criteria (each a test):
    - Admin, no `accessControl`: POST returns 200. The stored response has `provisional: true`, `agreed: true`, `provisionalSignedBy` = signer id, `provisionalNote` = trimmed note, `agreedAt` in the test window, `formVersionSnapshot` = form version, and no `ipAddress`/`userAgent`. With `auditTrail`, `provisionalSignerIp` is set.
    - With `createAccess` and a role granting `consentResponse:signOnBehalf`, a non-admin gets 200. Without it, 403 or 405. A non-admin without `accessControl` gets 403 or 405.
    - Blank note → 400; `userId` = signer → 400; inactive form → 400; form filtered out by `resolveConsentForms` for the target → 400; unknown user → 404.
    - After a provisional sign, the target's `/consents/pending` still lists the form. After the target's own `/consents/respond`, it does not.
    - Role upsert: a fresh database's Admin role includes `consentResponse:signOnBehalf`. An **existing** unsealed admin role without `consentResponse` gains it on the next upsert. A sealed role is untouched.
    - With `AuditApp` registered, a sign writes one `AuditEvent` naming actor, target user, and form.
  - Verification: `bun test --only-failures api/src/consentApp.test.ts api/src/rbac`
  - Docs: create `docs/explanation/consent-forms.md` (forms, responses, versions, the gate, provisional signing, and why it doesn't clear the gate). Add a `ConsentApp` section to `docs/reference/api.md`: the options table with `accessControl`, plus the provisional endpoint.
  - Skills: terreno:terreno-backend-api, terreno:mongoose-schema-safety, model-router-actions, terreno:backend-test-env

- [x] **T2** — Expose provisional signature notice data on user-facing consent payloads
  - Depends on: T1
  - Files: api/src/consentApp.ts, api/src/consentApp.test.ts, docs/reference/api.md
  - Criteria: after a provisional sign, the `/consents/pending` form has `provisionalSignature.{signedAt, signedByName}` and no `note`. A form without one has no `provisionalSignature`. `/consents/my` entries include `provisional` and `provisionalSignedBy.name`, but no note and no signer IP/UA (asserted absent). `/consents/audit/:userId` includes all provisional fields. Existing pending/my/audit tests still pass.
  - Verification: `bun test --only-failures api/src/consentApp.test.ts`
  - Docs: response shapes in `docs/reference/api.md`.
  - Skills: terreno:terreno-backend-api

- [x] **T3** — Add getConsentStatuses helper, status endpoint, and provisional admin columns
  - Depends on: T2
  - Files: api/src/consentStatus.ts (new), api/src/consentStatus.test.ts (new), api/src/index.ts, api/src/consentApp.ts, api/src/consentApp.test.ts, docs/reference/api.md, docs/explanation/consent-forms.md, example-frontend/store/openApiSdk.ts
  - Criteria: `getConsentStatuses` implements the status rules, with one test each for `pending`, `provisional`, `signed`, `declined`, "user agrees after provisional → `signed`", "user declines after provisional → `declined`", "old-version responses ignored", and "resolver filters forms for the target user". It is exported from `@terreno/api`. `GET /consent-responses/status?userId=` returns its rows, with the same permission matrix as T1, and writes an `AuditEvent` per read when `AuditApp` is registered. The "Consent Responses" admin contribution adds `provisional` to `listFields` plus a boolean filter, and `provisionalSignedBy` to populate paths.
  - Verification: `bun test --only-failures api/src/consentStatus.test.ts api/src/consentApp.test.ts`; `cd example-frontend && bun run sdk` diff contains the new operations
  - Docs: helper and endpoint in `docs/reference/api.md`; "considered signed" rules in the explanation page.
  - Skills: terreno:terreno-backend-api, terreno:generate-sdk

- [x] **T4** — Void a provisional consent signature
  - Depends on: T3
  - Files: api/src/types/consentResponse.ts, api/src/models/consentResponse.ts, api/src/consentApp.ts, api/src/consentStatus.ts, api/src/consentApp.test.ts, api/src/consentStatus.test.ts, docs/reference/api.md, example-frontend/store/openApiSdk.ts
  - Criteria: `POST /consent-responses/:id/void` with a reason sets `voidedAt`/`voidedBy`/`voidReason` and never deletes the record. Voiding a non-provisional response, voiding twice, or a blank reason → 400. Same permission matrix as T1. After a void, `getConsentStatuses` returns `pending`, and `/consents/pending` drops `provisionalSignature`. With `AuditApp`, a void writes an `AuditEvent`.
  - Verification: `bun test --only-failures api/src/consentApp.test.ts api/src/consentStatus.test.ts`; SDK regenerated
  - Skills: terreno:terreno-backend-api, terreno:mongoose-schema-safety

- [x] **T5** — Show provisional notice in the consent gate
  - Depends on: none (contract above)
  - Files: ui/src/useConsentForms.ts, ui/src/ConsentFormScreen.tsx, ui/src/ConsentFormScreen.test.tsx
  - Criteria: adds `ConsentFormPublic.provisionalSignature?: {signedAt, signedByName}`. When it is set, `consent-form-provisional-notice` shows "Signed on your behalf by <name> on <date>" (Luxon `DATETIME_MED`) above the content. Agree, decline, the scroll gate, checkboxes, and the signature requirement are unchanged, and existing tests pass. When it is unset, no notice shows.
  - Verification: `bun test --only-failures ui/src/ConsentFormScreen.test.tsx`
  - Skills: terreno:terreno-ui, accessibility-testing

- [x] **T6** — Add ProvisionalConsentSigner status list and useProvisionalConsent hook
  - Depends on: none (contract above)
  - Files: ui/src/useProvisionalConsent.ts, ui/src/useProvisionalConsent.test.ts, ui/src/ProvisionalConsentSigner.tsx, ui/src/ProvisionalConsentSigner.test.tsx, ui/src/lazyBoundaries/heavyOptionalExports.tsx, ui/src/index.tsx
  - Criteria: the hook injects `getConsentStatus` (`GET {base}/consent-responses/status?userId=`) once per (api, baseUrl), following the `useConsentForms` cache pattern. The component shows a spinner while loading, an error with Retry on failure, and one row per form with title and status badge: `Pending`, `Signed provisionally by X on date`, `Signed by user on date`, or `Declined by user on date`. It is exported lazily from `@terreno/ui`, like `ConsentNavigator`. `RootImportRegression` passes.
  - Verification: `bun test --only-failures ui/src/useProvisionalConsent.test.ts ui/src/ProvisionalConsentSigner.test.tsx ui/src/RootImportRegression.test.tsx`
  - Skills: terreno:terreno-ui, terreno:terreno-data-fetching

- [x] **T7** — Sign on behalf with a note box in ProvisionalConsentSigner
  - Depends on: T6
  - Files: ui/src/useProvisionalConsent.ts, ui/src/useProvisionalConsent.test.ts, ui/src/ProvisionalConsentSigner.tsx, ui/src/ProvisionalConsentSigner.test.tsx
  - Criteria: `pending` and `declined` rows have `provisional-consent-open-{formId}`. Opening one shows the form content read-only (`MarkdownView`, `variables` applied) and a required multiline `provisional-consent-note-input`. Submit stays disabled until the note is non-blank. Submit POSTs `{userId, consentFormId, note, locale}`, then shows `provisional-consent-success` with the signer name and time from the response, and calls `onSigned`. Server errors show inline and call `onError`.
  - Verification: `bun test --only-failures ui/src/ProvisionalConsentSigner.test.tsx ui/src/useProvisionalConsent.test.ts`
  - Skills: terreno:terreno-ui, terreno:terreno-data-fetching, accessibility-testing

- [x] **T8** — Add print helper and provisional block to the consent PDF template
  - Depends on: none
  - Files: ui/src/pdfHtmlTemplate.ts, ui/src/pdfHtmlTemplate.test.ts
  - Criteria: `buildConsentPdfHtml` renders a "Provisional signature" section (signer, date, escaped note when given, signer IP when given, "Voided <date>" when voided) when `provisionalSignature` is set, and nothing extra otherwise. `printConsentHtml({html})` calls `expo-print` `printAsync({html})` on native. On web it appends a hidden iframe with the HTML, calls `contentWindow.print()`, and removes the iframe. Unit tests cover both paths with mocks.
  - Verification: `bun test --only-failures ui/src/pdfHtmlTemplate.test.ts`
  - Skills: terreno:terreno-ui

- [x] **T9** — Include provisional signatures in admin-frontend consent PDFs
  - Depends on: T8
  - Files: admin-frontend/src/generateConsentPdf.ts, admin-frontend/src/generateConsentHistoryPdf.ts, admin-frontend/src/useConsentHistory.ts, admin-frontend/src/isolated/generateConsentPdf.isolated.ts, admin-frontend/src/isolated/generateConsentHistoryPdf.isolated.ts, admin-frontend/src/isolated/generateConsentPdfMobile.isolated.ts, admin-frontend/src/isolated/generateConsentPdfsMobile.isolated.ts, plus their test files
  - Criteria: response and history types carry the provisional fields. Web jsPDF output for a provisional response contains "Provisional signature", the signer name, and the date. The admin response PDF also has the note and signer IP. The user history PDF has no note. The native path passes `provisionalSignature` to `buildConsentPdfHtml`, and both mobile isolated tests assert it (extend their `@terreno/ui` mocks). Non-provisional output is unchanged. Each generator exports the template-data builder it uses, for T10.
  - Verification: `bun test --only-failures admin-frontend/src`
  - Skills: terreno:building-admin-interfaces

- [ ] **T10** — Add print buttons and provisional display to admin and user consent views
  - Depends on: T9
  - Files: admin-frontend/src/ConsentResponseViewer.tsx, admin-frontend/src/ConsentResponseViewer.test.tsx, admin-frontend/src/ConsentHistory.tsx, admin-frontend/src/ConsentHistory.test.tsx
  - Criteria: `ConsentResponseViewer` (admin) shows a "Provisional" badge, signer, date, note, and void state. `ConsentHistory` (the user's own) shows the badge, signer, and date, with no note. `consent-response-print-button` and per-entry `consent-history-print-{entryId}` call `printConsentHtml` with HTML containing the provisional block. Tests assert the HTML string. Existing download buttons still work.
  - Verification: `bun test --only-failures admin-frontend/src/ConsentResponseViewer.test.tsx admin-frontend/src/ConsentHistory.test.tsx`
  - Skills: terreno:building-admin-interfaces, terreno:terreno-ui

- [ ] **T11** — Print and void from ProvisionalConsentSigner
  - Depends on: T7, T8
  - Files: ui/src/useProvisionalConsent.ts, ui/src/useProvisionalConsent.test.ts, ui/src/ProvisionalConsentSigner.tsx, ui/src/ProvisionalConsentSigner.test.tsx
  - Criteria: `provisional`, `signed`, and `declined` rows, plus the success state, show `provisional-consent-print-{formId}`. It calls `printConsentHtml` with HTML from `buildConsentPdfHtml` containing the form content and, for provisional rows, the provisional block with the note. `provisional` rows show `provisional-consent-void-{formId}`, which asks for a reason in a `Modal`, POSTs `/void`, and refetches, so the row returns to `Pending`.
  - Verification: `bun test --only-failures ui/src/ProvisionalConsentSigner.test.tsx ui/src/useProvisionalConsent.test.ts`
  - Skills: terreno:terreno-ui

- [ ] **T12** — Wire provisional signing into the example apps with E2E coverage
  - Depends on: T4, T5, T11
  - Files: example-backend/src/server.ts, example-frontend/app/consent-sign/[userId].tsx (new), example-frontend/app/admin/consent-responses/[id].tsx, example-frontend/e2e/provisionalConsent.spec.ts (new), example-frontend/e2e/helpers/consentForms.ts, example-frontend/e2e/fixtures/testUsers.ts
  - Criteria: `ConsentApp` gets `accessControl: access`. `/consent-sign/[userId]` (outside `/admin`, so non-admin staff can reach it) renders `ProvisionalConsentSigner`. The admin response detail links to it. E2E cases:
    1. Admin opens a pending form, fills the note, and submits. The row shows provisional.
    2. The test user logs in and sees the gate with `consent-form-provisional-notice` and no note text. They agree and reach the app.
    3. Admin reloads, and the row shows signed.
    4. Setup creates a role with `consentResponse:["signOnBehalf"]` through the RBAC API and assigns it to a non-admin staff user, who signs provisionally from the same route.
    5. A non-admin user without the role sees the error state.

    Screenshots of the signer, the notice, and the print HTML go in `/opt/cursor/artifacts/`.
  - Verification: `bun run frontend:e2e -- provisionalConsent.spec.ts`; terreno:verify-ui-changes evidence
  - Skills: terreno:verify-ui-changes, accessibility-testing

- [ ] **T13** — Document provisional consent signing and printing
  - Depends on: T10, T12
  - Files: docs/reference/ui.md, docs/reference/admin-frontend.md, docs/how-to/sign-consent-on-behalf.md (new), docs/how-to/README.md, docs/explanation/README.md, changelog/unreleased/provisional-consent-signing.md (new)
  - Criteria: `ui.md` documents `ProvisionalConsentSigner`, `useProvisionalConsent`, `printConsentHtml`, and the gate notice. `admin-frontend.md` documents the print buttons and provisional display. The how-to covers granting `consentResponse:signOnBehalf` (including the existing-admin-role merge on upgrade), passing `accessControl` to `ConsentApp`, mounting the component, using `getConsentStatuses`, voiding, and printing. Both README indexes link the new pages. There is an `Added` changelog fragment.
  - Verification: `bun run check:changelog`; `bun run check:knip`; the docs-audit skill reports no undocumented new exports
  - Skills: terreno:update-docs, docs-audit

## Assumptions

- Endpoints are `collectionActions`/`instanceActions` on the existing `/consent-responses` modelRouter, not new hand-written `/consents` routes (repo rule: no new `router.post`).
- Permission lists are ANDed (`checkPermissions`, `api/src/permissions.ts:110`), so the actions build their own list from `accessControl` instead of using `action.access`.
- `ConsentApp` mounts routers without a path, so `TerrenoApp`'s `accessControl` does not reach them automatically. It is passed as an option.
- The target user is loaded with `mongoose.model("User")`. `resolveConsentForms` receives that document.
- The provisional signer does not tick checkboxes or draw a signature. The note is the only box (D3). Required checkboxes stay the user's to tick.
- `ConsentNavigator` needs no change. It renders whatever `/consents/pending` returns, and T5 adds the notice inside `ConsentFormScreen`.
- The user's own decline still clears the gate, as today. A decline after a provisional sign makes the status `declined`, not signed.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q4 | What does "print consent forms" cover? | A user's form with its signatures, from the admin response view, the user's history, and the signer component | Matches "make sure the provisional is included" | Also print blank forms from the form list (X1) | T8–T11 |
| Q5 | When organizations are on, limit signers to users in their org? | No, RBAC only, as chosen | You picked RBAC with no relationship check; reads and writes are audited | Add an org-membership check to sign, status, and void | T1, T3, T4 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Print blank consent forms from the admin form list | "print consent forms" could mean blank forms | S | T8 |
| X3 | App hook `canSignOnBehalf(signer, target, form)` for relationship checks (guardian, care team) | RBAC has no target-user check | M | T1 |
| X4 | Bulk provisional sign of all pending forms for a user | Intake usually covers several forms | S | T7 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Who may provisionally sign for another user? | RBAC permission | New `consentResponse:signOnBehalf` statement; no app hook or relationship check |
| D2 | What does the user see after a provisional signature? | Same gate + notice | Provisional responses don't clear `/consents/pending`; `ConsentFormScreen` shows a notice; the user must still agree |
| D3 | What is the box the provisional signer fills in? | Note only | Required `provisionalNote` text; no drawn signature from the signer |
| D5 | Can a provisional signature made in error be undone? | 1a: yes, void action that keeps the record | T4, void button in T11 |
| D6 | Should the user see the signer's note? | 2a: no, name and date only | Note only in admin, audit, printouts (T2, T5, T9, T10) |
| D7 | Without RBAC, fall back to `user.admin`? | 3a: yes, with a warning log | T1, T3, T4 permission matrix |
| D4 | (follow-up message) Printing | "add in the ability to print consent forms and make sure the provisional is included" | T8–T11 |

## Sign-off

Status: approved 2026-10-23
Cut: 1 round, 12 findings: 11 fixed (F1 status rules + `declined`, F2 existing-admin-role merge, F3 note hidden from user, F4 signer IP/UA in own fields, F5 `getConsentStatuses` export, F6 resolver check on sign, F7 audit events, F9 real verification commands, F10 mobile isolated tests, F11 per-entry testIDs + view naming, F12 RBAC staff E2E), 1 moved to questions (F8 → Q1, built on its recommendation as T4), 0 rebutted
