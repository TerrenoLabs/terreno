# Configure Better Auth

Set up Better Auth as the **default** authentication provider for new Terreno apps — session-based auth with built-in social OAuth and first-class `@terreno/syncdb` integration.

## Overview

Better Auth is the recommended authentication system for new Terreno frontends. Register `BetterAuthApp` on the backend, set `AUTH_PROVIDER=better-auth`, and wire `createBetterAuthClient` + `generateBetterAuthSlice` on the client. Pair with `betterAuthAdapter` when using `@terreno/syncdb`.

JWT/Passport remains available for legacy deployments (`AUTH_PROVIDER=jwt`). Both can run in parallel during migration.

**Choose Better Auth for:**
- New apps and greenfield screens
- Social login (Google, GitHub, Apple)
- Session-based authentication with `@terreno/syncdb`
- Socket.io sync via `RealtimeApp` bearer sessions

**Stay on JWT only when:**
- You have an existing JWT deployment and are mid-migration
- You require a fully stateless token contract with no session cookies
- You have custom JWT payload requirements Better Auth cannot satisfy

## Backend Setup

### 1. Configure Environment Variables

Set `AUTH_PROVIDER` to enable Better Auth:

``````bash
# Choose authentication provider
AUTH_PROVIDER=better-auth  # or "jwt" (default)

# Better Auth configuration
BETTER_AUTH_SECRET=your-secret-key-min-32-chars
BETTER_AUTH_URL=http://localhost:4000

# Optional: Social OAuth providers
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

GITHUB_CLIENT_ID=your-github-client-id  
GITHUB_CLIENT_SECRET=your-github-client-secret

APPLE_CLIENT_ID=your-apple-client-id
APPLE_CLIENT_SECRET=your-apple-client-secret
``````

### 2. Build Better Auth Configuration

Create a function to build your Better Auth config:

``````typescript
import {BetterAuthConfig, AuthProvider} from "@terreno/api";

const buildBetterAuthConfig = (): BetterAuthConfig | undefined => {
  const authProvider = process.env.AUTH_PROVIDER as AuthProvider | undefined;

  if (authProvider !== "better-auth") {
    return undefined; // Use JWT auth instead
  }

  const config: BetterAuthConfig = {
    enabled: true,
    // Deep link schemes for mobile app redirects
    trustedOrigins: ["yourapp://", "exp://"],
  };

  // Add Google OAuth if configured
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    config.googleOAuth = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  // Add GitHub OAuth if configured
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    config.githubOAuth = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  // Add Apple OAuth if configured
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
    config.appleOAuth = {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    };
  }

  return config;
};
``````

Set `publicAppUrl`, `sendMail`, and `renderAuthMail` from `@terreno/comms` so password-reset and
email-verification mail match the JWT recovery templates. The hooks throw 501 and do not send when
`publicAppUrl` is missing. JWT `POST /auth/resetPassword` updates the Better Auth password and
deletes Better Auth sessions when this plugin is registered. Better Auth password reset updates
the JWT password and `tokenEpoch` for the matching app User so dual-enrolled accounts cannot keep
the old passport hash. Terreno reads the new password from Better Auth's parsed request body, so
this works over HTTP (`POST {basePath}/reset-password`).

```typescript
import {getCommsService, renderAuthMail} from "@terreno/comms";

const config: BetterAuthConfig = {
  enabled: true,
  publicAppUrl: process.env.FRONTEND_URL || "http://localhost:8082",
  renderAuthMail,
  sendMail: async (message) => {
    await getCommsService().sendMail(message);
  },
  // ...
};
```

Throwaway in-process seed apps (CLI / container smoke tests that call Better Auth
sign-up many times) should set `disableRateLimit: true` on that instance only.
Better Auth enables its limiter in production, which 429s the fourth seeded user.

#### Pass other Better Auth options and plugins

`BetterAuthConfig` covers the settings Terreno manages. For anything else, use `options` and
`plugins` instead of replacing `BetterAuthApp`:

- `options` takes any Better Auth option except `basePath` and `plugins`, with nested fields
  optional. It is deep-merged over the options Terreno builds. Arrays (such as `trustedOrigins`)
  replace Terreno's instead of merging. An explicit value wins; an `undefined` value is ignored,
  so it cannot clear a default.
