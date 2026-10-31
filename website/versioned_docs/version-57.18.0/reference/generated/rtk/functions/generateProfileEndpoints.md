> **generateProfileEndpoints**(`builder`, `path`): `object`

## Parameters

### builder

`EndpointBuilder`\<`BaseQueryFn`\<`unknown`, `unknown`, `unknown`\>, `string`, `string`\>

### path

`string`

## Returns

`object`

### createEmailUser

> **createEmailUser**: `MutationDefinition`\<[`EmailSignupRequest`](../interfaces/EmailSignupRequest.md), `BaseQueryFn`\<`unknown`, `unknown`, `unknown`\>, `string`, [`UserResponse`](../interfaces/UserResponse.md), `string`, `unknown`\>

### emailLogin

> **emailLogin**: `MutationDefinition`\<[`EmailLoginRequest`](../type-aliases/EmailLoginRequest.md), `BaseQueryFn`\<`unknown`, `unknown`, `unknown`\>, `string`, [`UserResponse`](../interfaces/UserResponse.md), `string`, `unknown`\>

### emailSignUp

> **emailSignUp**: `MutationDefinition`\<[`EmailSignupRequest`](../interfaces/EmailSignupRequest.md), `BaseQueryFn`\<`unknown`, `unknown`, `unknown`\>, `string`, [`UserResponse`](../interfaces/UserResponse.md), `string`, `unknown`\>

### googleLogin

> **googleLogin**: `MutationDefinition`\<[`GoogleLoginRequest`](../interfaces/GoogleLoginRequest.md), `BaseQueryFn`\<`unknown`, `unknown`, `unknown`\>, `string`, [`UserResponse`](../interfaces/UserResponse.md), `string`, `unknown`\>

### resetPassword

> **resetPassword**: `MutationDefinition`\<[`ResetPasswordRequest`](../interfaces/ResetPasswordRequest.md), `BaseQueryFn`\<`unknown`, `unknown`, `unknown`\>, `string`, [`UserResponse`](../interfaces/UserResponse.md), `string`, `unknown`\>
