Hardening for org-admin recovery (`OrgsAppOptions.orgRecovery`).

## Properties

### minMembershipDays?

> `optional` **minMembershipDays?**: `number`

Refuse (403) acting on a member whose membership in the org is younger than this many days.
Defaults to 0 (off). It defends against an org-admin attaching an existing user by email and
running recovery on them right away.
