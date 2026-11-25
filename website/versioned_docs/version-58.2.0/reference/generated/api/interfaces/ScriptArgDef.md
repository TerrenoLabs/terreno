Optional declaration for a single script argument. Declarations are purely
advisory: they drive validation, type coercion, default values, and help text
but a script can still read any argument the caller supplied. This keeps
argument handling flexible — declare the args you care about, ignore the rest.

## Properties

### aliases?

> `optional` **aliases?**: `string`[]

Alternate names accepted on the CLI (e.g. ["l"] enables `-l`).

***

### default?

> `optional` **default?**: [`ScriptArgValue`](../type-aliases/ScriptArgValue.md)

Default applied when the argument is not provided.

***

### description

> **description**: `string`

Human-readable description shown in CLI help and the admin UI.

***

### example?

> `optional` **example?**: `string`

Example value shown in help text.

***

### name

> **name**: `string`

Canonical name (used as `--name` on the CLI and as the key in the args map).

***

### required?

> `optional` **required?**: `boolean`

When true, parsing fails if the argument is missing.

***

### type?

> `optional` **type?**: `"string"` \| `"number"` \| `"boolean"`

Type used for coercion and validation. Defaults to "string".
