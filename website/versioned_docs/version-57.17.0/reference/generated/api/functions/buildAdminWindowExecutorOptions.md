> **buildAdminWindowExecutorOptions**\<`T`\>(`__namedParameters`): [`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

Admin-window sync mutations use AdminApp router pre/post hooks, not product `modelRouter`
hooks. Product hooks can overwrite stripped or admin-authorized fields (for example by
forcing `ownerId` in `preCreate`).

## Type Parameters

### T

`T`

## Parameters

### \_\_namedParameters

#### productOptions

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>

#### scope

[`AdminWindowMutationScope`](../interfaces/AdminWindowMutationScope.md)

## Returns

[`ModelRouterOptions`](../interfaces/ModelRouterOptions.md)\<`T`\>