- `plugins` are appended after Terreno's `bearer()`, `terreno-methods`, and feature plugins
  (see [Auth features](#auth-features)). Their endpoints mount under `basePath`, like the
  built-in ones.

``````typescript
const config: BetterAuthConfig = {
  enabled: true,
  options: {
    emailAndPassword: {
      requireEmailVerification: true,
      // Carry over legacy password hashes during a migration
      password: {hash: hashPassword, verify: verifyPassword},
    },
    databaseHooks: {user: {create: {after: async (user) => onUserCreated(user)}}},
  },
  plugins: [myBetterAuthPlugin()],
};
``````

| Terreno default | Set from | What overriding it drops |
| --- | --- | --- |
| `database` | MongoDB adapter on the app's connection | Users and sessions in the app's database |
| `emailAndPassword.enabled` | `true` | Email/password sign-in |
| `emailAndPassword.revokeSessionsOnPasswordReset` | `true` | Signing out other sessions after a password reset |
| `emailAndPassword.sendResetPassword` | `sendMail` | Terreno's reset email |
| `emailAndPassword.onPasswordReset` | `userModel` | Syncing the new password to JWT credentials |
| `emailVerification.sendOnSignUp`, `emailVerification.sendVerificationEmail` | `sendMail` | Terreno's verification email on sign-up |
| `session.cookieCache` | `{enabled: true, maxAge: 300}` | The 5-minute session cookie cache |
| `advanced.defaultCookieAttributes` | `crossDomainCookies` | `SameSite=None; Secure` cookies for cross-site frontends |
| `rateLimit` | `disableRateLimit` | Turning Better Auth's limiter off |
| `socialProviders` | `googleOAuth`, `githubOAuth`, `appleOAuth`, `signUp` | The configured social providers (`options` adds to them per provider) |
| `account.accountLinking` | `accountLinking` | The linking mode Terreno maps (`options` wins field by field) |
| `emailAndPassword.disableSignUp` | `signUp` | Closed email sign-up |
| `trustedOrigins` | `trustedOrigins` | The origins listed in the config |

Endpoints added by `plugins` are not part of the `auth.api` type. Call them over HTTP, or cast
`auth.api` where you call them on the server.

#### Auth features

Switch auth features on with these `BetterAuthConfig` fields instead of adding Better Auth
plugins yourself. Every feature is off until you set its field. Terreno adds the plugins after
`bearer()` and `terreno-methods` and before `config.plugins`, so your own plugins still run
after them. `GET {basePath}/terreno/methods` reports `twoFactor`, `passkey`, `multiSession`,
`signUp`, and `accountLinking.mode` from the final configuration.

| Field | Maps to | Default |
| --- | --- | --- |
| `accountLinking: {mode, trustedProviders?}` | `account.accountLinking`: `verified-email` = linking on; `explicit` = `disableImplicitLinking: true`; `never` = `enabled: false`. `requireLocalEmailVerified` is `true` in every mode. `trustedProviders` skip the verified-email check, including on `/link-social`: list only providers that prove email ownership | Better Auth's default (`verified-email`) |
| `twoFactor: {issuer, backupCodes?: {amount?, length?}, trustDeviceDays?}` | `twoFactor()` from `better-auth/plugins` (TOTP + backup codes; adds the `twoFactor` collection and `user.twoFactorEnabled`) | Off. When on: 10 backup codes of 10 characters, 30 trusted days |
| `passkey: {rpID, rpName, origin: string[]}` | `passkey()` from `@better-auth/passkey` (adds the `passkey` collection; registering needs a session). Each origin must be a bare origin on `rpID` or a subdomain | Off |
| `signUp: {mode: "open" \| "closed"}` | `closed`: `emailAndPassword.disableSignUp`, plus `disableSignUp` and `disableImplicitSignUp` on every social and `genericOAuth` provider (not on other sign-in plugins) | `open` |
| `lastLoginMethod: true` | `lastLoginMethod({storeInDatabase: true})` (a cookie plus `user.lastLoginMethod`) | Off |
| `multiSession: {maximumSessions?}` | `multiSession()` | Off. When on: 5 sessions |
| `oauthProxy: {productionURL}` | `oAuthProxy()` | Off |
| `nativeApps: true` | `expo()` from `@better-auth/expo` (`GET {basePath}/expo-authorization-proxy` for native social sign-in) | Off |
| `appleOAuth: {clientId, teamId, keyId, privateKey, appBundleIdentifier?}` | `socialProviders.apple`, with the ES256 client secret signed from the key at startup | The `{clientId, clientSecret}` form still works |

```typescript
const config: BetterAuthConfig = {
  enabled: true,
  accountLinking: {mode: "explicit"},
  lastLoginMethod: true,
  multiSession: {maximumSessions: 3},
  passkey: {origin: ["https://app.example.com"], rpID: "example.com", rpName: "Example"},
  signUp: {mode: "closed"},
  twoFactor: {issuer: "Example", trustDeviceDays: 14},
};
```

Notes:

- **Closed sign-up.** `POST {basePath}/sign-up/email` answers 400, and a social or generic
  OAuth sign-in for an unknown email redirects to the error URL with `error=signup_disabled`
  (an ID-token sign-in answers 401 `signup disabled`). A client's `requestSignUp: true` does not
  reopen it. Terreno reaches providers registered through `config.plugins` (such as
  `genericOAuth`) with a `terreno-sign-up-closed` plugin that runs after them. Closed mode also
  refuses `auth.api.signUpEmail` on the same instance, so seed users with a separate instance
  that leaves `signUp` unset.
  - It covers email and password and OAuth providers only. Other sign-in plugins you add
    through `plugins` (`magicLink`, `emailOTP`, `phoneNumber`, `anonymous`, ...) create users on
    their own terms: set their own `disableSignUp` (or equivalent) option too.
  - With `oauthProxy`, the production server finishes a preview's OAuth sign-in and decides
    whether it may create a user, so the preview follows production's sign-up mode. Give both
    the same `signUp.mode`.
- **Trusted providers.** Better Auth skips the verified-email check for `trustedProviders` on
  sign-in, on an explicit `/link-social`, and on its callback. List only providers that prove
  the user owns the email they report. A provider that lets users set any email lets an
  attacker link into someone else's account.
- **Passkey origins.** `createBetterAuth` throws `passkey config is invalid` unless `origin`
  lists at least one bare `http(s)` origin (no path or trailing slash) whose host is `rpID` or
  a subdomain of it.
- **Apple key.** `privateKey` is the `.p8` file's PEM contents; escaped `\n` sequences from an env
  var are turned back into newlines. The signed secret is valid for 180 days, so redeploy at
  least that often. Web sign-in needs `https://appleid.apple.com` in `trustedOrigins`, since
  Apple posts the callback from there.
- **Schema.** Better Auth stores `twoFactorEnabled` and `lastLoginMethod` on its own `user`
  collection, not on your app `User` model, so a `strict: "throw"` User schema needs no new
  fields.
- **Rate limits.** With `TerrenoApp` `rateLimit` on, `{basePath}/two-factor/*`,
  `/passkey/*`, `/link-social`, `/unlink-account`, `/multi-session/*`,
  `/oauth-proxy-callback`, and `/expo-authorization-proxy` count against the `auth` bucket.
- **Linking.** `never` (or `options.account.accountLinking.enabled: false`) adds a
  `terreno-linking-disabled` plugin that refuses `POST {basePath}/link-social` with 403
  `LINKING_DISABLED`. In every mode an unverified sign-up never claims an existing app `User`
  with the same email (409 `VERIFY_EMAIL_TO_USE_ACCOUNT`). See
  [Account linking](../explanation/account-linking.md).
- `options` still wins: for example `options.account.accountLinking.enabled` overrides the
  mode `accountLinking` sets.

#### Auth features in example-backend

example-backend (`src/utils/betterAuthConfig.ts`) turns every feature on except `oauthProxy`.
These env vars tune it:

| Env var | Sets | Default |
| --- | --- | --- |
| `AUTH_ACCOUNT_LINKING` | `accountLinking.mode`: `verified-email`, `explicit`, or `never` | `verified-email` |
| `AUTH_SIGN_UP` | `signUp.mode`: `open` or `closed` | `open` |
| `FRONTEND_URL` | The first `passkey.origin` (its origin) and the default `passkey.rpID` (its host); also the auth mail links | `http://localhost:8082` |
| `PASSKEY_RP_ID` | `passkey.rpID`. Must be the `FRONTEND_URL` host or a parent domain of it, such as `example.com` for `https://app.example.com` | The `FRONTEND_URL` host |

The rest is fixed: `twoFactor.issuer` and `passkey.rpName` are `Terreno Example`, and
`lastLoginMethod`, `multiSession` (5 sessions) and `nativeApps` are on. Email verification
stays optional at sign-up; linking by email needs it.

`passkey.origin` is the `FRONTEND_URL` origin plus each `CORS_ORIGINS` (and dev) origin whose
host is the rpID or one of its subdomains, because a browser refuses a passkey on any other
host. `localhost` and `127.0.0.1` cannot share an rpID, so with the default `FRONTEND_URL`
passkeys work on `http://localhost:8082` and not on `http://127.0.0.1:8082`. Set
`FRONTEND_URL=http://127.0.0.1:8082` to use the loopback address instead. On a deploy where the
web app is `app.<domain>`, set `PASSKEY_RP_ID=<domain>` so a passkey works on every subdomain.
A passkey made under one rpID cannot be used under another.

With `NODE_ENV=production` and a loopback `FRONTEND_URL` (the default when a deploy does not set
it), example-backend leaves `passkey` out, logs one warning, and `/terreno/methods` reports
`passkey: false`: a passkey bound to `localhost` can never work for a deployed web app.

The seed (`seedBetterAuthUserInProcess`) and the e2e setup (`e2e/auth.setup.ts`) mark their
users' Better Auth email verified, so `verified-email` linking treats them as the email's
owner. The seed still works with `AUTH_SIGN_UP=closed`: it builds its own instance with sign-up
open.

### 3. Register BetterAuthApp Plugin

Use the TerrenoApp plugin system:

``````typescript
import {TerrenoApp, BetterAuthApp} from "@terreno/api";
import {User} from "./models/user";

const betterAuthConfig = buildBetterAuthConfig();

const app = new TerrenoApp({
  userModel: User,
  // ... other options
});

// Register Better Auth plugin if configured
if (betterAuthConfig) {
  app.register(new BetterAuthApp({
    config: betterAuthConfig,
    userModel: User,
  }));
}

const server = app.start();
``````

`RealtimeApp` (registered directly or through `TerrenoApp({realtime})`) uses this plugin's Better Auth instance for socket sessions. Do not build a second instance with `createBetterAuth` for sockets.

### 4. Update User Model

`syncBetterAuthUser` creates the app `User` on the first authenticated request after Better Auth sign-up. Declare `betterAuthId` on that schema. Declare `oauthProvider` only if the app uses social OAuth.

To lock an account out, set `disabled: true` on its app `User` (for example with `isDisabledPlugin`). That user's Better Auth sessions stop authenticating: `req.user` is not set, so protected routes answer 401. Sign-out still works.

Email/password sync does **not** write `oauthProvider`. A `strict: "throw"` schema that omits the field stays valid. Social login still passes a provider string and requires the field.

``````typescript
const userSchema = new mongoose.Schema(
  {
    email: {type: String, unique: true},
    name: {type: String},
    betterAuthId: {index: true, sparse: true, type: String},
    // Required only when using Google, GitHub, or Apple:
    // oauthProvider: {type: String},
  },
  {strict: "throw"}
);
``````

## Frontend Setup

### 1. Create Better Auth Client

``````typescript
import {createBetterAuthClient} from "@terreno/rtk";

// `scheme` is the app's deep-link scheme (required).
export const authClient = createBetterAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
  scheme: "yourapp",
});
``````

