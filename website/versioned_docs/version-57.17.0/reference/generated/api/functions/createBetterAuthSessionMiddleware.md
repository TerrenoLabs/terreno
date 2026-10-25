> **createBetterAuthSessionMiddleware**(`auth`, `userModel?`): (`req`, `_res`, `next`) => `Promise`\<`void`\>

Creates Express middleware that extracts the Better Auth session
and populates req.user with the application User model.

## Parameters

### auth

`Auth`

### userModel?

[`UserModel`](../interfaces/UserModel.md)

## Returns

(`req`, `_res`, `next`) => `Promise`\<`void`\>
