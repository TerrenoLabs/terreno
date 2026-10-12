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

### 4. Update User Model

`syncBetterAuthUser` creates the app `User` on the first authenticated request after Better Auth sign-up. Declare `betterAuthId` on that schema. Declare `oauthProvider` only if the app uses social OAuth.

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

export const authClient = createBetterAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
});
``````

### 2. Add Session Redux Slice

``````typescript
import {generateBetterAuthSlice} from "@terreno/rtk";
import {configureStore} from "@reduxjs/toolkit";
import {authClient} from "./authClient";

const {sessionReducer, sessionMiddleware} = generateBetterAuthSlice(authClient);

export const store = configureStore({
  reducer: {
    session: sessionReducer,
    // ... other reducers
  },
  middleware: (getDefault) => getDefault().concat(sessionMiddleware),
});
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
- [@terreno/rtk Reference (legacy)](../reference/legacy/rtk.md#better-auth)
- [Better Auth Documentation](https://better-auth.com/)
