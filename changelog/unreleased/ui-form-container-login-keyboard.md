---
category: Added
---

- `@terreno/ui` adds `FormContainer`: a real `<form>` on web (`display: contents`, `noValidate`, page reload always prevented) and a `Box` on native. `ref.requestSubmit()` submits through the form element on web so password managers see a real submit and offer "Save password"; `username` adds a hidden `autocomplete="username"` input for change-password forms. Chrome no longer logs "Password field is not contained in a form" on `LoginScreen`, `SignUpScreen`, `PasswordCard`, the `TwoFactorSettingsCard` password step, `GPTChat`'s API key modal, the admin configuration screen, or the example app's reset-password, profile, and admin password forms.
- `TextField` sends `autoComplete` to native too: React Native's `autoComplete` (Android's autofill hint) and the matching iOS `textContentType` (`username`, `emailAddress`, `password`, `newPassword`, `oneTimeCode`, `none`), so iOS and Android offer saved passwords, strong new passwords, and one-time codes. It also accepts `"one-time-code"`.
- `LoginScreen` and `SignUpScreen` default the email field to `autoComplete="username"`, name each input by its field label, and handle Enter: it moves to the next field and submits from the last one once, only when the submit button is enabled. `PasswordCard` now moves from current to new to confirm on Enter and submits from confirm. `OtpField` gains `onEnter`, and `TwoFactorChallengeScreen` submits a complete code on Enter.
- `PasswordCard` and `TwoFactorSettingsCard` take a `username`, which `useAccountSecurity` fills with the session user's email.
