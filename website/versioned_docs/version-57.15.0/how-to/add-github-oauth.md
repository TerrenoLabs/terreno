# Add GitHub OAuth Authentication

Add GitHub OAuth login to your @terreno/api backend. Users can authenticate with their GitHub account, and optionally link GitHub to existing password-based accounts.

## Prerequisites

- Existing @terreno/api backend with `setupServer()` configured
- User model with authentication set up
- GitHub OAuth application (see [Creating a GitHub OAuth App](#creating-a-github-oauth-app))

## Step 1: Install Dependencies

GitHub OAuth support uses `passport-github2`, which is already included as a dependency in @terreno/api.

## Step 2: Add GitHub Fields to User Model

Apply the `githubUserPlugin` to your user schema to add GitHub authentication fields:

``````typescript
import {githubUserPlugin} from "@terreno/api";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: {
    description: "User's email address",
    type: String,
    unique: true,
    required: true,
  },
  name: {
    description: "User's display name",
    type: String,
  },
  admin: {
    description: "Whether the user has admin privileges",
    type: Boolean,
    default: false,
  },
});

// Add GitHub authentication fields
userSchema.plugin(githubUserPlugin);

export const User = mongoose.model("User", userSchema);
``````

The plugin adds these fields:
- `githubId` — GitHub user ID (unique, indexed)
- `githubUsername` — GitHub username
- `githubProfileUrl` — GitHub profile URL
- `githubAvatarUrl` — GitHub avatar image URL

## Step 3: Configure GitHub OAuth

Add GitHub authentication configuration to your `setupServer()` call:

``````typescript
import {setupServer} from "@terreno/api";
import {User} from "./models/user";

setupServer({
  userModel: User,
  addRoutes: (router, options) => {
    // Your route setup
  },
  githubAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL || "http://localhost:4000/auth/github/callback",
    scope: ["user:email"], // Optional, defaults to ["user:email"]
    allowAccountLinking: true, // Optional, defaults to true
  },
});
``````

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `clientId` | string | Yes | GitHub OAuth Client ID |
| `clientSecret` | string | Yes | GitHub OAuth Client Secret |
| `callbackURL` | string | Yes | OAuth callback URL (must match GitHub app settings) |
| `scope` | string[] | No | OAuth scopes (default: `["user:email"]`) |
| `allowAccountLinking` | boolean | No | Allow linking GitHub to existing accounts (default: `true`) |
| `findOrCreateUser` | function | No | Custom user creation/lookup handler |

## Step 4: Set Environment Variables

Add these to your `.env` file:

``````bash
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:4000/auth/github/callback
``````

**Important:** Never commit secrets to version control. Use different values for development, staging, and production.

## Step 5: Test the Integration

The following routes are automatically added when `githubAuth` is configured:

### Login with GitHub

``````http
GET /auth/github
``````

Redirects users to GitHub for authentication. Optional query parameter:
- `returnTo` — URL to redirect after successful authentication (tokens will be appended as query params)

### OAuth Callback

``````http
GET /auth/github/callback
``````

Handles the GitHub OAuth callback. Returns JSON with tokens:

``````json
{
  "data": {
    "token": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "userId": "507f1f77bcf86cd799439011"
  }
}
``````

### Link GitHub Account (Requires Auth)

``````http
GET /auth/github/link
Authorization: Bearer <jwt-token>
``````

Links GitHub to the authenticated user's existing account. Redirects to GitHub, then back to callback.

### Unlink GitHub Account (Requires Auth)

``````http
DELETE /auth/github/unlink
Authorization: Bearer <jwt-token>
``````

Removes GitHub authentication from the user's account. Returns:

``````json
{
  "data": {
    "message": "GitHub account unlinked successfully"
  }
}
``````

**Note:** Users must have a password set before unlinking GitHub.

## Authentication Flow

### New User Registration

1. User clicks "Sign in with GitHub"
2. Frontend redirects to `GET /auth/github?returnTo=<frontend-url>`
3. User authorizes on GitHub
4. Backend receives callback, creates new user with GitHub profile data
5. Backend generates JWT tokens
6. Backend redirects to `returnTo` URL with tokens in query params
7. Frontend stores tokens and logs user in

