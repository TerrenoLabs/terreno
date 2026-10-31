What a handler returns. A `changed: false` result (nothing to do) answers 200 and is not
recorded; `data` is merged into the response body.

## Properties

### audit?

> `optional` **audit?**: `Record`\<`string`, `unknown`\>

Extra fields for the AuditEvent `after` (such as which passkey was removed). No secrets.

***

### changed

> **changed**: `boolean`

***

### data?

> `optional` **data?**: `Record`\<`string`, `unknown`\>
