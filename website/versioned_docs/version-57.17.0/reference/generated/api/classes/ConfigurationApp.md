TerrenoPlugin that provides configuration management endpoints.

Inspects the Mongoose configuration model to auto-generate:
- `GET {basePath}/meta` — Schema metadata (sections, fields, types, descriptions)
- `GET {basePath}` — Current configuration values (secret values redacted)
- `PATCH {basePath}` — Update configuration values (secret fields stripped; never written)
- `POST {basePath}/list-secrets` (alias `POST {basePath}/validate-secrets`) —
  Read-only status of each secret field (whether the provider can resolve it).
  This endpoint never resolves values into the document and returns no secret values.

By default all endpoints require `Permissions.IsAdmin`. Supply `permissions`
to gate routes with a consumer's own permission functions, and `preUpdate`/
`postUpdate` hooks to validate and audit-log changes. This makes
`ConfigurationApp` suitable as a single, consumer-owned configuration surface
that can replace a bespoke config router.

Secret values never touch the database, logs, audit payloads, or API
responses: secret fields are stripped from incoming updates and redacted on
every read.

Nested subschemas in the model become separate sections in the metadata,
making them renderable as cards/accordions in the admin UI.

## Example

```typescript
import {ConfigurationApp, configurationPlugin} from "@terreno/api";

const configSchema = new Schema({
  general: { type: new Schema({
    appName: { type: String, description: "App display name", default: "My App" },
    maintenanceMode: { type: Boolean, description: "Enable maintenance mode", default: false },
  })},
  integrations: { type: new Schema({
    openAiKey: { type: String, description: "OpenAI API key", secret: true, secretName: "openai-key" },
  })},
});
configSchema.plugin(configurationPlugin);
const AppConfig = mongoose.model("AppConfig", configSchema);

new TerrenoApp({ userModel: User })
  .configure(AppConfig, {
    permissions: {read: [IsStaff], update: [IsSuperUser]},
    postUpdate: (config, prevValue, req) => auditLog(req.user, prevValue, config),
  })
  .start();
```

## Implements

- [`TerrenoPlugin`](../interfaces/TerrenoPlugin.md)

## Constructors

### Constructor

> **new ConfigurationApp**(`options`): `ConfigurationApp`

#### Parameters

##### options

[`ConfigurationAppOptions`](../interfaces/ConfigurationAppOptions.md)

#### Returns

`ConfigurationApp`

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
