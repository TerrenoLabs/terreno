> `const` **suspendMembershipAction**: [`SecurityRouteAction`](../interfaces/SecurityRouteAction.md)

`POST /orgs/:orgId/members/:userId/security/suspend-membership`: suspend the member's active
membership in `:orgId`. Their account, sessions, and other memberships are untouched, so they
still sign in and keep using their other orgs. Suspending the last active org-admin is refused
(400). Restore a suspended member with `PATCH /orgs/:orgId/members/:memberId {status: "active"}`;
a suspended member is out of the recovery routes' reach (404).
