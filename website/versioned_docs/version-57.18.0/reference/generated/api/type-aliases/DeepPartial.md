> **DeepPartial**\<`T`\> = `{ [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }`

Deeply partial version of T, for use in updateConfig.

## Type Parameters

### T

`T`
