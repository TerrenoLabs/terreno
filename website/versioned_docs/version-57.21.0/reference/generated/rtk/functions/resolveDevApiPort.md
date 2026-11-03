> **resolveDevApiPort**(`args`): `number`

Resolves the local dev API port. Apps whose backend listens on a non-default
port (for example 3000 or 9000) override it via the `EXPO_PUBLIC_DEV_API_PORT`
env var or `expoConfig.extra.DEV_API_PORT`, mirroring how `EXPO_PUBLIC_API_URL`
and `extra.BASE_URL` are provided. Missing or invalid values fall back to the
default port.

## Parameters

### args

#### envDevApiPort?

`string`

#### expoConstants

[`ExpoConstantsShape`](../interfaces/ExpoConstantsShape.md)

## Returns

`number`
