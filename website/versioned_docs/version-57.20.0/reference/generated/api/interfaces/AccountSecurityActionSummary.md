## Properties

### destructive

> **destructive**: `boolean`

***

### id

> **id**: `string`

***

### label

> **label**: `string`

***

### method

> **method**: `"DELETE"` \| `"POST"`

HTTP method of the action's route, such as `POST` or `DELETE`.

***

### path

> **path**: `string`

Route path relative to the user's security base (`.../:userId/security`), with `:param`
placeholders for values the caller fills from the summary, such as `/passkeys/:passkeyId`.
