---
category: Changed
---

`LoginScreen` matches the login redesign. Method pills sit above the email form. Returning users
see a continue-as list, with other methods behind "Sign in another way". Edit removes a remembered
account from this device; a signed-in session cannot be removed there. A remembered email opens a
password step (`continuingAccount`). A wrong password is `passwordError` on the password field.
`error` is a banner, and one `notice` (info, warning, or error) replaces it. The submit button
reads "Sign in". `TwoFactorChallengeScreen` titles the authenticator step "Enter your code" and
the backup step "Use a backup code", checks "Trust this device" by default for an authenticator
code (`initialTrustDevice={false}` starts it unchecked), and shows the `error` string it was
given. `OAuthButtons` `appearance="pill"` and
`SocialLoginButton` `variant="outline"` render the same neutral pill.
