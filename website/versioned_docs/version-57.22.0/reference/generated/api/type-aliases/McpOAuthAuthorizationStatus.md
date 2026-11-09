> **McpOAuthAuthorizationStatus** = `"pending"` \| `"approved"` \| `"denied"` \| `"used"`

Lifecycle of one authorization request: `pending` until the signed-in user decides, then
`approved` (a code is outstanding) or `denied`, then `used` once the code is exchanged.
