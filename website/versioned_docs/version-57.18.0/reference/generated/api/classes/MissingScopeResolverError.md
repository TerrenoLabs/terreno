Resolve the streams a user currently belongs to for one registered entry — the
authoritative membership set, shared by the socket `sync:subscribe` handler,
`GET /sync/streams`, and the snapshot stream-membership check.

- broadcast → the single `{collection}|all` stream.
- owner → the single stream keyed by the authenticated user's own id (a client-supplied
  id must never select the stream).
- tenant / custom → one stream per value from `getUserScopes`. Requires the resolver;
  throws MissingScopeResolverError when it is absent.

Runs against the FULL user (D2) so tenant memberships resolve from current
`organizationIds`.

## Extends

- `Error`

## Constructors

### Constructor

> **new MissingScopeResolverError**(`collection`): `MissingScopeResolverError`

#### Parameters

##### collection

`string`

#### Returns

`MissingScopeResolverError`

#### Overrides

`Error.constructor`

## Properties

### collection

> **collection**: `string`
