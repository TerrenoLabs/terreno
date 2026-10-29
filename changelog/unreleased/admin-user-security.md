---
category: Added
---

- `UserSecurityScreen` in `@terreno/admin-frontend` is the platform staff page for one user's sign-in security: a header with the user's name and email from their admin record, then `MemberSecurityPanel` against `/users/:id/security`, so operators and superadmins can sign a user out everywhere, send a password reset, disable or enable the account, and run every other recovery action the server lists.
- `UserSecurityLink` and `userSecurityRoute` add a **Security** button to an admin user record (for example in `AdminModelForm` `footerContent`) that opens `{routeBase}/users/:id/security`.
- The example app mounts the screen at `/admin/users/[id]/security` and links it from the admin `User` record, both only for staff holding `user:manageSecurity`; the link is hidden on the viewer's own record.
