> **createAppUserSyncPlugin**(`userModel`): `BetterAuthPlugin`

The plugin that guards and syncs the app User while the request that proves who the user is
(its password, its provider) is still in hand. Session middleware only sees later requests,
which carry neither.

- Before a Better Auth user is created: when an app User already has the email, creation is
  refused with 409 `VERIFY_EMAIL_TO_USE_ACCOUNT` (an OAuth callback redirects with that
  `error`) unless the provider verified the email or the sign-up password verifies against
  that User's passport hash. An app User bound to another Better Auth account is always
  refused, with 409 `ACCOUNT_ALREADY_EXISTS`. Nothing is left behind (no user, account, or verification mail),
  so a later verification cannot hand an attacker's password the victim's User.
- Before a session is created, the app User is synced: the OAuth provider id fills
  `oauthProvider`, and on `/sign-up/email` and `/sign-in/email` the plaintext password lets an
  unverified user claim a legacy User. A refusal fails the sign-in with the same 409s. A
  verified email that links a User whose own email was never verified revokes that User's
  legacy password and refresh tokens (see `revokeUnprovenLegacyPassword`).
- A failed link that a password was proving fails the sign-in (500 `APP_USER_LINK_FAILED`), so
  no session exists that would be refused on every request. Any other sync failure is logged
  and the session proceeds; the session middleware retries the sync on the next request.

## Parameters

### userModel

[`UserModel`](../interfaces/UserModel.md)

## Returns

`BetterAuthPlugin`
