---
title: Set a user's password
area: admin
audience: admin
platforms: [web, ios, android]
questions:
  - How do I reset a user's password as an admin?
  - A user is locked out. How do I give them a new password?
screens:
  - "example-frontend/app/admin/[model]/[id].tsx"
added: user-guide-backfill
---

# Set a user's password

## What it does

An administrator can give a user a new password directly, without an email.

## How to use it

1. Open the admin panel and choose **Users**.
2. Tap the user's row.
3. Under **Set Password**, enter the **New Password** and the same value in
   **Confirm Password**.
4. Tap **Set Password**. **Password updated** confirms the change.

## Intended use

Use this when a user cannot reset their own password by email. The new password must be at
least eight characters and takes effect immediately. Share it with the user through a
private channel and ask them to change it from their **Profile**. When the user can reach
their email, point them to **Forgot password?** instead.

## Related

- [Browse and edit records in the admin panel](manage-records.md)
