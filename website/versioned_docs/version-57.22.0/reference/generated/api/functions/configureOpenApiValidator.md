> **configureOpenApiValidator**(`config?`): `void`

Configure the global OpenAPI validator settings.
Calling this function activates validation — middleware that was previously
installed as a no-op will begin validating requests.

## Parameters

### config?

`Partial`\<[`OpenApiValidatorConfig`](../interfaces/OpenApiValidatorConfig.md)\> = `{}`

Configuration options to merge with existing config

## Returns

`void`

## Example

```typescript
configureOpenApiValidator({
  removeAdditional: true,
  onAdditionalPropertiesRemoved: (props, req) => {
    Sentry.captureMessage(`Stripped: ${props.join(", ")} on ${req.method} ${req.path}`);
  },
});
```
