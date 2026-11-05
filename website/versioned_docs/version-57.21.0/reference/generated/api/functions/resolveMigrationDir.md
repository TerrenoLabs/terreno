> **resolveMigrationDir**(`__namedParameters`): `string`

Pick a real on-disk migrations directory.
`bun build --compile` rewrites `import.meta.url` to `$bunfs`, which is not
scandir-able. Prefer an explicit real `dir`, then `MIGRATIONS_DIR`, then
`<cwd>/migrations`.

## Parameters

### \_\_namedParameters

#### cwd?

`string` = `...`

#### dir?

`string`

#### envDir?

`string` = `process.env.MIGRATIONS_DIR`

## Returns

`string`
