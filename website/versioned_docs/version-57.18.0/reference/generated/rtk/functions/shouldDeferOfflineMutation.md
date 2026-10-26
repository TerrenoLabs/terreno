> **shouldDeferOfflineMutation**(`endpointName`, `getState`): `boolean`

When true, the base query should return a network error without making a request.
The offline middleware will queue the mutation and apply an optimistic update.

## Parameters

### endpointName

`string`

### getState

() => `unknown`

## Returns

`boolean`
