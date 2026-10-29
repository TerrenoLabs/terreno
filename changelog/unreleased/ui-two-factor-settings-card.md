---
category: Added
---

`@terreno/ui` adds `TwoFactorSettingsCard` to the account security cards. Turning on two-factor
authentication walks through four steps: confirm the password (`onStartEnroll(password)` resolves
`{totpURI, backupCodes}`, narrowed from the TOTP branch of Better Auth's `twoFactor.enable()`
data, which is `{method: "otp"}` or `{method: "totp", totpURI, backupCodes}`), scan a QR code drawn with
`react-native-qrcode-svg` or copy the setup key under it, enter a code in `OtpField`
(`onVerify(code)`), then save the backup codes with Copy and Download (a `.txt` file on web) or
Share (native), with Finish gated on "I saved these backup codes". Once on, the card offers new
backup codes (`onRegenerateBackupCodes(password)`, shown with the same gate) and Turn off
(`onDisable(password)`, after a destructive confirm), and warns when `backupCodesRemaining` drops
below 3. Better Auth requires the password unless its two-factor plugin sets `allowPasswordless`,
so `hasPassword={false}` disables the card's actions and asks an OAuth-only user to set a
password first, and
`requirePassword={false}` skips the password steps on a passwordless server. Also exported:
`parseTotpSecret(totpURI)`, `parseTotpDigits(totpURI)` (the code length defaults to it) and the
`TwoFactorEnrollment` type. Step changes move focus to the step on web and are announced on native.
