Registration object returned by modelRouter when called with a path.

Used with `TerrenoApp.register()` to mount model routers at specific paths.
Contains the Express router and the path it should be mounted at.

## See

 - modelRouter for creating registrations
 - TerrenoApp for registering routers

## Properties

### \_\_type

> **\_\_type**: `"modelRouter"`

Internal type discriminator for registration detection

***

### model

> **model**: `ModelLike`\<`any`\>

The Mongoose model this router serves

***

### options

> **options**: [`ModelRouterOptions`](ModelRouterOptions.md)\<`any`\>

Options passed to modelRouter (includes optional admin config)

***

### path

> **path**: `string`

The path where the router should be mounted (e.g., "/todos")

***

### router

> **router**: `Router`

The Express router containing CRUD endpoints
