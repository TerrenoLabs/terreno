# Auth regression suite

Area: AUTH
Owner: Josh Gachnang
Last full run: never

Walk these cases against example-frontend and example-backend on a deployed environment whose
backend sends real email. Use an inbox you can open, not a seeded `@example.com` address.

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | Password reset email reaches a real inbox | Signed out, with an account whose email is a real inbox you can open: on the login screen tap the forgot-password link, enter that email, tap "Send reset link", open the email, follow its link, enter a new password, tap "Save new password", then sign in with the new password | One reset email arrives within 2 minutes from the configured sender. Its link opens the "Reset password" screen in the app. Sign-in with the new password lands on Todos, and sign-in with the old password shows an error | Web, iOS, Android | manual | e2e-and-regression-testing |
| AUTH-002 | Verification email confirms the account | Signed in as a new account with a real inbox that has not verified its email: open Profile, tap "Resend" on the verify-email banner, open the email, follow its link, tap "Confirm email", then reopen Profile | One verification email arrives within 2 minutes. After confirming, Profile no longer shows the "Verify your email" banner | Web, iOS, Android | manual | e2e-and-regression-testing |
| AUTH-003 | Session survives a force quit on a device | Signed in on a release build on a phone, with at least one todo: force quit the app from the app switcher, wait 10 seconds, then open it again | The app opens on Todos with the same todos and no login screen, because the session is read back from the device's secure storage | iOS, Android | manual | e2e-and-regression-testing |
| AUTH-004 | Logout clears the stored session on a device | Signed in on a release build on a phone: open Profile, tap "Logout", force quit the app, then open it again | The app opens on the login screen, and no data from the previous account shows before sign-in | iOS, Android | manual | e2e-and-regression-testing |