On web the client authenticates with Better Auth's session cookie. When the web frontend and
the API are on different sites, use [bearer mode](#frontend-and-api-on-different-sites).

#### Client features

When the server turns on [auth features](#auth-features), pass `features` so the client gets
the matching Better Auth client plugins and their typed methods:

``````typescript
import {router} from "expo-router";
import {createBetterAuthClient} from "@terreno/rtk";

export const authClient = createBetterAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
  features: {
    lastLoginMethod: true,
    multiSession: true,
    passkey: true,
    twoFactor: {onTwoFactorRedirect: () => router.push("/twoFactor")},
  },
  scheme: "yourapp",
});

await authClient.twoFactor.enable({password});
await authClient.passkey.addPasskey({name: "Laptop"});
const sessions = await authClient.multiSession.listDeviceSessions();
``````

| Feature | Client plugin | Adds |
| --- | --- | --- |
| `twoFactor: true \| {onTwoFactorRedirect}` | `twoFactorClient` | `client.twoFactor.*` (`enable`, `disable`, `getTotpUri`, `verifyTotp`, `generateBackupCodes`, `verifyBackupCode`, ...). `onTwoFactorRedirect({twoFactorMethods})` runs when a sign-in answers `twoFactorRedirect` instead of a session. In [bearer mode](#frontend-and-api-on-different-sites) the 2FA challenge and trusted-device cookies are not sent yet, so finishing a 2FA sign-in needs cookie mode or native |
| `passkey: true` | `passkeyClient` from `@better-auth/passkey/client` | `client.passkey.*` (`addPasskey`, `listUserPasskeys`, `deletePasskey`, `updatePasskey`) and `client.signIn.passkey()`. Web only: React Native has no WebAuthn. In bearer mode the passkey challenge cookie is not sent yet, so registering and signing in need cookie mode |
| `multiSession: true` | `multiSessionClient` | `client.multiSession.*` (`listDeviceSessions`, `setActive`, `revoke`). Not in bearer mode: the server tracks device sessions in `session_token_multi-*` cookies, so `listDeviceSessions` answers `[]`; use [remembered accounts](#4-remember-accounts-on-this-device) for switching there |
| `lastLoginMethod: true` | `lastLoginMethodClient` | `client.getLastUsedLoginMethod()`, `isLastUsedLoginMethod(method)`, `clearLastUsedLoginMethod()`. They read the server's cookie, so they return `null` on native and in [bearer mode](#frontend-and-api-on-different-sites); use [remembered accounts](#4-remember-accounts-on-this-device) there |
| `oneTimeToken: true` | `oneTimeTokenClient` | `client.oneTimeToken.generate()` and `verify({token})`. The OAuth handoff does not need it |

Notes:

- **Types.** Each enabled feature's namespace is typed from the plugin, with no casts, when
  `features` is written out at the call. Without `features`, or when the config's type does not
  say which features are on (a config typed `BetterAuthClientConfig`, or a wrapper that forwards
  `features?: BetterAuthClientFeatures`), the client is `BetterAuthClient`, exactly what it was
  before, and `ReturnType<typeof createBetterAuthClient>` is still `BetterAuthClient`. `false`
  or a missing key adds nothing; a `boolean` read at runtime (`{twoFactor: isOn}`) is typed as
  on. Name the typed client with `BetterAuthClientWithFeatures<{twoFactor: true}>`.
- **Native.** The feature plugins go after the Expo plugin. Better-fetch runs plugin hooks in
  order, so on native the Expo plugin stores the 2FA challenge cookie before
  `onTwoFactorRedirect` runs, and every feature call sends the stored cookies.
- **Server first.** A client feature only adds client methods. Turn the feature on in
  `BetterAuthConfig` too, or its calls answer 404.

### 2. Add Session Redux Slice

``````typescript
import {generateBetterAuthSlice} from "@terreno/rtk";
import {configureStore} from "@reduxjs/toolkit";
import {authClient} from "./authClient";

const betterAuth = generateBetterAuthSlice({authClient});

export const store = configureStore({
  reducer: {
    betterAuth: betterAuth.reducer, // selectors read `state.betterAuth`
    // ... other reducers
  },
  middleware: (getDefault) => getDefault().concat(...betterAuth.middleware),
});

// Call after sign-in, sign-out, and at app startup to copy the session into Redux
void betterAuth.syncSession(store.dispatch);
``````

### 3. Add Social Login UI

Use the SocialLoginButton component:

``````typescript
import {SocialLoginButton, Box} from "@terreno/ui";
import {authClient} from "@/store/authClient";

const LoginScreen = () => {
  return (
    <Box padding={4} gap={3}>
      <SocialLoginButton
        provider="google"
        onPress={async () => {
          await authClient.signIn.social({
            provider: "google",
            callbackURL: "yourapp://auth/callback",
          });
        }}
      />
      
      <SocialLoginButton
        provider="github"
        onPress={async () => {
          await authClient.signIn.social({
            provider: "github",
            callbackURL: "yourapp://auth/callback",
          });
        }}
      />
      
      <SocialLoginButton
        provider="apple"
        onPress={async () => {
          await authClient.signIn.social({
            provider: "apple",
            callbackURL: "yourapp://auth/callback",
          });
        }}
      />
    </Box>
  );
};
``````

### 4. Remember accounts on this device

The login screen can show how each person signed in last and offer a "Continue as" card per
account. `createRememberedAccountsStore` keeps that list on the device. It is not a session and
holds no credential: a remembered account still signs in with its method. Use it alongside
Better Auth's `lastLoginMethod`, which reads a backend cookie that a cross-site web page cannot
see.

``````typescript
import {createRememberedAccountsStore, toLoginAccountOptions, useRememberedAccounts} from "@terreno/rtk";
import {LoginScreen} from "@terreno/ui";

// One store per app, at module scope.
export const rememberedAccounts = createRememberedAccountsStore({rememberIdentity: false});

// After a successful sign-in, record the user and the method they used:
// a provider id ("google", "mock-oidc"), "email", or "passkey".
await rememberedAccounts.record({
  email: user.email, // ignored unless rememberIdentity is true
  image: user.image,
  method: "google",
  name: user.name,
  userId: user.id,
});

const Login = (): React.ReactElement => {
  const {accounts, lastUsedMethod, forget} = useRememberedAccounts(rememberedAccounts);
  return (
    <LoginScreen
      lastUsedMethod={lastUsedMethod}
      onForget={(account) => forget(account.id)}
      rememberedAccounts={toLoginAccountOptions(accounts)}
      // ...fields, providers, onContinue
    />
  );
};
``````

What is stored:

| Field | Stored when | Notes |
| --- | --- | --- |
| `userId`, `method`, `lastUsedAt` | Always | `lastUsedAt` is an ISO UTC timestamp |
| `name` | `rememberIdentity: true` | Stored in clear, not masked. Trimmed, at most 64 characters |
| `email` | `rememberIdentity: true` | Always masked first: `josh@nang.io` becomes `j***@n***.io` |
| `image` | `rememberIdentity: true` | `https://` URLs up to 256 characters only |

The store keeps the newest 5 accounts (`max`), one entry per user, and stays under SecureStore's
2048-byte value limit by dropping the oldest. Storage by platform:

- **iOS:** SecureStore (the keychain) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so the entry is not
  restored to a new device from a backup.
- **Android:** SecureStore encrypts the value with an Android Keystore key and keeps it in the
  app's `SecureStore` shared preferences. The `keychainAccessible` setting does not apply. The
  `expo-secure-store` config plugin (on by default, `configureAndroidBackup: true`) excludes those
  preferences from Android Auto Backup. Without the plugin, or when the app already has its own
  backup rules, the encrypted value can be backed up; the Keystore key does not leave the device,
  so a restored copy cannot be decrypted. Add the plugin to `app.json` `plugins`.
- **Web:** localStorage, shared by every tab on the origin. Each change re-reads storage first and
  each store follows `storage` events, so a stale tab never brings back an account another tab
  forgot. Call `rememberedAccounts.dispose()` if you create a store that does not live for the
  whole page.

Native storage loads asynchronously: `useRememberedAccounts` returns `isHydrated: false` until it
has, so wait for it before deciding there is no last used method. Stored data the store cannot
read resets to an empty list instead of throwing.

**Privacy.** Apps that handle health or other sensitive data often run on shared devices: a
family tablet, a clinic kiosk. Showing who has an account there can itself disclose something,
so identity is opt-in:

- `rememberIdentity` is required. Pass `false` to remember only the method unless the app's
  users own their devices. Cards then show only the method.
- With `rememberIdentity: true`, the name is stored and shown in clear. Masking hides most of the
  email, but the first letters and top-level domain can still hint at an employer or clinic
  (`j***@f***.health`), so treat the masked email as identifying too.
- Turning `rememberIdentity` off later scrubs names, emails, and avatars already stored, the next
  time the store loads.
- Offer a way to forget. Pass `onForget` to `LoginScreen`, and on a "Sign out and forget me"
  action call `rememberedAccounts.forget(userId)` after signing out. Call
  `rememberedAccounts.clear()` to remove every account, for example from a "Not your device?"
  link.

## Frontend and API on different sites

By default the web client relies on Better Auth's HttpOnly session cookie. When the web app
and the API are on different sites (for example `app.example.com` and `api.example.net`, or
two hosting providers' domains), that cookie is a third-party cookie, and browsers such as
Safari block it. The user signs in and is signed out on the next request.

Use bearer mode in that case. Keep cookie mode when the frontend and API share a site.

``````typescript
import {createBetterAuthClient} from "@terreno/rtk";

export const authClient = createBetterAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
  scheme: "yourapp",
  webAuth: "bearer",
});
``````

With `webAuth: "bearer"`, on web only:

- The client stores the `set-auth-token` response header from sign-in under
  `${storagePrefix}_bearer_token` (default `terreno_bearer_token`) in `localStorage`.
- Every Better Auth client call, `getSession` included, sends `Authorization: Bearer <token>`
  and no cookies (`credentials: "omit"`).
- `signOut()` forgets the token before its request is sent, so a failed sign-out never leaves
  a usable token on the device.
- A successful `getSession` that returns no session clears the token, unless a newer token was
  stored while that request was in flight. A failed or 5xx `getSession` keeps it.

Native apps ignore `webAuth`: the Expo plugin already keeps the session without browser cookies.

Bearer mode covers email and password sign-in directly. Social and generic OAuth sign-in end
with a redirect, so the page never sees `set-auth-token`. They need the
[one-time-token handoff](#social-sign-in-in-bearer-mode) below.

Apps that handle PHI should pass `bearerStorage: window.sessionStorage` and serve a strict
Content-Security-Policy. `localStorage` is readable by any XSS on the frontend's origin and
outlives the tab, so a stolen or forgotten token stays usable after the person closes it.

Read the stored token outside the client, without a network call, with
`getBetterAuthBearerToken({storagePrefix?, bearerStorage?})`. Pass the same options the client
was created with.

example-frontend shows the whole setup. `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true` turns on
bearer mode in `lib/betterAuth.ts`. `store/syncdb.ts` passes the stored token to
`betterAuthAdapter` as `getBearerToken`, and `store/index.ts` registers that adapter with
`setTokenSource` before it creates the store, so RTK Query, the socket and MCP tools send the
same token. `e2e/crossSiteBearer.spec.ts` signs in from `localhost:8082` to an API on
`127.0.0.1:4000` with every `set-cookie` header stripped, then reloads.

### Server requirements

- The web app's origin must be in `trustedOrigins`. A cookie-less sign-in sends an `Origin`
  header, and Better Auth rejects an unlisted origin with 403 `INVALID_ORIGIN`:

  ``````typescript
  const config: BetterAuthConfig = {
    enabled: true,
    trustedOrigins: ["https://app.example.com", "yourapp://", "exp://"],
  };
  ``````

  Better Auth skips this check when `NODE_ENV=test`, so test it against a non-test build.
- No CORS change is needed. Bearer mode sends no cookies, so the default `corsOrigin` (`"*"`)
  works, and so does an explicit list that includes the web origin.
- No header change is needed. Better Auth's bearer plugin, which `BetterAuthApp` enables, lists
  `set-auth-token` in `Access-Control-Expose-Headers` itself, so the page can read it.

### Social sign-in in bearer mode

The server adds a single-use, three-minute token to the OAuth callback's redirect, in the URL
fragment, and the web app exchanges it for the bearer. rtk binds each exchange to a random
nonce the tab stored when it started the sign-in, so a token planted in a link is never sent.

1. On the server, list the web app's origin and the one page that reads the token. The origin
   must also be in `trustedOrigins`:

   ``````typescript
   const config: BetterAuthConfig = {
     enabled: true,
     oauthHandoff: {
       callbackPaths: ["/"], // the default; list only the page that runs the steps below
       webOrigins: ["https://app.example.com"],
     },
     trustedOrigins: ["https://app.example.com", "yourapp://", "exp://"],
   };
   ``````

   `webOrigins` takes exact `http(s)` origins. `callbackPaths` takes exact paths in normal form
   (no trailing-slash or case variants). The query is free. Any other return page is refused.

2. Start the sign-in from the buttons with `signInSocialWithHandoff`. It stores the nonce in
   `sessionStorage` and navigates the page to `GET {basePath}/oauth-handoff/start`, which keeps
   Better Auth's OAuth state cookie first-party on the API's origin. The start endpoint answers
   400 when a request's `Sec-Fetch-Dest` is set and is not `document`, so open it as a page
   navigation, never with `fetch`, an `<img>`, or an `<iframe>`:

   ``````typescript
   import {signInSocialWithHandoff} from "@terreno/rtk";

   <SocialLoginButton
     provider="google"
     onPress={() =>
       signInSocialWithHandoff({
         callbackURL: "/", // must be one of callbackPaths; defaults to "/" on this origin
         client: authClient,
         errorCallbackURL: "/login", // optional; defaults to callbackURL
         provider: "google",
       })
     }
   />
   ``````

   It throws on native, in cookie mode, and when `sessionStorage` is blocked. Keep
   `authClient.signIn.social` on native and in cookie mode.

3. On the return page, await `completeBetterAuthOAuthHandoff` at startup, before anything
   reads the session, before any code acts on other query parameters (such as `next=`), and
   before Sentry, analytics, or other third-party scripts start:

   ``````typescript
   import {completeBetterAuthOAuthHandoff} from "@terreno/rtk";

   await completeBetterAuthOAuthHandoff({client: authClient});
   await betterAuth.syncSession(store.dispatch);
   initSentry();
   ``````

   When the URL has `#ott=<token>` and a `handoff=` equal to the stored nonce, it removes
   `ott`, `handoff` and the stored nonce with `history.replaceState`, then posts the token to
   `{basePath}/one-time-token/verify`. Bearer mode stores the `set-auth-token` that comes back.
   It resolves `true` only when a token was stored, and it never rejects. Other query and
   fragment parts stay. A token without a matching nonce, or an `ott` in the query instead of the
   fragment, is removed from the URL and never sent.
   Calls made while one is running share its result, so React strict mode verifies once.

4. Show sign-in errors from the query. A failed start or callback comes back with
   `?error=provider_not_found`, `?error=sign_in_failed`, or one of Better Auth's own `error=`
   codes. The function resolves `false` and leaves `error` in the URL.

The return page must not redirect, on the server or in the browser, before the function has
run. A browser carries the fragment through a redirect that has none of its own, so a redirect
would hand the token to the next page. For the same reason, keep `callbackPaths` to that page.

example-frontend uses `/login` as the return page. With `BETTER_AUTH_OAUTH_HANDOFF=true`,
example-backend sets `oauthHandoff` to its web origins and `callbackPaths: ["/login"]`. With
`NODE_ENV=production` it drops loopback origins (`localhost`, `127.0.0.1`, `[::1]`, any port) from
the handoff only, so a token never goes to a page on the visitor's own machine, and it refuses to
start when no other origin is left in `CORS_ORIGINS`. CORS and `trustedOrigins` keep them. In bearer mode `lib/betterAuth.ts` starts the social buttons with
`signInSocialWithHandoff`. `app/_layout.tsx` syncs the session only after the exchange resolves.

In an Expo Router app, run the exchange from the entry file, not from a layout. Expo Router
copies the URL, fragment included, as soon as it is imported, and writes that copy back into
the address bar when it routes, which would put `ott` and `handoff` back. Importing
`@terreno/rtk` imports Expo Router too (through `@terreno/ui`). example-frontend's `index.js`
first imports `lib/oauthHandoffUrl.ts`, which has no imports and hides `handoff` and `ott` from
the URL, then `lib/oauthHandoff.ts`, which puts the URL back and calls
`completeBetterAuthOAuthHandoff` in the same synchronous step, then `expo-router/entry`.

The login screen shows `?error=` in `login-screen-error`. `e2e/crossSiteOAuth.spec.ts` signs in
cross-site through a local mock OIDC provider (`e2e/helpers/mockOidcProvider.ts`), which
example-backend registers as the `mock-oidc` generic OAuth provider only when `MOCK_OIDC_ISSUER`
is set. example-backend refuses to start when `MOCK_OIDC_ISSUER` is set with
`NODE_ENV=production` or names a host other than `127.0.0.1`, `localhost` or `[::1]`.

By default the mock provider signs in one fixed verified user (`MOCK_OIDC_USER`). A test can
name a different identity per sign-in with `setMockOidcIdentity(context, {email, emailVerified,
name?, sub?})`, which sets a `mock_oidc_identity` cookie on the provider's host for that browser
context only, so parallel tests do not collide. An authorize request with a `login_hint` and no
cookie signs in that email, verified. Use an unverified identity to drive the linking cases that
must refuse.

### Linking a provider in bearer mode

A signed-in user links Google, GitHub, or a generic OAuth provider from the Security screen. In
cookie mode `authClient.linkSocial` does this. In bearer mode it can't: its
`POST /link-social` fetch comes from another site, so the OAuth state cookie it needs on the
API's origin is never set. Use `linkSocialWithHandoff` from `@terreno/rtk` instead. It needs
the same `oauthHandoff` server config as social sign-in, and account linking must be on
(`accountLinking.mode` other than `never`).

``````typescript
import {linkSocialWithHandoff} from "@terreno/rtk";

const {error} = await linkSocialWithHandoff({
  callbackURL: "/settings/security", // any page on a web origin; sent as an absolute URL
  client: authClient,
  errorCallbackURL: "/settings/security?link=failed", // optional; defaults to callbackURL
  provider: "google",
});
if (error?.code === "LINKING_DISABLED") {
  // Linking is off on this server; hide the "Link" buttons.
}
``````

On web in bearer mode it takes two steps:

1. It posts `{provider, callbackURL, errorCallbackURL}` with the bearer to
   `POST {basePath}/oauth-handoff/link-intent`, with both URLs resolved to absolute ones. The
   server accepts any page on one of `oauthHandoff.webOrigins` that `trustedOrigins` allows.
   `callbackPaths` do not apply, because no token travels on a link's return. It answers
   `{token, startURL}`. The token is single-use, expires in
   three minutes, and stands for the caller's session.
2. It submits the token in a hidden HTML form (method POST) to `startURL`. That page navigation
   keeps the token out of the URL and lets the server set the state cookie first-party. The
   server uses the token up, starts Better Auth's link flow as that session, and redirects to
   the provider.

The provider sends the page back to `callbackURL`. The account is linked, and the URL carries
no `#ott`, because linking creates no session. `completeBetterAuthOAuthHandoff` finds nothing
to do there. A failure comes back to `errorCallbackURL` (default `callbackURL`) with `?error=`:

- `session_expired`: the session was revoked or expired between the two steps.
- `provider_not_found`: the server has no such provider.
- `link_failed`: any other failure.
- Better Auth's own callback codes, such as `email_does_not_match`, `unable_to_link_account`
  (the provider did not verify the email), or `account_already_linked_to_different_user`.

The intent answers 400 for a return URL that is not on one of `oauthHandoff.webOrigins` (403
when `trustedOrigins` does not allow it), and 403 `LINKING_DISABLED` when linking is off. The function resolves with that
`{error}` and submits nothing. The start answers 400, with no redirect, for an unknown, used, or
expired token. It also answers 400 when `Sec-Fetch-Dest` is set and is not `document`, and 403
when `Origin` is missing, `null`, or not one of `webOrigins`. Those two refusals leave the token
unused.

Don't serve the web app with `Referrer-Policy: no-referrer` or `Referrer-Policy: same-origin`.
With either, the browser sends `Origin: null` on the cross-site form post, and every link start
answers 403. The default, `strict-origin-when-cross-origin`, works.

Better Auth's same-email rule still applies: the provider's verified email must match the
user's, unless `options.account.accountLinking.allowDifferentEmails` is set. In cookie mode and
on native, `linkSocialWithHandoff` calls `client.linkSocial` as before.

### Trade-offs

A bearer token in web storage is readable by any script on the frontend's origin, so an XSS
can steal it. An HttpOnly cookie cannot be read that way, which is why cookie mode stays the
default. `localStorage` also outlives browser restarts, so on a shared device, such as a family
computer, the next person to open the app is still signed in.

On shared devices, keep the token in `sessionStorage` so it ends when the browser session does.
Reading `window.sessionStorage` throws when the browser blocks site storage, so guard it:

``````typescript
const sessionStorageOrDefault = (): Storage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined; // falls back to localStorage, or to no storage when that is blocked too
  }
};

