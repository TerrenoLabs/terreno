Interface for plugins that can be registered with TerrenoApp.

Implement this interface to create reusable plugins that encapsulate
routes, middleware, or other Express application setup. Plugins are
registered via `TerrenoApp.register()` and are mounted after core
authentication and OpenAPI middleware.

## Example

```typescript
class MyPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    app.get("/my-route", (req, res) => {
      res.json({ status: "ok" });
    });
  }
}

const app = new TerrenoApp({ userModel: User })
  .register(new MyPlugin())
  .start();
```

## See

 - TerrenoApp for the application builder that consumes plugins
 - HealthApp for a built-in plugin example

## Implements

- [`TerrenoPlugin`](../interfaces/TerrenoPlugin.md)

## Constructors

### Constructor

> **new BetterAuthApp**(`options`): `BetterAuthApp`

#### Parameters

##### options

[`BetterAuthAppOptions`](../interfaces/BetterAuthAppOptions.md)

#### Returns

`BetterAuthApp`

## Methods

### adoptUserModel()

> **adoptUserModel**(`userModel`): `void`

Uses `userModel` (TerrenoApp's) when this plugin was constructed without one. The app User
guard and sync (`terreno-app-user-sync`) are installed when the Better Auth instance is
created, so a user model that arrives after that would leave sign-ups unguarded while the
session middleware still links app Users: that is refused at boot instead.

#### Parameters

##### userModel

[`UserModel`](../interfaces/UserModel.md)

#### Returns

`void`

***

### ensureAuth()

> **ensureAuth**(): `Auth`

#### Returns

`Auth`

***

### getAuth()

> **getAuth**(): `Auth`\<`BetterAuthOptions`\> \| `undefined`

#### Returns

`Auth`\<`BetterAuthOptions`\> \| `undefined`

***

### getBetterAuthBasePath()

> **getBetterAuthBasePath**(): `string`

#### Returns

`string`

***

### getBetterAuthConfig()

> **getBetterAuthConfig**(): [`BetterAuthConfig`](../interfaces/BetterAuthConfig.md)

#### Returns

[`BetterAuthConfig`](../interfaces/BetterAuthConfig.md)

***

### markSessionMiddlewareMounted()

> **markSessionMiddlewareMounted**(): `void`

#### Returns

`void`

***

### register()

> **register**(`app`): `void`

Register routes and middleware with the Express application.

Called during `TerrenoApp.build()` after core middleware has been
configured but before error handling middleware is added.

#### Parameters

##### app

`Application`

The Express application instance to register with

#### Returns

`void`

#### Implementation of

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md).[`register`](../interfaces/TerrenoPlugin.md#register)
