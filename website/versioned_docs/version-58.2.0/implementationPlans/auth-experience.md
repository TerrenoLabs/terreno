# Auth experience: social login, account linking, passkeys, 2FA, and admin recovery

Terreno already runs Better Auth with email/password, and `BetterAuthConfig` has slots
for Google, GitHub, and Apple. On every deployment, though, social login is off, the
native OAuth return is broken, and the only plugin enabled is `bearer()`. No app has
passkeys, 2FA, linked-account management, or any way for an admin to help a locked-out
user. This plan turns auth into a set of features an app switches on in config.
Consumers get a login screen that knows how you signed in last and who is signed in on
this device. They also get a security screen for providers, passkeys, 2FA, sessions,
and password, plus recovery tools for org-admins and platform staff. The example app
turns on all of it, and it works on per-PR previews and on the stable deployment.

## The idea

- **One config contract.** `BetterAuthConfig` gains first-class `accountLinking`,
  `twoFactor`, `passkey`, `lastLoginMethod`, `multiSession`, `oauthProxy`, and
  `nativeApps` fields. Terreno maps them to Better Auth plugins, so consumers never
  assemble plugins by hand.
- **Discovery.** A public endpoint, `GET {basePath}/terreno/methods`, reports what is
  enabled. The login screen renders from it and never shows a provider that isn't
  configured.
- **Three layers on the frontend:**
  - Presentational screens and cards in `@terreno/ui`.
  - Connected screens and hooks in `@terreno/rtk`, which already depends on ui.
  - Recovery panels in `@terreno/admin-frontend`.
- **Recovery is Terreno-owned.** An `AccountSecurityApp` plugin adds per-user routes.
  Platform staff reach them at `/users/:id/security/*`. An org-admin reaches the same
  handlers at `/orgs/:orgId/members/:userId/security/*` for any active member of
  their org (D2). Every action writes an `AuditEvent` through the existing `AuditApp`, with
  `source: "security"`, and emails the affected user.
- **Builds on #1604.** Master already has web bearer mode (`createBetterAuthClient({webAuth:
  "bearer"})`, `bearerStorage`), the OAuth one-time-token handoff (`oauthHandoff`,
  `signInSocialWithHandoff`), the mock OIDC provider (`MOCK_OIDC_ISSUER`), and the
  cross-site bearer Playwright project. This plan reuses them instead of building its own
  (D7).
- **Previews.** Previews sign in through Better Auth's `oauth-proxy`. The stable
  deployment, called "staging" here (D1), owns the registered callback URLs and
  forwards each OAuth return to the preview that started it.
- **Rejected alternative:** Better Auth's `admin` and `organization` plugins. Terreno
  already owns orgs, RBAC, and `User.disabled`, and a second authority would drift.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Methods discovery drives the example login buttons (tracer) | none | api, rtk, example-frontend | api test + Playwright |
| T2 | Auth feature config contract and plugin wiring | T1 | api | api tests |
| T3 | Account linking modes and verified-email sync | T2 | api | api tests (stubbed provider) |
| T4 | Example backend enables the full suite; the mock OIDC provider joins e2e | T2 | example-backend, e2e | api test + Playwright |
| T5 | Linking a provider works for bearer-mode web clients | T4 | api, rtk | api tests |
| T27 | The 2FA, trust-device and passkey challenges work without cookies | T5, T18 | api, rtk, example-frontend | api test + Playwright cross-site bearer |
| T6 | Security summary, 2FA reset, security audit events, platform routes | T2 | api | api tests |
| T7 | Recovery: remove passkey, unlink provider | T6 | api | api tests |
| T8 | Recovery: revoke sessions, send reset, disable/enable | T7 | api, example-backend | api tests |
| T9 | Org-admin scoped recovery routes | T6 | api | api tests (auth matrix) |
| T10 | Security notification emails | T8, T27 | api, comms | api + comms tests |
| T11 | Previews sign in through oauth-proxy on the stable deploy | T5 | example-backend, CI, infra, docs | config test, terraform validate |
| T28 | Live social sign-in on a preview and on the stable deploy (needs H1) | T11 | e2e | live curl + opt-in Playwright |
| T12 | LoginScreen v2 (presentational) | none | ui, demo | ui tests + snapshots |
| T13 | OtpField and TwoFactorChallengeScreen | none | ui, demo | ui tests |
| T14 | LinkedAccountsCard and PasswordCard | none | ui, demo | ui tests |
| T15 | PasskeysCard and SessionsCard | none | ui, demo | ui tests |
| T16 | TwoFactorSettingsCard (enroll, backup codes) | T2, T13 | ui, demo | ui tests |
| T17 | AccountSecurityScreen, exports, demo registration | T12, T14, T15, T16 | ui, demo, docs | ui tests + demo coverage |
| T18 | rtk client feature plugins | T2 | rtk | rtk tests |
| T19 | Remembered accounts on device | none | rtk | rtk tests |
| T20 | Connected TerrenoLoginScreen and login controller | T3, T11, T17, T19, T27 | rtk | rtk tests |
| T21 | Connected TerrenoAccountSecurityScreen | T20 | rtk | rtk tests |
| T22 | Example login, 2FA challenge, passkey sign-in | T4, T20 | example-frontend | Playwright |
| T29 | Android example signs in with the mock provider | T22 | example-frontend (Maestro) | Maestro on emulator |
| T23 | Example security screen | T21, T22 | example-frontend | Playwright |
| T24 | Org-admin member security panel | T4, T9 | admin-frontend, example-frontend | admin tests + Playwright |
| T25 | Platform user security screen | T8, T24 | admin-frontend, example-frontend | admin tests + Playwright |
| T26 | create-terreno-app generates the auth suite | T4, T21 | create-terreno-app | generator tests |

Tracer: config, then `/terreno/methods`, then `useAuthMethods`, then the example login
buttons.

Out of scope: dedicated staging environment, iOS native proof, native Apple button,
native passkeys, org security policies, magic link / email OTP / One Tap, enterprise
SSO, and self-service email change or account deletion. The last two are deliberate
cuts from "all of it" (X6). See Expansions.

Open risks:
- **Apple through oauth-proxy.** Apple returns with `form_post`; whether the proxy
  handles that is unproven.
- **Safari.** Safari blocks third-party cookies. After H3 the stable sites are
  same-site (D6), but previews stay on `netlify.app` and `run.app`. #1604's bearer mode
  removes the dependence on cookies for sessions; T27 does the same for the 2FA and
  passkey challenges.
- **Revocation delay.** The 5-minute session cookie cache delays revocation for
  cookie (not bearer) clients.
- **Credentials.** Real provider credentials need a human (H1).

## Human prerequisites

- **H1.** Create the OAuth apps and add their secrets with `gcloud secrets versions add`
  to the containers T11 creates:
  - a GitHub OAuth app;
  - a Google OAuth client;
  - an Apple Services ID with a Sign in with Apple key (team ID, key ID, `.p8`).

  Register exactly one callback per provider, on the stable backend's final host:
  `https://api.<domain>/api/auth/callback/{provider}` once H3 is done (D6). Before H3,
  register `https://terreno-backend-example-7knxlrnpqq-uc.a.run.app/api/auth/callback/{provider}`
  too, and drop it after the move. Apple's Services ID also lists `api.<domain>` and
  `app.<domain>` under Domains.
  Also create a GitHub test account without 2FA for the opt-in live Playwright run.
  Only T28 waits on this; every other task proves itself with the mock
  provider from T4.
- **H3.** Move the stable sites onto one domain (D6): the Netlify custom domain
  `app.<domain>` for `terreno-frontend`, and a Cloud Run domain mapping `api.<domain>`
  for `terreno-backend-example`. Then set `STABLE_FRONTEND_URL` and `STABLE_BACKEND_URL`
  in CI (T11). Nothing waits on this: until then every URL defaults to today's hosts
  and T27 covers the cross-site gap.
- **H2.** After T28 passes, sign in once with Google and once with Apple on a preview
  and on the stable deploy. These providers block automated sign-in.

## Tasks

