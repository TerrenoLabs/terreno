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

## Methods

### adminContribution()?

> `optional` **adminContribution**(): [`AdminContribution`](AdminContribution.md)

Optional admin metadata for AdminApp aggregation.
Called during admin plugin registration to collect models, screens, widgets, and scripts.

#### Returns

[`AdminContribution`](AdminContribution.md)

***

### onServerCreated()?

> `optional` **onServerCreated**(`server`): `void`

Called after the HTTP server is created but before it starts listening.
Use this to attach services that need the raw HTTP server, such as
Socket.io or other WebSocket libraries.

Only called when using `TerrenoApp.start()` (not `build()`).

#### Parameters

##### server

`Server`

The Node.js HTTP server instance

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

[`TerrenoApp`](../classes/TerrenoApp.md)

#### Returns

`void`
