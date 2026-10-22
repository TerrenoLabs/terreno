# Configure Better Auth

Set up Better Auth as the **default** authentication provider for new Terreno apps — session-based auth with built-in social OAuth and first-class `@terreno/syncdb` integration.

## Overview

Better Auth is the recommended authentication system for new Terreno frontends. Register `BetterAuthApp` on the backend, set `AUTH_PROVIDER=better-auth`, and on the client create the client with `createBetterAuthClient` and wrap the app in `SessionProvider`, both from `@terreno/syncdb/auth`. Pass the same client to `betterAuthAdapter` for `createSyncDb` and the API client.

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
the old passport hash.

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
- `plugins` are appended after Terreno's `bearer()` plugin. Their endpoints mount under
  `basePath`, like the built-in ones.

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
| `socialProviders` | `googleOAuth`, `githubOAuth`, `appleOAuth` | The configured social providers (`options` adds to them per provider) |
| `trustedOrigins` | `trustedOrigins` | The origins listed in the config |

Endpoints added by `plugins` are not part of the `auth.api` type. Call them over HTTP, or cast
`auth.api` where you call them on the server.

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
// lib/betterAuth.ts
import {createBetterAuthClient} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";

// `scheme` is the app's deep-link scheme (required).
export const authClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: "yourapp", // app.json "scheme", for OAuth deep links
  storagePrefix: "yourapp",
});
``````

The client stores its session in `expo-secure-store` on native and AsyncStorage on web.
Install them in the app with `bunx expo install expo-secure-store @react-native-async-storage/async-storage`.

### 2. Provide the Session

Wrap the app in `SessionProvider` and read the session with `useSession()`. No Redux store is
needed.

``````tsx
// app/_layout.tsx
import {SessionProvider, useSession} from "@terreno/syncdb/auth";
import {authClient} from "@/lib/betterAuth";
import {syncDb} from "@/store/syncdb";

const RootLayout = (): React.ReactElement => (
  <SessionProvider authClient={authClient} syncDbs={[syncDb]}>
    <RootNavigator />
  </SessionProvider>
);

const RootNavigator = (): React.ReactElement => {
  const {userId, isLoading} = useSession();
  if (isLoading) {
    return <Spinner />;
  }
  return userId ? <AppTabs /> : <LoginScreen />;
};
``````

The provider reads the session on start and follows Better Auth's session signal, so a
sign-in or sign-out updates `useSession()` on its own. `logout()` from `useSession()` signs
out of Better Auth, signs out each `syncDbs` client (create it with `wipeOnSignOut: true` to
wipe local data), runs `onLogout`, and clears the session.

After an email sign-in, call `refresh()` to resolve the user right away:

``````typescript
const {refresh} = useSession();

const result = await authClient.signIn.email({email, password});
if (!result.error) {
  await refresh();
}
``````

For `@terreno/syncdb`, build the auth provider from the same client:

``````typescript
import {betterAuthAdapter, bridgeBetterAuthReactClient} from "@terreno/syncdb/auth";

export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(authClient));
``````

### 3. Add Social Login UI

Use the SocialLoginButton component:

``````typescript
import {SocialLoginButton, Box} from "@terreno/ui";
import {authClient} from "@/lib/betterAuth";

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

## Frontend and API on different sites

