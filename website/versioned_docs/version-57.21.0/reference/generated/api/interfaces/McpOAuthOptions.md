## Properties

### accessTokenTtlSeconds?

> `optional` **accessTokenTtlSeconds?**: `number`

Access token lifetime. Default: 3600 (one hour).

***

### allowedRedirectHosts?

> `optional` **allowedRedirectHosts?**: `string`[]

Hostnames a registering client may put redirect URIs on, for example
`["claude.ai", "chatgpt.com"]`. Required with `dynamicClientRegistration`, unused without it.
`*.example.com` matches any subdomain. Add `localhost` to allow loopback `http://` redirects
for local clients.

***

### authorizationCodeTtlSeconds?

> `optional` **authorizationCodeTtlSeconds?**: `number`

How long an issued authorization code can be exchanged. Default: 60.

***

### authorizationRequestTtlSeconds?

> `optional` **authorizationRequestTtlSeconds?**: `number`

How long a pending authorization request waits for a consent decision. Default: 600.

***

### consentUrl

> **consentUrl**: `string`

App page that hosts the consent screen. `/oauth/authorize` redirects the browser here with
`?request=<id>` added. The page reads the request with `GET /oauth/authorize/:request` and
posts the user's decision to `/oauth/authorize/:request/approve` or `/deny`.

***

### dynamicClientRegistration?

> `optional` **dynamicClientRegistration?**: `boolean`

Mount RFC 7591 dynamic client registration at `POST /oauth/register` and advertise it in the
metadata. Default: false. The endpoint is unauthenticated, so anyone who can reach the API
can create a client; the consent screen is then the only gate. While off, only clients you
create as `McpOAuthClient` documents can run the flow, and `/oauth/register` returns 404.

***

### enabled

> **enabled**: `boolean`

Turns the authorization server on. Every other field is ignored while false.

***

### issuer

> **issuer**: `string`

Public origin of this API, for example `https://api.example.com`. It is the RFC 8414
`issuer`, and every endpoint URL in the metadata is built from it. It must be an origin with
no path, because the well-known documents are served from the root of this app.

***

### refreshTokenTtlSeconds?

> `optional` **refreshTokenTtlSeconds?**: `number`

Refresh token lifetime. Default: 30 days.

***

### resource?

> `optional` **resource?**: `string`

RFC 8707 resource identifier for `/mcp`. Default: `${issuer}/mcp`.

***

### scopesSupported?

> `optional` **scopesSupported?**: `string`[]

Scopes advertised and accepted. Default: `["mcp"]`.