export const authClient = createBetterAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
  bearerStorage: sessionStorageOrDefault(),
  scheme: "yourapp",
  webAuth: "bearer",
});
``````

`bearerStorage` takes any synchronous `{getItem, setItem, removeItem}` store.

## OAuth Provider Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs:
   - `http://localhost:4000/api/auth/callback/google` (development)
   - `https://yourapp.com/api/auth/callback/google` (production)
6. Copy Client ID and Client Secret to `.env`

### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set Authorization callback URL:
   - `http://localhost:4000/api/auth/callback/github` (development)
   - `https://yourapp.com/api/auth/callback/github` (production)
4. Copy Client ID and generate Client Secret
5. Add to `.env`

### Apple Sign In

1. Go to [Apple Developer Console](https://developer.apple.com/)
2. Create a new Services ID
3. Configure Sign in with Apple
4. Add return URLs (similar to above)
5. Generate a Sign in with Apple key and download the `.p8` file
6. Pass the Services ID, team ID, key ID, and key contents as `appleOAuth: {clientId, teamId,
   keyId, privateKey}`; Terreno signs the client secret at startup (see
   [Auth features](#auth-features))

## Generated Endpoints

When Better Auth is enabled, these endpoints are available:

- `POST /api/auth/signup/email` — Email/password signup
- `POST /api/auth/signin/email` — Email/password signin
- `GET /api/auth/signin/google` — Initiate Google OAuth
- `GET /api/auth/signin/github` — Initiate GitHub OAuth
- `GET /api/auth/signin/apple` — Initiate Apple Sign In
- `GET /api/auth/callback/{provider}` — OAuth callback handler
- `POST /api/auth/signout` — Sign out current session
- `GET /api/auth/session` — Get current session

## Troubleshooting

### "BETTER_AUTH_SECRET is not set"

Ensure you've set both `AUTH_PROVIDER=better-auth` and `BETTER_AUTH_SECRET` in your environment variables.

### OAuth redirect mismatch

Verify the callback URLs in your OAuth provider settings match your `BETTER_AUTH_URL` + `/api/auth/callback/{provider}`.

### Session not persisting

Check that `trustedOrigins` in your Better Auth config includes your app's deep link scheme (e.g., `"yourapp://"`).

### Social login opens browser but doesn't redirect back

Ensure your mobile app has the proper deep link configuration in `app.json`:

``````json
{
  "expo": {
    "scheme": "yourapp"
  }
}
``````

## Migration from JWT Auth

Better Auth runs **in parallel** with JWT auth. You don't need to migrate existing users immediately:

1. Set `AUTH_PROVIDER=better-auth`
2. Keep existing JWT endpoints available (they still work)
3. New users can sign up via Better Auth
4. Existing users continue using JWT tokens
5. Existing users who sign up through Better Auth with the same email are linked to their app
   `User` when the password they sign up with matches their existing passport password, or when
   they sign in with a provider that verified the email. Otherwise sign-up answers 409 "Verify
   your email to use this account" and nothing is created. Users without a password (GitHub JWT
   sign-in) use a verified provider sign-in or JWT forgot-password first, so keep the JWT routes
   mounted during the move.

See [Account linking](../explanation/account-linking.md) for the linking modes, why both emails
must be verified, and the full migration path for JWT apps.

## Learn More

- [Authentication Architecture](../explanation/authentication.md)
- [@terreno/api Reference](../reference/api.md#better-auth)
- [@terreno/rtk Reference (legacy)](../reference/legacy/rtk.md#better-auth-integration)
- [Better Auth Documentation](https://better-auth.com/)
