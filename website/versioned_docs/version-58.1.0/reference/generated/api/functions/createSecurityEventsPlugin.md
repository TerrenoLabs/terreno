> **createSecurityEventsPlugin**(`userModel`): `BetterAuthPlugin`

The Better Auth plugin that records self-service security changes. `createBetterAuth` adds it
whenever it has a `userModel` (security principals are app User ids).

- Endpoint `hooks.after`: `/change-password` (password-changed), `/terreno/set-password`
  (password-set, a first password for an OAuth- or passkey-only user), `/revoke-other-sessions`
  (other-sessions-revoked), `/passkey/verify-registration` (passkey-added),
  `/passkey/delete-passkey` (passkey-removed), and a successful `/two-factor/*` request that
  changed the user's stored `twoFactorEnabled` (two-factor-enabled / two-factor-disabled). The
  change is detected by a `user.update.before` database hook that compares the value being
  written with the user row in the database, not with the (possibly cookie-cached) session.
  So enrolment counts once, the 2FA step of a sign-in never does, and admin resets (which run
  outside any Better Auth endpoint) are not mistaken for the user's own change.
- Database hooks, because they see the account row: a non-password `account` created for a
  user who already had another sign-in method (provider-linked, from `/link-social`, the link
  callback, the OAuth handoff, or implicit linking on sign-in), and an account deleted by
  `/unlink-account` (provider-unlinked). A first account is a sign-up, not a link.

A completed `/reset-password` is recorded from `onPasswordReset` in `createBetterAuth`
(password-reset), which knows the user the token belonged to.

## Parameters

### userModel

[`UserModel`](../interfaces/UserModel.md)

## Returns

`BetterAuthPlugin`
