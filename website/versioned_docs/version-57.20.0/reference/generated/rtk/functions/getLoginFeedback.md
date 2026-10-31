> **getLoginFeedback**(`__namedParameters`): [`LoginFeedback`](../interfaces/LoginFeedback.md)

Maps a failure to a notice or an error line.

## Parameters

### \_\_namedParameters

#### attemptedMethod?

`string`

Display name of the method that just failed, such as "Google".

#### failure

[`LoginFailure`](../interfaces/LoginFailure.md) \| `undefined`

#### hasAccounts?

`boolean` = `false`

Whether the screen is offering continue-as accounts. Changes the cancelled copy.

#### mode?

[`BetterAuthAccountLinkingMode`](../type-aliases/BetterAuthAccountLinkingMode.md)

#### originalMethod?

`string`

Display name of the method this device used last, such as "GitHub".

#### originalMethodId?

`string`

Id of that method (`"email"`, `"github"`), so the notice action can focus it.

## Returns

[`LoginFeedback`](../interfaces/LoginFeedback.md)

## Example

```typescript
const {notice, error} = getLoginFeedback({
  failure: {code: "account_not_linked", source: "url"},
  mode: methods?.accountLinking.mode,
});
```
