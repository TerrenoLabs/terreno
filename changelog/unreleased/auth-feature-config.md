---
category: Added
---

- `@terreno/api`: `BetterAuthConfig` turns auth features on without hand-built plugins:
  `accountLinking: {mode: "verified-email" | "explicit" | "never", trustedProviders?}`,
  `twoFactor: {issuer, backupCodes?, trustDeviceDays?}`, `passkey: {rpID, rpName, origin}`,
  `signUp: {mode: "open" | "closed"}`, `lastLoginMethod`, `multiSession: {maximumSessions?}`,
  `oauthProxy: {productionURL}`, and `nativeApps` (the `@better-auth/expo` server plugin).
  Every feature is off until set; with none set the plugin list stays
  `bearer`, `terreno-methods`, then `config.plugins`. Feature plugins go before
  `config.plugins`, and `options` still overrides what they set.
- `signUp: {mode: "closed"}` stops new accounts through email and password and OAuth: email
  sign-up answers 400, and a social or generic OAuth sign-in for an unknown email fails with
  `signup_disabled`, even with `requestSignUp: true`. Other sign-in plugins added through
  `plugins` (magic link, email OTP, phone number, anonymous) need their own `disableSignUp`.
- `passkey` config is checked at startup: each `origin` must be a bare http(s) origin on
  `rpID` or a subdomain of it.
- `appleOAuth` also accepts `{clientId, teamId, keyId, privateKey, appBundleIdentifier?}` and
  signs Apple's ES256 client secret at startup (valid 180 days).
- `GET {basePath}/terreno/methods` now reports real `twoFactor`, `passkey`, and
  `multiSession` flags.
- With `rateLimit` on, `{basePath}/two-factor/*`, `/passkey/*`, `/link-social`,
  `/unlink-account`, `/multi-session/*`, `/oauth-proxy-callback`, and
  `/expo-authorization-proxy` use the `auth` bucket.
- New dependencies: `@better-auth/passkey` (catalog, api and rtk), `@better-auth/expo` (api),
  `react-native-qrcode-svg` (ui), and `otpauth` (example-frontend dev).
