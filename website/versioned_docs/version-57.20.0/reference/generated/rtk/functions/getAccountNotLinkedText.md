> **getAccountNotLinkedText**(`__namedParameters`): `string`

Guidance for `account_not_linked`, worded for the server's linking mode. `originalMethod` names
the method this device used last ("Google", "email"), when known. `attemptedMethod` names the
method that was just refused.

## Parameters

### \_\_namedParameters

#### attemptedMethod?

`string`

#### mode?

[`BetterAuthAccountLinkingMode`](../type-aliases/BetterAuthAccountLinkingMode.md)

#### originalMethod?

`string`

## Returns

`string`
