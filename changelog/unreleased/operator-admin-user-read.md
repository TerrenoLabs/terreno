---
category: Fixed
---

- The `operator` role can find users in the admin panel and open a user's record, and from there their Security screen, in apps that declare an `adminUser` statement (as the example app does). Seeding gives the operator `adminUser:read` (never `write`), and an operator row seeded earlier gains it once through `appliedGrants`. Before this fix, `/admin/config` left User out for operators and `/admin/User/:id` showed a spinner that never finished.
