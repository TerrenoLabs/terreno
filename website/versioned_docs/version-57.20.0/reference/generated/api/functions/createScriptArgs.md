> **createScriptArgs**(`__namedParameters`): `object`

Build a [ScriptArgs](../interfaces/ScriptArgs.md) accessor from a raw values map and optional declarations.
Applies declared defaults, coerces declared types, and validates required args.
Returns the accessor plus any validation errors (callers decide how to surface them).

## Parameters

### \_\_namedParameters

#### defs?

[`ScriptArgDef`](../interfaces/ScriptArgDef.md)[] = `[]`

#### positional?

`string`[] = `[]`

#### values

`Record`\<`string`, [`ScriptArgValue`](../type-aliases/ScriptArgValue.md)\>

## Returns

`object`

### args

> **args**: [`ScriptArgs`](../interfaces/ScriptArgs.md)

### errors

> **errors**: `string`[]
