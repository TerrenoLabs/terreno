TerrenoPlugin that adds a public GET /version-check endpoint for upgrade enforcement.
Compares client build number against admin-configured thresholds per platform.

## Implements

- [`TerrenoPlugin`](../interfaces/TerrenoPlugin.md)

## Constructors

### Constructor

> **new VersionCheckPlugin**(): `VersionCheckPlugin`

#### Returns

`VersionCheckPlugin`

## Methods

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
