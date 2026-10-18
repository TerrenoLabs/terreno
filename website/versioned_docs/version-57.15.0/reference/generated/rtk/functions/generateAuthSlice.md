> **generateAuthSlice**(`api`): `object`

## Parameters

### api

`any`

## Returns

`object`

### authReducer

> **authReducer**: `Reducer`\<`AuthState`\> = `authSlice.reducer`

### authSlice

> **authSlice**: `Slice`\<`AuthState`, \{ `logout`: (`state`) => `void`; `setUserId`: (`state`, `__namedParameters`) => `void`; `tokenRefreshedSuccess`: (`state`) => `void`; \}, `"auth"`, `"auth"`, `SliceSelectors`\<`AuthState`\>\>

### logout

> **logout**: `ActionCreatorWithoutPayload`\<`"auth/logout"`\> = `authSlice.actions.logout`

### middleware

> **middleware**: `ListenerMiddleware`\<`unknown`, `ThunkDispatch`\<`unknown`, `unknown`, `UnknownAction`\>, `unknown`\>[]

### setUserId

> **setUserId**: `ActionCreatorWithPayload`\<\{ `userId`: `string`; \}, `"auth/setUserId"`\> = `authSlice.actions.setUserId`

### tokenRefreshedSuccess

> **tokenRefreshedSuccess**: `ActionCreatorWithoutPayload`\<`"auth/tokenRefreshedSuccess"`\> = `authSlice.actions.tokenRefreshedSuccess`
