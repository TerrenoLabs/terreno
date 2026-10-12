> **PathValue**\<`T`, `P`\> = `P` *extends* `` `${infer K}.${infer Rest}` `` ? `K` *extends* keyof `T` ? `PathValue`\<`NonNullable`\<`T`\[`K`\]\>, `Rest`\> : `never` : `P` *extends* keyof `T` ? `T`\[`P`\] : `never`

The value type at a dot-notation path P within type T.

## Type Parameters

### T

`T`

### P

`P` *extends* `string`

## Example

```ts
PathValue<{a: {b: string}}, "a.b"> = string
```
