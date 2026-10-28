---
category: Changed
---

`useLoginController` maps a cancelled sign-in (`AUTH_CANCELLED`, or a message of "auth cancelled"
/ "authentication cancelled") to an info notice. A wrong email or password
(`INVALID_EMAIL_OR_PASSWORD`, `INVALID_PASSWORD`, `INVALID_EMAIL`, or those messages on a response)
is `passwordError` on the login screen instead of the error banner. Continuing a remembered email
account that has a usable address sets `continuingAccount` and opens the password step.
Canceling that step, or canceling two-factor, clears `continuingAccount` and sets the form
password back to empty so the next account does not keep the previous password.
`account_not_linked` notices name the original method and, when that method is known, offer
"Sign in with {method}". The two-factor failure message tells the user to enter the code their
app shows now. `TerrenoLoginScreen` passes the email that started the challenge as
`accountLabel`.
