# Account linking

One person can sign in to a Terreno app in several ways: email and password, Google, GitHub,
Apple, or a passkey. Account linking decides what happens when a new sign-in method arrives with
an email that already belongs to an account. Done carelessly, it is an account takeover. This page
explains the three modes, why Terreno asks for proof of the email before it links anything, and
how apps that started on JWT auth move their users over.

Setup: [Auth features](../how-to/configure-better-auth.md#auth-features). Reference:
[`GET {basePath}/terreno/methods`](../reference/api.md#better-auth-authentication).

## Two layers of accounts

A Terreno app with Better Auth has two records per person:

- **The Better Auth user** (`user` collection) owns sign-in. Each sign-in method is an `account`
  row under it: `credential` for email and password, `google`, `github`, and so on. Better Auth
  keeps emails unique, so there is at most one Better Auth user per email.
- **The app `User`** (your Mongoose model) owns everything else: permissions, `admin`,
  `disabled`, org memberships, and your data. It points at its Better Auth user through
  `betterAuthId`.

Linking happens at both layers. Better Auth decides whether a new provider `account` joins an
existing Better Auth user. Terreno decides whether a Better Auth user may claim an existing app
`User` (`syncBetterAuthUser`).

## The three modes

Set `accountLinking: {mode}` on `BetterAuthConfig`. The mode controls the Better Auth layer.

| Mode | A same-email sign-in with a new method | `POST {basePath}/link-social` |
| --- | --- | --- |
| `verified-email` (default) | Joins the account when both emails are verified | Links |
| `explicit` | Refused with `account_not_linked`; nothing is created | Links, from a signed-in session |
| `never` | Refused with `account_not_linked`; nothing is created | Refused with 403 `LINKING_DISABLED` |

- **`verified-email`** is the least friction: someone who signed up with email and password and
  later taps "Continue with Google" on the same address lands in the same account.
- **`explicit`** makes the user prove they own the existing account first. They sign in the old
  way, open the Security screen, and link the provider there. A login screen should turn
  `account_not_linked` into "sign in with your original method, then link this one".
- **`never`** keeps every sign-in method separate. Because Better Auth keeps emails unique, a
  second method on the same email cannot sign in at all. Pick it when a shared inbox must not
  join two people's records.

`/terreno/methods` reports the mode so clients can word their guidance. Unlinking the only
remaining sign-in method is refused in every mode (400 `FAILED_TO_UNLINK_LAST_ACCOUNT`), so a user
cannot lock themselves out.

### What the refusals look like

| Path | `account_not_linked` | Unverified email matches an app `User` |
| --- | --- | --- |
| OAuth redirect (`/callback/{provider}`) | Redirect with `?error=account_not_linked` | Redirect with `?error=VERIFY_EMAIL_TO_USE_ACCOUNT` |
| ID-token sign-in (`/sign-in/social` with `idToken`) | 401, `message: "account not linked"` | 409, `code: "VERIFY_EMAIL_TO_USE_ACCOUNT"` |
| Email sign-up or sign-in | n/a | 409, `code: "VERIFY_EMAIL_TO_USE_ACCOUNT"`, `message: "Verify your email to use this account"` |

## Why both emails must be verified

Linking by email trusts that whoever controls the email controls the account. That trust has to
hold on both sides:

- **The new method's email.** A provider that reports an unverified email has not checked that
  the person owns it. Linking on it lets anyone who types your address into that provider into
  your account. An unverified provider email never links, in any mode. `trustedProviders` turns
  this check off for the providers it lists, so list only providers that prove email ownership.
- **The existing account's email.** If the existing account was itself created without proving
  the email, an attacker can **pre-register**: sign up with the victim's address and a password
  the attacker knows, wait for the victim to sign in with Google, and share the account.
  Terreno keeps Better Auth's `requireLocalEmailVerified: true` in every mode, so an unverified
  local account never absorbs a new method.

The same rule applies one layer down. A Better Auth user claims an existing app `User` only when
the provider verified its email, or when the user proves they own that `User` another way (see
the migration below). Terreno checks this **before the Better Auth user is created**. An
unverified sign-up for someone else's address gets 409 "Verify your email to use this account"
and leaves nothing behind: no Better Auth user, no `account` row, no verification email. That
matters because a Better Auth user left behind would be a pre-registration one layer down: once
anyone verified that email (the victim clicking the mail the attacker's sign-up triggered, or an
admin), the attacker's password would open the victim's `User`. Terreno never inserts a second
`User` for the same email either.

Emails are compared ignoring case, so a legacy `User` stored as `Jane@Example.com` is protected
from a sign-up as `jane@example.com`, and claiming it never creates a second `User`.

**Trade-off: the 409 reveals that an account exists.** A sign-up that gets 409
`VERIFY_EMAIL_TO_USE_ACCOUNT` tells the caller that an app `User` already has that email. Terreno
accepts this account-existence signal: refusing silently would either leave the
pre-registration hole open or leave legitimate users stuck with no explanation, and Better Auth's
own sign-up already answers `USER_ALREADY_EXISTS` for emails it knows. Apps that must hide
membership (for example, where an account implies care) should rate-limit sign-up (the `auth`
bucket) and word the client message neutrally.

The guard needs a user model on the Better Auth instance. `BetterAuthApp` uses its own
`userModel`, or adopts `TerrenoApp`'s when it was given none, before it creates Better Auth. If you
call `createBetterAuth` yourself, pass `userModel` to it whenever a session middleware links app
`User`s.

Terreno then syncs the app `User` as each Better Auth session is created, while the request that
proves who the user is (its password, its provider) is still in hand. That is also when
`oauthProvider` is recorded. The session check repeats the claim rule as a second guard, and a
password-proven link that fails to save fails the sign-in (500 `APP_USER_LINK_FAILED`) instead of
leaving a session that every request would refuse.

## Apple private-relay emails

Sign in with Apple lets users hide their address. Apple then reports a relay address such as
`abc123@privaterelay.appleid.com`, marked verified, that forwards to the real inbox. It never
matches the email the person used elsewhere, so Apple sign-in creates a separate account in every
mode. Users who want one account sign in their usual way and link Apple from the Security screen
(`/link-social`). That link works only when Apple shares the real address ("Share My Email"):
Better Auth refuses a link whose email differs from the account's unless `allowDifferentEmails`
is on. Do not merge relay accounts by name: a name proves nothing.

## Several accounts on one device

Linking answers "is this the same person?". Some people really have several accounts, for example
a parent with their own login and a child's. They should not merge them. `multiSession` lets one
device hold several signed-in accounts and switch between them without signing out, and
`signUp: {mode: "closed"}` stops new accounts altogether. Together with the linking mode, these
are the three knobs an app has over "multiple accounts".

## Migrating users from JWT auth

Apps that started on Terreno's JWT and passport auth already have app `User`s with
passport-local-mongoose password hashes. When such a user first signs in through Better Auth with
the same email, Terreno links the new Better Auth user to their existing `User` if either:

- the sign-in comes from a provider (Google, GitHub, Apple, ...) that reports the email as
  verified, or
- the password they sign up with verifies against the `User`'s existing passport hash. The
  plaintext is checked only during that request and never stored. The check does not count as a
  failed JWT login, so with passport's `limitAttempts` a stranger signing up with the victim's
  email cannot lock the victim out.

Otherwise the sign-up answers 409 "Verify your email to use this account" and nothing is created.
Verifying the email afterwards cannot link anything, because there is no Better Auth user to
verify. Before this change, any unverified sign-up claimed the `User` with the same email, which
let anyone take over a legacy account by signing up with its address.

Users who signed in with GitHub through JWT have no password hash. They get in one of three ways:

- a provider sign-in whose email the provider verified;
- a password reset sent to their email through the JWT forgot-password flow
  (`POST /auth/forgotPassword`), then a Better Auth sign-up with the new password;
- an admin-issued account recovery link (see [account security](../reference/api.md#better-auth-authentication)
  once recovery is enabled) that sets their password and creates the Better Auth user.

To migrate smoothly:

1. Keep the JWT auth routes mounted while users move over, so forgot-password still works.
2. Tell users to sign up with the email and password they already use; those link at once.
3. Point users without a password at a provider sign-in or at JWT forgot-password.

## Learn more

- [Authentication architecture](authentication.md)
- [Configure Better Auth](../how-to/configure-better-auth.md)
- [Better Auth: users and accounts](https://www.better-auth.com/docs/concepts/users-accounts#account-linking)
