One stream's page request inside `POST /sync/snapshot/batch`.

## Properties

### cursor?

> `optional` **cursor?**: `number`

Resume cursor (highest seq already applied); 0 = from the beginning.

***

### legacyCursor?

> `optional` **legacyCursor?**: `string`

C3: legacy-stratum token echoed back from this stream's previous page.

***

### stream

> **stream**: `string`
