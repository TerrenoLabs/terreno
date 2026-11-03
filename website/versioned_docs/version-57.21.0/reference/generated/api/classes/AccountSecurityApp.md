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

> **new AccountSecurityApp**(`options?`): `AccountSecurityApp`

#### Parameters

##### options?

[`AccountSecurityAppOptions`](../interfaces/AccountSecurityAppOptions.md) = `{}`

#### Returns

`AccountSecurityApp`

## Properties

### authorizePlatform

> `readonly` **authorizePlatform**: [`SecurityAuthorizer`](../type-aliases/SecurityAuthorizer.md)

Platform staff: `user:manageSecurity` under RBAC, otherwise `admin: true`.

## Methods

### getActions()

> **getActions**(): readonly [`SecurityRouteAction`](../interfaces/SecurityRouteAction.md)[]

The recovery actions this plugin mounts, in display order.

#### Returns

readonly [`SecurityRouteAction`](../interfaces/SecurityRouteAction.md)[]

***

### isRegistered()

> **isRegistered**(): `boolean`

Whether `register` has run. A mount elsewhere (OrgsApp) needs a registered instance: only
registration checks for AuditApp and wires access control and the user model.

#### Returns

`boolean`

***

### mountSecurityRoutes()

> **mountSecurityRoutes**(`router`, `authorize`, `__namedParameters?`): `void`

Mounts `GET {pathPrefix}/:userId/security` and every action route on `router`, each guarded
by `authorize`. Pass a prefix's params (such as `/:orgId/members`) as `pathPrefix` so they
reach the authorizer and the OpenAPI spec; a router nested under them instead needs
`Router({mergeParams: true})` and leaves them out of the spec.

#### Parameters

##### router

`Router`

##### authorize

[`SecurityAuthorizer`](../type-aliases/SecurityAuthorizer.md)

##### \_\_namedParameters?

[`MountSecurityRoutesOptions`](../interfaces/MountSecurityRoutesOptions.md) = `{}`

#### Returns

`void`

***

### register()

> **register**(`app`, `openApi?`, `terrenoApp?`): `void`

Register routes and middleware with the Express application.

Called during `TerrenoApp.build()` after core middleware has been
configured but before error handling middleware is added.

#### Parameters

##### app

`Application`

The Express application instance to register with

##### openApi?

`unknown`

##### terrenoApp?

[`TerrenoApp`](TerrenoApp.md)

#### Returns

`void`

#### Implementation of

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md).[`register`](../interfaces/TerrenoPlugin.md#register)

***

### unsubscribeNotifications()

> **unsubscribeNotifications**(): `void`

Stops the security notification emails, when this instance owns them (on shutdown).

#### Returns

`void`
