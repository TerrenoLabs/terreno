> **onSecurityAction**(`listener`): () => `void`

Subscribes to every recorded security action (for example, to email the affected user).
Returns the unsubscribe function. A throwing listener is logged and never fails the action.

## Parameters

### listener

[`SecurityActionListener`](../type-aliases/SecurityActionListener.md)

## Returns

() => `void`
