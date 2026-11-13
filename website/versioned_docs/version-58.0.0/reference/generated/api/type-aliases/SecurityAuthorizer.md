> **SecurityAuthorizer** = (`args`) => `Promise`\<[`SecurityAuthorization`](../interfaces/SecurityAuthorization.md)\>

Decides whether `req.user` may act on `targetUserId`. Throws an `APIError` to refuse: 403 when
the caller lacks the right, 404 when the target is out of their reach.

## Parameters

### args

#### req

`Request`

#### targetUserId

`string`

## Returns

`Promise`\<[`SecurityAuthorization`](../interfaces/SecurityAuthorization.md)\>
