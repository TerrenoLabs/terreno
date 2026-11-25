> **canUseMcpTool**(`__namedParameters`): `boolean`

True when the caller may see and call `tool`.

- Credentials other than an OAuth token, and apps without `grants`, may use every tool.
- A tool that declares `scope` requires exactly that scope on the token.
- A `read` tool needs a granted scope whose grant has `read` or `write` access (write implies
  read); a `write` tool needs a granted scope whose grant has `write` access.
- Token scopes that match no grant (for example the legacy `mcp` scope) allow nothing.

## Parameters

### \_\_namedParameters

[`CanUseMcpToolOptions`](../interfaces/CanUseMcpToolOptions.md)

## Returns

`boolean`
