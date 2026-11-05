---
title: Reset your password
area: account
audience: user
platforms: [web, ios, android]
questions:
  - I forgot my password. How do I reset it?
  - How do I get a password reset email?
  - My reset link says it is missing a token. What do I do?
screens: [example-frontend/app/forgotPassword.tsx, example-frontend/app/resetPassword.tsx]
added: user-guide-backfill
---

# Reset your password

## What it does

If you forget your password, the app emails you a link to choose a new one.

## How to use it

1. On **Welcome Back**, tap **Forgot password?**.
2. On **Forgot password**, enter your **Email** and tap **Send reset link**.
3. When **Check your email** appears, open the reset email and follow its link.
4. On **Reset password**, enter a **New password** of at least six characters and tap
   **Save new password**.
5. When **Password updated** appears, tap **Back to login** and sign in with the new
   password.

## Intended use

Use this when you cannot sign in because you forgot your password. The app shows the same
**Check your email** message whether or not an account uses that address, so it never
reveals who has an account. If the email does not arrive, check your spam folder. If the
reset page says the link is missing a token, request a new email from **Forgot password**.

To change a password you still know, use **New Password** on the **Profile** tab instead;
see [Update your profile](profile.md).

## Related

- [Sign in](sign-in.md)
