> **Paths**\<`T`\> = \{ \[K in keyof T & string\]: T\[K\] extends object ? K \| \`$\{K\}.$\{Paths\<T\[K\]\>\}\` : K \}\[keyof `T` & `string`\]

All dot-notation paths for a type T.

## Type Parameters

### T

`T` *extends* `object`

## Example

```ts
Paths<{a: {b: string}; c: number}> = "a" | "a.b" | "c"
```
