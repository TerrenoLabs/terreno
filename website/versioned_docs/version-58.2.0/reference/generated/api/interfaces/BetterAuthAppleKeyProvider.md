Sign in with Apple configured with the Sign in with Apple key itself. Terreno signs the
ES256 client-secret JWT when Better Auth is created; it is valid for 180 days, so restart
(redeploy) the server at least that often.

## Properties

### appBundleIdentifier?

> `optional` **appBundleIdentifier?**: `string`

The iOS bundle id, used as the audience of native ID tokens.

***

### clientId

> **clientId**: `string`

The Services ID (web) the sign-in uses.

***

### keyId

> **keyId**: `string`

The key id of the Sign in with Apple key.

***

### privateKey

> **privateKey**: `string`

The `.p8` key contents in PEM (PKCS#8) form. Escaped `\n` sequences, as env vars often carry
them, are turned back into newlines.

***

### teamId

> **teamId**: `string`

The Apple developer team id.
