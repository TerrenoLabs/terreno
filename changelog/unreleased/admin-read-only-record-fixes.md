---
category: Fixed
---

`@terreno/admin-frontend`: an admin record no longer stays on its loading spinner when the organization switcher settles on a default organization after the record's request started. `useAdminApi`'s `useListQuery` and `useReadQuery` now carry the organization in the query argument, so the switch fetches the new organization's entry instead of waiting on one that was never requested. A read-only user record's `roles` field also no longer requests `GET /rbac/roles`, which staff without `rbac:read` (such as an operator viewing a user) were refused with 403; it lists the assigned role names instead.
