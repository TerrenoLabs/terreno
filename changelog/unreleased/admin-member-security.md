---
category: Added
---

- `MemberSecurityPanel` in `@terreno/admin-frontend` shows a user's sign-in security (providers, password, passkeys, two-factor, sessions, last sign-in, disabled and email-verified state) and runs the recovery actions the server lists. Actions render from the summary's `actions`, so new server actions get a button without a frontend change; destructive ones confirm first, results and server error titles show inline, and a returned sign-in link is shown once with a copy button. It calls `/orgs/:orgId/members/:userId/security` or, without `orgId`, `/users/:id/security` through the host-bound `adminRequest`.
- `OrgMembersScreen` rows get a **Security** button that opens the panel for active members, and a **Reactivate** button for suspended memberships.
- `useMemberSecurityApi`, `memberSecurityPath`, and `resolveSecurityActionRequest` are exported for custom security screens.
- Each entry of the account security summary's `actions` now carries its route: `method` (`POST` or `DELETE`) and `path` relative to the user's security base, with `:param` placeholders such as `/passkeys/:passkeyId`. Clients can run any listed action, including custom ones, from the summary alone.