### Existing User Login

If a user with the same GitHub ID already exists, they are logged in automatically.

### Account Linking

1. User logs in with email/password
2. User clicks "Link GitHub Account"
3. Frontend makes authenticated request to `GET /auth/github/link`
4. User authorizes on GitHub
5. Backend links GitHub ID to existing user account
6. User can now log in with either method

## Custom User Creation

For advanced use cases, provide a custom `findOrCreateUser` function:

``````typescript
setupServer({
  githubAuth: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL!,
    findOrCreateUser: async (profile, accessToken, refreshToken, existingUser) => {
      // Custom logic for finding or creating users
      // - profile: GitHub profile data
      // - accessToken: GitHub access token
      // - refreshToken: GitHub refresh token (if available)
      // - existingUser: If user is authenticated, their user document
      
      if (existingUser) {
        // Link GitHub to existing user
        existingUser.githubId = profile.id;
        existingUser.githubUsername = profile.username;
        await existingUser.save();
        return existingUser;
      }
      
      // Find or create user based on GitHub ID or email
      let user = await User.findOne({githubId: profile.id});
      if (!user && profile.emails?.[0]?.value) {
        user = await User.findOne({email: profile.emails[0].value});
      }
      
      if (!user) {
        user = await User.create({
          githubId: profile.id,
          githubUsername: profile.username,
          email: profile.emails?.[0]?.value,
          name: profile.displayName,
        });
      }
      
      return user;
    },
  },
});
``````

## Frontend Integration

### React Native / Expo

Use `expo-auth-session` for OAuth flow:

``````typescript
import * as AuthSession from "expo-auth-session";

const redirectUri = AuthSession.makeRedirectUri();

const handleGitHubLogin = async () => {
  const result = await AuthSession.startAsync({
    authUrl: `https://api.yourapp.com/auth/github?returnTo=${redirectUri}`,
  });
  
  if (result.type === "success") {
    const {token, refreshToken, userId} = result.params;
    // Store tokens and log in user
  }
};
``````

### Web

Simple redirect flow:

``````typescript
const handleGitHubLogin = () => {
  window.location.href = `https://api.yourapp.com/auth/github?returnTo=${window.location.origin}/auth/callback`;
};

// On callback page (/auth/callback)
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get("token");
const refreshToken = urlParams.get("refreshToken");
const userId = urlParams.get("userId");
// Store tokens and redirect to app
``````

## Creating a GitHub OAuth App

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: Your App Name
   - **Homepage URL**: `http://localhost:4000` (dev) or your production URL
   - **Authorization callback URL**: `http://localhost:4000/auth/github/callback`
4. Click "Register application"
5. Copy the Client ID
6. Generate a new Client Secret and copy it
7. Add both to your `.env` file

**Production:** Create a separate OAuth app for production with your production callback URL.

## Security Considerations

- **Never expose client secrets** — They should only exist on the backend
- **Use HTTPS in production** — GitHub OAuth requires HTTPS for production callbacks
- **Validate redirect URLs** — Only allow trusted domains in `returnTo` parameters
- **Scope minimization** — Only request GitHub scopes your app actually needs
- **Token storage** — Store tokens securely on the frontend (SecureStore on mobile, httpOnly cookies on web)

## Troubleshooting

### "GitHub authentication failed"

- Verify `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are correct
- Check that callback URL in GitHub app settings matches `GITHUB_CALLBACK_URL`
- Ensure user grants all requested permissions

### "This GitHub account is already linked to another user"

A different user has already linked this GitHub account. Users must unlink it first or use a different GitHub account.

### "Account linking is disabled"

Set `allowAccountLinking: true` in `githubAuth` configuration.

### Tokens not included in callback

If using `returnTo`, tokens are appended as query parameters. Check that your frontend is reading them correctly.

## Learn More

- [Authentication architecture](../explanation/authentication.md)
- [API reference](../reference/api.md)
- [GitHub OAuth documentation](https://docs.github.com/en/developers/apps/building-oauth-apps)