By default the web client relies on Better Auth's HttpOnly session cookie. When the web app
and the API are on different sites (for example `app.example.com` and `api.example.net`, or
two hosting providers' domains), that cookie is a third-party cookie, and browsers such as
Safari block it. The user signs in and is signed out on the next request.

Use bearer mode in that case. Keep cookie mode when the frontend and API share a site.

``````typescript
import {createBetterAuthClient} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";

export const authClient = createBetterAuthClient({
  baseURL: baseUrl,
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
`getBetterAuthBearerToken({storagePrefix?, bearerStorage?})` from `@terreno/syncdb/auth`. Pass
the same options the client was created with. Pass it to `betterAuthAdapter` as
`getBearerToken` so the shared `authProvider` reads the token locally instead of calling
`get-session` on every request:

``````typescript
import {betterAuthAdapter, bridgeBetterAuthReactClient, getBetterAuthBearerToken} from "@terreno/syncdb/auth";

export const authProvider = betterAuthAdapter(bridgeBetterAuthReactClient(authClient), {
  getBearerToken: () => getBetterAuthBearerToken({storagePrefix: "yourapp"}),
});
``````

example-frontend shows the whole setup. `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true` turns on
bearer mode in `lib/betterAuth.ts`. `store/syncdb.ts` passes the stored token to
`betterAuthAdapter` as `getBearerToken`, and that one `authProvider` feeds syncdb (and its
socket), the request client, and MCP tools, so they all send the same token. `e2e/crossSiteBearer.spec.ts` signs in from `localhost:8082` to an API on
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
fragment, and the web app exchanges it for the bearer. syncdb binds each exchange to a random
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
   import {signInSocialWithHandoff} from "@terreno/syncdb/auth";

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
   import {completeBetterAuthOAuthHandoff} from "@terreno/syncdb/auth";

   const stored = await completeBetterAuthOAuthHandoff({client: authClient});
   if (stored) {
     await refresh(); // useSession().refresh(): SessionProvider read the session before the exchange
   }
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
   codes. The function resolves `false` and leaves `error` in the URL. On better-auth 1.6 (the
   version Terreno 58 pins), a generic OAuth provider's own error (such as `access_denied`)
   goes to the API's `{basePath}/error` page instead of `errorCallbackURL`.
   No token is issued either way.

The return page must not redirect, on the server or in the browser, before the function has
run. A browser carries the fragment through a redirect that has none of its own, so a redirect
would hand the token to the next page. For the same reason, keep `callbackPaths` to that page.

example-frontend uses `/login` as the return page. With `BETTER_AUTH_OAUTH_HANDOFF=true`,
example-backend sets `oauthHandoff` to its web origins and `callbackPaths: ["/login"]`. With
`NODE_ENV=production` it drops loopback origins (`localhost`, `127.0.0.1`, `[::1]`, any port) from
the handoff only, so a token never goes to a page on the visitor's own machine, and it refuses to
start when no other origin is left in `CORS_ORIGINS`. CORS and `trustedOrigins` keep them. In bearer mode `lib/betterAuth.ts` starts the social buttons with
`signInSocialWithHandoff`. `app/_layout.tsx` refreshes the session once the exchange stores a
bearer.

In an Expo Router app, run the exchange from the entry file, not from a layout. Expo Router
copies the URL, fragment included, as soon as it is imported, and writes that copy back into
the address bar when it routes, which would put `ott` and `handoff` back. Importing
`@terreno/ui` imports Expo Router too. example-frontend's `index.js`
first imports `lib/oauthHandoffUrl.ts`, which has no imports and hides `handoff` and `ott` from
the URL, then `lib/oauthHandoff.ts`, which puts the URL back and calls
`completeBetterAuthOAuthHandoff` in the same synchronous step, then `expo-router/entry`.

The login screen shows `?error=` in `login-screen-error`. `e2e/crossSiteOAuth.spec.ts` signs in
cross-site through a local mock OIDC provider (`e2e/helpers/mockOidcProvider.ts`), which
example-backend registers as the `mock-oidc` generic OAuth provider only when `MOCK_OIDC_ISSUER`
is set. example-backend refuses to start when `MOCK_OIDC_ISSUER` is set with
`NODE_ENV=production` or names a host other than `127.0.0.1`, `localhost` or `[::1]`.

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
  baseURL: baseUrl,
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
5. Generate private key and download
6. Copy Service ID and Key to `.env`

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

On native, if every request fails before it is sent after an app update, the stored cookie jar
may hold an entry the Expo plugin cannot read. `createBetterAuthClient` drops such entries on
read and logs `Discarded … unreadable Better Auth cookie entry`; sign in again to restore the
session.

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
5. Optionally add migration logic to link accounts

## Learn More

- [Authentication Architecture](../explanation/authentication.md)
- [@terreno/api Reference](../reference/api.md#better-auth)
- [@terreno/syncdb Reference: Auth](../reference/syncdb.md#auth)
- [Upgrade from @terreno/rtk to @terreno/syncdb](migrate-rtk-to-syncdb.md)
- [Better Auth Documentation](https://better-auth.com/)
