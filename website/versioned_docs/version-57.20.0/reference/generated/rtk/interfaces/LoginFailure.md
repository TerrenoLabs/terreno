A refused sign-in, from a response's error or from the `?error=` of an OAuth return.

## Properties

### code?

> `optional` **code?**: `string`

Server error code, such as `account_not_linked` or `VERIFY_EMAIL_TO_USE_ACCOUNT`.

***

### message?

> `optional` **message?**: `string`

Server message. Shown only for `source: "response"`.

***

### method?

> `optional` **method?**: `string`

The sign-in method that failed: a provider id, `"email"`, or `"passkey"`.

***

### source

> **source**: `"response"` \| `"url"`

Where the failure came from. URL text is never displayed.
