Who is acting, and for org-admin routes, the org they act for.

## Properties

### actor

> **actor**: [`User`](User.md)

***

### org?

> `optional` **org?**: [`SecurityActionOrg`](SecurityActionOrg.md)

***

### orgScope?

> `optional` **orgScope?**: [`SecurityOrgScope`](SecurityOrgScope.md)

Org routes: the organization and each user's own membership in it. The D9 reach check then
resolves the actor under `actorMembership` and the target under `targetMembership`, so both
are judged with their org-scoped grants. Without it (platform routes) both are resolved
outside any org context.
