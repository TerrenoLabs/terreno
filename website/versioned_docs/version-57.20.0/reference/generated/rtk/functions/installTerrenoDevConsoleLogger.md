> **installTerrenoDevConsoleLogger**(`args?`): `void`

Batches dev console errors to the backend's `POST /__terreno/browser-logs` route,
defaulting the target to this package's resolved `baseUrl`.

## Parameters

### args?

#### baseUrl?

`string`

## Returns

`void`

## Deprecated

Moved to `@terreno/syncdb`. Use
`import {installTerrenoDevConsoleLogger} from "@terreno/syncdb"` and call it with
`{baseUrl}`. This re-export stays for the `@terreno/rtk` deprecation window only.
