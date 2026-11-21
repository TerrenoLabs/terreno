> **auditActorIdFromRequest**(`req`): `string` \| `undefined`

Coalesce `req.user.id` and `req.user._id` to match Admin REST audit actor ids.

## Parameters

### req

`Request`

## Returns

`string` \| `undefined`
