> **parseScriptArgs**(`tokens`, `defs?`): `object`

Parse CLI-style tokens into a [ScriptArgs](../interfaces/ScriptArgs.md) accessor. Supports a flexible set
of conventions so callers and scripts do not need to agree on a rigid format:

- `--name=value` and `--name value`
- `--flag` (boolean true) and `--no-flag` (boolean false)
- short aliases `-x` (treated like `--x`)
- repeated flags collapse into a string array
- bare tokens become positional arguments

When [declarations](../interfaces/ScriptArgDef.md) are supplied, values are coerced to the
declared type, defaults are applied, and required args are validated.

## Parameters

### tokens

`string`[]

### defs?

[`ScriptArgDef`](../interfaces/ScriptArgDef.md)[] = `[]`

## Returns

`object`

### args

> **args**: [`ScriptArgs`](../interfaces/ScriptArgs.md)

### errors

> **errors**: `string`[]
