> **resolveBaseUrls**(`args`): [`BaseUrls`](../interfaces/BaseUrls.md)

Pure resolver for the base URLs used throughout the RTK package.
Decoupled from the Expo-constants module so it can be unit tested.

## Parameters

### args

#### devApiPort?

`number`

#### envApiUrl?

`string`

#### expoConstants

[`ExpoConstantsShape`](../interfaces/ExpoConstantsShape.md)

#### isDev

`boolean`

#### windowOrigin?

`string`

## Returns

[`BaseUrls`](../interfaces/BaseUrls.md)
