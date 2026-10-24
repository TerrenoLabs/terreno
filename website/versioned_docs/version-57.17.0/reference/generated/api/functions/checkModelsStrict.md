> **checkModelsStrict**(`ignoredModels?`): `void`

Ensure that all mongoose models are set to strict mode.
This validates that models will throw errors when attempting to set
properties that aren't defined in the schema.

## Parameters

### ignoredModels?

`string`[] = `[]`

Array of model names to skip validation for

## Returns

`void`

## Throws

Error if any model is not set to strict mode or missing virtual settings
