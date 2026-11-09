> **AnyTerrenoAccess** = [`TerrenoAccess`](../interfaces/TerrenoAccess.md)\<[`Statements`](Statements.md)\>

Non-generic TerrenoAccess for runtime wiring (modelRouter, rbacRouter, TerrenoApp).
`queryFilter` / `fieldMask` take `resource: string` so a concrete
`TerrenoAccess<AppStatements>` remains assignable (function parameters are
contravariant; a keyof-S union would not accept `string`).
