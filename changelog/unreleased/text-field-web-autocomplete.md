---
category: Fixed
---

- `@terreno/ui`: `TextField` now sets its `autoComplete` prop as the input's `autocomplete`
  attribute on web (it was ignored before). Native rendering is unchanged. The prop also accepts
  `"email"`, `"new-password"`, and `"username webauthn"` (passkey autofill).
- Because the hint now reaches the browser, `autoComplete="off"` takes effect on web and turns
  autofill off for that field. The example app, `create-terreno-app`, and the MCP bootstrap
  templates switch their email fields from `"off"` to `"username"` (login) and `"email"`
  (sign-up).
- `Field type="password"` still defaults to `"current-password"`; pass `autoComplete="new-password"`
  (also through `TapToEdit`) on fields that set a new password. The example admin set-password
  fields now do.
  `SignUpScreen` password fields default to `"new-password"` and `LoginScreen` password fields to
  `"current-password"` unless the field config sets its own.
