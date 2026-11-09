> **registerTerrenoDevStore**(`store`): `void`

Exposes the Redux store on `globalThis.__TERRENO_STORE__` in development so
`terreno-mcp-local` can run `get_client_state` against the real app state.

## Parameters

### store

`Store`\<`Record`\<`string`, `unknown`\>\>

## Returns

`void`
