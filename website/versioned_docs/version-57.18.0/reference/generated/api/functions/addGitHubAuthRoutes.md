> **addGitHubAuthRoutes**(`app`, `userModel`, `githubOptions`, `authOptions?`): `void`

Adds GitHub OAuth routes to the Express application.

Routes added:
- GET /auth/github - Initiates GitHub OAuth flow
- GET /auth/github/callback - Handles GitHub OAuth callback
- POST /auth/github/link - Links GitHub account to authenticated user (requires JWT auth)
- DELETE /auth/github/unlink - Unlinks GitHub account from authenticated user (requires JWT auth)

## Parameters

### app

`Application`

### userModel

[`UserModel`](../interfaces/UserModel.md)

### githubOptions

[`GitHubAuthOptions`](../interfaces/GitHubAuthOptions.md)

### authOptions?

[`AuthOptions`](../interfaces/AuthOptions.md)

## Returns

`void`
