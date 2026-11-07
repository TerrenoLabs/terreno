> **scrubAdminFields**(`value`, `params`): `unknown`

Removes `excludeFields` and `hiddenFields` from a document (or nested value).
Populated refs are scrubbed using the referenced model's admin config when present
in `allModelAdmins` (keyed by Mongoose model name).

## Parameters

### value

`unknown`

### params

`ScrubAdminFieldsParams`

## Returns

`unknown`
