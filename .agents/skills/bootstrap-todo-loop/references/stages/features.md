# Stage: features — todo features

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: skill `terreno:terreno-backend-api`, `docs/reference/syncdb.md`

## Do

1. Todos support create, edit title, complete, delete, a `dueDate` (Luxon, never `Date`) and an all/active/done filter on the list screen.
2. Todos are owner-scoped and use the synced (syncdb) collection, so they work offline.
3. Add backend tests for the owner scoping and `dueDate` field; every Mongoose field gets a `description`.

## Done when

The Todo model has `dueDate`, the list screen has the filter, and both packages type-check.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
