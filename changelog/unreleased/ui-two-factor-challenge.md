---
category: Added
---

`@terreno/ui` adds `OtpField` and `TwoFactorChallengeScreen`. `OtpField` is a one-time code input
with a cell per digit: paste or one-time-code autofill fills every cell, backspace steps back a
cell, each cell is labelled "Digit k of N", and `onComplete(code)` fires when the code is full.
`TwoFactorChallengeScreen` is the second sign-in step: an authenticator code that submits itself
once complete, a toggle to a backup code, an optional "Don't ask again on this device for N days"
checkbox (`trustDeviceDays`), an alert error that clears the code, and
`onSubmit({code, kind: "totp" | "backup", trustDevice})`. `TextField` accepts
`accessibilityLabel` to set its input's accessible name.
