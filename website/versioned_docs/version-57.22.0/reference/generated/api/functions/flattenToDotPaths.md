> **flattenToDotPaths**(`obj`, `prefix?`): \[`string`, `unknown`\][]

Flattens a nested patch into MongoDB-style dotted paths, recursing into plain
objects only; arrays and other values are treated as leaves.

## Parameters

### obj

`Record`\<`string`, `unknown`\>

### prefix?

`string` = `""`

## Returns

\[`string`, `unknown`\][]

## Example

```ts
flattenToDotPaths({a: {b: 1}}) // => [["a.b", 1]]
```
