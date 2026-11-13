## Properties

### adminId?

> `optional` **adminId?**: `unknown`

The admin making the change; recorded in the audit log line, never with the password.

***

### app?

> `optional` **app?**: `Application`

The Express app (`req.app`) the auth routes were added to.

***

### authOptions?

> `optional` **authOptions?**: [`AuthOptions`](AuthOptions.md)

Auth options to use instead of the ones registered on `app`.
