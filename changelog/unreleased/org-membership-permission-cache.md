---
category: Fixed
---

`@terreno/api`: `OrgsApp` now clears a user's cached permissions when their membership is added, changed, or removed through `POST` / `PATCH` / `DELETE /orgs/:id/members`. Before, a newly attached org-admin could be refused the admin page (no `admin:access`) for up to the 30-second permission cache TTL, and a demoted, suspended, or removed org-admin kept it as long.
