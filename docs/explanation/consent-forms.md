# Consent forms

`ConsentApp` gives an app versioned consent forms (terms, privacy, HIPAA, research, and
custom agreements), a record of every response, and a gate that keeps a user out of the app
until they have answered every form that applies to them.

## Forms and versions

A `ConsentForm` has a `slug`, a `version`, localized markdown `content`, and options such as
required checkboxes, a drawn signature, and whether the user may decline. Publishing
(`POST /consent-forms/:id/publish`) copies the form to `version + 1`, activates the copy, and
deactivates every other version of the same slug. Only active forms are shown to users. Publish a new version rather than editing
a form users have already answered, so each response still points at the text the user saw.

An app can narrow which active forms apply to a user with `resolveConsentForms(user, forms)`,
for example to show a research consent only to enrolled members. Every consent endpoint that
asks "which forms apply to this user" runs the same resolver.

## Responses

A `ConsentResponse` records one answer to one form version: `agreed`, `agreedAt`, the locale
shown, checkbox values, an optional signature, and `formVersionSnapshot`. With
`auditTrail: true`, it also keeps the user's IP address and user agent and a snapshot of the
exact content they saw. Responses are append-only. A user who answers again gets a new
record, so the history of what they agreed to, and when, is never rewritten.

## The gate

`GET /consents/pending` returns the forms that apply to the user and that the user has not
answered at the form's current version. The client (`ConsentNavigator` in `@terreno/ui`)
shows them one at a time until the list is empty. A decline also clears the form from the
list: the user has answered it.

When a form is republished, every user's earlier answer is for an older version, so the new
version reappears in their gate.

## Provisional signatures

Some consent is given before the user ever opens the app. A guardian may agree on the phone
at intake, or staff may record verbal consent during a visit. For compliance the form must
count as signed from that moment, but the user should still read the form and sign it
themselves.

A provisional signature is a `ConsentResponse` with `provisional: true`. Staff create it with
`POST /consent-responses/provisional`, naming the target user, the form, and a required note
that explains how consent was obtained. The response records:

- `agreed: true` and `agreedAt` (server time)
- `provisionalSignedBy`: the staff member who recorded it
- `provisionalNote`: the note (trimmed, at most 2000 characters)
- `formVersionSnapshot`, plus `contentSnapshot`, `provisionalSignerIp`, and
  `provisionalSignerUserAgent` when `auditTrail` is on

`ipAddress`, `userAgent`, `signature`, and `signedAt` stay empty. Those fields describe the
user's own device and signature, and the user did not sign.

### Why a provisional signature does not clear the gate

Only the user's own responses remove a form from `/consents/pending`. A provisional signature
is a record that someone else vouched for the user's consent. It is not the user's consent in
their own words. Keeping the form in the gate means the user still meets it, reads it, and
agrees or declines. The gate tells them who signed on their behalf and when, but not the
signer's note: that stays in the admin audit history. The user's own answer is stored as a separate response, so both records
stay for audit.

A separate `ProvisionalConsent` model was rejected. A field on `ConsentResponse` keeps one
audit trail per user and reuses the existing admin screens, populate paths, and PDF code.

### What counts as signed

`getConsentStatuses` (and `GET /consent-responses/status`) is the "considered signed"
contract. For each form that applies to the user, only responses to the current version
count. The user's own latest answer always wins: agreeing makes the form `signed`, declining
makes it `declined`. Without one, a provisional signature makes it `provisional`, which
counts as consented. Otherwise it is `pending`. App code that needs to know whether a user
may proceed (for example before scheduling a visit) checks `isConsented` on these rows
instead of reading responses directly.

### Who may sign for another user

Pass `accessControl` to `ConsentApp` to use RBAC. Any authenticated user whose roles grant
`consentResponse:signOnBehalf` may then sign for others. The built-in `admin` role includes
that action, and existing unsealed admin roles gain it the next time roles are seeded. The
merge runs on every seed, so removing `signOnBehalf` from the `admin` role does not stick.
To keep admins from signing, give them a custom role instead of `admin`.
Without `accessControl`, only users with `admin: true` may sign, and `ConsentApp` logs a
warning at register.

There is no relationship check: a permitted signer may sign for any user. A signer cannot
sign for themselves, and the form must be active and must apply to the target user under
`resolveConsentForms`. The same permission covers reading another user's consent statuses.
When `AuditApp` is registered, every provisional signature and every status read writes an
`AuditEvent` naming the actor and the target user. Audit events gain a `read` operation and
a `viewed` verb for these reads.

Reference: [ConsentApp](../reference/api.md#consent-forms-consentapp).
