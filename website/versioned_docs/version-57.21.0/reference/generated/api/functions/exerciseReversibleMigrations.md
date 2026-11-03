> **exerciseReversibleMigrations**(`__namedParameters`): `Promise`\<[`ExerciseReversibleMigrationsResult`](../interfaces/ExerciseReversibleMigrationsResult.md)\>

CI helper: apply every file, then roll back in reverse until a file without
`down` stops the chain. The irreversible id is recorded; earlier files stay applied.

## Parameters

### \_\_namedParameters

[`ExerciseReversibleMigrationsOptions`](../interfaces/ExerciseReversibleMigrationsOptions.md)

## Returns

`Promise`\<[`ExerciseReversibleMigrationsResult`](../interfaces/ExerciseReversibleMigrationsResult.md)\>
