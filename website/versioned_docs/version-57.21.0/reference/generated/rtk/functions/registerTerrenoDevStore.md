> **registerTerrenoDevStore**\<`S`\>(`store`): `void`

Exposes the Redux store on `globalThis.__TERRENO_STORE__` in development so
`terreno-mcp-local` can run `get_client_state` against the real app state.

## Type Parameters

### S

`S` *extends* `object`

## Parameters

### store

`Store`\<`S`\>

## Returns

`void`
