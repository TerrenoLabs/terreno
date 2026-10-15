Options for the Better Auth session validator.

## Properties

### auth

> **auth**: `Auth`

The instance returned by `createBetterAuth`.

***

### userModel?

> `optional` **userModel?**: [`UserModel`](UserModel.md)

Optional application user model. When provided, the Better Auth user is resolved to
the app user (via `betterAuthId`) so `decodedToken.id`/`admin` match the identity the
REST layer uses. Without it, the Better Auth user id is used and `admin` is false.
