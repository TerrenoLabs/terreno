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

> **new ConsentApp**(`options?`): `ConsentApp`

#### Parameters

##### options?

[`ConsentAppOptions`](../interfaces/ConsentAppOptions.md) = `{}`

#### Returns

`ConsentApp`

## Methods

### adminContribution()

> **adminContribution**(): [`AdminContribution`](../interfaces/AdminContribution.md)

Optional admin metadata for AdminApp aggregation.
Called during admin plugin registration to collect models, screens, widgets, and scripts.

#### Returns

[`AdminContribution`](../interfaces/AdminContribution.md)

#### Implementation of

[`TerrenoPlugin`](../interfaces/TerrenoPlugin.md).[`adminContribution`](../interfaces/TerrenoPlugin.md#admincontribution)

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
