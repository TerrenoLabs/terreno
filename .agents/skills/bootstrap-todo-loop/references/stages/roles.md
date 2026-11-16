# Stage: roles — roles and permissions

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: `docs/how-to/add-organizations.md`, skill `terreno:terreno-backend-api`

## Do

1. Use the template's seeded RBAC roles (`access.roles.seedDefaults()`: `operator`, `org-admin`). Call `seedDefaults` at startup and give the seeded admin user the `org-admin` role.
2. A member must get 403/404 on admin routes and on another user's todo; an admin can reach both.
3. Add a backend test for each of those three rules.

## Done when

`seedDefaults` runs at startup, the admin holds `org-admin`, the tests pass, and both packages type-check.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
