> **BetterAuthOptionsOverride**\<`T`\> = `T` *extends* (...`args`) => `unknown` ? `T` : `T` *extends* readonly `unknown`[] \| `string` ? `T` : `T` *extends* `object` ? `{ [K in keyof T]?: BetterAuthOptionsOverride<T[K]> }` : `T`

Makes nested option objects optional too, so `options` can set one nested field (such as
`emailAndPassword.requireEmailVerification`) without restating the fields Terreno sets.
Functions, arrays, and strings are kept as they are.

## Type Parameters

### T

`T` = `Omit`\<`BetterAuthOptions`, `"basePath"` \| `"plugins"`\>
