---
title: Confirm your email address
area: account
audience: user
platforms: [web, ios, android]
questions:
  - How do I verify my email?
  - How do I resend the verification email?
  - Why does my profile say to verify my email?
screens: [example-frontend/app/verifyEmail.tsx, example-frontend/app/(tabs)/profile.tsx]
added: user-guide-backfill
---

# Confirm your email address

## What it does

Confirming your email address proves the address is yours, so you can recover the account
if you lose your password.

## How to use it

1. Open the verification email and follow its link.
2. On the page that opens, tap **Confirm email**.

To get a new verification email, open the **Profile** tab. Under the banner
**Verify your email to keep this account recoverable.**, tap **Resend**.

## Intended use

Confirm the address once after you sign up, and again after you change your email. The
banner on **Profile** disappears once the address is confirmed. If the page says the link
is missing a token, send a new email from **Profile** and use the newest link.

## Related

- [Update your profile](profile.md)
