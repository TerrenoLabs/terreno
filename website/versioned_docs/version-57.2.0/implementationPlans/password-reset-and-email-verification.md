# Implementation Plan: Password reset and email verification

**Status:** Draft
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1023
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-08-09
**Program:** [B2B platform](b2b-platform-program.md)
**Depends on:** [comms-abstraction](comms-abstraction.md), [comms-adapter-sendgrid](comms-adapter-sendgrid.md)
**RTK deprecation flag:** None — the RTK client's existing `resetPassword` endpoint gets a
backend at last; new client work is a thin screen pair noted in UI

## Goal

The JWT auth path has no way to recover an account or verify an email address: the
`@terreno/rtk` client ships a `resetPassword` mutation with **no backend route**, and
nothing sets or checks email verification. This IP adds forgot/reset password and email
verification flows to `@terreno/api`'s JWT auth, wires the Better Auth equivalents to the
same mail templates, and sends everything through `@terreno/comms`.

## Non-Goals

- MFA / step-up auth (`mfa-step-up-auth` item).
- Magic-link login.
- SMS-based recovery (possible later via the Twilio Verify adapter).
- Account lockout / brute-force throttling beyond token single-use + expiry
  (`rate-limiting` item hardens the endpoints).

## Decisions

| Question | Decision |
|----------|----------|
| Token design | 32-byte crypto-random token, stored **hashed** (sha256) with expiry (`1h` reset / `24h` verify) and single-use consumption; separate `AuthToken` collection rather than fields on User |
| Enumeration safety | `POST /auth/forgotPassword` always returns 202 regardless of whether the email exists |
| Password set mechanism | `passport-local-mongoose`'s `setPassword` on the user document, then invalidate all refresh tokens |
| RTK client compatibility | The existing RTK `resetPassword` endpoint's path/shape is the contract — verify at implementation time and alias if it differs from `/auth/resetPassword` |
| Verification gating | Opt-in `requireEmailVerification` auth option: unverified users get 403 with code `email-not-verified` on login; default off (non-breaking) |
| Better Auth path | Enable Better Auth's built-in reset/verification, providing `sendResetPassword` / `sendVerificationEmail` hooks that call the same comms templates so both auth paths send identical mail |
| Link targets | Deep-link/URL base from a new `authOptions.publicAppUrl`; web route examples in example-frontend |

## Architecture

```
api/src/authTokens.ts      # AuthToken model + issue/consume helpers
api/src/authRecovery.ts    # forgot/reset/verify routes + options
                           # registered by addAuthRoutes when comms is available
comms templates            # resetPassword + verifyEmail templates (subject/text/html)
```

Flow (reset): `POST /auth/forgotPassword {email}` → 202 always; if user exists, issue
token, send mail with `${publicAppUrl}/resetPassword?token=...` → `POST
/auth/resetPassword {token, password}` → validate + consume token, `setPassword`,
invalidate refresh tokens, 200.

Flow (verify): token issued on signup (and via `POST /auth/sendVerification` for
re-sends, authenticated); `POST /auth/verifyEmail {token}` sets `user.emailVerified =
true`.

## Models

**AuthToken** — `userId` (ref User, required, indexed), `tokenHash` (string, unique),
`type` ("passwordReset" | "emailVerification"), `expiresAt` (date, TTL-indexed),
`consumedAt` (date, optional). Statics: `issueFor(user, type)`, `consume(token, type)`
(atomic findOneAndUpdate guarding single-use).

**User** — adds `emailVerified` (boolean, default false) via a small
`emailVerificationPlugin` so existing user schemas opt in without breaking.

## APIs

| Method | Path | Permissions | Notes |
|---|---|---|---|
| POST | `/auth/forgotPassword` | anonymous | `{email}` → always 202 |
| POST | `/auth/resetPassword` | anonymous | `{token, password}`; path/shape matched to the RTK client contract |
| POST | `/auth/sendVerification` | IsAuthenticated | Re-send verification mail |
| POST | `/auth/verifyEmail` | anonymous | `{token}` |

All registered by `addAuthRoutes` when a mail-capable `CommsApp` is present; without one,
routes 501 in production and console-send in development (inherited comms behavior).

## Notifications

Two mail templates (`resetPassword`, `verifyEmail`) shipped in `@terreno/comms` templates
with app-override hooks.

## UI

example-frontend: `/resetPassword` (token from URL, new-password form using the existing
RTK `resetPassword` mutation) and a "verify your email" banner + re-send button on the
profile screen. `LoginScreen` gains an optional `onForgotPassword` link prop in
`@terreno/ui`.

## Phases

1. **Token infrastructure:** AuthToken model, issue/consume, `emailVerificationPlugin`,
   unit tests.
2. **JWT routes + mail:** four routes, templates, refresh-token invalidation,
   enumeration-safety + single-use/expiry test suite.
3. **Better Auth parity:** wire `sendResetPassword`/`sendVerificationEmail` hooks to the
   same templates; parity tests.
4. **Client + docs:** example-frontend screens, `@terreno/ui` login link prop, SDK regen,
   `docs/how-to/password-reset.md`, env/reference docs.

## Feature Flags & Migrations

`requireEmailVerification` defaults off; enabling it for an existing app is documented
(backfill `emailVerified: true` for existing users or accept re-verification). No schema
migration otherwise.

## Activity Log & User Updates

Token issue/consume and verification events logged via `logger` and `CommsMessage`
rows; no user-facing activity feed.

## Not Included / Future Work

- Password strength policy hooks (exists via `PasswordRequirements` UI; server policy is
  future work).
- Admin-triggered forced resets (admin panel action — future).
- Endpoint rate limiting (`rate-limiting` item).

## Files to Create / Modify

- `api/src/authTokens.ts`, `api/src/authRecovery.ts` (new), `api/src/auth.ts`,
  `api/src/plugins.ts` (emailVerificationPlugin), `api/src/index.ts`
- `comms/src/templates.ts` — two templates
- `example-frontend/app/resetPassword.tsx`, profile banner, SDK regen
- `ui/src/login/LoginScreen.tsx` — `onForgotPassword` prop
- `docs/how-to/password-reset.md`, `docs/reference/environment-variables.md`

## Task List

See [docs/tasks/password-reset-and-email-verification.md](../tasks/password-reset-and-email-verification.md).

## Acceptance Criteria

- [ ] `POST /auth/forgotPassword` returns 202 for existing and non-existing emails alike,
      sending mail only for existing ones.
- [ ] A reset token works exactly once, fails after expiry, and a successful reset
      invalidates outstanding refresh tokens.
- [ ] The unmodified RTK client `resetPassword` mutation completes the flow end to end.
- [ ] With `requireEmailVerification` on, an unverified user gets 403 code
      `email-not-verified` on login and can complete verification to proceed.
- [ ] Better Auth mode sends the same two templates through comms.
- [ ] example-frontend can complete forgot → email link (console adapter output in dev) →
      reset → login with the new password; UI verification evidence attached to the PR.
