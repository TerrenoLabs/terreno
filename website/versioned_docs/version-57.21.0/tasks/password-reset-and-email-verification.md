# Tasks: Password reset and email verification

IP: [password-reset-and-email-verification](../implementationPlans/password-reset-and-email-verification.md)

## Phase 1 — Token infrastructure

- [x] **Task 1.1**: `AuthToken` model + issue/consume statics
  - Description: hashed single-use tokens with TTL expiry per IP
  - Files: `api/src/authTokens.ts`, type files
  - Depends on: none
  - Acceptance: atomic single-use test (parallel consumes → one winner); expiry test
- [x] **Task 1.2**: `emailVerificationPlugin`
  - Description: `emailVerified` field plugin for user schemas
  - Files: `api/src/plugins.ts`
  - Depends on: none
  - Acceptance: plugin test; example User adopts it

## Phase 2 — JWT routes + mail

- [x] **Task 2.1**: forgot/reset routes
  - Description: 202-always forgot; reset validates+consumes token, `setPassword`, invalidates refresh tokens; RTK client path/shape contract verified
  - Files: `api/src/authRecovery.ts`, `api/src/auth.ts`
  - Depends on: 1.1, comms-abstraction
  - Acceptance: enumeration-safety + happy-path supertest; RTK-shape test
- [x] **Task 2.2**: verification routes + `requireEmailVerification` option
  - Description: sendVerification/verifyEmail; 403 `email-not-verified` gating on login when enabled
  - Files: `api/src/authRecovery.ts`, `api/src/auth.ts`
  - Depends on: 1.2, 2.1
  - Acceptance: gating on/off supertest
- [x] **Task 2.3**: Mail templates
  - Description: `resetPassword` + `verifyEmail` templates with app-override hook and `publicAppUrl` links
  - Files: `comms/src/templates.ts`
  - Depends on: comms-abstraction Phase 1
  - Acceptance: rendered output snapshot tests

## Phase 3 — Better Auth parity

- [x] **Task 3.1**: Better Auth hooks
  - Description: `sendResetPassword`/`sendVerificationEmail` wired to the same templates
  - Files: `api/src/betterAuthSetup.ts`
  - Depends on: 2.3
  - Acceptance: parity test asserting identical template usage

## Phase 4 — Client + docs

- [x] **Task 4.1**: example-frontend reset screen + verify banner
  - Description: `/resetPassword` route + profile banner with re-send; SDK regen
  - Files: `example-frontend/app/resetPassword.tsx`, `app/(tabs)/profile.tsx`, `store/openApiSdk.ts`
  - Depends on: Phase 2
  - Acceptance: end-to-end flow with console adapter; UI verification evidence per verify-ui-changes
- [x] **Task 4.2**: `LoginScreen` forgot-password link prop
  - Description: optional `onForgotPassword` on `@terreno/ui` LoginScreen
  - Files: `ui/src/login/LoginScreen.tsx` + tests + demo story
  - Depends on: none
  - Acceptance: renders only when provided; story added
- [x] **Task 4.3**: Docs
  - Description: how-to + env reference + rulesync
  - Files: `docs/how-to/password-reset.md`, `docs/reference/environment-variables.md`, `.rulesync/**`
  - Depends on: Phase 2
  - Acceptance: `bun run rules:check` passes
