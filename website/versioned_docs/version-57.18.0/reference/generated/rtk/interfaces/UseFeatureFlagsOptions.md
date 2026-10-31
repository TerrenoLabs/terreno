Creates feature flag accessors from an RTK Query API instance.

Injects a `GET {basePath}/flagConfiguration` endpoint into the API and returns
accessors for reading flag values. Fetches once on mount and caches via
RTK Query. Both `api` and `basePath` should be stable references.

## Example

```typescript
const { getFlag, getVariant } = useFeatureFlags(terrenoApi);

const showNewCheckout = getFlag("new-checkout-flow");       // true | false
const variant = getVariant("checkout-experiment");           // "control" | "variant-a" | null
```

## Properties

### basePath?

> `optional` **basePath?**: `string`

***

### domain?

> `optional` **domain?**: `string`

***

### skip?

> `optional` **skip?**: `boolean`

***

### socket?

> `optional` **socket?**: \{ `off`: (`event`, `handler`) => `void`; `on`: (`event`, `handler`) => `void`; \} \| `null`

***

### socketEventName?

> `optional` **socketEventName?**: `string`

***

### userId?

> `optional` **userId?**: `string` \| `null`