- [x] **T1** — Methods discovery drives the example login buttons
  - Depends on: none
  - Files: api/src/betterAuthMethods.ts, api/src/betterAuthMethods.test.ts, api/src/betterAuthSetup.ts, rtk/src/useAuthMethods.ts, rtk/src/useAuthMethods.test.ts, rtk/src/index.ts, example-frontend/app/login.tsx, example-frontend/e2e/login.spec.ts, docs/reference/api.md, changelog/unreleased/auth-methods-discovery.md
  - Build:
    - Add a Better Auth plugin that serves a public `GET {basePath}/terreno/methods`
      returning `{emailPassword, signUp, providers: string[], passkey, twoFactor, accountLinking, multiSession}`.
      `providers` lists social providers and `genericOAuth` provider ids (so the
      example's `mock-oidc` appears when `MOCK_OIDC_ISSUER` is set).
      Flags that T2 has not built yet report `false`.
    - Add `useAuthMethods(authClient)` in rtk.
    - The example login replaces its hard-coded `["google","github","apple"]`
      (`example-frontend/app/login.tsx:62`) with the result.
  - Proof:
    - `api/src/betterAuthMethods.test.ts` "lists only configured providers": with only
      `githubOAuth` set, `providers` equals `["github"]` and the endpoint answers
      without a session.
    - `e2e/login.spec.ts` "user sees only configured providers": with no provider env,
      `login-screen-oauth` has no buttons.
  - Docs: `docs/reference/api.md` Better Auth section (endpoint + response).
  - Skills: terreno-backend-api, terreno-data-fetching, verify-ui-changes

- [x] **T2** — Auth feature config contract and plugin wiring
  - Depends on: T1
  - Files: api/src/betterAuth.ts, api/src/betterAuthSetup.ts, api/src/betterAuthFeatures.ts, api/src/betterAuthFeatures.test.ts, api/src/betterAuthMethods.ts, api/src/rateLimit/policies.ts, api/src/rateLimit/policies.test.ts, api/package.json, rtk/package.json, ui/package.json, example-backend/package.json, example-frontend/package.json, package.json, bun.lock, docs/how-to/configure-better-auth.md, changelog/unreleased/auth-feature-config.md
  - Build:
    - Add these optional fields to `BetterAuthConfig`:
      - `accountLinking: {mode: "verified-email" | "explicit" | "never", trustedProviders?}`
    - `verified-email`: a sign-in whose verified email matches joins that account.
    - `explicit`: the user links a method from the Security screen.
    - `never`: no linking. Each sign-in method stays its own account, and a same-email
      sign-in with a new method is refused.
    - Better Auth's `requireLocalEmailVerified` stays `true` in every mode.
      - `twoFactor: {issuer, backupCodes?, trustDeviceDays?}`
      - `passkey: {rpID, rpName, origin: string[]}`
      - `signUp: {mode: "open" | "closed"}` (default `open`). `closed` maps to Better
      Auth `emailAndPassword.disableSignUp` plus `disableImplicitSignUp` on every
      social provider, so only existing users can sign in (D4).
    - `lastLoginMethod: boolean` (`storeInDatabase: true`)
      - `multiSession: {maximumSessions}`
      - `oauthProxy: {productionURL}`
      - `nativeApps: boolean` (registers the `@better-auth/expo` server plugin)
    - `appleOAuth` additionally accepts `{teamId, keyId, privateKey, appBundleIdentifier}`
      and signs Apple's client-secret JWT at startup.
    - `buildFeaturePlugins(config)` in `betterAuthFeatures.ts` maps each field to its
      plugin:
      - `twoFactor`, `passkey` (add `@better-auth/passkey` to the catalog)
      - `lastLoginMethod`, `multiSession`, `oAuthProxy`, `expo`
      - `account.accountLinking`
    - The plugins are appended before `config.plugins`, which keeps the escape hatch
      (#1592).
    - The methods endpoint reports the real flags.
    - Add every new dependency for the plan here, so one task owns the lockfile:
      - `@better-auth/passkey` (catalog) in api and rtk;
      - `react-native-qrcode-svg` in ui;
      - `otpauth` in example-frontend dev dependencies (the mock OIDC provider from
        #1604 replaces `oauth2-mock-server`).
    - Add `/two-factor`, `/passkey`, `/link-social`, `/unlink-account`, `/multi-session`
      to the `auth` rate-limit bucket (`/one-time-token` and `/oauth-handoff` are
      already there from #1604; keep them).
  - Proof:
    - `betterAuthFeatures.test.ts` "each feature mounts only when configured": for each
      feature, its endpoint is non-404 when enabled and 404 when absent. The endpoints
      are:
      - `/two-factor/enable`
      - `/passkey/generate-register-options`
      - `/multi-session/list-device-sessions`
      - `/expo-authorization-proxy`
    - `policies.test.ts`: `/api/auth/two-factor/verify-totp` resolves to the `auth`
      bucket.
    - `signUp: closed`:
      - email sign-up is refused;
      - a social sign-in for an unknown email returns `signup_disabled` and creates no
        user;
      - an existing user still signs in;
      - `/terreno/methods` reports `signUp: false`.
    - Existing `betterAuthSetup.test.ts` passes unchanged, which shows the change is
      backward compatible.
  - Docs: `configure-better-auth.md` gets a new "Auth features" table, with each field,
    the plugin it maps to, and a default.
  - Skills: terreno-backend-api, mongoose-schema-safety (Better Auth adds the
    `twoFactor`/`passkey` collections and user fields), backend-test-env, security-audit

- [x] **T3** — Account linking modes and verified-email sync
  - Depends on: T2
  - Files: api/src/betterAuthSetup.ts, api/src/betterAuthLinking.test.ts, docs/explanation/account-linking.md, docs/how-to/configure-better-auth.md, changelog/unreleased/account-linking.md
  - Changelog: marked breaking. Unverified sign-ups no longer claim an existing app
    User by email. The fragment includes the migration note.
  - Build:
    - `syncBetterAuthUser` (`api/src/betterAuthSetup.ts:488-498`) stops linking to an
      existing app `User` by email unless the Better Auth user's `emailVerified` is
      true.
    - The provider id is passed through so `oauthProvider` gets filled in.
  - Build (legacy migration): an unverified Better Auth user links to an existing
    legacy app `User` with the same email only when the Better Auth password verifies
    against that User's passport hash. Otherwise the sync returns 409 "Verify your
    email to use this account". It never inserts a duplicate `User` (no 11000 error).
    This closes today's takeover path, where anyone signing up unverified with a
    victim's email is linked to the victim's User.
  - Proof (`betterAuthLinking.test.ts`, Google stubbed through
    `verifyIdToken`/`getUserInfo` and an idToken sign-in):
    - `verified-email`: an email/password user whose email is verified signs in with a
      verified Google identity on the same email. The result is one Better Auth user,
      two `account` rows and one app `User`.
    - `verified-email`, with the local email unverified: the sign-in returns
      `account_not_linked`, and nothing is created.
    - `never`: `linkSocial` returns 403, and a same-email social sign-in is refused.
    - Legacy migration:
      - a legacy User plus a Better Auth sign-up with the same password gives one
        User;
      - a different password gives 409 and still one User;
      - a legacy User with no hash (a GitHub-JWT user) and no `sendMail` gives 409.
        Nothing is left behind (no Better Auth user, account row, or verification
        mail). The T8 `issue-sign-in-link` admin action then lets them in (D8).
    - `explicit`: the same sign-in returns error code `account_not_linked` and creates
      no user. `linkSocial` from the signed-in session then links it.
    - An unverified provider email never links in either mode.
    - Unlinking the only remaining sign-in method is refused.
  - Docs: new `docs/explanation/account-linking.md`. Covers the three modes, why both
    emails must be verified, Apple private-relay emails, `multiSession`, and a
    migration note for JWT apps. `configure-better-auth.md`'s "Migration from JWT
    Auth" section links to it.
  - Skills: terreno-backend-api, security-audit

- [x] **T4** — Example backend enables the full suite; the mock OIDC provider joins e2e
  - Depends on: T2
  - Files: example-backend/src/utils/betterAuthConfig.ts, example-backend/src/utils/betterAuthConfig.test.ts, example-backend/.env.example, example-frontend/playwright.config.ts, example-frontend/e2e/helpers/mockOidcProvider.ts, example-frontend/e2e/authMethods.spec.ts, changelog/unreleased/example-auth-suite.md
  - Build:
    - The example turns on every T2 feature:
      - `accountLinking.mode` comes from `AUTH_ACCOUNT_LINKING` (default
        `verified-email`).
      - `signUp.mode` comes from `AUTH_SIGN_UP` (default `open`).
      - Email verification stays optional at sign-up, as today. Linking needs a
        verified email, and the T20 notice covers that.
      - The seeded e2e users are created verified.
      - `twoFactor.issuer` is "Terreno Example".
      - `passkey.origin` comes from `FRONTEND_URL`. `passkey.rpID` comes from
        `PASSKEY_RP_ID` when set, otherwise the `FRONTEND_URL` host. On stable after H3
        it is `<domain>`, so a passkey works on every subdomain (D6).
      - `lastLoginMethod`, `multiSession` and `nativeApps` are on.
    - The `mock-oidc` provider from #1604 (`MOCK_OIDC_ISSUER`) stays the e2e provider.
      The auth-experience specs (T22, T23) join the cross-site bearer project's spec
      list, which already starts the mock provider and runs the backend with the
      handoff on (D7).
    - The mock provider can name any email and whether it is verified per sign-in
      (a login-hint or query option on its authorize page), so T3 and T22 can drive the
      verified and unverified linking cases.
  - Proof:
    - `betterAuthConfig.test.ts`: the default env enables all features,
      `AUTH_ACCOUNT_LINKING=explicit` switches the mode, and `PASSKEY_RP_ID` overrides
      the rpID.
    - `e2e/authMethods.spec.ts` (cross-site bearer project): `GET
      /api/auth/terreno/methods` lists `mock-oidc` and reports every feature on.
  - Skills: terreno-backend-api, backend-test-env

- [x] **T5** — Linking a provider works for bearer-mode web clients
  - Depends on: T4
  - Files: api/src/betterAuthOAuthHandoff.ts, api/src/betterAuthOAuthHandoff.test.ts, api/src/betterAuth.ts, rtk/src/betterAuthClient.ts, rtk/src/betterAuthClient.test.ts, rtk/src/index.ts, docs/reference/api.md, docs/how-to/configure-better-auth.md, changelog/unreleased/oauth-handoff-link.md
  - Why: #1604's handoff covers sign-in. Linking a provider from the Security screen
    needs the OAuth state cookie on the API's origin too, and a bearer client's
    `POST /link-social` fetch can't set it cross-site.
  - Build:
    - `POST {basePath}/oauth-handoff/link-intent` (bearer-authenticated,
      `{provider, callbackURL}`) mints a single-use, three-minute link token for the
      caller's session. `callbackURL` follows the handoff's `errorCallbackURL` rule
      (any page on a listed web origin), since no token travels on a link return.
    - `POST {basePath}/oauth-handoff/link-start` takes the token from a form body in a
      top-level navigation (so it never lands in a URL or access log), consumes it,
      runs `linkSocial` for that session, forwards the state cookie, and redirects to
      the provider.
    - The provider callback links the account and redirects to `callbackURL` with no
      one-time token (no session is created).
    - rtk exports `linkSocialWithHandoff({client, provider, callbackURL})`, which on web
      bearer mode fetches the intent and submits the form. Cookie mode and native call
      `linkSocial` as before.
  - Proof (`betterAuthOAuthHandoff.test.ts`, mock genericOAuth provider):
    - a signed-in bearer user links the provider and ends with two `account` rows and no
      new session;
    - a reused or expired token answers 400 with no redirect;
    - a `callbackURL` outside the web origins answers 400;
    - with `accountLinking.mode: "never"` the intent answers 403.
    - rtk test: bearer mode posts the intent and submits the form; cookie mode calls
      `linkSocial`.
  - Docs: `api.md` Better Auth section and the bearer-mode section of
    `configure-better-auth.md`.
  - Skills: terreno-backend-api, terreno-data-fetching, security-audit

- [x] **T27** — The 2FA, trust-device and passkey challenges work without cookies
  - Depends on: T5, T18
  - Files: api/src/betterAuthChallengeHeaders.ts, api/src/betterAuthChallengeHeaders.test.ts, api/src/betterAuthFeatures.ts, rtk/src/betterAuthClient.ts, rtk/src/betterAuthClient.test.ts, example-frontend/playwright.config.ts, example-frontend/e2e/crossSiteChallenges.spec.ts, docs/explanation/authentication.md, changelog/unreleased/cookieless-challenges.md
  - Why: bearer mode (#1604) sends no cookies (`credentials: "omit"`). Better Auth keeps
    the 2FA challenge, the trust-device token, and the passkey challenge in cookies, so
    a bearer client on previews (and on stable before H3) can't finish 2FA or passkeys.
  - Build:
    - A Terreno Better Auth plugin copies each challenge cookie the server sets
      (`two_factor`, `trust_device`, the passkey challenge) into a response header,
      `X-Terreno-Auth-Challenge`, carrying the signed cookie values.
    - On requests it accepts that header and converts it back to the cookies in a
      `before` hook, the same way `bearer()` converts the Authorization header. Values
      stay signed, so a tampered header fails the signature check.
    - rtk bearer mode stores the header value next to the bearer (same
      `bearerStorage`) and sends it on `/two-factor/*` and `/passkey/*` calls. It clears
      it on sign-out and after a successful verify (except trust-device, which lives
      for `trustDeviceDays`).
  - Proof:
    - `betterAuthChallengeHeaders.test.ts`: verify-totp with only the header (no cookie)
      succeeds; a tampered header gives 401; passkey register and sign-in finish with
      only the header; a trusted device skips the challenge on the next sign-in.
    - Playwright, cross-site bearer project (cookies are never sent, so the browser
      engine doesn't matter): `e2e/crossSiteChallenges.spec.ts` covers "user with 2FA
      completes the challenge" and "user signs in with a passkey" (CDP virtual
      authenticator).
  - Docs: `authentication.md` gets "Challenges without cookies" next to #1604's bearer
    section, including XSS exposure of `bearerStorage` and the HIPAA note to use
    `sessionStorage`.
  - Skills: terreno-backend-api, terreno-data-fetching, security-audit

- [x] **T6** — Security summary, 2FA reset, security audit events, platform routes
  - Depends on: T2
  - Files: api/src/accountSecurity/accountSecurityService.ts, api/src/accountSecurity/accountSecurityApp.ts, api/src/accountSecurity/securityEvents.ts, api/src/accountSecurity/accountSecurity.test.ts, api/src/audit/record.ts, api/src/audit/auditEventModel.ts, api/src/rbac/statements.ts, api/src/rbac/roleModel.ts, api/src/index.ts, example-backend/src/server.ts, docs/reference/account-security.md, docs/how-to/audit-log.md, changelog/unreleased/account-security-app.md
  - Build:
    - The `AccountSecurityApp` TerrenoPlugin exports
      `mountSecurityRoutes(router, authorize)`.
    - `GET /users/:id/security` returns:
      - linked providers;
      - passkey count and names;
      - 2FA on or off and backup codes remaining;
      - active session count;
      - last sign-in method and time;
      - `disabled`;
      - `actions: [{id, label, destructive}]`.
    - `POST /users/:id/security/reset-two-factor` removes the user's TOTP secret and
      backup codes and turns 2FA off.
    - Access is granted to holders of the new RBAC statement `user:manageSecurity`.
      `superadmin` and `operator` hold it; the operator grant goes in
      `api/src/rbac/roleModel.ts:131-140`.
    - The example backend registers `AccountSecurityApp`
      (`example-backend/src/server.ts`). Only the user's own session credential is
      accepted; delegated credentials are refused.
    - `recordSecurityAction({actor, target, action, org})` in `securityEvents.ts`
      writes an `AuditEvent` with `source: "security"`, `modelName: "User"`,
      `recordId` set to the target, `verb: "updated"`, `operation: "update"`, and
      `after: {securityAction, organizationId?}`. That source is added to
      `AuditEventWrite` (`api/src/audit/record.ts:22-33`) and to the model enum.
      `recordSecurityAction` also emits to in-process listeners, which T10 uses.
    - `securityEvents.ts` defines every action name used in T7–T10.
    - `AccountSecurityApp` throws at startup when `AuditApp` is not registered, unless
      the consumer passes `audit: false` (Q6). The example already registers `AuditApp`
      (`example-backend/src/server.ts:428`).
  - Proof (`accountSecurity.test.ts`):
    - An operator gets the summary and can reset 2FA. Afterwards the target signs in
      with a password and gets no 2FA challenge.
    - A member is refused with 403.
    - An MCP service-token request is refused with 403.
    - Each reset writes one `AuditEvent` with `source: "security"`.
    - Startup without `AuditApp` throws; `audit: false` boots.
  - Docs: new `docs/reference/account-security.md` (routes, actions, permissions).
    `audit-log.md` gains a `security` source row.
  - Skills: terreno-backend-api, mongoose-schema-safety, security-audit

- [x] **T7** — Recovery: remove passkey, unlink provider
  - Depends on: T6
  - Files: api/src/accountSecurity/credentialActions.ts, api/src/accountSecurity/accountSecurityApp.ts, api/src/accountSecurity/credentialActions.test.ts, docs/reference/account-security.md
  - Build:
    - `DELETE /users/:id/security/passkeys/:passkeyId`
    - `DELETE /users/:id/security/accounts/:providerId`
    - An unlink that would leave zero sign-in methods returns 409, unless the user has
      a verified email, in which case it also sends a password reset.
  - Proof:
    - After removal, the passkey is no longer listed, and the provider row is gone.
    - The 409 guard holds.
    - Each action writes a security `AuditEvent`.
    - The summary `actions` include both.
  - Skills: terreno-backend-api, security-audit

- [x] **T8** — Recovery: revoke sessions, send reset, disable/enable
  - Depends on: T7
  - Files: api/src/accountSecurity/accessActions.ts, api/src/accountSecurity/accountSecurityApp.ts, api/src/accountSecurity/accessActions.test.ts, example-backend/src/models/user.ts, example-backend/src/types/models/userTypes.ts, docs/reference/account-security.md
  - Build:
    - Fix the existing Better Auth reset-password JWT sync: over HTTP,
      `applyBetterAuthPasswordResetToJwt` re-reads a request body Better Auth already
      consumed, so `POST {basePath}/reset-password` answers 500 whenever a `userModel`
      is set (found in T7). Capture `newPassword` from the parsed endpoint body instead
      (a `hooks.before` matcher on `/reset-password`). Proof: an HTTP reset with a
      `userModel` succeeds, signs in with the new password, and bumps `tokenEpoch`.
    - `POST .../revoke-sessions`
    - `POST .../send-password-reset`, which uses `sendMail` and returns 501 when
      `publicAppUrl` is unset, matching the existing hooks.
    - `POST .../disable` and `.../enable`, which set `User.disabled`.
    - `POST .../issue-sign-in-link` (platform-only, for legacy users with no password
      hash and no mail path, T3) creates the Better Auth user for that app User,
      linked by `betterAuthId`, and returns a single-use set-password link the admin
      hands over. It never marks an attacker-chosen credential verified: T3 refuses
      unverified same-email sign-ups before any Better Auth user exists (D8).
    - The example User gains `isDisabledPlugin`, applied in `user.ts` only.
  - Proof:
    - After revoke, the next REST request with the old bearer token gets 401.
    - After disable, REST gets 401 and the socket handshake is refused. After enable,
      sign-in works again.
    - The reset email is captured by the test mailer.
    - After `issue-sign-in-link`, the link sets a password and the user signs in to
      the same app User; the link is refused on reuse.
  - Skills: terreno-backend-api, mongoose-schema-safety, security-audit

- [x] **T9** — Org-admin scoped recovery routes
  - Depends on: T6
  - Files: api/src/orgs/orgsApp.ts, api/src/terrenoApp.ts, api/src/accountSecurity/orgSecurityRoutes.ts, api/src/accountSecurity/orgSecurityRoutes.test.ts, api/src/rbac/membershipOrgAdminSource.ts, docs/explanation/organizations.md, docs/how-to/recover-locked-out-user.md
  - Build:
    - `TerrenoApp` passes the registered `AccountSecurityApp`, if any, to the
      `OrgsApp` it builds (`api/src/terrenoApp.ts:599`). `OrgsApp` mounts
      `mountSecurityRoutes` at `/orgs/:orgId/members/:userId/security` only when one is
      present.
    - The authorizer allows an org-admin of `:orgId` when the target has an active
      membership there, even if the target also belongs to other orgs (D2). It always
      refuses targets with a platform role (`superadmin`, `operator`) or `admin: true`
      (Q1).
    - `orgRecovery.minMembershipDays` is opt-in hardening and defaults to 0. When set,
      it refuses members who joined more recently than that. This defends against an
      org-admin attaching an existing user by email
      (`api/src/orgs/orgsApp.ts:406-450`) and acting on them right away. T10's email
      tells the user whenever an org-admin acts.
    - Under the org prefix, a separate `suspend-membership` action
      (`POST /orgs/:orgId/members/:userId/security/suspend-membership`) suspends that
      membership; `disable`, `enable` and `issue-sign-in-link` are not mounted there.
      Global `User.disabled` stays platform-only (Q8). Restoring a member uses the
      existing `PATCH /orgs/:id/members/:memberId {status: "active"}`.
    - Platform actors always pass.
    - Events record `org`.
  - Proof (`orgSecurityRoutes.test.ts`, authorization matrix on summary and
    reset-two-factor):
    - The org-admin of A acting on an active member of A is allowed. This includes a
      member who also belongs to B.
    - The org-admin of A acting on a member of B only gets 404.
    - The org-admin of A acting on a suspended member gets 404.
    - The org-admin of A acting on a member who holds `superadmin` gets 403.
    - The org-admin of A acting on another org-admin of A is allowed.
    - With `minMembershipDays: 7`, attaching an existing user by email and resetting
      their 2FA the same day gets 403. With the default 0, it is allowed.
    - Org-prefix `suspend-membership` suspends only the A membership, and the user can
      still sign in.
    - An app without `AccountSecurityApp` exposes no `/orgs/*/security` routes.
    - A plain member gets 403.
    - A disabled org gets 403.
    - A generic check confirms that every route `mountSecurityRoutes` registers is
      reachable under the org prefix.
  - Docs: `organizations.md` gets a "Member recovery" section. New
    `recover-locked-out-user.md` covers platform and org paths.
  - Skills: terreno-backend-api, security-audit, building-admin-interfaces

- [x] **T10** — Security notification emails
  - Depends on: T8, T27
  - Files: api/src/accountSecurity/securityNotifications.ts, api/src/accountSecurity/securityEventHooks.ts, api/src/accountSecurity/securityEvents.ts, api/src/betterAuthFeatures.ts, api/src/accountSecurity/securityNotifications.test.ts, comms/src/templates.ts, comms/src/templates.test.ts, comms/src/types.ts, docs/reference/account-security.md
  - Build:
    - A listener on `recordSecurityAction` emails the affected user. This covers both admin
      actions and self-service ones (provider linked or unlinked, passkey added or
      removed, 2FA enabled or disabled, password changed).
    - Self-service events are recorded by a Better Auth `hooks.after` plugin.
    - Each email names who acted: "you", or "an administrator". The org name appears
      only when `notifications.includeOrgName` is true (default false; Q9).
  - Proof:
    - Each event type sends exactly one email to the target, through the test mailer.
    - `renderAuthMail` renders each new template id.
    - No email is sent when `sendMail` is unset.
  - Skills: terreno-backend-api, security-audit

- [x] **T11** — Previews sign in through oauth-proxy on the stable deploy
  - Depends on: T5
  - Files: example-backend/src/utils/betterAuthConfig.ts, example-backend/src/utils/betterAuthConfig.test.ts, api/src/betterAuthOAuthHandoff.ts, api/src/betterAuthOAuthProxy.test.ts, scripts/ci/gcp-deploy.sh, infra/flourish/main.tf, docs/how-to/set-up-social-login.md, changelog/unreleased/preview-oauth.md
  - Build:
    - When `OAUTH_PROXY_PRODUCTION_URL` is set, the example backend enables
      `oauthProxy`.
    - `gcp-deploy.sh` reads `STABLE_BACKEND_URL` and `STABLE_FRONTEND_URL`, defaulting
      to today's `run.app` and `netlify.app` hosts, so the H3 move is a two-variable
      change (D6). It sets `OAUTH_PROXY_PRODUCTION_URL` to `STABLE_BACKEND_URL` for
      `pr-N` revisions, sets `BETTER_AUTH_URL` to it on stable, and sets `FRONTEND_URL`
      for both. `PASSKEY_RP_ID` is set on stable only when `STABLE_FRONTEND_URL` is a
      subdomain (its parent domain); previews keep their own host.
    - The stable `trustedOrigins` include both the old and new frontend hosts during the
      move.
    - `gcp-deploy.sh` mounts the `GOOGLE_*`, `GITHUB_*` and `APPLE_*` secrets.
    - Terraform adds those secret containers.
    - Previews already share the stable `BETTER_AUTH_SECRET`
      (`scripts/ci/gcp-deploy.sh:129-131`), which oauth-proxy needs.
    - The #1604 handoff hook also runs on oauth-proxy's `/oauth-proxy-callback`, so a
      bearer-mode preview gets its one-time token after the proxied return. This file is
      `api/src/betterAuthOAuthHandoff.ts` (ordered after T5).
  - Proof:
    - Config test: the preview env includes the oauthProxy plugin, with `productionURL`
      set to stable. Stable runs it too (Better Auth 1.7.4 forwards a preview's return
      from stable's callback hook), naming itself, and its own sign-ins skip the proxy
      so they keep the state-cookie check.
    - api test (`betterAuthOAuthProxy.test.ts`): two Better Auth instances, "stable" and
      "preview", with separate databases and one secret. A mock-provider sign-in started
      on the preview returns through stable's callback to the preview, and the preview's
      redirect carries the one-time token. This proves the state survives the hop.
    - Config test: with `STABLE_*` on subdomains of one domain, stable gets
      `passkey.rpID` = the parent domain and no `crossSubDomainCookies`; with the
      defaults it gets the `netlify.app` host.
    - `terraform validate` passes.
    - `bash -n scripts/ci/gcp-deploy.sh` passes.
  - Docs: new `set-up-social-login.md` (linked from `configure-better-auth.md` by T20),
    covering:
    - registering each provider;
    - Apple key and JWT rotation;
    - one callback per provider;
    - how previews proxy;
    - passkey `rpID` per preview host, given that `netlify.app` is a public suffix,
      and the parent domain on stable once it shares a domain;
    - moving stable onto one domain (H3): the custom domain, the domain mapping, the
      callback re-registration, and why passkeys made on the old host stop working.
  - Skills: deploy-gcp, terreno-backend-api, verify-ui-changes

- [ ] **T28** — Live social sign-in on a preview and on the stable deploy
  - Depends on: T11
  - Blocked by: H1
  - Status: deferred past PR #1613 and tracked as X10. It needs the H1 OAuth apps; every other
    proof uses the mock provider.
  - Files: example-frontend/e2e/live-social-login.spec.ts
  - Proof:
    - On this PR's preview and on the stable deploy, after H1:
      - On both, `GET /api/auth/terreno/methods` lists github, google and apple.
      - For each provider on both, `POST /api/auth/sign-in/social` returns an
        authorization URL whose `redirect_uri` host is the stable backend.
      - Apple `form_post` gate: a `POST` to the stable
        `/api/auth/callback/apple`, carrying a preview-originated state, answers 302 to
        the preview host (not 404/405). If it fails, Apple on previews moves to Open
        risks with the cause, and stable Apple still ships.
      - `e2e/live-social-login.spec.ts` (opt-in, `LIVE_OAUTH=1`) signs in with the H1
        GitHub test account on both URLs.
      - Google and Apple are checked by reaching the provider consent page with the
        stable `redirect_uri`.

      Screenshots go to `/opt/cursor/artifacts/`. A full Google/Apple sign-in is H2.
  - Skills: verify-ui-changes, deploy-gcp

- [x] **T12** — LoginScreen v2 (presentational)
  - Depends on: none
  - Files: ui/src/login/LoginScreen.tsx, ui/src/login/loginTypes.ts, ui/src/login/LoginScreen.test.tsx, ui/src/login/__snapshots__/LoginScreen.test.tsx.snap, ui/src/signUp/OAuthButtons.tsx, ui/src/signUp/signUpTypes.ts, ui/src/SocialLoginButton.tsx, ui/src/Common.ts, demo/stories/LoginScreen.stories.tsx, demo/story-config/LoginScreen.config.tsx, docs/reference/ui.md
  - Build: new optional props.
    - `lastUsedMethod`: shows a "Last used" badge on that method and moves it to the
      top.
    - `currentSessions` / `rememberedAccounts`: shows "Continue as" cards with avatar,
      name, provider, `onContinue` and `onForget`.
    - `onPasskeyPress` and `passkeyAutofill`: the email field gets
      `autoComplete="username webauthn"`.
    - `notice`: for `account_not_linked` guidance.
    - Provider buttons move above the form when `lastUsedMethod` is a provider.
    - Fix `SocialLoginButton` ignoring later `loading` prop changes
      (`ui/src/SocialLoginButton.tsx:76`).
    - Every new element gets a testID, named `login-screen-continue-<i>` and so on.
  - Proof: `LoginScreen.test.tsx` covers:
    - badge and ordering per `lastUsedMethod`;
    - continue and forget callbacks;
    - the passkey button only when `onPasskeyPress` is set;
    - the loading prop update.

    Existing snapshots stay unchanged with no new props.
  - Docs: `ui.md` LoginScreen section.
  - Skills: terreno-ui, accessibility-testing, verify-ui-changes

- [x] **T13** — OtpField and TwoFactorChallengeScreen
  - Depends on: none
  - Files: ui/src/OtpField.tsx, ui/src/OtpField.test.tsx, ui/src/login/TwoFactorChallengeScreen.tsx, ui/src/login/TwoFactorChallengeScreen.test.tsx, demo/stories/OtpField.stories.tsx, demo/story-config/OtpField.config.tsx, demo/stories/TwoFactorChallengeScreen.stories.tsx, demo/story-config/TwoFactorChallengeScreen.config.tsx
  - Build:
    - `OtpField` takes N digits, supports paste, and uses `autoComplete="one-time-code"`.
    - The challenge screen has TOTP mode, a backup-code toggle, a "Trust this device"
      checkbox, an error state, and `onSubmit({code, kind, trustDevice})`.
  - Proof:
    - Pasting "123456" fills every cell and fires `onComplete`.
    - The backup toggle switches `kind`.
    - Errors render under `two-factor-challenge-error`.
  - Skills: terreno-ui, accessibility-testing

- [x] **T14** — LinkedAccountsCard and PasswordCard
  - Depends on: none
  - Files: ui/src/security/LinkedAccountsCard.tsx, ui/src/security/LinkedAccountsCard.test.tsx, ui/src/security/PasswordCard.tsx, ui/src/security/PasswordCard.test.tsx, ui/src/security/securityTypes.ts, demo/stories/LinkedAccountsCard.stories.tsx, demo/story-config/LinkedAccountsCard.config.tsx, demo/stories/PasswordCard.stories.tsx, demo/story-config/PasswordCard.config.tsx
  - Build:
    - `LinkedAccountsCard` lists each provider as linked (with email and linked date) or
      not linked. It offers Link and Unlink, with a confirm. Unlink is disabled with an
      explanation when it is the last method.
    - `PasswordCard` shows "Change password" when a credential exists, and "Set a
      password" for OAuth-only users.
  - Proof: tests for the last-method disabled state, the confirm modal, and the
    set/change variants.
  - Skills: terreno-ui, accessibility-testing

- [x] **T15** — PasskeysCard and SessionsCard
  - Depends on: none
  - Files: ui/src/security/PasskeysCard.tsx, ui/src/security/PasskeysCard.test.tsx, ui/src/security/SessionsCard.tsx, ui/src/security/SessionsCard.test.tsx, demo/stories/PasskeysCard.stories.tsx, demo/story-config/PasskeysCard.config.tsx, demo/stories/SessionsCard.stories.tsx, demo/story-config/SessionsCard.config.tsx
  - Build:
    - `PasskeysCard`: add, rename and remove passkeys, each showing its created and
      last-used dates.
    - `SessionsCard`: device and browser, location if given, last active (Luxon
      relative time), "This device" marker, revoke one, and "Sign out everywhere else".
  - Proof: tests for remove confirm, the current session not being revocable
    individually, and relative time rendering.
  - Skills: terreno-ui, accessibility-testing

- [x] **T16** — TwoFactorSettingsCard (enroll, backup codes)
  - Depends on: T2, T13
  - Files: ui/src/security/TwoFactorSettingsCard.tsx, ui/src/security/TwoFactorSettingsCard.test.tsx, demo/stories/TwoFactorSettingsCard.stories.tsx, demo/story-config/TwoFactorSettingsCard.config.tsx
  - Build: the card walks through these steps:
    1. Password confirm.
    2. QR code from `totpURI` (`react-native-qrcode-svg` over the existing
       `react-native-svg`), plus a copyable secret.
    3. Verify the code with `OtpField`.
    4. Show backup codes with copy and download. The user must check "I saved these"
       before finishing.

    Once enrolled, the card offers regenerate backup codes and disable.
  - Proof: tests for step progression, the finish button gated on "I saved these", and
    regenerate showing the new codes.
  - Skills: terreno-ui, accessibility-testing

- [x] **T17** — AccountSecurityScreen, exports, demo registration
  - Depends on: T12, T14, T15, T16
  - Files: ui/src/security/AccountSecurityScreen.tsx, ui/src/security/AccountSecurityScreen.test.tsx, ui/src/index.tsx, demo/demoConfig.tsx, demo/stories/AccountSecurityScreen.stories.tsx, demo/story-config/AccountSecurityScreen.config.tsx, docs/reference/ui.md, changelog/unreleased/ui-auth-components.md
  - Build:
    - The composite screen renders the cards that the props enable, so a disabled
      feature hides its card.
    - Export everything from T13–T17 at the ui package root.
    - Register every new story config.
  - Proof:
    - `bun run check:demo-coverage` passes.
    - The screen test hides the passkey card when `passkeys` is undefined.
    - `bun run ui:test` passes.
  - Docs: `ui.md` gets an "Account security" section.
  - Skills: terreno-ui, update-docs, verify-ui-changes

- [x] **T18** — rtk client feature plugins
  - Depends on: T2
  - Files: rtk/src/betterAuthClient.ts, rtk/src/betterAuthTypes.ts, rtk/src/betterAuthClient.test.ts
  - Build:
    - `createBetterAuthClient({features})` adds `twoFactorClient` (with
      `onTwoFactorRedirect`), `passkeyClient`, `multiSessionClient`,
      `lastLoginMethodClient` and `oneTimeTokenClient`.
    - Provider types widen to `string` so generic providers work.
  - Proof:
    - A test checks that each feature flag exposes its namespace on the client
      (`client.twoFactor.enable`, and so on).
    - Calls without `features` still produce today's client shape, so existing apps are
      unaffected.
  - Skills: terreno-data-fetching

- [x] **T19** — Remembered accounts on device
  - Depends on: none
  - Files: rtk/src/auth/rememberedAccounts.ts, rtk/src/auth/rememberedAccounts.test.ts
  - Build:
    - `createRememberedAccountsStore({rememberIdentity})` stores data in SecureStore
      on native and localStorage on web.
    - It records `{userId, method, lastUsedAt}`. Name, email (masked) and avatar are
      stored only when `rememberIdentity` is true.
    - It keeps the newest 5, supports `forget(userId)`, and exposes
      `useRememberedAccounts()`.
  - Proof:
    - With `rememberIdentity: false`, the persisted record has no name, email or
      image.
    - `forget` removes the record.
    - Ordering is by `lastUsedAt`.
  - Skills: terreno-data-fetching, security-audit

- [x] **T20** — Connected TerrenoLoginScreen and login controller
  - Depends on: T3, T11, T17, T19, T27
  - Files: rtk/src/auth/useLoginController.ts, rtk/src/auth/useLoginController.test.ts, rtk/src/auth/TerrenoLoginScreen.tsx, rtk/src/index.ts, docs/how-to/configure-better-auth.md, changelog/unreleased/terreno-login-screen.md
  - Build: the controller combines:
    - `useAuthMethods`;
    - a live session (the #1604 bearer from `getBetterAuthBearerToken`, or the cookie
      session): a valid one skips the login screen entirely;
    - device sessions from `multiSession`, which become one-tap "Continue as" cards
      where the backend cookie is first-party (native cookie jar, same-site web);
    - remembered accounts from T19, which become "Continue as" cards that
      re-authenticate with the remembered method. On cross-site web this is the only
      source;
    - the last used method, read from T19's on-device store. Better Auth's
      `lastLoginMethodClient` reads the backend's cookie, which a cross-site page
      cannot see;
    - passkey conditional UI on web;
    - social sign-in through #1604's `signInSocialWithHandoff` in bearer mode;
    - the 2FA redirect;
    - mapping `account_not_linked` to guidance for the linking mode: "verify your
      email to link" when the local email is unverified, "sign in with <method> and
      link from Security" in `explicit` mode, or "this email already has an account"
      in `never` mode;
    - hiding sign-up links and mapping `signup_disabled` to "ask your administrator
      for access" when `signUp` is closed.

    `TerrenoLoginScreen` renders ui's `LoginScreen` from it.
  - Proof: controller tests with a mocked client cover:
    - device sessions taking precedence over remembered accounts;
    - the 2FA redirect firing `onTwoFactorRequired`;
    - `account_not_linked` producing the notice;
    - a successful sign-in recording a remembered account.
  - Docs: `configure-better-auth.md` gets a "Drop-in login screen" section and a link
    to `set-up-social-login.md`.
  - Skills: terreno-data-fetching, terreno-ui

- [x] **T21** — Connected TerrenoAccountSecurityScreen
  - Depends on: T20
  - Files: rtk/src/auth/useAccountSecurity.ts, rtk/src/auth/useAccountSecurity.test.ts, rtk/src/auth/TerrenoAccountSecurityScreen.tsx, rtk/src/index.ts, docs/how-to/configure-better-auth.md, api/src/betterAuthSetPassword.ts, api/src/betterAuthSetPassword.test.ts, api/src/rateLimit/policies.ts
  - Build: the hook wraps:
    - `listAccounts`, `linkSocialWithHandoff` (T5), `unlinkAccount`;
    - the passkey list, add and delete;
    - the `twoFactor` enable, verify, disable and backup-code calls;
    - `listSessions`, `revokeSession`, `revokeOtherSessions`;
    - `changePassword`, and "set a password" for OAuth-only users. Better Auth's
      `setPassword` is server-only, so T21 adds a Terreno endpoint
      `POST {basePath}/terreno/set-password` (session required; refused when a
      credential account already exists; rate-limited in the `auth` bucket) in
      `api/src/betterAuthSetPassword.ts` with its own api test.

    After each mutation it refetches the affected section. The connected screen renders
    ui's `AccountSecurityScreen`.
  - Proof: hook tests with a mocked client cover:
    - unlinking the last method never calls the client;
    - enabling 2FA returns backup codes to the card;
    - "sign out everywhere else" calls `revokeOtherSessions`.
  - Skills: terreno-data-fetching, terreno-ui

- [x] **T22** — Example login, 2FA challenge, passkey sign-in
  - Depends on: T4, T20
  - Files: example-frontend/app/login.tsx, example-frontend/app/_layout.tsx, example-frontend/lib/betterAuth.ts, example-frontend/e2e/login.spec.ts, example-frontend/e2e/two-factor.spec.ts, example-frontend/e2e/account-linking.spec.ts, example-frontend/e2e/helpers/login.ts
  - Build:
    - The example login uses `TerrenoLoginScreen` with `rememberIdentity: true`.
    - The two-factor challenge runs inline on the login route (TerrenoLoginScreen's default), so there is no separate `app/twoFactor.tsx`.
    - `loginAs` handles a 2FA challenge when a fixture user has a TOTP secret.
  - Proof (Playwright; social, 2FA and passkey cases run in the cross-site bearer
    project, which has the mock OIDC provider; the rest in the default project):
    - "user sees last used method after signing out": sign in with mock OIDC, sign
      out, and `login-screen-oauth-mock-oidc` shows the badge.
    - "user continues as a remembered account".
    - "user with 2FA completes the TOTP challenge": the code is computed in the test
      from the fixture secret.
    - "user signs in with a passkey": uses a CDP `WebAuthn.addVirtualAuthenticator`
      authenticator with a passkey registered through the API.
    - "explicit linking mode shows the link guidance": the backend runs with
      `AUTH_ACCOUNT_LINKING=explicit`.
    - "user's email and mock-OAuth sign-ins land in one account" (the requested
      josh@ example):
      1. Sign up by email and verify it.
      2. Sign out, then sign in with mock OAuth on the same email.
      3. The same todos show.
      The unverified variant shows "verify your email to link", and after verifying,
      the same sign-in joins the account.
    - Remove `test.fixme` from `e2e/crossSiteChallenges.spec.ts` (added by T27) once the
      example login wires 2FA and passkey, and make it pass.
    - In the cross-site bearer project, "last used" and "Continue as" both render after
      sign-out (they come from T19's on-device store, not a backend cookie).

    Screenshots go to `/opt/cursor/artifacts/`.
  - Skills: verify-ui-changes, accessibility-testing, building-terreno-apps

- [ ] **T29** — Android example signs in with the mock provider (device-proven native)
  - Depends on: T22
  - Status: deferred past PR #1613 and tracked as X11. The emulator companion never stayed up.
    The flow and the native proxy fix shipped, so only the device run is left.
  - Blocked by: an Android emulator companion (`hive-companion start`). If none is
    available, return BLOCKED, environment.
  - Files: example-frontend/maestro/native-social-login.yaml, docs/how-to/set-up-social-login.md
  - Build: no app code is expected. It is a native proof of the T2 `nativeApps`
    wiring and the T20 controller.
    - `adb reverse` exposes the backend and the mock OAuth server to the emulator.
    - The Maestro flow taps `login-screen-oauth-mock-oidc`, completes the browser sign-in,
      and lands on `todos-screen`.
  - Proof: `maestro --device 127.0.0.1:5555 test example-frontend/maestro/native-social-login.yaml`
    passes. A screenshot from `adb ... screencap` is saved to `/opt/cursor/artifacts/`.
  - Docs: `set-up-social-login.md` gets a "Native" section (scheme, `trustedOrigins`).
  - Skills: verify-ui-changes, building-terreno-apps

- [x] **T23** — Example security screen
  - Depends on: T21, T22
  - Files: example-frontend/app/settings/security.tsx, example-frontend/app/settings/_layout.tsx, example-frontend/app/(tabs)/profile.tsx, example-frontend/e2e/account-security.spec.ts
  - Build:
    - Add `settings/security`, using `TerrenoAccountSecurityScreen`.
    - Profile links to it (`profile-security-link`).
    - Password change on profile moves to Better Auth `changePassword`, replacing the
      users PATCH at `app/(tabs)/profile.tsx:151`.
  - Proof (Playwright): the user can:
    - link the mock provider and see it listed;
    - unlink it;
    - enroll 2FA, saving backup codes, then sign in with a backup code;
    - add a passkey with the virtual authenticator and then remove it;
    - revoke another session (a second browser context gets 401 afterwards);
    - change the password and sign in with the new one.

    Screenshots go to artifacts.
  - Skills: verify-ui-changes, accessibility-testing, building-terreno-apps

- [x] **T24** — Org-admin member security panel
  - Depends on: T4, T9
  - Files: admin-frontend/src/orgs/MemberSecurityPanel.tsx, admin-frontend/src/orgs/MemberSecurityPanel.test.tsx, admin-frontend/src/orgs/useMemberSecurityApi.ts, admin-frontend/src/orgs/OrgMembersScreen.tsx, admin-frontend/src/index.tsx, example-frontend/e2e/org-admin-security.spec.ts, docs/reference/admin-frontend.md, changelog/unreleased/admin-member-security.md
  - Build:
    - Each member row on `OrgMembersScreen` gets a "Security" action, which opens a
      panel with the T6 summary.
    - The panel renders the summary's `actions` generically, with a confirm modal on
      destructive ones, so T7 and T8 actions appear without frontend changes.
    - It calls the routes through the host-bound `adminRequest`
      (`admin-frontend/src/adminRequest.ts`). The package rules forbid new admin
      `injectEndpoints`.
  - Proof:
    - Panel test: actions render from the summary, and confirm calls the action route.
    - Playwright "org-admin resets a member's 2FA": the member then signs in without a
      challenge.
  - Docs: `admin-frontend.md` MemberSecurityPanel section.
  - Skills: building-admin-interfaces, verify-ui-changes, accessibility-testing

- [x] **T25** — Platform user security screen
  - Depends on: T8, T24
  - Files: admin-frontend/src/UserSecurityScreen.tsx, admin-frontend/src/UserSecurityScreen.test.tsx, admin-frontend/src/index.tsx, example-frontend/app/admin/users/[id]/security.tsx, example-frontend/e2e/admin-user-security.spec.ts, docs/reference/admin-frontend.md
  - Build: operators get a user security screen that reuses `MemberSecurityPanel`
    against `/users/:id/security`, linked from the admin user record.
  - Proof: Playwright "operator disables and re-enables a user". The user's session gets
    401 while disabled, and sign-in works after enable.
  - Skills: building-admin-interfaces, verify-ui-changes

- [x] **T26** — create-terreno-app generates the auth suite
  - Depends on: T4, T21
  - Files: create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, docs/how-to/configure-better-auth.md, changelog/unreleased/cta-auth-suite.md
  - Build: the generated backend config enables:
    - `accountLinking: verified-email`
    - `twoFactor`
    - `passkey` (`rpID` from `FRONTEND_URL`)
    - `lastLoginMethod`
    - `multiSession`
    - `nativeApps`

    The generated frontend uses `TerrenoLoginScreen` and `settings/security`. The
    login route is the OAuth return page (#1604's handoff and T20 make a separate
    `auth/callback` route unnecessary).
  - Proof: generator test asserting the generated `server.ts` and `app/login.tsx`
    contain the features and the connected screens. The existing generator tests pass.
  - Skills: build-terreno-app, update-docs

## Assumptions

- **Better Auth only.** Legacy JWT/Passport auth gets no new features.
- **Plugins come from the catalog.** Better Auth plugins are pinned through the
  `better-auth` catalog version (lock 1.7.4). `@better-auth/passkey` is added to the
  catalog at the matching version (1.7.x on npm).
- **"Multiple accounts".** Better Auth enforces a unique email per user, so "multiple
  accounts" is the three-way `accountLinking.mode` plus `multiSession` (Q2). Same-email
  duplicate users are not offered.
- **Recovery routes use Express routers inside plugins.** They follow the `OrgsApp`
  precedent (a framework plugin, an allowed exception to modelRouter actions). The
  example SDK is not regenerated because admin-frontend calls the routes through
  `adminRequest`.
- **Security actions reuse the existing audit log.** They are recorded as `AuditEvent`
  rows with `source: "security"` through `AuditApp`, not in a new collection.
- **Grouped recovery tasks.** T7 and T8 each group recovery actions that share one route
  table, so T8 is ordered after T7 for that file.
- **Dependency chains.**
  - T1→T2→T6→T9→T24→T25 is ordered because each link reads what the previous one
    creates:
    - methods file
    - feature plugin tables
    - mount function
    - endpoints
    - panel
  - T2→T4→T5→T27→T20→T21→T23 is ordered for the same reason:
    - feature wiring
    - mock provider and e2e config
    - link handoff in `betterAuthOAuthHandoff.ts` and `betterAuthClient.ts`
    - challenge headers in `betterAuthClient.ts`
    - controller and `rtk/src/index.ts`
    - security hook
    - screen
  - Docs pages shared across tasks are ordered too:
    - `configure-better-auth.md` goes T2→T3→T20→T21→T26;
    - `account-security.md` goes T6→T7→T8→T10;
    - `set-up-social-login.md` goes T11→T29.
  - All new dependencies land in T2, so one task owns `bun.lock`.
- **Passkey `rpID` on previews.** It is the full preview host (`netlify.app` is a public
  suffix), so a passkey made on a preview works only on that preview. On stable after
  H3 it is the shared parent domain.
- **Host-only session cookies.** Same-site subdomains (D6) don't need Better Auth's
  `crossSubDomainCookies`: a host-only cookie on `api.<domain>` is sent on same-site
  fetches. Leaving it off keeps the session cookie away from every other subdomain.
- **Passkeys made before H3 are lost.** A passkey registered on the `netlify.app` host
  can't be used under the new `rpID`. Users sign in another way and add a new one;
  the example has no real users, and `set-up-social-login.md` says so for consumers.
- **This repo has no PHI.** The example app holds no PHI. Privacy-sensitive defaults are
  still chosen for consumers like Flourish (Q3).
- **Native: Android-proven, iOS parked.** Native social sign-in uses the browser
  through the `@better-auth/expo` server plugin (T2, `nativeApps`). T29 proves it on
  the Android emulator. iOS, the native Apple button and native passkeys are X2.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q10 | Where should the reusable auth screens live? | ui for presentation, rtk for connected screens and hooks, admin-frontend for recovery panels | ui cannot import rtk (rtk depends on ui); admin-frontend already takes an `api` prop | A new `@terreno/auth` package: same tasks, new package scaffolding, files move | T17–T21, T26 |
| Q4 | Should orgs get security policies (require 2FA, restrict sign-in methods)? | Not in this plan (X3) | The request asks for org-admin recovery; policies are new enforcement surface | +3 tasks: org settings, sign-in enforcement, member UI | T9, T24 |
| Q5 | Should an admin unlink be allowed to remove a user's last sign-in method? | Only when the user has a verified email, and then a reset email goes out automatically | Otherwise recovery creates new lockouts | Always allowed: drop the 409 guard; never allowed: always 409 | T7 |
| Q6 | Should recovery routes refuse to start without `AuditApp`? | Yes: throw at startup unless `audit: false` is passed explicitly | HIPAA reviews expect who-did-what for access changes; D2 makes cross-org reach auditable; `AuditApp` is opt-in today | Warn and run unaudited: drop the startup check in T6 | T6 |
| Q8 | Under the org prefix, should "disable" suspend the membership rather than the global account? | Yes; global `User.disabled` stays platform-only | One org must not lock a user out of every other org | Org-admins disable globally: T9 drops the remap | T9, T24 |
| Q9 | Should security emails name the org whose admin acted? | No by default (`notifications.includeOrgName`) | On a shared inbox, the org name can reveal care (same concern as Q3) | Name it by default: flip one default | T10 |
| Q7 | Accept a 5-minute revocation delay for cookie (web) sessions? | Yes, documented; bearer sessions revoke immediately | Better Auth `cookieCache` (`api/src/betterAuthSetup.ts:229-232`); disabling it costs a DB read per request | Disable the cache when recovery is enabled: one config line in T2, tested in T8 | T2, T8 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | A dedicated staging environment (Cloud Run service, Netlify site, terraform, CI) | No staging exists today; D1 uses the stable deploy | L | T11 |
| X2 | iOS proof, the native Sign in with Apple button (`expo-apple-authentication`), and native passkeys | The example is universal; iOS proof needs an EAS build | M | T18, T29 |
| X3 | Org security policies: require 2FA, allowed methods, session length | "Works for organization management" | M | T9, Q4 |
| X4 | Magic link, email OTP, Google One Tap | Other sign-in methods for the login screen | M | T2, T20 |
| X5 | Enterprise SSO (SAML/OIDC per org) | Org-managed identity | L | X3 |
| X6 | Self-service email change and account deletion | Profile completeness | M | T21 |
| X7 | Account lockout after repeated failed attempts | "Locked out" recovery | S | T8 |
| X9 | Previews under the shared domain (Netlify deploy subdomains plus a load balancer for Cloud Run tag URLs), making previews same-site too | D6 makes stable same-site; previews stay cross-site | M | T11, H3 |
| X8 | Implement the empty `PasswordField` stub; fix the stale rtk rule doc (`betterAuthReducer`) | Found during research | S | none |
| X10 | Finish T28: the live GitHub sign-in on a preview and on stable, plus the Google and Apple consent-page checks, then H2 | T28 waits on H1 (OAuth apps and secrets); deferred past PR #1613 | S | H1, T11 |
| X11 | Finish T29: run `example-frontend/maestro/native-social-login.yaml` on an Android emulator and save a screenshot | The emulator companion never stayed up; the flow and the native proxy fix shipped in PR #1613 | S | T22 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | There is no staging environment. What is "the final deployed staging one"? | Use the existing stable example deploy | It hosts the registered callbacks and proxies to previews (T11); a real staging env is X1 |
| D2 (durable) | Who may an org-admin run recovery actions on? | Any active member of their org, even one in other orgs | T9 authorizer; every action is audited (T6) and emails the user (T10) |
| D3 | An org-admin can attach any existing user by email and then act on them. Which guards? | Light guards: always refuse platform staff and `admin` targets, email the user on every org-admin action, and make a minimum membership age opt-in (default 0) | T9 as written; `orgRecovery.minMembershipDays` defaults to 0 |
| D4 (durable) | "Leave it to the consumer whether people can make multiple accounts": which knobs? | All three: linking policy (`verified-email` / `explicit` / `never`), account switching (`multiSession`), and open vs closed sign-up | T2 adds `signUp.mode`; T4 reads `AUTH_SIGN_UP`; T20 hides sign-up and maps `signup_disabled` |
| D6 | Stable frontend and backend will move to subdomains of one domain. Does the plan still work? | Yes. Stable becomes same-site, so cookies work in Safari there; previews stay cross-site, so T27 stays | H1 callbacks go on `api.<domain>`; new H3; T4 adds `PASSKEY_RP_ID`; T11 reads `STABLE_*` URLs; X9 parks same-site previews |
| D7 | Master merged #1604 after approval: web bearer mode, the OAuth one-time-token handoff, the mock OIDC provider, and a cross-site bearer Playwright project | Reuse them (engineering reconciliation, no product change) | T4 reuses `mock-oidc`; T5 becomes the link handoff; T27 narrows to the 2FA/passkey challenges; T11 extends the handoff to oauth-proxy returns; cross-site proofs use the bearer project, where cookies are never sent, instead of WebKit |
| D8 | Review found that a refused unverified sign-up left a Better Auth user behind, which a later email verification could turn into a takeover of the legacy User | Refuse before the Better Auth user is created; T8's admin action issues a set-password link instead of marking an email verified | T3 adds a `user.create.before` guard; T8 `verify-email` becomes `issue-sign-in-link` |
| D9 | Review: should recovery routes let an operator act on a superadmin, or on themselves? | No: refuse targets holding permissions the actor lacks (a `*` target needs a superadmin actor) and refuse self-targeting; self-service lives on the user's own Security screen | T6 adds the guard to the shared route pipeline, so T9 org routes inherit it (alongside D3's platform-staff refusal) |
| D10 | Review of T7: removing a user's last passkey can lock them out just like unlinking their last provider | Apply Q5's rule to passkey removal too: 409 unless the email is verified, then send a reset first | T7 guards both routes; unlink also points operators to revoke-sessions, since sessions don't record their provider |
| D11 | Review of T8: a sign-in link sets the password of a user with no inbox, which is a full takeover by whoever issues it | It needs its own RBAC statement, `user:issueSignInLink`, granted to superadmin only by default; expired links can be reissued | T8 |
| D5 (durable) | Remember name, email and avatar on the login screen by default? | No: method only by default; identity is opt-in (`rememberIdentity`); the example opts in | T19, T20 and T26 as written |

## Sign-off

Status: approved 2026-10-22
Cut: 2 rounds, 24 findings (8 blocking): 22 fixed in the plan, 2 left for the human as fundamental questions (Q1, Q2), 0 rebutted. Round 1: 12 fixed; Q1, Q2, Q8 and Q9 added to Open questions. Round 2: 10 fixed; C2 and C3 carried into Q1 and Q2, which go first at sign-off.
